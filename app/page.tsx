'use client';
import React, { useState } from 'react';

/** Tipi coerenti con la risposta della /api/plan (versione Google Lodging) */
type TransportMode = 'flight';
type TransportOut = {
  mode: TransportMode;
  provider: string;
  depText: string;
  arrText: string;
  durationMin: number;
  transfers?: number;
  price: number;
  notes?: string;
};
type LodgingLinks = {
  city: string;
  googleHotels: string;
  googleMaps: string;
};
type ApiResult = {
  go: TransportOut;
  back: TransportOut;
  lodging: LodgingLinks;
  nights: number;
  gcalLinks: string[];
  ics: string;
};

export default function Home() {
  const [loading, setLoading] = useState<boolean>(false);
  const [res, setRes] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setRes(null);

    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        origin: String(fd.get('origin') || ''),
        dest: String(fd.get('dest') || ''),
        departDate: String(fd.get('departDate') || ''),
        returnDate: String(fd.get('returnDate') || ''),
        alarmMin: fd.get('alarmMin') ? Number(fd.get('alarmMin')) : 45,
      };

      const r = await fetch('/api/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!r.ok) {
        let msg = 'Errore imprevisto';
        try {
          const j: { error?: string } = await r.json();
          if (j?.error) msg = j.error;
        } catch {}
        setError(msg);
        return;
      }

      const j: ApiResult = await r.json();
      setRes(j);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function downloadICS() {
    if (!res) return;
    const blob = new Blob([res.ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tripplanner.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main style={{ maxWidth: 800, margin: '40px auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>TripPlanner — Voli + Alloggi (Google)</h1>
      <p>Trova il volo migliore (tempo/costo) e apri direttamente <b>Google Hotels</b> per scegliere e prenotare l’alloggio.</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            Partenza
            <input name="origin" defaultValue="Bologna" required />
          </label>
          <label>
            Destinazione
            <input name="dest" defaultValue="Parigi" required />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            Data partenza
            <input type="date" name="departDate" defaultValue="2025-10-18" required />
          </label>
          <label>
            Data ritorno
            <input type="date" name="returnDate" defaultValue="2025-10-21" required />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label>
            Promemoria (min)
            <input type="number" name="alarmMin" defaultValue={45} min={0} />
          </label>
          <span />
        </div>

        <button type="submit" disabled={loading}>{loading ? 'Cerco…' : 'Cerca soluzioni'}</button>
      </form>

      {!!error && <p style={{ color: 'crimson' }}>Errore: {error}</p>}

      {res && (
        <section style={{ marginTop: 24 }}>
          <h2>Risultati</h2>

          <h3>Voli</h3>
          <p>
            <b>Andata</b>: {res.go.mode.toUpperCase()} {res.go.provider} · {res.go.depText} → {res.go.arrText} · {res.go.durationMin} min ·{' '}
            {(res.go.transfers ?? 0)} scali · €{Math.round(res.go.price)} · {res.go.notes ?? ''}
          </p>
          <p>
            <b>Ritorno</b>: {res.back.mode.toUpperCase()} {res.back.provider} · {res.back.depText} → {res.back.arrText} · {res.back.durationMin} min ·{' '}
            {(res.back.transfers ?? 0)} scali · €{Math.round(res.back.price)} · {res.back.notes ?? ''}
          </p>

          <h3>Alloggi (Google)</h3>
          <p>
            Soggiorno a <b>{res.lodging.city}</b> per {res.nights} notte{res.nights > 1 ? 'i' : ''}.<br />
            Apri <a href={res.lodging.googleHotels} target="_blank" rel="noopener">Google Hotels</a> (date già impostate) e scegli la struttura.<br />
            (Opzionale) <a href={res.lodging.googleMaps} target="_blank" rel="noopener">Apri su Google Maps</a>.
          </p>

          <p>
            <button onClick={downloadICS}>⬇️ Scarica calendario (.ics)</button>
          </p>

          <h3>Aggiungi i singoli eventi su Google Calendar</h3>
          <ol>
            {res.gcalLinks.map((u: string, i: number) => (
              <li key={i}><a href={u} target="_blank" rel="noopener">Aggiungi evento {i + 1}</a></li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
