
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
export const runtime = 'nodejs'

// ---------- Types (coerenti con la UI) ----------
type TransportMode = 'flight' | 'train' | 'drive'
type YMD = { y: number; m: number; d: number }
type HMS = { hh: number; mm: number; ss?: number }

export type TransportOption = {
  mode: TransportMode
  provider: string
  dep: YMD & HMS
  arr: YMD & HMS
  price: number
  durationMin: number
  transfers?: number
  notes?: string
}
export type LodgingOption = {
  name: string
  location: string
  pricePerNight: number
  rating: number
  reviews: number
  url?: string
}
export type EventItem = {
  title: string
  start: YMD & HMS
  end: YMD & HMS
  location?: string
  url?: string
  notes?: string
}

// ---------- Utils ----------
function pad(n: number, len = 2) { return n.toString().padStart(len, '0') }
function toDisplay(dt: YMD & HMS) { return `${pad(dt.d)}/${pad(dt.m)}/${dt.y} ${pad(dt.hh)}:${pad(dt.mm)}` }
function fmtICS(dt: YMD & HMS) { return `${pad(dt.y,4)}${pad(dt.m)}${pad(dt.d)}T${pad(dt.hh)}${pad(dt.mm)}${pad(dt.ss ?? 0)}` }
function parseISODate(d: string): YMD { const [y, m, dd] = d.split('-').map(Number); return { y, m, d: dd } }
function isoToParts(iso: string): YMD & HMS {
  const dt = new Date(iso)
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), hh: dt.getHours(), mm: dt.getMinutes(), ss: dt.getSeconds() }
}
function iso8601DurationToMin(s: string): number {
  // es. "PT2H30M"
  const m = s.match(/P(T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/)
  const h = m?.[2] ? parseInt(m![2]) : 0
  const mi = m?.[3] ? parseInt(m![3]) : 0
  const sec = m?.[4] ? parseInt(m![4]) : 0
  return h * 60 + mi + Math.round(sec / 60)
}

// ---------- Scoring ----------
function scoreTransport(opt: TransportOption, w_price = 0.55, w_time = 0.35, w_transfers = 0.10) {
  const priceCap = 300, timeCap = 600, transfersCap = 2
  const sPrice = Math.max(0, 1 - opt.price / priceCap)
  const sTime = Math.max(0, 1 - opt.durationMin / timeCap)
  const sTransfers = Math.max(0, 1 - (opt.transfers || 0) / transfersCap)
  return w_price * sPrice + w_time * sTime + w_transfers * sTransfers
}
function scoreLodging(opt: LodgingOption, w_rating = 0.7, w_price = 0.3) {
  const priceCap = 200
  const ratingScore = opt.rating / 5
  const priceScore = Math.max(0, 1 - opt.pricePerNight / priceCap)
  const reviewsBonus = Math.min(0.1, (opt.reviews / 2000) * 0.1)
  return w_rating * ratingScore + w_price * priceScore + reviewsBonus
}

// ---------- ENV ----------
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || ''
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || ''
const AMADEUS_ENV = (process.env.AMADEUS_ENV || 'test').toLowerCase() // 'test'|'production'
const AMADEUS_BASE = AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com' // OAuth+APIs
const ORS_KEY = process.env.ORS_API_KEY || ''
const ORS_BASE = 'https://api.openrouteservice.org'

// ---------- Amadeus OAuth (cache in memoria "per lambda") ----------
let amadeusToken: { token: string; exp: number } | null = null
async function getAmadeusToken(): Promise<string> {
  const now = Date.now() / 1000
  if (amadeusToken && amadeusToken.exp - 30 > now) return amadeusToken.token
  const res = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: AMADEUS_KEY, client_secret: AMADEUS_SECRET })
  })
  if (!res.ok) throw new Error('Amadeus OAuth failed')
  const j = await res.json() as { access_token: string; expires_in: number }
  amadeusToken = { token: j.access_token, exp: Math.floor(now + j.expires_in) }
  return amadeusToken.token
}

// ---------- Amadeus: risolvi città → IATA (CITY/AIRPORT) ----------
async function amadeusCityOrAirportCode(q: string): Promise<string | null> {
  const token = await getAmadeusToken()
  const url = new URL(`${AMADEUS_BASE}/v1/reference-data/locations`)
  url.searchParams.set('keyword', q)
  url.searchParams.set('subType', 'CITY,AIRPORT')
  url.searchParams.set('view', 'LIGHT')
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) return null
  const j = await res.json() as any
  const data = Array.isArray(j.data) ? j.data : []
  // prefer CITY, fallback AIRPORT
  const city = data.find((x: any) => x.subType === 'CITY' && x.iataCode)?.iataCode
  const apt = data.find((x: any) => x.subType === 'AIRPORT' && x.iataCode)?.iataCode
  return city || apt || null
}

// ---------- Amadeus: voli ----------
async function amadeusFlights(originCity: string, destCity: string, departISO: string): Promise<TransportOption[]> {
  const token = await getAmadeusToken()
  const oCode = await amadeusCityOrAirportCode(originCity)
  const dCode = await amadeusCityOrAirportCode(destCity)
  if (!oCode || !dCode) throw new Error('IATA code not found')

  const url = new URL(`${AMADEUS_BASE}/v2/shopping/flight-offers`)
  url.searchParams.set('originLocationCode', oCode)
  url.searchParams.set('destinationLocationCode', dCode)
  url.searchParams.set('departureDate', departISO)
  url.searchParams.set('adults', '1')
  url.searchParams.set('currencyCode', 'EUR')
  url.searchParams.set('max', '10')

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error('Flight search failed')
  const j = await res.json() as any
  const arr: TransportOption[] = []

  for (const f of j.data || []) {
    const itin = f.itineraries?.[0]
    if (!itin) continue
    const firstSeg = itin.segments?.[0]
    const lastSeg = itin.segments?.[itin.segments.length - 1]
    const dep = firstSeg?.departure?.at
    const arrAt = lastSeg?.arrival?.at
    const duration = itin.duration ? iso8601DurationToMin(itin.duration) : undefined
    const price = f.price?.grandTotal ? Number(f.price.grandTotal) : (f.price?.total ? Number(f.price.total) : NaN)
    if (!dep || !arrAt || !duration || !isFinite(price)) continue
    arr.push({
      mode: 'flight',
      provider: f.validatingAirlineCodes?.[0] || f.carrierCode || 'Flight',
      dep: isoToParts(dep),
      arr: isoToParts(arrAt),
      price,
      durationMin: duration,
      transfers: (itin.segments?.length || 1) - 1,
      notes: (itin.segments?.length || 1) === 1 ? 'Diretto' : `${(itin.segments?.length || 1) - 1} scalo/i`
    })
  }
  if (!arr.length) throw new Error('No flights found')
  arr.sort((a, b) => scoreTransport(b) - scoreTransport(a))
  return arr
}

// ---------- ORS: geocode + driving ----------
async function orsGeocode(text: string): Promise<[number, number] | null> {
  const url = new URL(`${ORS_BASE}/geocode/search`)
  url.searchParams.set('api_key', ORS_KEY)
  url.searchParams.set('text', text)
  url.searchParams.set('size', '1')
  const res = await fetch(url.toString(), { cache: 'no-store' })
  if (!res.ok) return null
  const j = await res.json() as any
  const feat = j.features?.[0]
  const coords = feat?.geometry?.coordinates
  return Array.isArray(coords) && coords.length >= 2 ? [coords[0], coords[1]] : null // [lon, lat]
}
async function orsDrive(origin: string, dest: string, d: YMD): Promise<TransportOption[]> {
  const a = await orsGeocode(origin)
  const b = await orsGeocode(dest)
  if (!a || !b) throw new Error('Geocode failed')
  const dep = new Date(`${d.y}-${pad(d.m)}-${pad(d.d)}T06:45:00`)
  const body = { coordinates: [a, b] }
  const res = await fetch(`${ORS_BASE}/v2/directions/driving-car`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: ORS_KEY },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error('ORS directions failed')
  const j = await res.json() as any
  const r = j.routes?.[0]
  const sec = r?.summary?.duration
  const m = typeof sec === 'number' ? Math.round(sec / 60) : 0
  const km = r?.summary?.distance ? r.summary.distance / 1000 : 0
  const price = Math.round(km * 0.2) // stima €0.20/km (carburante+pedaggi generici)
  const arr = new Date(dep.getTime() + m * 60_000)
  return [{
    mode: 'drive',
    provider: 'Auto (stima ORS)',
    dep: { y: d.y, m: d.m, d: d.d, hh: dep.getHours(), mm: dep.getMinutes(), ss: 0 },
    arr: { y: d.y, m: d.m, d: d.d, hh: arr.getHours(), mm: arr.getMinutes(), ss: 0 },
    price, durationMin: m, transfers: 0, notes: `Distanza ~${km.toFixed(0)} km`
  }]
}

// ---------- Amadeus: hotel ----------
async function amadeusHotels(city: string, dFromISO: string, dToISO: string, maxPerNight?: number): Promise<LodgingOption[]> {
  const token = await getAmadeusToken()
  // prova cityCode IATA; se non disponibile useremo fallback coordinate
  const cityCode = await amadeusCityOrAirportCode(city)
  const url = new URL(`${AMADEUS_BASE}/v2/shopping/hotel-offers`)
  if (cityCode) url.searchParams.set('cityCode', cityCode)
  else {
    // fallback: cerca coordinate città (grossolane) usando ORS geocode
    if (!ORS_KEY) throw new Error('Need ORS for coords')
    const coords = await orsGeocode(city)
    if (!coords) throw new Error('Geocode city failed')
    url.searchParams.set('latitude', String(coords[1]))
    url.searchParams.set('longitude', String(coords[0]))
    url.searchParams.set('radius', '10')
    url.searchParams.set('radiusUnit', 'KM')
  }
  url.searchParams.set('checkInDate', dFromISO)
  url.searchParams.set('checkOutDate', dToISO)
  url.searchParams.set('adults', '2')
  url.searchParams.set('roomQuantity', '1')
  url.searchParams.set('currency', 'EUR')

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (!res.ok) throw new Error('Hotel search failed')
  const j = await res.json() as any
  const out: LodgingOption[] = []
  for (const h of j.data || []) {
    const hotel = h.hotel || {}
    const offer = (h.offers && h.offers[0]) || {}
    const nightly =
      offer?.price?.variations?.average?.base ??
      offer?.price?.variations?.average?.total ??
      offer?.price?.base ??
      offer?.price?.total
    if (!nightly) continue
    const perNight = Number(nightly)
    if (maxPerNight && perNight > maxPerNight) continue
    out.push({
      name: hotel.name || 'Hotel',
      location: hotel.address?.cityName || city,
      pricePerNight: perNight,
      rating: Number(hotel.rating || 4.2), // fallback se manca
      reviews: Number(hotel.rating || 0) > 0 ? 300 : 0, // fallback semplice
      url: hotel.hotelId ? `https://www.google.com/search?q=${encodeURIComponent(hotel.name + ' ' + (hotel.address?.cityName || city))}` : undefined
    })
  }
  if (!out.length) throw new Error('No hotels found')
  out.sort((a, b) => scoreLodging(b) - scoreLodging(a))
  return out
}

// ---------- MOCK fallback (train + backup) ----------
function mockTrains(origin: string, dest: string, d: YMD): TransportOption[] {
  return [
    { mode: 'train', provider: 'Frecciarossa', dep: { ...d, hh: 7, mm: 30 }, arr: { ...d, hh: 10, mm: 35 }, price: 59, durationMin: 185, transfers: 0, notes: 'Alta velocità' },
    { mode: 'train', provider: 'Italo',        dep: { ...d, hh: 8, mm: 30 }, arr: { ...d, hh: 12, mm: 30 }, price: 49, durationMin: 240, transfers: 0, notes: 'Diretto' },
  ]
}
function pickBest<T>(arr: T[], score: (x: T) => number): T { return arr.sort((a, b) => score(b) - score(a))[0] }

// ---------- GCal & ICS ----------
const TZID = 'Europe/Rome'
function gcalLink(e: EventItem) {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
  const dates = `${fmtICS(e.start)}/${fmtICS(e.end)}`
  const params = new URLSearchParams({ text: e.title, dates, details: e.notes || '', location: e.location || '' })
  return `${base}&${params.toString()}`
}
function makeICS(title: string, events: EventItem[], alarmMin = 45) {
  const now = new Date()
  const dtstamp = `${pad(now.getUTCFullYear(),4)}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  const lines: string[] = ['BEGIN:VCALENDAR','PRODID:-//TripPlanner AI//Transport+Lodging//IT','VERSION:2.0','CALSCALE:GREGORIAN',`X-WR-CALNAME:${title}`,`X-WR-TIMEZONE:${TZID}`]
  for (const e of events) {
    const uid = randomUUID()
    lines.push('BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${dtstamp}`,`DTSTART;TZID=${TZID}:${fmtICS(e.start)}`,`DTEND;TZID=${TZID}:${fmtICS(e.end)}`,`SUMMARY:${e.title}`)
    if (e.location) lines.push(`LOCATION:${e.location}`)
    const desc: string[] = []
    if (e.notes) desc.push(e.notes)
    if (e.url) desc.push(`Link: ${e.url}`)
    if (desc.length) lines.push(`DESCRIPTION:${desc.join('\\n')}`)
    if (alarmMin && alarmMin > 0) lines.push('BEGIN:VALARM',`TRIGGER:-PT${Math.floor(alarmMin)}M`,'ACTION:DISPLAY','DESCRIPTION:Promemoria','END:VALARM')
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}

// ---------- Core ----------
async function pickBestTransport(origin: string, dest: string, dISO: string, modes: string[]): Promise<TransportOption> {
  const d = parseISODate(dISO)
  const list: TransportOption[] = []
  // flight
  try {
    if (modes.includes('flight') && AMADEUS_KEY && AMADEUS_SECRET) {
      const f = await amadeusFlights(origin, dest, dISO)
      list.push(...f)
    }
  } catch {}
  // train (per ora mock finché non integriamo un provider)
  if (modes.includes('train')) list.push(...mockTrains(origin, dest, d))
  // drive
  try {
    if (modes.includes('drive') && ORS_KEY) {
      const dlist = await orsDrive(origin, dest, d)
      list.push(...dlist)
    }
  } catch {}
  if (!list.length) throw new Error('Nessuna opzione di trasporto disponibile (verifica API keys o abilita almeno un mock)')
  return pickBest(list, scoreTransport)
}

async function pickBestLodging(city: string, dFromISO: string, dToISO: string, maxPerNight?: number): Promise<LodgingOption> {
  if (AMADEUS_KEY && AMADEUS_SECRET) {
    try {
      const list = await amadeusHotels(city, dFromISO, dToISO, maxPerNight)
      return pickBest(list, scoreLodging)
    } catch {}
  }
  // fallback mock minimale
  const nights = Math.max(1, Math.round((new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime())/86400000))
  const mock: LodgingOption[] = [
    { name: 'B&B Panoramico', location: city, pricePerNight: 85, rating: 4.7, reviews: 650, url: 'https://example.com/bnb1' },
    { name: 'Hotel Centro Storico', location: city, pricePerNight: 110, rating: 4.5, reviews: 1800, url: 'https://example.com/hotel1' },
  ].filter(x => !maxPerNight || x.pricePerNight <= maxPerNight)
  if (!mock.length) throw new Error('Nessuna sistemazione trovata')
  return pickBest(mock, scoreLodging)
}

// ---------- Handler ----------
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const origin = String(body.origin || '')
    const dest = String(body.dest || '')
    const dFromISO = String(body.departDate || '')
    const dToISO = String(body.returnDate || '')
    const modes: string[] = Array.isArray(body.modes) ? body.modes : ['flight','train','drive']
    const maxPerNight = body.maxNight ? Number(body.maxNight) : undefined
    const alarmMin = body.alarmMin ? Number(body.alarmMin) : 45

    if (!origin || !dest || !dFromISO || !dToISO) {
      return NextResponse.json({ error: 'origin, dest, departDate, returnDate sono obbligatori' }, { status: 400 })
    }
    if (new Date(`${dToISO}T00:00:00`) <= new Date(`${dFromISO}T00:00:00`)) {
      return NextResponse.json({ error: 'La data di ritorno deve essere dopo la partenza' }, { status: 400 })
    }

    const go = await pickBestTransport(origin, dest, dFromISO, modes)
    const back = await pickBestTransport(dest, origin, dToISO, modes)
    const stay = await pickBestLodging(dest, dFromISO, dToISO, maxPerNight)

    const nights = Math.max(1, Math.round((new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime()) / (1000 * 60 * 60 * 24)))
    const totalStay = Math.round(stay.pricePerNight * nights)

    const events: EventItem[] = [
      { title: `Partenza ${origin} → ${dest} (${go.provider})`, start: { ...go.dep, ss: 0 }, end: { ...go.arr, ss: 0 }, location: origin, notes: `${go.mode} · €${Math.round(go.price)} · ${go.notes || ''}` },
      { title: `Check-in ${stay.name}`, start: { ...parseISODate(dFromISO), hh: 15, mm: 0, ss: 0 }, end: { ...parseISODate(dFromISO), hh: 16, mm: 0, ss: 0 }, location: stay.location, url: stay.url, notes: `€${Math.round(stay.pricePerNight)}/notte · Rating ${stay.rating}/5` },
      { title: `Check-out ${stay.name}`, start: { ...parseISODate(dToISO), hh: 11, mm: 0, ss: 0 }, end: { ...parseISODate(dToISO), hh: 11, mm: 30, ss: 0 }, location: stay.location, url: stay.url },
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
      ics
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Errore inatteso' }, { status: 500 })
  }
}
