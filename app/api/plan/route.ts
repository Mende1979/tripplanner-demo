import { NextResponse } from 'next/server'
if (alarmMin && alarmMin > 0) {
lines.push('BEGIN:VALARM', `TRIGGER:-PT${Math.floor(alarmMin)}M`, 'ACTION:DISPLAY', 'DESCRIPTION:Promemoria', 'END:VALARM')
}
lines.push('END:VEVENT')
}
lines.push('END:VCALENDAR')
return lines.join('\r\n') + '\r\n'
}


// ===== Core =====
function pickBestTransport(origin: string, dest: string, depart: { y: number; m: number; d: number }, modes: string[]): TransportOption {
let opts: TransportOption[] = []
if (modes.includes('flight')) opts = opts.concat(mockFlights(origin, dest, depart))
if (modes.includes('train')) opts = opts.concat(mockTrains(origin, dest, depart))
if (modes.includes('drive')) opts = opts.concat(mockDrive(origin, dest, depart))
return opts.sort((a, b) => scoreTransport(b) - scoreTransport(a))[0]
}
function pickBestLodging(city: string, dFrom: { y: number; m: number; d: number }, dTo: { y: number; m: number; d: number }, maxPerNight?: number): LodgingOption {
return mockLodging(city, dFrom, dTo, maxPerNight).sort((a, b) => scoreLodging(b) - scoreLodging(a))[0]
}


export async function POST(req: Request) {
const body = await req.json()
const origin = String(body.origin || '')
const dest = String(body.dest || '')
const dFromISO = String(body.departDate || '')
const dToISO = String(body.returnDate || '')
const modes: string[] = Array.isArray(body.modes) ? body.modes : ['flight', 'train', 'drive']
const maxPerNight = body.maxNight ? Number(body.maxNight) : undefined
const alarmMin = body.alarmMin ? Number(body.alarmMin) : 45


if (!origin || !dest || !dFromISO || !dToISO) {
return NextResponse.json({ error: 'origin, dest, departDate, returnDate sono obbligatori' }, { status: 400 })
}
const dFrom = parseISODate(dFromISO)
const dTo = parseISODate(dToISO)
if (new Date(`${dToISO}T00:00:00`) <= new Date(`${dFromISO}T00:00:00`)) {
return NextResponse.json({ error: 'La data di ritorno deve essere dopo la partenza' }, { status: 400 })
}


const go = pickBestTransport(origin, dest, dFrom, modes)
const back = pickBestTransport(dest, origin, dTo, modes)
const stay = pickBestLodging(dest, dFrom, dTo, maxPerNight)


const nights = Math.max(1, Math.round((new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime()) / (1000*60*60*24)))
const totalStay = Math.round(stay.pricePerNight * nights)


const events: EventItem[] = [
{ title: `Partenza ${origin} → ${dest} (${go.provider})`, start: go.dep, end: go.arr, location: origin, notes: `${go.mode} · €${Math.round(go.price)} · ${go.notes || ''}` },
{ title: `Check-in ${stay.name}`, start: { ...dFrom, hh: 15, mm: 0 }, end: { ...dFrom, hh: 16, mm: 0 }, location: stay.location, url: stay.url, notes: `€${Math.round(stay.pricePerNight)}/notte · Rating ${stay.rating}/5` },
{ title: `Check-out ${stay.name}`, start: { ...dTo, hh: 11, mm: 0 }, end: { ...dTo, hh: 11, mm: 30 }, location: stay.location, url: stay.url },
{ title: `Ritorno ${dest} → ${origin} (${back.provider})`, start: back.dep, end: back.arr, location: dest, notes: `${back.mode} · €${Math.round(back.price)} · ${back.notes || ''}` },
]


const ics = makeICS(`${dest} — viaggio`, events, alarmMin)
const gcalLinks = events.map(gcalLink)


const result = {
go: { ...go, depText: toDisplay(go.dep), arrText: toDisplay(go.arr) },
back: { ...back, depText: toDisplay(back.dep), arrText: toDisplay(back.arr) },
stay,
nights,
totalStay,
events,
gcalLinks,
ics, // stringa che il client può scaricare come file
}
return NextResponse.json(result)
}