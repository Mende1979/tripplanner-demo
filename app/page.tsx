'use client';
import React, { useState } from 'react';

type TrendArticle = { title: string; link: string; published?: string };
type Proposal = {
  id: string;
  destination: { city: string; country?: string; iataCity: string };
  dates: { depart: string; return: string; nights: number };
  party: number;
  flight: {
    go: { provider: string; durationMin: number; transfers: number; price: number };
    back:{ provider: string; durationMin: number; transfers: number; price: number };
    total: number;
  };
  lodging: { nights: number; estPerNight: number; estTotal: number; googleHotelsUrl: string; googleMapsUrl: string };
  totalEstimate: number;
  underBudget: boolean;
  budget?: number;
  web?: { trendScore: number; articles: TrendArticle[] };
  gcalLinks: string[];
  ics: string;
};

type ApiResult = { proposals: Proposal[] };

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [res, setRes] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError(null); setRes(null);

    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        origin: String(fd.get('origin') || 'Bologna'),
        theme: String(fd.get('theme') || 'mare'),
        month: String(fd.get('month') || ''),       // YYYY-MM
        startDate: String(fd.get('startDate') || ''), // YYYY-MM-DD
        nights: Number(fd.get('nights') || 14),
        party: Number(fd.get('party') || 4),
        budget: fd.get('budget') ? Number(fd.get('budget')) : undefined,
      };

      const r = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as { error?: string }));
        setError(j?.error || 'Errore imprevisto');
        return;
      }
      const j = (await r.json()) as ApiResult;
      setRes(j);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function downloadICS(p: Proposal) {
    const blob = new Blob([p.ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `trip-${p.destination.iataCity}.ics`; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ maxWidth: 980, margin: '40px auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>TripPlanner — Agent dinamico</h1>
      <p>Il sistema sceglie <b>mete reali</b> (Amadeus Inspiration) e le ordina usando voli, budget e segnali dal web (Google News, opzionale).</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          <label> Partenza
            <input name="origin" defaultValue="Bologna" required />
          </label>
          <label> Tema (hint trend)
            <select name="theme" defaultValue="mare">
              <option value="mare">Mare</option>
              <option value="città">Città</option>
              <option value="montagna">Montagna</option>
              <option value="natura">Natura</option>
            </select>
          </label>
          <label> Persone
            <input type="number" name="party" defaultValue={4} min={1} />
          </label>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
          <label> Mese (YYYY-MM)
            <input name="month" placeholder="2025-08" />
          </label>
          <label> Oppure data partenza
            <input type="date" name="startDate" />
          </label>
          <label> Notti
            <input type="number" name="nights" defaultValue={14} min={1} />
          </label>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          <label> Budget totale (€)
            <input type="number" name="budget" defaultValue={3000} min={0} />
          </label>
          <span />
        </div>

        <button type="submit" disabled={loading}>{loading ? 'Genero…' : 'Genera 4–5 proposte'}</button>
      </form>

      {!!error && <p style={{ color: 'crimson', marginTop: 12 }}>Errore: {error}</p>}

      {res?.proposals && (
        <section style={{ marginTop: 24, display:'grid', gap:16 }}>
          {res.proposals.map((p) => (
            <article key={p.id} style={{ border:'1px solid #ddd', borderRadius:12, padding:16 }}>
              <h3 style={{ marginTop: 0 }}>
                {p.destination.city} ({p.destination.iataCity}) {p.underBudget ? '· ✅ entro budget' : '· ⚠️ sopra budget'}
              </h3>
              <p style={{ margin:'6px 0' }}>
                <b>Date</b>: {p.dates.depart} → {p.dates.return} · {p.dates.nights} notti · <b>Persone</b>: {p.party}
              </p>
              <p style={{ margin:'6px 0' }}>
                <b>Voli</b>: Andata {p.flight.go.provider} · {p.flight.go.durationMin} min · {p.flight.go.transfers} scali · €{Math.round(p.flight.go.price)}<br/>
                Ritorno {p.flight.back.provider} · {p.flight.back.durationMin} min · {p.flight.back.transfers} scali · €{Math.round(p.flight.back.price)}<br/>
                <b>Totale voli</b>: €{Math.round(p.flight.total)}
              </p>
              <p style={{ margin:'6px 0' }}>
                <b>Alloggio</b>: stima €{p.lodging.estPerNight}/notte × {p.lodging.nights} = <b>€{p.lodging.estTotal}</b><br/>
                <a href={p.lodging.googleHotelsUrl} target="_blank" rel="noopener">Apri Google Hotels (date)</a> ·{' '}
                <a href={p.lodging.googleMapsUrl} target="_blank" rel="noopener">Apri su Maps</a>
              </p>
              <p style={{ margin:'6px 0' }}>
                <b>Totale stimato</b>: €{Math.round(p.totalEstimate)} {p.budget ? `(budget €${p.budget})` : ''}
              </p>

              {p.web && (
                <div style={{ margin:'6px 0' }}>
                  <b>Trend</b>: {(p.web.trendScore*100).toFixed(0)}%
                  <ul>
                    {p.web.articles.slice(0,3).map((a, i) => (
                      <li key={i}><a href={a.link} target="_blank" rel="noopener">{a.title}</a>{a.published ? ` · ${a.published}` : ''}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
                <button onClick={() => downloadICS(p)}>⬇️ Scarica .ics</button>
                {p.gcalLinks.map((u, i) => (
                  <a key={i} href={u} target="_blank" rel="noopener">Aggiungi evento {i+1}</a>
                ))}
              </div>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
