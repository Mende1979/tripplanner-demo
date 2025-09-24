'use client'
setError(j.error || 'Errore imprevisto')
setLoading(false)
return
}
const j = (await r.json()) as ApiResult
setRes(j)
setLoading(false)
}


function downloadICS() {
if (!res) return
const blob = new Blob([res.ics], { type: 'text/calendar;charset=utf-8' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'tripplanner.ics'
a.click()
URL.revokeObjectURL(url)
}


return (
<main style={{ maxWidth: 800, margin: '40px auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
<h1>TripPlanner — Transport + Lodging</h1>
<p>Trova il miglior trasporto (tempo/costo) e una sistemazione ben recensita entro budget.</p>


<form onSubmit={onSubmit} style={{ display: 'grid', gap: 12, marginTop: 16 }}>
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<label>Partenza<input name="origin" defaultValue="Bologna" required /></label>
<label>Destinazione<input name="dest" defaultValue="Lisbona" required /></label>
</div>
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<label>Data partenza<input type="date" name="departDate" defaultValue="2025-10-18" required /></label>
<label>Data ritorno<input type="date" name="returnDate" defaultValue="2025-10-21" required /></label>
</div>
<fieldset>
<legend>Mezzi consentiti</legend>
<label><input type="checkbox" name="modes" value="flight" defaultChecked /> Volo</label>{' '}
<label><input type="checkbox" name="modes" value="train" defaultChecked /> Treno</label>{' '}
<label><input type="checkbox" name="modes" value="drive" defaultChecked /> Auto</label>
</fieldset>
<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
<label>Budget/notte (€)<input type="number" name="maxNight" defaultValue={100} min={0} /></label>
<label>Promemoria (min)<input type="number" name="alarmMin" defaultValue={45} min={0} /></label>
</div>
<button type="submit" disabled={loading}>{loading ? 'Cerco…' : 'Cerca soluzioni'}</button>
</form>


{error && <p style={{ color: 'crimson' }}>Errore: {error}</p>}


{res && (
<section style={{ marginTop: 24 }}>
<h2>Risultati</h2>
<h3>Trasporti</h3>
<p><b>Andata</b>: {res.go.mode?.toUpperCase()} {res.go.provider} · {res.go.depText} → {res.go.arrText} · {res.go.durationMin} min · {res.go.transfers || 0} transiti · €{Math.round(res.go.price)} · {res.go.notes || ''}</p>
<p><b>Ritorno</b>: {res.back.mode?.toUpperCase()} {res.back.provider} · {res.back.depText} → {res.back.arrText} · {res.back.durationMin} min · {res.back.transfers || 0} transiti · €{Math.round(res.back.price)} · {res.back.notes || ''}</p>


<h3>Sistemazione</h3>
<p><b>{res.stay.name}</b> ({res.stay.location}) — Rating {res.stay.rating}/5 ({res.stay.reviews} recensioni)<br />
€{Math.round(res.stay.pricePerNight)}/notte × {res.nights} = <b>€{res.totalStay}</b></p>
{res.stay.url && (
<p><a href={res.stay.url} target="_blank" rel="noopener">Apri link struttura</a></p>
)}


<p>
<button onClick={downloadICS}>⬇️ Scarica calendario (.ics)</button>
</p>


<h3>Aggiungi i singoli eventi su Google Calendar</h3>
<ol>
{res.gcalLinks.map((u, i) => (
<li key={i}><a href={u} target="_blank" rel="noopener">Aggiungi evento {i + 1}</a></li>
))}
</ol>
</section>
)}
</main>
)
}