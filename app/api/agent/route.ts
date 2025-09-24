import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import OpenAI from 'openai';

export const runtime = 'nodejs';

/** ---------- Tipi ---------- */
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

type Proposal = {
  id: string;
  destination: { city: string; country?: string; iataCity: string; lat?: number; lon?: number; reason: string };
  dates: { depart: string; return: string; nights: number };
  party: number;
  flight: { go: FlightLeg; back: FlightLeg; total: number };
  lodging: { nights: number; estPerNight: number; estTotal: number; googleHotelsUrl: string; googleMapsUrl: string };
  totalEstimate: number;
  underBudget: boolean;
  budget?: number;
  gcalLinks: string[];
  ics: string;
};

/** ---------- ENV ---------- */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const AMADEUS_KEY = process.env.AMADEUS_API_KEY || '';
const AMADEUS_SECRET = process.env.AMADEUS_API_SECRET || '';
const AMADEUS_ENV = (process.env.AMADEUS_ENV || 'test').toLowerCase();
const AMADEUS_BASE = AMADEUS_ENV === 'production' ? 'https://api.amadeus.com' : 'https://test.api.amadeus.com';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

/** ---------- Utils ---------- */
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
    'BEGIN:VCALENDAR','PRODID:-//TripPlanner AI//LLM Agent//IT','VERSION:2.0','CALSCALE:GREGORIAN',
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

/** ---------- Amadeus OAuth + helpers ---------- */
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
  if (!res.ok) throw new Error(`Amadeus OAuth failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  amadeusToken = { token: j.access_token, exp: now + j.expires_in };
  return amadeusToken.token;
}

interface ALoc { subType?: 'CITY'|'AIRPORT'; iataCode?: string; name?: string; address?: { countryCode?: string }; geoCode?: { latitude?: number; longitude?: number } }
interface ALocResp { data?: ALoc[] }

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

/** ---------- Flight Offers ---------- */
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

/** ---------- Stima alloggio + link Google ---------- */
function seasonalFactor(month: number) {
  return month === 8 ? 1.0 : month === 7 ? 0.9 : (month === 6 || month === 9) ? 0.8 : 0.6;
}
function googleLinks(city: string, checkin: string, checkout: string, lat?: number, lon?: number) {
  const q = encodeURIComponent(city);
  const hotels = `https://www.google.com/travel/hotels?hl=it&q=${q}&checkin=${checkin}&checkout=${checkout}`;
  const maps = lat != null && lon != null
    ? `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`
    : `https://www.google.com/maps/search/?api=1&query=${q}`;
  return { hotels, maps };
}

/** ---------- LLM: sceglie 5 mete mare (JSON via prompt, niente response_format) ---------- */
type LlmPick = {
  city: string;
  country: string;
  reason: string;
  expected_lodging_per_night_eur: number; // per tutto il gruppo
  family_score: number;                    // 0..1
  novelty_score: number;                   // 0..1
};
type LlmOut = { picks: LlmPick[] };

async function llmPickDestinations(input: {
  origin: string; month?: string; startDate?: string; nights: number; party: number; budget?: number;
}) : Promise<LlmPick[]> {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');

  const prefs = [
    `Origine: ${input.origin}`,
    input.month ? `Mese: ${input.month}` : `Data inizio: ${input.startDate}`,
    `Notti: ${input.nights}`,
    `Persone: ${input.party}`,
    input.budget ? `Budget: €${input.budget}` : 'Budget: non specificato',
    `Tema: mare, family-friendly, diversificazione geografica, focus Europa/Med; stima alloggio per NOTTE per l’intero gruppo (hotel o appart. medio).`,
  ].join('\n');

  const sys = [
    'Sei un agente viaggi.',
    'Devi restituire ESATTAMENTE 5 destinazioni di mare adatte a famiglie, diversificate per Paese/area.',
    'Per ciascuna meta fornisci una motivazione sintetica.',
    'Stima il costo alloggio per NOTTE per tutto il gruppo (non lusso).',
    'Rispondi SOLO con un JSON valido con questo schema:',
    '{ "picks": [ { "city": "...", "country": "...", "reason": "...", "expected_lodging_per_night_eur": 200, "family_score": 0.9, "novelty_score": 0.6 }, ... (totale 5) ] }',
  ].join('\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-2024-08-06',
    temperature: 0.2,
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: `Preferenze:\n${prefs}\n\nRestituisci SOLO il JSON richiesto, nessun testo fuori dal JSON.` }
    ],
  });

  const content = completion.choices[0]?.message?.content?.trim() || '{}';
  let parsed: LlmOut;
  try {
    parsed = JSON.parse(content) as LlmOut;
  } catch {
    // fallback minimale: prova a ripulire blocchi "```json"
    const cleaned = content.replace(/```json|```/g, '').trim();
    parsed = JSON.parse(cleaned) as LlmOut;
  }

  // Validazione minima
  if (!parsed || !Array.isArray(parsed.picks)) throw new Error('LLM output malformato');
  // Prendi esattamente 5
  const picks = parsed.picks.filter(p =>
    p && typeof p.city === 'string' && typeof p.country === 'string' &&
    typeof p.reason === 'string' && Number.isFinite(p.expected_lodging_per_night_eur)
  ).slice(0, 5);

  if (picks.length < 1) throw new Error('LLM non ha restituito destinazioni valide');
  // Se meno di 5, useremo quante ne abbiamo (evito errore duro)
  return picks;
}

/** ---------- Handler principale ---------- */
export async function POST(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;

    const originInput = String(body.origin || 'Bologna');
    const party = Math.max(1, Number(body.party || 4));
    const nights = Math.max(1, Number(body.nights || 14));
    const budget = body.budget ? Number(body.budget) : undefined;

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

    // 1) LLM seleziona fino a 5 mete di mare (family)
    const llmPicks = await llmPickDestinations({ origin: originInput, month: monthStr || undefined, startDate: startDate || undefined, nights, party, budget });

    // 2) Per ciascuna meta: risolvi IATA, voli A/R con Amadeus, stima alloggio + link
    const originIata = await resolveIATA(originInput);
    if (!originIata) return NextResponse.json({ error: 'Origin non riconosciuta' }, { status: 400 });

    const proposals: Proposal[] = [];
    for (const pick of llmPicks) {
      const destIata = await amadeusCityOrAirportCode(`${pick.city}`);
      if (!destIata) continue;

      const [goList, backList] = await Promise.all([
        searchFlights(originIata, destIata, startISO, party),
        searchFlights(destIata, originIata, endISO, party),
      ]);
      if (!goList.length || !backList.length) continue;

      const go = goList[0], back = backList[0];
      const flightTotal = Math.round(go.price + back.price);

      const meta = await amadeusCityLookupByIata(destIata);
      const cityName = `${pick.city}`;
      const month = Number(startISO.slice(5,7));
      const perNight = Math.max(60, Math.round(pick.expected_lodging_per_night_eur * seasonalFactor(month)));
      const lodgingTotal = perNight * nights;

      const { hotels, maps } = googleLinks(cityName, startISO, endISO, meta.lat, meta.lon);

      const total = flightTotal + lodgingTotal;
      const underBudget = budget !== undefined ? total <= budget : true;

      const events = [
        { title: `Partenza ${originInput} → ${cityName} (${go.provider})`, start: { ...go.dep, ss:0 }, end: { ...go.arr, ss:0 }, location: originInput, notes: `${go.mode} · €${Math.round(go.price)}` },
        { title: `Check-in a ${cityName}`, start: { y: Number(startISO.slice(0,4)), m: Number(startISO.slice(5,7)), d: Number(startISO.slice(8,10)), hh: 15, mm: 0, ss: 0 }, end: { y: Number(startISO.slice(0,4)), m: Number(startISO.slice(5,7)), d: Number(startISO.slice(8,10)), hh: 16, mm: 0, ss: 0 }, location: cityName, notes: pick.reason, url: hotels },
        { title: `Check-out a ${cityName}`, start: { y: Number(endISO.slice(0,4)), m: Number(endISO.slice(5,7)), d: Number(endISO.slice(8,10)), hh: 11, mm: 0, ss: 0 }, end: { y: Number(endISO.slice(0,4)), m: Number(endISO.slice(5,7)), d: Number(endISO.slice(8,10)), hh: 11, mm: 30, ss: 0 }, location: cityName, url: hotels },
        { title: `Ritorno ${cityName} → ${originInput} (${back.provider})`, start: { ...back.dep, ss:0 }, end: { ...back.arr, ss:0 }, location: cityName, notes: `${back.mode} · €${Math.round(back.price)}` },
      ];
      const ics = makeICS(`${cityName} — proposta`, events, 45);
      const gcalLinks = [
        gcalLink(`Partenza ${originInput}→${cityName}`, events[0].start, events[0].end, originInput),
        gcalLink(`Check-in ${cityName}`, events[1].start, events[1].end, cityName, pick.reason),
        gcalLink(`Check-out ${cityName}`, events[2].start, events[2].end, cityName),
        gcalLink(`Ritorno ${cityName}→${originInput}`, events[3].start, events[3].end, cityName),
      ];

      proposals.push({
        id: randomUUID(),
        destination: { city: cityName, country: pick.country, iataCity: destIata, lat: meta.lat, lon: meta.lon, reason: pick.reason },
        dates: { depart: startISO, return: endISO, nights },
        party,
        flight: { go, back, total: flightTotal },
        lodging: { nights, estPerNight: perNight, estTotal: lodgingTotal, googleHotelsUrl: hotels, googleMapsUrl: maps },
        totalEstimate: total,
        underBudget,
        budget,
        gcalLinks,
        ics
      });
    }

    if (!proposals.length) {
      return NextResponse.json({ error: 'Nessuna proposta valida dalle mete LLM (voli non trovati sulle date richieste).' }, { status: 404 });
    }

    // Ordina: prima entro budget, poi prezzo totale crescente
    proposals.sort((a, b) => {
      if (a.underBudget && !b.underBudget) return -1;
      if (!a.underBudget && b.underBudget) return 1;
      return a.totalEstimate - b.totalEstimate;
    });

    return NextResponse.json({ proposals: proposals.slice(0, 5) });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** ---------- GET diagnostico ---------- */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get('diag') === '1') {
    return NextResponse.json({
      hasOpenAI: !!OPENAI_API_KEY,
      hasAmadeusKey: !!AMADEUS_KEY,
      hasAmadeusSecret: !!AMADEUS_SECRET,
      env: process.env.AMADEUS_ENV || 'test',
      runtime,
    });
  }
  return NextResponse.json({ ok: true });
}