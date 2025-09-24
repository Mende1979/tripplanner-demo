import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';

export const runtime = 'nodejs';

/** ========== Tipi ========== */
type YMD = { y: number; m: number; d: number };
type HMS = { hh: number; mm: number; ss?: number };
type Mode = 'flight';

type FlightLeg = {
  mode: Mode;
  provider: string;
  dep: YMD & HMS;
  arr: YMD & HMS;
  price: number;          // totale gruppo
  durationMin: number;
  transfers: number;
  notes?: string;
};

type TrendArticle = { title: string; link: string; published?: string };
type WebSignals = { trendScore: number; articles: TrendArticle[] };

type Proposal = {
  id: string;
  destination: { city: string; country?: string; iataCity: string; lat?: number; lon?: number };
  dates: { depart: string; return: string; nights: number };
  party: number;
  flight: { go: FlightLeg; back: FlightLeg; total: number };
  lodging: {
    nights: number;
    estPerNight: number;     // €/notte per tutto il gruppo (stima)
    estTotal: number;
    googleHotelsUrl: string;
    googleMapsUrl: string;
  };
  totalEstimate: number;
  underBudget: boolean;
  budget?: number;
  web?: WebSignals;
  gcalLinks: string[];
  ics: string;
};

/** ========== Utils ========== */
function pad(n: number, len = 2) { return n.toString().padStart(len, '0'); }
function fmtICS(dt: YMD & HMS) { return `${pad(dt.y,4)}${pad(dt.m)}${pad(dt.d)}T${pad(dt.hh)}${pad(dt.mm)}${pad(dt.ss ?? 0)}`; }
function isoToParts(iso: string): YMD & HMS {
  const d = new Date(iso);
  return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes(), ss: d.getSeconds() };
}
function addDays(iso: string, days: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function nightsWindow(startISO: string, nights: number) {
  const endISO = addDays(startISO, nights);
  return { startISO, endISO };
}
function iso8601DurationToMin(s: string): number {
  const m = s.match(/P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);
  const H = m?.[1] ? parseInt(m[1], 10) : 0;
  const M = m?.[2] ? parseInt(m[2], 10) : 0;
  const S = m?.[3] ? parseInt(m[3], 10) : 0;
  return H * 60 + M + Math.round(S / 60);
}

const TZID = 'Europe/Rome';
function gcalLink(title: string, start: YMD & HMS, end: YMD & HMS, location?: string, notes?: string) {
  const base = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const dates = `${fmtICS(start)}/${fmtICS(end)}`;
  const params = new URLSearchParams({ text: title, dates, location: location || '', details: notes || '' });
  return `${base}&${params.toString()}`;
}
function makeICS(title: string, events: Array<{title: string; start: YMD & HMS; end: YMD & HMS; location?: string; notes?: string; url?: string}>, alarmMin = 45) {
  const now = new Date();
  const dtstamp = `${pad(now.getUTCFullYear(),4)}${pad(now.getUTCMonth()+1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines: string[] = [
    'BEGIN:VCALENDAR','PRODID:-//TripPlanner AI//Agent Suggest//IT','VERSION:2.0','CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${title}`,`X-WR-TIMEZONE:${TZID}`
  ];
  for (const e of events) {
    lines.push('BEGIN:VEVENT',`UID:${randomUUID()}`,`DTSTAMP:${dtstamp}`,`DTSTART;TZID=${TZID}:${fmtICS(e.start)}`,`DTEND;TZID=${TZID}:${fmtICS(e.end)}`,`SUMMARY:${e.title}`);
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

/** ========== ENV ========== */
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || '';
const AMADEUS_ENV = (process.env.AMADEUS_ENV || 'test').toLowerCase();
const AMADEUS_BASE = AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';

const SERPAPI_KEY = process.env.SERPAPI_KEY || ''; // opzionale

/** ========== Amadeus OAuth ========== */
let amadeusToken: { token: string; exp: number } | null = null;
async function getAmadeusToken(): Promise<string> {
  if (!AMADEUS_KEY || !AMADEUS_SECRET) throw new Error('Missing AMADEUS envs');
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

/** ========== Amadeus helpers ========== */
interface ALoc { subType?: 'CITY'|'AIRPORT'; iataCode?: string; name?: string; address?: { countryCode?: string }; geoCode?: { latitude?: number; longitude?: number } }
interface ALocResp { data?: ALoc[] }

async function amadeusCityLookupByIata(iataCity: string): Promise<{ city: string; country?: string; lat?: number; lon?: number }> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v1/reference-data/locations`);
  url.searchParams.set('keyword', iataCity);
  url.searchParams.set('subType', 'CITY');
  url.searchParams.set('view', 'LIGHT');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return { city: iataCity };
  const j = (await res.json()) as ALocResp;
  const city = j.data?.find(x => x.subType === 'CITY' && x.iataCode?.toUpperCase() === iataCity.toUpperCase());
  return {
    city: city?.name || iataCity,
    country: city?.address?.countryCode,
    lat: city?.geoCode?.latitude,
    lon: city?.geoCode?.longitude,
  };
}

async function amadeusCityOrAirportCode(keyword: string): Promise<string | null> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v1/reference-data/locations`);
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('subType', 'CITY,AIRPORT');
  url.searchParams.set('view', 'LIGHT');
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return null;
  const j = (await res.json()) as ALocResp;
  const arr = j.data || [];
  const city = arr.find(x => x.subType === 'CITY' && x.iataCode)?.iataCode;
  const apt  = arr.find(x => x.subType === 'AIRPORT' && x.iataCode)?.iataCode;
  return (city || apt || null);
}

const IATA_BY_ALIAS: Record<string, string> = {
  bologna: 'BLQ', roma: 'ROM', milano: 'MIL', napoli: 'NAP', torino: 'TRN', venezia: 'VCE',
  lisbona: 'LIS', parigi: 'PAR', londra: 'LON', madrid: 'MAD', barcellona: 'BCN',
};
const EN_BY_ALIAS: Record<string, string> = { lisbona: 'Lisbon', parigi: 'Paris', londra: 'London' };

async function resolveIATA(cityOrCode: string): Promise<string | null> {
  const raw = cityOrCode.trim();
  if (/^[A-Za-z]{3}$/.test(raw)) return raw.toUpperCase();
  const k = raw.toLowerCase();
  if (IATA_BY_ALIAS[k]) return IATA_BY_ALIAS[k];
  let code = await amadeusCityOrAirportCode(raw);
  if (code) return code;
  const en = EN_BY_ALIAS[k]; if (en) code = await amadeusCityOrAirportCode(en);
  return code || null;
}

/** Flight Inspiration (mete dinamiche) */
interface AInspItem { destination?: string; departureDate?: string; returnDate?: string; price?: { total?: string; currency?: string } }
interface AInspResp { data?: AInspItem[] }

async function inspiration(originIata: string, departISO: string, nights: number, maxFlightPrice?: number): Promise<AInspItem[]> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v1/shopping/flight-destinations`);
  url.searchParams.set('origin', originIata);
  url.searchParams.set('departureDate', departISO);
  url.searchParams.set('oneWay', 'false');
  url.searchParams.set('currencyCode', 'EUR');
  url.searchParams.set('duration', String(nights));            // è supportato dall’API
  if (maxFlightPrice !== undefined) url.searchParams.set('maxPrice', String(Math.max(1, Math.floor(maxFlightPrice))));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) throw new Error('Inspiration search failed');
  const j = (await res.json()) as AInspResp;
  return (j.data ?? []).filter(x => typeof x.destination === 'string');
}

/** Flight Offers (dettaglio voli A/R) */
interface ASeg { departure?: { at?: string }; arrival?: { at?: string } }
interface AItin { duration?: string; segments?: ASeg[] }
interface AOffer { itineraries?: AItin[]; price?: { grandTotal?: string; total?: string }; validatingAirlineCodes?: string[]; carrierCode?: string }
interface AOffersResp { data?: AOffer[] }

function scoreFlight(price: number, durationMin: number, transfers: number) {
  const priceCap = 2000, timeCap = 900, transfersCap = 2;
  const sPrice = Math.max(0, 1 - price / priceCap);
  const sTime = Math.max(0, 1 - durationMin / timeCap);
  const sTransfers = Math.max(0, 1 - transfers / transfersCap);
  return 0.6*sPrice + 0.3*sTime + 0.1*sTransfers;
}

async function searchFlights(originIata: string, destIata: string, dateISO: string, adults: number): Promise<FlightLeg[]> {
  const token = await getAmadeusToken();
  const url = new URL(`${AMADEUS_BASE}/v2/shopping/flight-offers`);
  url.searchParams.set('originLocationCode', originIata);
  url.searchParams.set('destinationLocationCode', destIata);
  url.searchParams.set('departureDate', dateISO);
  url.searchParams.set('adults', String(adults));
  url.searchParams.set('currencyCode', 'EUR');
  url.searchParams.set('max', '6');

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (!res.ok) return [];
  const j = (await res.json()) as AOffersResp;

  const out: FlightLeg[] = [];
  for (const f of j.data ?? []) {
    const itin = f.itineraries?.[0]; if (!itin) continue;
    const segs = itin.segments ?? [];
    const depISO = segs[0]?.departure?.at;
    const arrISO = segs[segs.length - 1]?.arrival?.at;
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
      transfers: Math.max(0, segs.length - 1),
      notes: `${segs.length === 1 ? 'Diretto' : `${segs.length - 1} scalo/i`} · via Amadeus`,
    });
  }
  return out.sort((a, b) => scoreFlight(b.price, b.durationMin, b.transfers) - scoreFlight(a.price, a.durationMin, a.transfers));
}

/** ========== Stima alloggio + link Google ========== */
function seasonalFactor(month: number) {
  return month === 8 ? 1.0 : month === 7 ? 0.9 : (month === 6 || month === 9) ? 0.8 : 0.6;
}
function basePerNightGuess(city: string) {
  // eur/notte per 4p (hotel/appart. medio) – fallback euristico
  const k = city.toLowerCase();
  if (/(olbia|palma|ibiza|tenerife|heraklion|faro|dubrovnik|catania|palermo)/.test(k)) return 230;
  if (/(parigi|londra)/.test(k)) return 320;
  if (/(lisbona|madrid|barcellona)/.test(k)) return 240;
  return 200;
}
function googleLinks(city: string, checkin: string, checkout: string, lat?: number, lon?: number) {
  const q = encodeURIComponent(city);
  const hotels = `https://www.google.com/travel/hotels?hl=it&q=${q}&checkin=${checkin}&checkout=${checkout}`;
  const maps = lat != null && lon != null
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  return { hotels, maps };
}

/** ========== Web signals (SerpAPI opzionale) ========== */
interface SerpNewsItem { title?: string; link?: string; date?: string }
interface SerpNewsResp { news_results?: SerpNewsItem[] }

async function fetchTrend(city: string, themeHint: string): Promise<WebSignals | undefined> {
  if (!SERPAPI_KEY) return undefined;
  const q = encodeURIComponent(`${city} family travel ${themeHint} 2025`);
  const url = `https://serpapi.com/search.json?engine=google_news&hl=it&gl=it&q=${q}&num=10&api_key=${SERPAPI_KEY}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return undefined;
  const j = (await res.json()) as SerpNewsResp;
  const items = (j.news_results ?? []).slice(0, 5).filter(x => x.title && x.link);
  // punteggio semplice: più articoli recenti => punteggio più alto
  const trendScore = Math.min(1, items.length / 5);
  const articles: TrendArticle[] = items.map(x => ({ title: x.title!, link: x.link!, published: x.date }));
  return { trendScore, articles };
}

/** ========== Handler principale ========== */
export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

    const originInput = String(body.origin || 'Bologna');
    const party = Math.max(1, Number(body.party || 2));
    const nights = Math.max(1, Number(body.nights || 7));
    const budget = body.budget ? Number(body.budget) : undefined;
    const theme = String(body.theme || 'mare'); // usato solo come hint per news

    // Date: month=YYYY-MM o startDate=YYYY-MM-DD
    let startDate = String(body.startDate || '');
    const monthStr = String(body.month || '');
    if (!startDate) {
      if (/^\d{4}-\d{2}$/.test(monthStr)) {
        const [Y, M] = monthStr.split('-').map(Number);
        // 2° sabato del mese
        const d = new Date(Date.UTC(Y, M-1, 1));
        const saturdays: number[] = [];
        for (let i=1;i<=31;i++) {
          d.setUTCDate(i);
          if (d.getUTCMonth() !== M-1) break;
          if (d.getUTCDay() === 6) saturdays.push(i);
        }
        const day = saturdays[1] ?? saturdays[0] ?? 1;
        startDate = `${Y}-${pad(M)}-${pad(day)}`;
      } else {
        throw new Error('Fornisci month (YYYY-MM) oppure startDate (YYYY-MM-DD)');
      }
    }
    const { startISO, endISO } = nightsWindow(startDate, nights);

    // Prepara origin IATA
    const originIata = await resolveIATA(originInput);
    if (!originIata) return NextResponse.json({ error: 'Origin non riconosciuta' }, { status: 400 });

    // Quota del budget per i voli (greedy 45%)
    const flightCap = budget ? Math.max(1, Math.floor(budget * 0.45)) : undefined;

    // 1) Mete dinamiche via Inspiration
    const insp = await inspiration(originIata, startISO, nights, flightCap);
    // prendi top 12 per prezzo
    const sorted = insp
      .map(x => ({ dest: String(x.destination), price: Number(x.price?.total ?? NaN), depart: x.departureDate ?? startISO, ret: x.returnDate ?? endISO }))
      .filter(x => x.dest && Number.isFinite(x.price))
      .sort((a, b) => a.price - b.price)
      .slice(0, 12);

    const proposals: Proposal[] = [];

    for (const item of sorted) {
      if (proposals.length >= 5) break;
      try {
        const destIata = item.dest;
        // lookup nome città/geo
        const meta = await amadeusCityLookupByIata(destIata);
        const cityName = meta.city;
        const depart = startISO;    // usiamo le date scelte dall’utente (non sempre le date "ispirazione" hanno disponibilità)
        const ret = endISO;

        // 2) voli A/R (per TUTTO il gruppo)
        const [goList, backList] = await Promise.all([
          searchFlights(originIata, destIata, depart, party),
          searchFlights(destIata, originIata, ret, party),
        ]);
        if (!goList.length || !backList.length) continue;
        const go = goList[0], back = backList[0];
        const flightTotal = Math.round(go.price + back.price);

        // 3) stima alloggio
        const month = Number(startISO.slice(5,7));
        const perNight = Math.round(basePerNightGuess(cityName) * seasonalFactor(month));
        const lodgingTotal = perNight * nights;

        // 4) link Google Hotels/Maps
        const { hotels, maps } = googleLinks(cityName, depart, ret, meta.lat, meta.lon);

        // 5) web signals (opzionale)
        const web = await fetchTrend(cityName, theme).catch(() => undefined);

        const total = flightTotal + lodgingTotal;
        const underBudget = budget !== undefined ? total <= budget : true;

        // eventi/ics
        const events = [
          { title: `Partenza ${originInput} → ${cityName} (${go.provider})`, start: { ...go.dep, ss:0 }, end: { ...go.arr, ss:0 }, location: originInput, notes: `${go.mode} · €${Math.round(go.price)} · ${go.notes ?? ''}` },
          { title: `Check-in a ${cityName}`, start: { y: Number(depart.slice(0,4)), m: Number(depart.slice(5,7)), d: Number(depart.slice(8,10)), hh: 15, mm: 0, ss: 0 }, end: { y: Number(depart.slice(0,4)), m: Number(depart.slice(5,7)), d: Number(depart.slice(8,10)), hh: 16, mm: 0, ss: 0 }, location: cityName, notes: 'Apri Google Hotels/Maps per la prenotazione', url: hotels },
          { title: `Check-out a ${cityName}`, start: { y: Number(ret.slice(0,4)), m: Number(ret.slice(5,7)), d: Number(ret.slice(8,10)), hh: 11, mm: 0, ss: 0 }, end: { y: Number(ret.slice(0,4)), m: Number(ret.slice(5,7)), d: Number(ret.slice(8,10)), hh: 11, mm: 30, ss: 0 }, location: cityName, url: hotels },
          { title: `Ritorno ${cityName} → ${originInput} (${back.provider})`, start: { ...back.dep, ss:0 }, end: { ...back.arr, ss:0 }, location: cityName, notes: `${back.mode} · €${Math.round(back.price)} · ${back.notes ?? ''}` },
        ];
        const ics = makeICS(`${cityName} — proposta`, events, 45);
        const gcalLinks = [
          gcalLink(`Partenza ${originInput}→${cityName}`, events[0].start, events[0].end, originInput, events[0].notes),
          gcalLink(`Check-in ${cityName}`, events[1].start, events[1].end, cityName, events[1].notes),
          gcalLink(`Check-out ${cityName}`, events[2].start, events[2].end, cityName),
          gcalLink(`Ritorno ${cityName}→${originInput}`, events[3].start, events[3].end, cityName, events[3].notes),
        ];

        proposals.push({
          id: randomUUID(),
          destination: { city: cityName, country: meta.country, iataCity: destIata, lat: meta.lat, lon: meta.lon },
          dates: { depart, return: ret, nights },
          party,
          flight: { go, back, total: flightTotal },
          lodging: { nights, estPerNight: perNight, estTotal: lodgingTotal, googleHotelsUrl: hotels, googleMapsUrl: maps },
          totalEstimate: total,
          underBudget,
          budget,
          web,
          gcalLinks,
          ics,
        });
      } catch {
        continue;
      }
    }

    if (!proposals.length) {
      return NextResponse.json({ error: 'Nessuna proposta trovata: prova a cambiare mese/durata/budget.' }, { status: 404 });
    }

    // ranking finale: budget first, poi (trendScore desc), poi prezzo crescente
    proposals.sort((a, b) => {
      if (a.underBudget && !b.underBudget) return -1;
      if (!a.underBudget && b.underBudget) return 1;
      const ta = a.web?.trendScore ?? 0, tb = b.web?.trendScore ?? 0;
      if (tb !== ta) return tb - ta;
      return a.totalEstimate - b.totalEstimate;
    });

    return NextResponse.json({ proposals: proposals.slice(0, 5) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET diagnostico: /api/suggest?diag=1 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('diag') === '1') {
    return NextResponse.json({
      hasKey: !!process.env.AMADEUS_API_KEY,
      hasSecret: !!process.env.AMADEUS_API_SECRET,
      env: process.env.AMADEUS_ENV || 'test',
      base: AMADEUS_BASE,
      serpapi: !!SERPAPI_KEY,
      runtime,
    });
  }
  return NextResponse.json({ ok: true });
}
