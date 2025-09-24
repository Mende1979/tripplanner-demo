#!/usr/bin/env python3
"""
TripPlanner — MVP Agent (single-file, no deps)
- Interactive CLI agent (Q&A) che costruisce un mini itinerario realistico
- Genera un file .ics e stampa i link "Aggiungi a Google Calendar" per ogni evento
- Nessuna dipendenza esterna: solo Python standard library

Uso:
  python agent_mvp.py

Note:
- Timezone: Europe/Rome (semplificato: orari locali senza conversioni)
- Slot standard: 09:00–12:30 / 14:30–18:00 / 20:00–22:00
- Max 3 attività core/giorno
"""
from __future__ import annotations
from datetime import datetime, date, time, timedelta
from dataclasses import dataclass
from typing import List, Optional
import urllib.parse as _url
import uuid

# ==========================
# Calendar (.ics) utilities
# ==========================
TZID = "Europe/Rome"


def _escape_ics(text: Optional[str]) -> str:
    if not text:
        return ""
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\n", "\\n")
    )


def _fmt_dt_local(dt: datetime) -> str:
    # local naive datetime → basic format
    return dt.strftime("%Y%m%dT%H%M%S")


VTIMEZONE_EUROPE_ROME = "\r\n".join(
    [
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
    ]
)


def make_ics(trip_title: str, events: List["Event"], add_alarm_minutes: int = 30) -> str:
    now_utc = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    header = [
        "BEGIN:VCALENDAR",
        "PRODID:-//TripPlanner AI//MVP//IT",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape_ics(trip_title)}",
        f"X-WR-TIMEZONE:{TZID}",
        VTIMEZONE_EUROPE_ROME,
    ]

    body_lines = []
    for e in events:
        uid = f"{uuid.uuid4()}@tripplanner.mvp"
        body = [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_utc}",
            f"DTSTART;TZID={TZID}:{_fmt_dt_local(e.start)}",
            f"DTEND;TZID={TZID}:{_fmt_dt_local(e.end)}",
            f"SUMMARY:{_escape_ics(e.title)}",
        ]
        if e.location:
            body.append(f"LOCATION:{_escape_ics(e.location)}")
        desc_parts = []
        if e.notes:
            desc_parts.append(e.notes)
        if e.url:
            desc_parts.append(f"Link: {e.url}")
        if desc_parts:
            body.append(f"DESCRIPTION:{_escape_ics('\n'.join(desc_parts))}")
        if add_alarm_minutes and add_alarm_minutes > 0:
            body += [
                "BEGIN:VALARM",
                f"TRIGGER:-PT{int(add_alarm_minutes)}M",
                "ACTION:DISPLAY",
                "DESCRIPTION:Promemoria",
                "END:VALARM",
            ]
        body.append("END:VEVENT")
        body_lines += body

    footer = ["END:VCALENDAR"]
    ics = "\r\n".join(header + body_lines + footer) + "\r\n"
    return ics


# ==========================
# Google Calendar link utils
# ==========================

def gcal_link(e: "Event") -> str:
    base = "https://calendar.google.com/calendar/render?action=TEMPLATE"
    q = {
        "text": e.title,
        "dates": f"{e.start.strftime('%Y%m%dT%H%M%S')}/{e.end.strftime('%Y%m%dT%H%M%S')}",
        "details": e.notes or "",
        "location": e.location or "",
    }
    return base + "&" + _url.urlencode(q)


# ==========================
# Minimal planner (rule-based)
# ==========================

@dataclass
class Event:
    title: str
    start: datetime
    end: datetime
    location: Optional[str] = None
    url: Optional[str] = None
    notes: Optional[str] = None


SLOTS = [
    (time(9, 0), time(12, 30), "Mattina"),
    (time(14, 30), time(18, 0), "Pomeriggio"),
    (time(20, 0), time(22, 0), "Sera"),
]


INTEREST_TEMPLATES = {
    "arte": ["Museo principale", "Centro storico", "Galleria locale"],
    "cibo": ["Food market", "Street food tour", "Trattoria tipica"],
    "outdoor": ["Parco panoramico", "Passeggiata sul lungofiume", "Belvedere"],
    "bambini": ["Parco giochi", "Acquario / zoo", "Laboratorio per bimbi"],
}


def daterange(d0: date, d1: date):
    cur = d0
    one = timedelta(days=1)
    while cur <= d1:
        yield cur
        cur += one


def build_itinerary(city: str, start_d: date, end_d: date, pace: str, interests: List[str]) -> List[Event]:
    events: List[Event] = []
    # Per semplicità: 2 slot se pace="relax", 3 slot se pace="intenso" (default: 3)
    slots_per_day = 2 if pace.lower().startswith("r") else 3

    # Scegli un template per giorno in base agli interessi (mixa se >1)
    templates: List[str] = []
    for i in interests:
        templates += INTEREST_TEMPLATES.get(i.strip().lower(), [])
    if not templates:
        templates = [
            "Passeggiata nel centro",
            "Caffè in piazza",
            "Punto panoramico",
        ]

    ti = 0  # indice sul template
    for d in daterange(start_d, end_d):
        day_templates = templates[ti : ti + slots_per_day]
        if len(day_templates) < slots_per_day:
            # ricomincia se finisce la lista
            ti = 0
            day_templates = templates[ti : ti + slots_per_day]
        ti += slots_per_day

        for idx, (t0, t1, _label) in enumerate(SLOTS[:slots_per_day]):
            title = f"{day_templates[idx]} — {city}"
            start_dt = datetime.combine(d, t0)
            end_dt = datetime.combine(d, t1)
            events.append(
                Event(
                    title=title,
                    start=start_dt,
                    end=end_dt,
                    location=city,
                    notes=f"Slot {_label}"
                )
            )
    return events


# ==========================
# CLI agent (no LLM)
# ==========================

def ask(prompt: str, default: Optional[str] = None) -> str:
    msg = prompt
    if default:
        msg += f" [{default}]"
    msg += ": "
    val = input(msg).strip()
    return val or (default or "")


def main():
    print("\n=== TripPlanner — MVP Agent (senza dipendenze) ===\n")
    city = ask("Dove vuoi andare?", "Lisbona")
    d_from_s = ask("Data di inizio (YYYY-MM-DD)", "2025-10-18")
    d_to_s = ask("Data di fine (YYYY-MM-DD)", "2025-10-20")
    pace = ask("Ritmo (relax / intenso)", "relax")
    interests_s = ask("Interessi (separa con virgola: arte, cibo, outdoor, bambini)", "cibo, panorami")

    # normalizza interessi
    interests = [s.strip().lower() for s in interests_s.split(",") if s.strip()]

    try:
        d_from = date.fromisoformat(d_from_s)
        d_to = date.fromisoformat(d_to_s)
        if d_to < d_from:
            raise ValueError("La data di fine è precedente a quella di inizio")
    except Exception as e:
        print(f"Errore nelle date: {e}")
        return

    title = f"{city} — {d_from.strftime('%d %b')}→{d_to.strftime('%d %b')}"
    events = build_itinerary(city, d_from, d_to, pace, interests)

    # Genera file .ics
    ics = make_ics(title, events, add_alarm_minutes=30)
    fname = "tripplanner_mvp.ics"
    with open(fname, "w", encoding="utf-8") as f:
        f.write(ics)

    print("\nItinerario creato!\n")
    for i, e in enumerate(events, 1):
        print(f"{i:02d}. {e.title} | {e.start.strftime('%a %d %b %H:%M')} → {e.end.strftime('%H:%M')}")

    print(f"\n📅 File calendario generato: {fname}")
    print("(Importalo su Google Calendar / Apple / Outlook)")

    # Stampa link Google Calendar per ogni evento
    print("\nLink 'Aggiungi a Google Calendar' per i singoli eventi:")
    for i, e in enumerate(events, 1):
        print(f"{i:02d}. {gcal_link(e)}")


if __name__ == "__main__":
    main()
