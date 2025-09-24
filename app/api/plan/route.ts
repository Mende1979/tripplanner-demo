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

export type LodgingOption = {
  name: string;
  location: string;
  pricePerNight: number;
  rating: number;
  reviews: number;
  url?: string;
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
  return {
    y: dt.getFullYear(),
    m: dt.getMonth() + 1,
    d: dt.getDate(),
    hh: dt.getHours(),
    mm: dt.getMinutes(),
    ss: dt.getSeconds(),
  };
}
function iso8601DurationToMin(s: string): number {
  // es. "PT2H30M"
  const re = /P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/;
  const m = s.match(re);
  const H = m?.[1] ? parseInt(m[1], 10) : 0;
  const M = m?.[2] ? parseInt(m[2], 10) : 0;
  const S = m?.[3] ? parseInt(m[3], 10) : 0;
  return H * 60 + M + Math.round(S / 60);
}

/** ===== Scoring ===== */
function scoreTransport(opt: TransportOption, w_price = 0.55, w_time = 0.35, w_transfers = 0.10) {
  const priceCap = 300;
  const timeCap = 600;
  const transfersCap = 2;
  const sPrice = Math.max(0, 1 - opt.price / priceCap);
  const sTime = Math.max(0, 1 - opt.durationMin / timeCap);
  const sTransfers = Math.max(0, 1 - (opt.transfers ?? 0) / transfersCap);
  return w_price * sPrice + w_time * sTime + w_transfers * sTransfers;
}
function scoreLodging(opt: LodgingOption, w_rating = 0.7, w_price = 0.3) {
  const priceCap = 200;
  const ratingScore = opt.rating / 5;
  const priceScore = Math.max(0, 1 - opt.pricePerNight / priceCap);
  const reviewsBonus = Math.min(0.1, (opt.reviews / 2000) * 0.1);
  return w_rating * ratingScore + w_price * priceScore + reviewsBonus;
}
function pickBest<T>(arr: T[], score: (x: T) => number): T {
  return arr.slice().sort((a, b) => score(b) - score(a))[0];
}

/** ===== ENV Amadeus ===== */
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || '';
const AMADEUS_ENV = (process.env.AMADEUS_ENV || 'test').toLowerCase(); // 'test'|'production'
const AMADEUS_BASE = AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';

/** ===== Tipi minimi Amadeus (solo campi che usiamo) ===== */
interface AmadeusLocation {
  subType?: 'CITY' | 'AIRPORT';
  iataCode?: string;
}
interface AmadeusLocationsResponse {
  data?: AmadeusLocation[];
}

interface AmadeusFlightSegment {
  departure?: { at?: string };
  arrival?: { at?: string };
}
interface AmadeusItinerary {
  duration?: string;
  segments?: AmadeusFlightSegment[];
}
interface AmadeusFlightOffer {
  itineraries?: AmadeusItinerary[];
  price?: { grandTotal?: string; total?: string };
  validatingAirlineCodes?: string[];
  carrierCode?: string;
}
interface AmadeusFlightOffersResponse {
  data?: AmadeusFlightOffer[];
}

interface AmadeusHotel {
  name?: string;
  address?: { cityName?: string };
  rating?: string;
  hotelId?: string;
}
interface AmadeusHotelOfferPrice {
  total?: string;
  base?: string;
  variations?: { average?: { base?: string; total?: string } };
}
interface AmadeusHotelOffer {
  price?: AmadeusHotelOfferPrice;
}
interface AmadeusHotelData {
  hotel?: AmadeusHotel;
  offers?: AmadeusHotelOffer[];
}
interface AmadeusHotelOffersResponse {
  data?: AmadeusHotelData[];
}

/** ===== OAuth Amadeus (cache in memoria) ===== */
let amadeusToken: { token: string; exp: number } | null = null;

async function getAmadeusToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (amadeusToken && amadeusToken.exp - 30 > now) return amadeusToken.token;

  const res = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: AMADEUS_KEY,
      client_secret: AMADEUS_SECRET,
    }),
    cache: 'no-store',
  });

  if (!res.ok) throw new Error('Amadeus OAuth failed');
  const j = (await res.json()) as { access_token: string; expires_in: number };
  amadeusToken = { token: j.access_token, exp: now + j.expires_in };
  return amadeusToken.token;
}

/** ===== City/Airport code ===== */
async function amadeusCityOrAirportCode(q: string): Promise<string | null> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v1/reference-data/locations`);
  url.searchParams.set('keyword', q);
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

/** ===== Flight offers ===== */
async function amadeusFlights(originCity: string, destCity: string, departISO: string): Promise<TransportOption[]> {
  const token = await getAmadeusToken();
  const oCode = await amadeusCityOrAirportCode(originCity);
  const dCode = await amadeusCityOrAirportCode(destCity);
  if (!oCode || !dCode) throw new Error('IATA code not found');

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

/** ===== Hotel offers (Hotel List + Hotel Search v3) ===== */
interface HotelListByCityItem {
  hotelId?: string;
  name?: string;
  address?: { cityName?: string };
  geoCode?: { latitude?: number; longitude?: number };
}
interface HotelListByCityResponse {
  data?: HotelListByCityItem[];
}

interface HotelOffersV3Price { total?: string; currency?: string }
interface HotelOffersV3Hotel { hotelId?: string; name?: string; address?: { cityName?: string } }
interface HotelOffersV3Item { hotel?: HotelOffersV3Hotel; offers?: { price?: HotelOffersV3Price }[] }
interface HotelOffersV3Response { data?: HotelOffersV3Item[] }

async function amadeusHotels(city: string, dFromISO: string, dToISO: string, maxPerNight?: number): Promise<LodgingOption[]> {
  const token = await getAmadeusToken();
  const cityCode = await resolveIata(city);
  if (!cityCode) throw new Error('City/IATA not found for hotels');

  // 1) Lista hotel per città (Hotel List API)
  const listUrl = new URL(`${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city`);
  listUrl.searchParams.set('cityCode', cityCode);
  listUrl.searchParams.set('radius', '20');           // allarga un po’ il raggio
  listUrl.searchParams.set('radiusUnit', 'KM');
  listUrl.searchParams.set('hotelSource', 'ALL');     // più copertura in sandbox

  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!listRes.ok) throw new Error('Hotel list failed');
  const listJson = (await listRes.json()) as HotelListByCityResponse;

  const ids = (listJson.data ?? [])
    .map(h => h.hotelId)
    .filter((x): x is string => typeof x === 'string' && x.length > 0)
    .slice(0, 20); // limitiamo

  if (!ids.length) throw new Error('No hotels found for city (test dataset may be limited)');

  // 2) Offerte per quegli hotel (Hotel Search v3)
  const nights = Math.max(1, Math.round(
    (new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime()) / 86_400_000
  ));

  const offersUrl = new URL(`${AMADEUS_BASE}/v3/shopping/hotel-offers`);
  offersUrl.searchParams.set('hotelIds', ids.join(','));
  offersUrl.searchParams.set('adults', '2');
  offersUrl.searchParams.set('checkInDate', dFromISO);
  offersUrl.searchParams.set('checkOutDate', dToISO);
  offersUrl.searchParams.set('currency', 'EUR');

  const offersRes = await fetch(offersUrl, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!offersRes.ok) throw new Error('Hotel search failed');
  const offersJson = (await offersRes.json()) as HotelOffersV3Response;

  const out: LodgingOption[] = [];
  for (const item of offersJson.data ?? []) {
    const hotel = item.hotel;
    const offers = item.offers ?? [];
    if (!hotel || offers.length === 0) continue;

    // prendi l’offerta più economica e calcola €/notte
    const totals = offers
      .map(o => o.price?.total)
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
      .map(t => Number(t))
      .filter(n => Number.isFinite(n));
    if (totals.length === 0) continue;

    const minTotal = Math.min(...totals);
    const perNight = Math.max(1, Math.round(minTotal / nights));

    if (maxPerNight !== undefined && perNight > maxPerNight) continue;

    out.push({
      name: hotel.name || 'Hotel',
      location: hotel.address?.cityName || city,
      pricePerNight: perNight,
      rating: 4.2,                 // sandbox spesso non fornisce rating reali
      reviews: 0,                  // idem
      url: hotel.hotelId
        ? `https://www.google.com/search?q=${encodeURIComponent((hotel.name || 'hotel') + ' ' + (hotel.address?.cityName || city))}`
        : undefined,
    });
  }

  if (!out.length) throw new Error('No hotels found (try different dates/city in sandbox)');
  out.sort((a, b) => scoreLodging(b) - scoreLodging(a));
  return out;
}


/** ===== GCal & ICS ===== */
const TZID = 'Europe/Rome';
function gcalLink(e: EventItem) {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const dates = `${fmtICS(e.start)}/${fmtICS(e.end)}`;
  const params = new URLSearchParams({
    text: e.title,
    dates,
    details: e.notes || '',
    location: e.location || '',
  });
  return `${base}&${params.toString()}`;
}
function makeICS(title: string, events: EventItem[], alarmMin = 45) {
  const now = new Date();
  const dtstamp = `${pad(now.getUTCFullYear(), 4)}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate(),
  )}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'PRODID:-//TripPlanner AI//Transport+Lodging//IT',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${title}`,
    `X-WR-TIMEZONE:${TZID}`,
  ];
  for (const e of events) {
    const uid = randomUUID();
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;TZID=${TZID}:${fmtICS(e.start)}`,
      `DTEND;TZID=${TZID}:${fmtICS(e.end)}`,
      `SUMMARY:${e.title}`,
    );
    if (e.location) lines.push(`LOCATION:${e.location}`);
    const desc: string[] = [];
    if (e.notes) desc.push(e.notes);
    if (e.url) desc.push(`Link: ${e.url}`);
    if (desc.length) lines.push(`DESCRIPTION:${desc.join('\\n')}`);
    if (alarmMin && alarmMin > 0)
      lines.push('BEGIN:VALARM', `TRIGGER:-PT${Math.floor(alarmMin)}M`, 'ACTION:DISPLAY', 'DESCRIPTION:Promemoria', 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** ===== Core (solo Amadeus) ===== */
async function pickBestTransport(origin: string, dest: string, dISO: string): Promise<TransportOption> {
  const list = await amadeusFlights(origin, dest, dISO);
  return pickBest(list, scoreTransport);
}
async function pickBestLodging(city: string, dFromISO: string, dToISO: string, maxPerNight?: number): Promise<LodgingOption> {
  const list = await amadeusHotels(city, dFromISO, dToISO, maxPerNight);
  return pickBest(list, scoreLodging);
}

/** ===== Handler ===== */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const origin = String((body as Record<string, unknown>).origin || '');
    const dest = String((body as Record<string, unknown>).dest || '');
    const dFromISO = String((body as Record<string, unknown>).departDate || '');
    const dToISO = String((body as Record<string, unknown>).returnDate || '');
    const maxPerNight =
      (body as Record<string, unknown>).maxNight !== undefined
        ? Number((body as Record<string, unknown>).maxNight)
        : undefined;
    const alarmMin =
      (body as Record<string, unknown>).alarmMin !== undefined
        ? Number((body as Record<string, unknown>).alarmMin)
        : 45;

    if (!origin || !dest || !dFromISO || !dToISO) {
      return NextResponse.json({ error: 'origin, dest, departDate, returnDate sono obbligatori' }, { status: 400 });
    }
    if (new Date(`${dToISO}T00:00:00`) <= new Date(`${dFromISO}T00:00:00`)) {
      return NextResponse.json({ error: 'La data di ritorno deve essere dopo la partenza' }, { status: 400 });
    }

    const go = await pickBestTransport(origin, dest, dFromISO);
    const back = await pickBestTransport(dest, origin, dToISO);
    const stay = await pickBestLodging(dest, dFromISO, dToISO, maxPerNight);

    const ms = new Date(`${dToISO}T00:00:00`).getTime() - new Date(`${dFromISO}T00:00:00`).getTime();
    const nights = Math.max(1, Math.round(ms / 86_400_000));
    const totalStay = Math.round(stay.pricePerNight * nights);

    const events: EventItem[] = [
      {
        title: `Partenza ${origin} → ${dest} (${go.provider})`,
        start: { ...go.dep, ss: 0 },
        end: { ...go.arr, ss: 0 },
        location: origin,
        notes: `${go.mode} · €${Math.round(go.price)} · ${go.notes || ''}`,
      },
      {
        title: `Check-in ${stay.name}`,
        start: { ...parseISODate(dFromISO), hh: 15, mm: 0, ss: 0 },
        end: { ...parseISODate(dFromISO), hh: 16, mm: 0, ss: 0 },
        location: stay.location,
        url: stay.url,
        notes: `€${Math.round(stay.pricePerNight)}/notte · Rating ${stay.rating}/5`,
      },
      {
        title: `Check-out ${stay.name}`,
        start: { ...parseISODate(dToISO), hh: 11, mm: 0, ss: 0 },
        end: { ...parseISODate(dToISO), hh: 11, mm: 30, ss: 0 },
        location: stay.location,
        url: stay.url,
      },
      {
        title: `Ritorno ${dest} → ${origin} (${back.provider})`,
        start: { ...back.dep, ss: 0 },
        end: { ...back.arr, ss: 0 },
        location: dest,
        notes: `${back.mode} · €${Math.round(back.price)} · ${back.notes || ''}`,
      },
    ];

    const ics = makeICS(`${dest} — viaggio`, events, alarmMin);
    const gcalLinks = events.map(gcalLink);

    return NextResponse.json({
      go: { ...go, depText: toDisplay(go.dep), arrText: toDisplay(go.arr) },
      back: { ...back, depText: toDisplay(back.dep), arrText: toDisplay(back.arr) },
      stay,
      nights,
      totalStay,
      gcalLinks,
      ics,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
