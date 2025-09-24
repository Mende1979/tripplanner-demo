import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'   // <-- usa Node Crypto
export const runtime = 'nodejs'       // <-- forza runtime Node (non Edge)

// ===== Tipi =====
export type TransportOption = {
  mode: 'flight' | 'train' | 'drive'
  provider: string
  dep: { y: number; m: number; d: number; hh: number; mm: number }
  arr: { y: number; m: number; d: number; hh: number; mm: number }
  price: number
  durationMin: number
  transfers?: number
  notes?: string
}

export type LodgingOption = {
  name: string
  location: string
  pricePerNight: number
  rating: number // 0..5
  reviews: number
  url?: string
}

export type EventItem = {
  title: string
  start: { y: number; m: number; d: number; hh: number; mm: number; ss?: number }
  end: { y: number; m: number; d: number; hh: number; mm: number; ss?: number }
  location?: string
  url?: string
  notes?: string
}

// ===== Helpers data/time =====
function fmtNum(n: number, len: number) {
  return n.toString().padStart(len, '0')
}
function fmtICS(dt: { y: number; m: number; d: number; hh: number; mm: number; ss?: number }) {
  const ss = dt.ss ?? 0
  return `${fmtNum(dt.y, 4)}${fmtNum(dt.m, 2)}${fmtNum(dt.d, 2)}T${fmtNum(dt.hh, 2)}${fmtNum(dt.mm, 2)}${fmtNum(ss, 2)}`
}
function toDisplay(dt: { y: number; m: number; d: number; hh: number; mm: number }) {
  return `${fmtNum(dt.d, 2)}/${fmtNum(dt.m, 2)}/${dt.y} ${fmtNum(dt.hh, 2)}:${fmtNum(dt.mm, 2)}`
}
function parseISODate(d: string) {
  const [y, m, dd] = d.split('-').map(Number)
  return { y, m, d: dd }
}

// ===== MOCK providers =====
function mockFlights(origin: string, dest: string, depart: { y: number; m: number; d: number }): TransportOption[] {
  return [
    { mode: 'flight', provider: 'ITA Airways', dep: { ...depart, hh: 8,  mm: 0 },  arr: { ...depart, hh: 10, mm: 25 }, price: 79,  durationMin: 145, transfers: 0, notes: 'Diretto' },
    { mode: 'flight', provider: 'Ryanair',    dep: { ...depart, hh: 14, mm: 0 },  arr: { ...depart, hh: 16, mm: 35 }, price: 39,  durationMin: 155, transfers: 0, notes: 'Diretto' },
    { mode: 'flight', provider: 'Lufthansa',  dep: { ...depart, hh: 9,  mm: 0 },  arr: { ...depart, hh: 13, mm: 40 }, price: 129, durationMin: 220, transfers: 1, notes: '1 scalo FRA' },
  ]
}
function mockTrains(origin: string, dest: string, depart: { y: number; m: number; d: number }): TransportOption[] {
  return [
    { mode: 'train', provider: 'Frecciarossa', dep: { ...depart, hh: 7, mm: 30 }, arr: { ...depart, hh: 10, mm: 35 }, price: 59, durationMin: 185, transfers: 0, notes: 'Alta velocità' },
    { mode: 'train', provider: 'Italo',        dep: { ...depart, hh: 8, mm: 30 }, arr: { ...depart, hh: 12, mm: 30 }, price: 49, durationMin: 240, transfers: 0, notes: 'Diretto' },
  ]
}
function mockDrive(origin: string, dest: string, depart: { y: number; m: number; d: number }): TransportOption[] {
  return [
    { mode: 'drive', provider: 'Auto (stima)', dep: { ...depart, hh: 6, mm: 45 }, arr: { ...depart, hh: 11, mm: 5 }, price: 45, durationMin: 260, transfers: 0, notes: 'Carburante+pedaggi' },
  ]
}
function mockLodging(city: string, dFrom: { y: number; m: number; d: number }, dTo: { y: number; m: number; d: number }, maxPerNight?: number): LodgingOption[] {
  const data: LodgingOption[] = [
    { name: 'Hotel Centro Storico', location: city, pricePerNight: 110, rating: 4.5, reviews: 1800, url: 'https://example.com/hotel1' },
    { name: 'B&B Panoramico',       location: city, pricePerNight: 85,  rating: 4.7, reviews: 650,  url: 'https://example.com/bnb1' },
    { name: 'Aparthotel Easy',      location: city, pricePerNight: 95,  rating: 4.2, reviews: 420,  url: 'https://example.com/apt1' },
    { name: 'Ostello Smart',        location: city, pricePerNight: 45,  rating: 4.0, reviews: 1200, url: 'https://example.com/hostel1' },
  ]
  return data.filter(l => maxPerNight == null || l.pricePerNight <= maxPerNight)
}

// ===== Scoring =====
function scoreTransport(opt: TransportOption, w_price = 0.55, w_time = 0.35, w_transfers = 0.10) {
  const priceCap = 200
  const timeCap = 420 // 7h
  const transfersCap = 2
  const sPrice = Math.max(0, 1 - opt.price / priceCap)
  const sTime = Math.max(0, 1 - opt.durationMin / timeCap)
  const sTransfers = Math.max(0, 1 - (opt.transfers || 0) / transfersCap)
  return w_price * sPrice + w_time * sTime + w_transfers * sTransfers
}
function scoreLodging(opt: LodgingOption, w_rating = 0.7, w_price = 0.3) {
  const ratingScore = opt.rating / 5
  const priceCap = 180
  const priceScore = Math.max(0, 1 - opt.pricePerNight / priceCap)
  const reviewsBonus = Math.min(0.1, (opt.reviews / 2000) * 0.1)
  return w_rating * ratingScore + w_price * priceScore + reviewsBonus
}

// ===== Google Calendar link =====
function gcalLink(e: EventItem) {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
  const dates = `${fmtICS(e.start)}/${fmtICS(e.end)}`
  const params = new URLSearchParams({ text: e.title, dates, details: e.notes || '', location: e.location || '' })
  return `${base}&${params.toString()}`
}

// ===== ICS =====
const TZID = 'Europe/Rome'
function makeICS(title: string, events: EventItem[], alarmMin = 45) {
  const now = new Date()
  const dtstamp = `${fmtNum(now.getUTCFullYear(), 4)}${fmtNum(now.getUTCMonth() + 1, 2)}${fmtNum(now.getUTCDate(), 2)}T${fmtNum(now.getUTCHours(), 2)}${fmtNum(now.getUTCMinutes(), 2)}${fmtNum(now.getUTCSeconds(), 2)}Z`
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//TripPlanner AI//Transport+Lodging//IT',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${title}`,
    `X-WR-TIMEZONE:${TZID}`,
  ]
  for (const e of events) {
    const uid = randomUUID() // <-- qui
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TZID}:${fmtICS(e.start)}`,
      `DTEND;TZID=${TZID}:${fmtICS(e.end)}`,
      `SUMMARY:${e.title}`,
    )
    if (e.location) lines.push(`LOCATION:${e.location}`)
    const descParts: string[] = []
    if (e.notes) descParts.push(e.notes)
    if (e.url) descParts.push(`Link: ${e.url}`)
    if (descParts.length) lines.push(`DESCRIPTION:${descParts.join('\\n')}`)
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
  if (modes.includes('train'))  opts = opts.concat(mockTrains(origin, dest, depart))
  if (modes.includes('drive'))  opts = opts.concat(mockDrive(origin, dest, depart))
  return opts.sort((a, b) => scoreTransport(b) - scoreTransport(a))[0]
}
function pickBestLodging(city: string, dFrom: { y: number; m: number; d: number }, dTo: { y: number; m: number; d: number }, maxPerNight?: number): LodgingOption {
  return mockLodging(city, dFrom, dTo, maxPerNight).sort((a, b) => scoreLodging(b) - scoreLodging(a))[0]
}

// ===== Handler =====
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

  const nights = Math.max(1, Math.round((new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)))
  const totalStay = Math.round(stay.pricePerNight * nights)

  const events: EventItem[] = [
    { title: `Partenza ${origin} → ${dest} (${go.provider})`, start: { ...go.dep, ss: 0 }, end: { ...go.arr, ss: 0 }, location: origin, notes: `${go.mode} · €${Math.round(go.price)} · ${go.notes || ''}` },
    { title: `Check-in ${stay.name}`, start: { ...dFrom, hh: 15, mm: 0, ss: 0 }, end: { ...dFrom, hh: 16, mm: 0, ss: 0 }, location: stay.location, url: stay.url, notes: `€${Math.round(stay.pricePerNight)}/notte · Rating ${stay.rating}/5` },
    { title: `Check-out ${stay.name}`, start: { ...dTo, hh: 11, mm: 0, ss: 0 }, end: { ...dTo, hh: 11, mm: 30, ss: 0 }, location: stay.location, url: stay.url },
    { title: `Ritorno ${dest} → ${origin} (${back.provider})`, start: { ...back.dep, ss: 0 }, end: { ...back.arr, ss: 0 }, location: dest, notes: `${back.mode} · €${Math.round(back.price)} · ${back.notes || ''}` },
  ]

  const ics = makeICS(`${dest} — viaggio`, events, alarmMin)
  const gcalLinks = events.map(gcalLink)

  return NextResponse.json({
    go: { ...go, depText: toDisplay(go.dep), arrText: toDisplay(go.arr) },
    back: { ...back, depText: toDisplay(back.dep), arrText: toDisplay(back.arr) },
    stay,
    nights,
    totalStay,
    gcalLinks,
    ics, // stringa ICS per il download lato client
  })
}
