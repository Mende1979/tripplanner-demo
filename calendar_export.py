from datetime import datetime
import uuid

TZID = "Europe/Rome"

def make_ics(trip_title: str, events: list, add_alarm_minutes: int = 30) -> str:
    now_utc = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    header = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"X-WR-CALNAME:{trip_title}",
    ]

    body_lines = []
    for e in events:
        uid = f"{uuid.uuid4()}@tripplanner.ai"
        body = [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{now_utc}",
            f"DTSTART:{e['start'].strftime('%Y%m%dT%H%M%S')}",
            f"DTEND:{e['end'].strftime('%Y%m%dT%H%M%S')}",
            f"SUMMARY:{e['title']}",
            "END:VEVENT",
        ]
        body_lines += body

    footer = ["END:VCALENDAR"]
    return "\r\n".join(header + body_lines + footer) + "\r\n"


if __name__ == "__main__":
    demo_events = [
        {
            "title": "Check-in hotel",
            "start": datetime(2025, 10, 18, 15, 0),
            "end": datetime(2025, 10, 18, 15, 30),
        },
        {
            "title": "Visita centro storico",
            "start": datetime(2025, 10, 18, 17, 0),
            "end": datetime(2025, 10, 18, 19, 0),
        },
    ]
    ics = make_ics("Lisbona weekend", demo_events)
    with open("tripplanner_demo.ics", "w", encoding="utf-8") as f:
        f.write(ics)
    print("File tripplanner_demo.ics generato con successo!")
