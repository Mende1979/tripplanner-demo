import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
export const runtime = 'nodejs';

/** ===== Tipi condivisi con la UI ===== */
type TransportMode = 'flight';
type YMD = { y: number; m: number; d: number };
type HMS = { hh: number; mm: number; ss?: number };

export type TransportOption = {
  mode: TransportMode;
  provider: string;
  dep: YMD & HMS;
  arr: YMD & HMS;
  price: number;
  durationMin: number;
  transfers?: number;
  notes?: string;
};

export type EventItem = {
  title: string;
  start: YMD & HMS;
  end: YMD & HMS;
  location?: string;
  url?: string;
  notes?: string;
};

/** ===== Utils ===== */
function pad(n: number, len = 2) {
  return n.toString().padStart(len, '0');
}
function toDisplay(dt: YMD & HMS) {
  return `${pad(dt.d)}/${pad(dt.m)}/${dt.y} ${pad(dt.hh)}:${pad(dt.mm)}`;
}
function fmtICS(dt: YMD & HMS) {
  return `${pad(dt.y, 4)}${pad(dt.m)}${pad(dt.d)}T${pad(dt.hh)}${pad(dt.mm)}${pad(dt.ss ?? 0)}`;
}
function parseISODate(d: string): YMD {
  const [y, m, dd] = d.split('-').map(Number);
  return { y, m, d: dd };
}
function isoToParts(iso: string): YMD & HMS {
  const dt = new Date(iso);
  return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), hh: dt.getHours(), mm: dt.getMinutes(), ss: dt.getSeconds() };
}
function iso8601DurationToMin(s: string): number {
  const re = /P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/;
  const m = s.match(re);
  const H = m?.[1] ? parseInt(m[1], 10) : 0;
  const M = m?.[2] ? parseInt(m[2], 10) : 0;
  const S = m?.[3] ? parseInt(m[3], 10) : 0;
  return H * 60 + M + Math.round(S / 60);
}

/** ===== Scoring ===== */
function scoreTransport(opt: TransportOption, w_price = 0.55, w_time = 0.35, w_transfers = 0.10) {
  const priceCap = 300, timeCap = 600, transfersCap = 2;
  const sPrice = Math.max(0, 1 - opt.price / priceCap);
  const sTime = Math.max(0, 1 - opt.durationMin / timeCap);
  const sTransfers = Math.max(0, 1 - (opt.transfers ?? 0) / transfersCap);
  return w_price * sPrice + w_time * sTime + w_transfers * sTransfers;
}
function pickBest<T>(arr: T[], score: (x: T) => number): T {
  return arr.slice().sort((a, b) => score(b) - score(a))[0];
}

/** ===== ENV Amadeus ===== */
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || '';
const AMADEUS_ENV = (process.env.AMADEUS_ENV || 'test').toLowerCase(); // 'test' | 'production'
const AMADEUS_BASE = AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';

/** ===== Tipi minimi Amadeus (solo campi che usiamo) ===== */
interface AmadeusLocation {
  subType?: 'CITY' | 'AIRPORT';
  iataCode?: string;
  geoCode?: { latitude?: number; longitude?: number };
}
interface AmadeusLocationsResponse { data?: AmadeusLocation[] }

interface AmadeusFlightSegment { departure?: { at?: string }; arrival?: { at?: string } }
interface AmadeusItinerary { duration?: string; segments?: AmadeusFlightSegment[] }
interface AmadeusFlightOffer {
  itineraries?: AmadeusItinerary[];
  price?: { grandTotal?: string; total?: string };
  validatingAirlineCodes?: string[];
  carrierCode?: string;
}
interface AmadeusFlightOffersResponse { data?: AmadeusFlightOffer[] }

/** ===== OAuth Amadeus (cache in memoria) ===== */
let amadeusToken: { token: string; exp: number } | null = null;
async function getAmadeusToken(): Promise<string> {
  if (!AMADEUS_KEY || !AMADEUS_SECRET) throw new Error('Missing AMADEUS_API_KEY or AMADEUS_API_SECRET');
  const now = Math.floor(Date.now() / 1000);
  if (amadeusToken && amadeusToken.exp - 30 > now) return amadeusToken.token;

  const res = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: AMADEUS_KEY, client_secret: AMADEUS_SECRET }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Amadeus OAuth error:', res.status, txt);
    throw new Error(`Amadeus OAuth failed (${res.status})`);
  }
  const j = (await res.json()) as { access_token: string; expires_in: number };
  amadeusToken = { token: j.access_token, exp: now + j.expires_in };
  return amadeusToken.token;
}

/** ===== Airport & City Search ===== */
async function amadeusCityOrAirportCode(keyword: string): Promise<string | null> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v1/reference-data/locations`);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('subType', 'CITY,AIRPORT');
  url.searchParams.set('view', 'LIGHT');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return null;
  const j = (await res.json()) as AmadeusLocationsResponse;
  const data = Array.isArray(j.data) ? j.data : [];
  const city = data.find((x) => x.subType === 'CITY' && x.iataCode)?.iataCode;
  const apt = data.find((x) => x.subType === 'AIRPORT' && x.iataCode)?.iataCode;
  return city || apt || null;
}
async function amadeusCityGeo(keyword: string): Promise<{ lat: number; lon: number } | null> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v1/reference-data/locations`);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('subType', 'CITY,AIRPORT');
  url.searchParams.set('view', 'LIGHT');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return null;
  const j = (await res.json()) as AmadeusLocationsResponse;
  const list = Array.isArray(j.data) ? j.data : [];
  const pick =
    list.find((x) => x.subType === 'CITY' && x.geoCode?.latitude && x.geoCode?.longitude) ??
    list.find((x) => x.subType === 'AIRPORT' && x.geoCode?.latitude && x.geoCode?.longitude);
  if (!pick?.geoCode) return null;
  return { lat: pick.geoCode.latitude!, lon: pick.geoCode.longitude! };
}

/** ===== Alias IT→IATA e IT→EN + risoluzione IATA ===== */
const IATA_BY_ALIAS: Record<string, string> = {
  bologna: 'BLQ', roma: 'ROM', milano: 'MIL', napoli: 'NAP', torino: 'TRN', venezia: 'VCE',
  firenze: 'FLR', pisa: 'PSA', verona: 'VRN', bari: 'BRI', catania: 'CTA', palermo: 'PMO',
  lisbona: 'LIS', parigi: 'PAR', londra: 'LON', barcellona: 'BCN', madrid: 'MAD',
  berlino: 'BER', amsterdam: 'AMS', bruxelles: 'BRU', vienna: 'VIE', praga: 'PRG',
  budapest: 'BUD', zurigo: 'ZRH', ginevra: 'GVA', dublino: 'DUB', copenaghen: 'CPH',
  'new york': 'NYC', 'los angeles': 'LAX', dubai: 'DXB', istanbul: 'IST', atene: 'ATH',
};
const EN_BY_ALIAS: Record<string, string> = {
  lisbona: 'Lisbon', roma: 'Rome', milano: 'Milan', napoli: 'Naples', torino: 'Turin',
  venezia: 'Venice', firenze: 'Florence', 'monaco di baviera': 'Munich', londra: 'London',
  parigi: 'Paris', praga: 'Prague', copenaghen: 'Copenhagen', bruxelles: 'Brussels',
  berlino: 'Berlin', amsterdam: 'Amsterdam', barcellona: 'Barcelona', vienna: 'Vienna',
  ginevra: 'Geneva', zurigo: 'Zurich', atene: 'Athens', 'new york': 'New York',
};
async function resolveIata(cityOrCode: string): Promise<string | null> {
  const raw = cityOrCode.trim();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  const k = raw.toLowerCase();
  if (IATA_BY_ALIAS[k]) return IATA_BY_ALIAS[k];
  let code = await amadeusCityOrAirportCode(raw);
  if (code) return code;
  const en = EN_BY_ALIAS[k];
  if (en) {
    code = await amadeusCityOrAirportCode(en);
    if (code) return code;
  }
  return null;
}

/** ===== Flights (Amadeus) ===== */
async function amadeusFlights(originCity: string, destCity: string, departISO: string): Promise<TransportOption[]> {
  const oCode = await resolveIata(originCity);
  const dCode = await resolveIata(destCity);
  if (!oCode || !dCode) throw new Error('IATA code not found');

  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v2/shopping/flight-offers`);
  url.searchParams.set('originLocationCode', oCode);
  url.searchParams.set('destinationLocationCode', dCode);
  url.searchParams.set('departureDate', departISO);
  url.searchParams.set('adults', '1');
  url.searchParams.set('currencyCode', 'EUR');
  url.searchParams.set('max', '10');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) throw new Error('Flight search failed');
  const j = (await res.json()) as AmadeusFlightOffersResponse;

  const out: TransportOption[] = [];
  for (const f of j.data ?? []) {
    const itin = f.itineraries?.[0];
    if (!itin) continue;
    const firstSeg = itin.segments?.[0];
    const lastSeg = itin.segments?.[(itin.segments?.length ?? 1) - 1];
    const depISO = firstSeg?.departure?.at;
    const arrISO = lastSeg?.arrival?.at;
    const durMin = itin.duration ? iso8601DurationToMin(itin.duration) : undefined;
    const priceStr = f.price?.grandTotal ?? f.price?.total;
    const price = priceStr ? Number(priceStr) : NaN;
    if (!depISO || !arrISO || !durMin || !Number.isFinite(price)) continue;

    out.push({
      mode: 'flight',
      provider: f.validatingAirlineCodes?.[0] || f.carrierCode || 'Flight',
      dep: isoToParts(depISO),
      arr: isoToParts(arrISO),
      price,
      durationMin: durMin,
      transfers: (itin.segments?.length ?? 1) - 1,
      notes: ((itin.segments?.length ?? 1) === 1 ? 'Diretto' : `${(itin.segments?.length ?? 1) - 1} scalo/i`) + ' · via Amadeus',
    });
  }
  if (!out.length) throw new Error('No flights found');
  out.sort((a, b) => scoreTransport(b) - scoreTransport(a));
  return out;
}

/** ===== Link alloggi (Google Hotels/Maps) ===== */
function buildHotelLinks(city: string, ci: string, co: string, lat?: number, lon?: number) {
  const q = encodeURIComponent(city);
  const googleHotels = `https://www.google.com/travel/hotels?hl=it&q=${q}&checkin=${ci}&checkout=${co}`;
  const googleMaps = lat != null && lon != null
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  return { googleHotels, googleMaps };
}

/** ===== GCal & ICS ===== */
const TZID = 'Europe/Rome';
function gcalLink(e: EventItem) {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const dates = `${fmtICS(e.start)}/${fmtICS(e.end)}`;
  const params = new URLSearchParams({ text: e.title, dates, details: e.notes || '', location: e.location || '' });
  return `${base}&${params.toString()}`;
}
function makeICS(title: string, events: EventItem[], alarmMin = 45) {
  const now = new Date();
  const dtstamp = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines: string[] = ['BEGIN:VCALENDAR','PRODID:-//TripPlanner AI//Transport+Lodging//IT','VERSION:2.0','CALSCALE:GREGORIAN',`X-WR-CALNAME:${title}`,`X-WR-TIMEZONE:${TZID}`];
  for (const e of events) {
    const uid = randomUUID();
    lines.push('BEGIN:VEVENT',`UID:${uid}`,`DTSTAMP:${dtstamp}`,`DTSTART;TZID=${TZID}:${fmtICS(e.start)}`,`DTEND;TZID=${TZID}:${fmtICS(e.end)}`,`SUMMARY:${e.title}`);
    if (e.location) lines.push(`LOCATION:${e.location}`);
    const desc: string[] = [];
    if (e.notes) desc.push(e.notes);
    if (e.url) desc.push(`Link: ${e.url}`);
    if (desc.length) lines.push(`DESCRIPTION:${desc.join('\\n')}`);
    if (alarmMin && alarmMin > 0) lines.push('BEGIN:VALARM',`TRIGGER:-PT${Math.floor(alarmMin)}M`,'ACTION:DISPLAY','DESCRIPTION:Promemoria','END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** ===== Core ===== */
async function pickBestTransport(origin: string, dest: string, dISO: string): Promise<TransportOption> {
  const list = await amadeusFlights(origin, dest, dISO);
  return pickBest(list, scoreTransport);
}

/** ===== Handler ===== */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const origin = String(body.origin || '');
    const dest = String(body.dest || '');
    const dFromISO = String(body.departDate || '');
    const dToISO = String(body.returnDate || '');
    const alarmMin = body.alarmMin !== undefined ? Number(body.alarmMin) : 45;

    if (!origin || !dest || !dFromISO || !dToISO) {
      return NextResponse.json({ error: 'origin, dest, departDate, returnDate sono obbligatori' }, { status: 400 });
    }
    if (new Date(`${dToISO}T00:00:00`) <= new Date(`${dFromISO}T00:00:00`)) {
      return NextResponse.json({ error: 'La data di ritorno deve essere dopo la partenza' }, { status: 400 });
    }

    const go = await pickBestTransport(origin, dest, dFromISO);
    const back = await pickBestTransport(dest, origin, dToISO);

    // Link alloggi su Google
    const geo = await amadeusCityGeo(dest); // per Maps più preciso, se disponibile
    const { googleHotels, googleMaps } = buildHotelLinks(dest, dFromISO, dToISO, geo?.lat, geo?.lon);

    // Eventi ICS (check-in/out generici)
    const events: EventItem[] = [
      { title: `Partenza ${origin} → ${dest} (${go.provider})`, start: { ...go.dep, ss: 0 }, end: { ...go.arr, ss: 0 }, location: origin, notes: `${go.mode} · €${Math.round(go.price)} · ${go.notes || ''}` },
      { title: `Check-in hotel a ${dest}`, start: { ...parseISODate(dFromISO), hh: 15, mm: 0, ss: 0 }, end: { ...parseISODate(dFromISO), hh: 16, mm: 0, ss: 0 }, location: dest, url: googleHotels, notes: 'Apri Google Hotels/Maps per i dettagli' },
      { title: `Check-out hotel a ${dest}`, start: { ...parseISODate(dToISO), hh: 11, mm: 0, ss: 0 }, end: { ...parseISODate(dToISO), hh: 11, mm: 30, ss: 0 }, location: dest, url: googleHotels },
      { title: `Ritorno ${dest} → ${origin} (${back.provider})`, start: { ...back.dep, ss: 0 }, end: { ...back.arr, ss: 0 }, location: dest, notes: `${back.mode} · €${Math.round(back.price)} · ${back.notes || ''}` },
    ];

    const ics = makeICS(`${dest} — viaggio`, events, alarmMin);
    const gcalLinks = events.map(gcalLink);

    return NextResponse.json({
      go: { ...go, depText: toDisplay(go.dep), arrText: toDisplay(go.arr) },
      back: { ...back, depText: toDisplay(back.dep), arrText: toDisplay(back.arr) },
      lodging: { city: dest, googleHotels, googleMaps },
      nights: Math.max(1, Math.round((new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime()) / 86_400_000)),
      gcalLinks,
      ics,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** ===== Diagnostica rapida: GET /api/plan?diag=1 ===== */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('diag') === '1') {
    return NextResponse.json({
      hasKey: !!process.env.AMADEUS_API_KEY,
      hasSecret: !!process.env.AMADEUS_API_SECRET,
      env: process.env.AMADEUS_ENV || 'test',
      base: AMADEUS_BASE,
      runtime,
    });
  }
  return NextResponse.json({ ok: true });
}
