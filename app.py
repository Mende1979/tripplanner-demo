from __future__ import annotations
from flask import Flask, request, make_response
from dataclasses import dataclass
from datetime import datetime, date, time, timedelta
from typing import Optional, List
import urllib.parse as _url
import uuid

app = Flask(__name__)

# ---------- Modelli ----------
@dataclass
class TransportOption:
    mode: str      # "flight" | "train" | "drive"
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
    rating: float
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

# ---------- Provider MOCK ----------
def mock_flights(origin: str, dest: str, d: date) -> List[TransportOption]:
    base = datetime.combine(d, time(8, 0))
    return [
        TransportOption("flight", "ITA Airways", base, base + timedelta(hours=2, minutes=25), 79, 145, 0, "Diretto"),
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
    return [TransportOption("drive", "Auto (stima)", base, base + timedelta(hours=4, minutes=20), 45, 260, 0, "Carburante+pedaggi stimati")]

def mock_lodging(city: str, d_from: date, d_to: date, max_per_night: Optional[float]) -> List[LodgingOption]:
    data = [
        LodgingOption("Hotel Centro Storico", city, 110, 4.5, 1800, "https://example.com/hotel1"),
        LodgingOption("B&B Panoramico", city, 85, 4.7, 650, "https://example.com/bnb1"),
        LodgingOption("Aparthotel Easy", city, 95, 4.2, 420, "https://example.com/apt1"),
        LodgingOption("Ostello Smart", city, 45, 4.0, 1200, "https://example.com/hostel1"),
    ]
    return [l for l in data if (max_per_night is None or l.price_per_night_eur <= max_per_night)]

# ---------- Scoring ----------
def score_transport(opt: TransportOption, w_price=0.55, w_time=0.35, w_transfers=0.10) -> float:
    price_cap, time_cap, transfers_cap = 200, 420, 2
    s_price = max(0.0, 1 - (opt.price_eur / price_cap))
    s_time = max(0.0, 1 - (opt.duration_min / time_cap))
    s_transfers = max(0.0, 1 - (opt.transfers / transfers_cap))
    return w_price*s_price + w_time*s_time + w_transfers*s_transfers

def score_lodging(opt: LodgingOption, w_rating=0.7, w_price=0.3) -> float:
    rating_score = opt.rating / 5.0
    price_cap = 180
    price_score = max(0.0, 1 - (opt.price_per_night_eur / price_cap))
    reviews_bonus = min(0.1, (opt.reviews_count / 2000) * 0.1)
    return w_rating*rating_score + w_price*price_score + reviews_bonus

# ---------- ICS + GCal ----------
TZID = "Europe/Rome"

def _fmt(dt: datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%S")

def make_ics(title: str, events: List[Event], alarm_min: int = 45) -> str:
    now_utc = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    lines = [
        "BEGIN:VCALENDAR",
        "PRODID:-//TripPlanner AI//Transport+Lodging//IT",
        "VERSION:2.0",
        "CALSCALE:GREGORIAN",
        f"X-WR-CALNAME:{title}",
        f"X-WR-TIMEZONE:{TZID}",
    ]
    for e in events:
        lines += [
            "BEGIN:VEVENT",
            f"UID:{uuid.uuid4()}@tripplanner",
            f"DTSTAMP:{now_utc}",
            f"DTSTART;TZID={TZID}:{_fmt(e.start)}",
            f"DTEND;TZID={TZID}:{_fmt(e.end)}",
            f"SUMMARY:{e.title}",
        ]
        if e.location:
            lines.append(f"LOCATION:{e.location}")
        desc = []
        if e.notes: desc.append(e.notes)
        if e.url:   desc.append(f"Link: {e.url}")
        if desc:
            lines.append("DESCRIPTION:" + "\\n".join(desc))
        if alarm_min:
            lines += [
                "BEGIN:VALARM",
                f"TRIGGER:-PT{int(alarm_min)}M",
                "ACTION:DISPLAY",
                "DESCRIPTION:Promemoria",
                "END:VALARM",
            ]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(lines) + "\r\n"

def gcal_link(e: Event) -> str:
    base = "https://calendar.google.com/calendar/render?action=TEMPLATE"
    q = {"text": e.title, "dates": f"{_fmt(e.start)}/{_fmt(e.end)}", "details": e.notes or "", "location": e.location or ""}
    return base + "&" + _url.urlencode(q)

# ---------- Core ----------
def pick_best_transport(origin: str, dest: str, d: date, modes: List[str]) -> TransportOption:
    options: List[TransportOption] = []
    if "flight" in modes: options += mock_flights(origin, dest, d)
    if "train" in modes:  options += mock_trains(origin, dest, d)
    if "drive" in modes:  options += mock_drive(origin, dest, d)
    return max(options, key=score_transport)

def pick_best_lodging(city: str, d_from: date, d_to: date, max_per_night: Optional[float]) -> LodgingOption:
    return max(mock_lodging(city, d_from, d_to, max_per_night), key=score_lodging)

# ---------- Pagine ----------
FORM_HTML = """<!doctype html>
<html lang=it><meta charset="utf-8">
<title>TripPlanner — Transport+Lodging MVP</title>
<h1>TripPlanner — Transport + Lodging</h1>
<p>Trova il miglior trasporto (tempo/costo) e una sistemazione ben recensita entro budget.</p>
<form method="post" action="/plan">
  <label>Partenza <input name="origin" value="Bologna" required></label><br>
  <label>Destinazione <input name="dest" value="Lisbona" required></label><br>
  <label>Data partenza <input type="date" name="d_from" value="2025-10-18" required></label><br>
  <label>Data ritorno <input type="date" name="d_to" value="2025-10-21" required></label><br>
  <label>Mezzi:
    <label><input type="checkbox" name="modes" value="flight" checked>Volo</label>
    <label><input type="checkbox" name="modes" value="train"  checked>Treno</label>
    <label><input type="checkbox" name="modes" value="drive"  checked>Auto</label>
  </label><br>
  <label>Budget massimo per notte (€) <input type="number" name="max_night" value="100" min="0"></label><br>
  <label>Promemoria calendario (minuti) <input type="number" name="alarm_min" value="45" min="0"></label><br><br>
  <button type="submit">Cerca soluzioni</button>
</form>
"""

RESULT_HTML = """<!doctype html>
<html lang=it><meta charset="utf-8">
<title>Risultati — TripPlanner</title>
<h1>Risultati</h1>
<h2>Trasporti</h2>
<p><b>Andata</b>: {go_mode} {go_provider} · {go_dep} → {go_arr} · {go_dur} min · {go_tr} transiti · €{go_price} · {go_notes}</p>
<p><b>Ritorno</b>: {bk_mode} {bk_provider} · {bk_dep} → {bk_arr} · {bk_dur} min · {bk_tr} transiti · €{bk_price} · {bk_notes}</p>

<h2>Sistemazione</h2>
<p><b>{stay_name}</b> ({stay_loc}) — Rating {stay_rating}/5 ({stay_rev} recensioni)<br>
€{stay_ppn}/notte × {nights} = <b>€{total_stay}</b><br>
{stay_link}
</p>

<p><a href="/download_ics?token={token}">⬇️ Scarica calendario (.ics)</a></p>

<h3>Aggiungi i singoli eventi su Google Calendar</h3>
<ol>
  {gcal_items}
</ol>

<p><a href="/">↩︎ Nuova ricerca</a></p>
"""

ICS_STORE = {}

@app.get("/")
def index():
    return FORM_HTML

@app.post("/plan")
def plan():
    try:
        origin = request.form.get("origin","").strip()
        dest   = request.form.get("dest","").strip()
        d_from = date.fromisoformat(request.form.get("d_from"))
        d_to   = date.fromisoformat(request.form.get("d_to"))
        if d_to <= d_from:
            return "<h1>Errore</h1><p>La data di ritorno deve essere dopo la partenza.</p><p><a href='/'>Torna indietro</a></p>", 400
        modes = request.form.getlist("modes") or ["flight","train","drive"]
        max_night = request.form.get("max_night","").strip()
        alarm_min = int(request.form.get("alarm_min","45").strip())
        max_per_night = float(max_night) if max_night else None
    except Exception as e:
        return f"<h1>Errore input</h1><p>{e}</p><p><a href='/'>Torna indietro</a></p>", 400

    go   = pick_best_transport(origin, dest, d_from, modes)
    back = pick_best_transport(dest, origin, d_to, modes)
    stay = pick_best_lodging(dest, d_from, d_to, max_per_night)

    nights = (d_to - d_from).days
    total_stay = int(stay.price_per_night_eur * nights)

    events: List[Event] = [
        Event(title=f"Partenza {origin} → {dest} ({go.provider})", start=go.dep_time, end=go.arr_time, location=origin, notes=f"{go.mode} · €{int(go.price_eur)} · {go.notes or ''}"),
        Event(title=f"Check-in {stay.name}", start=datetime.combine(d_from, time(15,0)), end=datetime.combine(d_from, time(16,0)), location=stay.location, url=stay.url, notes=f"€{int(stay.price_per_night_eur)}/notte · Rating {stay.rating}/5"),
        Event(title=f"Check-out {stay.name}", start=datetime.combine(d_to, time(11,0)), end=datetime.combine(d_to, time(11,30)), location=stay.location, url=stay.url),
        Event(title=f"Ritorno {dest} → {origin} ({back.provider})", start=back.dep_time, end=back.arr_time, location=dest, notes=f"{back.mode} · €{int(back.price_eur)} · {back.notes or ''}"),
    ]
    ics = make_ics(f"{dest} — viaggio", events, alarm_min=alarm_min)
    token = uuid.uuid4().hex
    ICS_STORE[token] = ics

    gcal_items = "".join([f'<li><a href="{gcal_link(e)}" target="_blank" rel="noopener">Aggiungi evento {i+1}</a></li>' for i, e in enumerate(events)])
    stay_link = f'<a href="{stay.url}" target="_blank" rel="noopener">Apri link struttura</a>' if stay.url else ""

    html = RESULT_HTML.format(
        go_mode=go.mode.upper(), go_provider=go.provider, go_dep=go.dep_time.strftime("%d %b %H:%M"),
        go_arr=go.arr_time.strftime("%H:%M"), go_dur=go.duration_min, go_tr=go.transfers, go_price=int(go.price_eur), go_notes=(go.notes or ""),
        bk_mode=back.mode.upper(), bk_provider=back.provider, bk_dep=back.dep_time.strftime("%d %b %H:%M"),
        bk_arr=back.arr_time.strftime("%H:%M"), bk_dur=back.duration_min, bk_tr=back.transfers, bk_price=int(back.price_eur), bk_notes=(back.notes or ""),
        stay_name=stay.name, stay_loc=stay.location, stay_rating=stay.rating, stay_rev=stay.reviews_count, stay_ppn=int(stay.price_per_night_eur),
        nights=nights, total_stay=total_stay, stay_link=stay_link,
        token=token, gcal_items=gcal_items
    )
    return html

@app.get("/download_ics")
def download_ics():
    token = request.args.get("token")
    ics = ICS_STORE.get(token)
    if not ics:
        return "Calendario non trovato", 404
    resp = make_response(ics)
    resp.headers["Content-Type"] = "text/calendar; charset=utf-8"
    resp.headers["Content-Disposition"] = f"attachment; filename=tripplanner_{token}.ics"
    return resp

if __name__ == "__main__":
    app.run(debug=True)
