#!/usr/bin/env python3
"""
TripPlanner — MVP Transport+Lodging Agent (single-file, no deps)
Obiettivo: dati origine, destinazione e date, trova
- SOLUZIONE DI TRASPORTO (volo / treno / auto) migliore per tempo/costo
- SISTEMAZIONE (hotel/bnb) ben recensita entro budget

Nota: provider MOCK per ora. Struttura pronta per sostituzione con API reali (Skyscanner/Amadeus, Trainline, Google/Booking API, OpenRouteService).
Output:
- riepilogo a schermo con best option
- file .ics con 3 eventi: Partenza, Check-in, Check-out (più ritorno se presente)
- link "Aggiungi a Google Calendar" per ciascun evento
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, date, time, timedelta
from typing import List, Optional, Dict
import uuid
import urllib.parse as _url

# ==========================
# Models
# ==========================

@dataclass
class TransportOption:
    mode: str  # "flight" | "train" | "drive"
    provider: str
    dep_time: datetime
    arr_time: datetime
    price_eur: float
    duration_min: int
    transfers: int = 0
    notes: Optional[str] = None

@dataclass
class LodgingOption:
    name: str
    location: str
    price_per_night_eur: float
    rating: float  # 0..5
    reviews_count: int
    url: Optional[str] = None

@dataclass
class Event:
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None

# ==========================
# MOCK providers (replace later)
# ==========================

def mock_flights(origin: str, dest: str, d: date) -> List[TransportOption]:
    base = datetime.combine(d, time(8, 0))
    return [
        TransportOption("flight", "AZ/ITA Airways", base, base + timedelta(hours=2, minutes=25), 79, 145, 0, "Diretto"),
        TransportOption("flight", "Ryanair", base + timedelta(hours=6), base + timedelta(hours=8, minutes=35), 39, 155, 0, "Diretto"),
        TransportOption("flight", "Lufthansa", base + timedelta(hours=1), base + timedelta(hours=4, minutes=40), 129, 220, 1, "1 scalo FRA"),
    ]

def mock_trains(origin: str, dest: str, d: date) -> List[TransportOption]:
    base = datetime.combine(d, time(7, 30))
    return [
        TransportOption("train", "Frecciarossa", base, base + timedelta(hours=3, minutes=5), 59, 185, 0, "Alta velocità"),
        TransportOption("train", "Italo", base + timedelta(hours=1), base + timedelta(hours=4, minutes=0), 49, 240, 0, "Diretto"),
    ]

def mock_drive(origin: str, dest: str, d: date) -> List[TransportOption]:
    base = datetime.combine(d, time(6, 45))
    # durata 4h20, costi stimati carburante+pedaggi 45€
    return [TransportOption("drive", "Auto (stima)", base, base + timedelta(hours=4, minutes=20), 45, 260, 0, "Carburante+pedaggi stimati")]

def mock_lodging(city: str, d_from: date, d_to: date, max_per_night: Optional[float]) -> List[LodgingOption]:
    nights = (d_to - d_from).days or 1
    data = [
        LodgingOption("Hotel Centro Storico", city, 110, 4.5, 1800, "https://example.com/hotel1"),
        LodgingOption("B&B Panoramico", city, 85, 4.7, 650, "https://example.com/bnb1"),
        LodgingOption("Aparthotel Easy", city, 95, 4.2, 420, "https://example.com/apt1"),
        LodgingOption("Ostello Smart", city, 45, 4.0, 1200, "https://example.com/hostel1"),
    ]
    out = []
    for l in data:
        if max_per_night is None or l.price_per_night_eur <= max_per_night:
            out.append(l)
    return out

# ==========================
# Scoring
# ==========================

def score_transport(opt: TransportOption, w_price=0.55, w_time=0.35, w_transfers=0.10) -> float:
    # lower price/time/transfers better → convert to scores ~ [0..1]
    # naive normalization using reasonable caps
    price_cap = 200
    time_cap = 420  # 7h
    transfers_cap = 2
    s_price = max(0.0, 1 - (opt.price_eur / price_cap))
    s_time = max(0.0, 1 - (opt.duration_min / time_cap))
    s_transfers = max(0.0, 1 - (opt.transfers / transfers_cap))
    return w_price * s_price + w_time * s_time + w_transfers * s_transfers

def score_lodging(opt: LodgingOption, w_rating=0.7, w_price=0.3) -> float:
    # higher rating better, lower price better
    rating_score = opt.rating / 5.0
    price_cap = 180
    price_score = max(0.0, 1 - (opt.price_per_night_eur / price_cap))
    # reviews bonus (log-like)
    reviews_bonus = min(0.1, (opt.reviews_count / 2000) * 0.1)
    return w_rating * rating_score + w_price * price_score + reviews_bonus

# ==========================
# Calendar (.ics) + GCal links
# ==========================
TZID = "Europe/Rome"

def _escape_ics(text: Optional[str]) -> str:
    if not text:
        return ""
    return text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")

def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%S")

VTIMEZONE_EUROPE_ROME = "\r\n".join([
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Rome",
    "X-LIC-LOCATION:Europe/Rome",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "TZNAME:CEST",
    "DTSTART:19700329T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "TZNAME:CET",
    "DTSTART:19701025T030000",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "END:VTIMEZONE",
])

def make_ics(title: str, events: List[Event], alarm_min: int = 30) -> str:
    now_utc = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    head = [
        "BEGIN:VCALENDAR",
        "PRODID:-//TripPlanner AI//Transport+Lodging//IT",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{_escape_ics(title)}",
        f"X-WR-TIMEZONE:{TZID}",
        VTIMEZONE_EUROPE_ROME,
    ]
    body = []
    for e in events:
        uid = f"{uuid.uuid4()}@tripplanner"
        body += [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_utc}",
            f"DTSTART;TZID={TZID}:{_fmt(e.start)}",
            f"DTEND;TZID={TZID}:{_fmt(e.end)}",
            f"SUMMARY:{_escape_ics(e.title)}",
        ]
        if e.location:
            body.append(f"LOCATION:{_escape_ics(e.location)}")
        desc = []
        if e.notes:
            desc.append(e.notes)
        if e.url:
            desc.append(f"Link: {e.url}")
        if desc:
            body.append(f"DESCRIPTION:{_escape_ics('\n'.join(desc))}")
        if alarm_min:
            body += [
                "BEGIN:VALARM",
                f"TRIGGER:-PT{int(alarm_min)}M",
                "ACTION:DISPLAY",
                "DESCRIPTION:Promemoria",
                "END:VALARM",
            ]
        body.append("END:VEVENT")
    tail = ["END:VCALENDAR"]
    return "\r\n".join(head + body + tail) + "\r\n"


def gcal_link(e: Event) -> str:
    base = "https://calendar.google.com/calendar/render?action=TEMPLATE"
    q = {"text": e.title, "dates": f"{_fmt(e.start)}/{_fmt(e.end)}", "details": e.notes or "", "location": e.location or ""}
    return base + "&" + _url.urlencode(q)

# ==========================
# Planner core
# ==========================

def pick_best_transport(origin: str, dest: str, d: date, modes: List[str]) -> TransportOption:
    options: List[TransportOption] = []
    if "flight" in modes:
        options += mock_flights(origin, dest, d)
    if "train" in modes:
        options += mock_trains(origin, dest, d)
    if "drive" in modes:
        options += mock_drive(origin, dest, d)
    # best by score
    best = max(options, key=score_transport)
    return best

def pick_best_lodging(city: str, d_from: date, d_to: date, max_per_night: Optional[float]) -> LodgingOption:
    options = mock_lodging(city, d_from, d_to, max_per_night)
    best = max(options, key=score_lodging)
    return best

# ==========================
# CLI agent
# ==========================

def ask(prompt: str, default: Optional[str] = None) -> str:
    msg = prompt
    if default:
        msg += f" [{default}]"
    msg += ": "
    x = input(msg).strip()
    return x or (default or "")


def main():
    print("\n=== TripPlanner — MVP Transport+Lodging ===\n")
    origin = ask("Città di partenza", "Bologna")
    dest = ask("Destinazione", "Lisbona")
    d_from_s = ask("Data di partenza (YYYY-MM-DD)", "2025-10-18")
    d_to_s = ask("Data di ritorno (YYYY-MM-DD)", "2025-10-21")
    modes_s = ask("Mezzi consentiti (comma): flight, train, drive", "flight, train, drive")
    max_night_s = ask("Budget massimo per notte (vuoto = nessun limite)", "100")

    try:
        d_from = date.fromisoformat(d_from_s)
        d_to = date.fromisoformat(d_to_s)
        if d_to <= d_from:
            raise ValueError("Il ritorno deve essere dopo la partenza")
        max_per_night = float(max_night_s) if max_night_s else None
    except Exception as e:
        print(f"Errore input: {e}")
        return

    modes = [m.strip().lower() for m in modes_s.split(',') if m.strip()]

    # PICK SOLUTIONS
    out_go = pick_best_transport(origin, dest, d_from, modes)
    out_back = pick_best_transport(dest, origin, d_to, modes)
    stay = pick_best_lodging(dest, d_from, d_to, max_per_night)

    # SUMMARY
    print("\nSoluzione migliore — TRASPORTI")
    for leg_name, leg in [("Andata", out_go), ("Ritorno", out_back)]:
        print(f"- {leg_name}: {leg.mode.upper()} {leg.provider} | {leg.dep_time.strftime('%d %b %H:%M')} → {leg.arr_time.strftime('%H:%M')} | {leg.duration_min} min | {leg.transfers} transiti | €{leg.price_eur:.0f} | {leg.notes or ''}")

    print("\nSoluzione migliore — SISTEMAZIONE")
    nights = (d_to - d_from).days
    total_stay = stay.price_per_night_eur * nights
    print(f"- {stay.name} ({stay.location}) | Rating {stay.rating}/5 ({stay.reviews_count} recensioni) | €{stay.price_per_night_eur:.0f}/notte × {nights} = €{total_stay:.0f}")
    if stay.url:
        print(f"  Link: {stay.url}")

    # Calendar events
    events: List[Event] = [
        Event(title=f"Partenza {origin} → {dest} ({out_go.provider})", start=out_go.dep_time, end=out_go.arr_time, location=origin, notes=f"{out_go.mode} | €{out_go.price_eur:.0f} | {out_go.notes or ''}"),
        Event(title=f"Check-in {stay.name}", start=datetime.combine(d_from, time(15, 0)), end=datetime.combine(d_from, time(16, 0)), location=stay.location, url=stay.url, notes=f"€{stay.price_per_night_eur:.0f}/notte | Rating {stay.rating}/5"),
        Event(title=f"Check-out {stay.name}", start=datetime.combine(d_to, time(11, 0)), end=datetime.combine(d_to, time(11, 30)), location=stay.location, url=stay.url, notes=""),
        Event(title=f"Ritorno {dest} → {origin} ({out_back.provider})", start=out_back.dep_time, end=out_back.arr_time, location=dest, notes=f"{out_back.mode} | €{out_back.price_eur:.0f} | {out_back.notes or ''}"),
    ]

    ics = make_ics(f"{dest} — viaggio", events, alarm_min=45)
    fname = "tripplanner_transport_lodging.ics"
    with open(fname, "w", encoding="utf-8") as f:
        f.write(ics)

    print(f"\n📅 Calendario generato: {fname}")
    print("Link 'Aggiungi a Google Calendar' (singoli eventi):")
    for i, e in enumerate(events, 1):
        print(f"{i:02d}. {gcal_link(e)}")


if __name__ == "__main__":
    main()
