import { useState } from 'react';
import Dialog from './Dialog';
import { api } from '../api';

// Styles live here so they load with the component and do not depend on a CSS file.
const EDITOR_CSS = `.route-editor { display: grid; gap: 16px; width: 100%; box-sizing: border-box; }
.route-editor *, .route-editor *::before, .route-editor *::after { box-sizing: border-box; }
.route-editor-section-title { margin: 4px 0 0; font-size: .95rem; }
.route-editor-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.route-editor-grid .full { grid-column: 1 / -1; }
.route-editor-grid label { display: grid; gap: 6px; font-size: .85rem; min-width: 0; }
.route-editor input { width: 100%; min-width: 0; padding: 8px 10px; border-radius: 10px; border: 1px solid rgba(120,160,190,.3); background: rgba(8,20,32,.7); color: inherit; font: inherit; }

/* One row per pickup point. Existing stops: #, name, arrival, fee, actions.
   New stops add latitude and longitude before the actions. */
.route-editor-head, .route-editor-stop {
  display: grid;
  grid-template-columns: 24px minmax(120px, 1fr) 120px 96px auto;
  gap: 8px; align-items: center;
}
.route-editor-stop.is-new { grid-template-columns: 24px minmax(110px, 1fr) 116px 92px minmax(80px, .8fr) minmax(80px, .8fr) auto; }
.route-editor-head { font-size: .72rem; text-transform: uppercase; letter-spacing: .05em; opacity: .7; }
.route-editor-stop .index { text-align: center; font-weight: 700; }
.route-editor-stop .actions { display: flex; gap: 4px; }
.route-editor-stop .actions button { padding: 6px 8px; white-space: nowrap; }
.route-editor-hint { margin: 0; font-size: .8rem; opacity: .7; }
.route-editor-actions { display: flex; justify-content: flex-end; gap: 10px; }

@media (max-width: 720px) {
  .route-editor-grid { grid-template-columns: 1fr; }
  .route-editor-head { display: none; }
  .route-editor-stop, .route-editor-stop.is-new { grid-template-columns: 1fr 1fr; }
  .route-editor-stop .index { grid-column: 1 / -1; text-align: left; }
  .route-editor-stop .name { grid-column: 1 / -1; }
  .route-editor-stop .actions { grid-column: 1 / -1; }
}
`;

// Admin editor for an existing route: name, code, description, safety limits and stops.
function toDraft(route) {
  return {
    code: route.code || '',
    name: route.name || '',
    description: route.description || '',
    speedLimitKmph: Number(route.speedLimitKmph || 40),
    arrivalAlertMinutes: Number(route.arrivalAlertMinutes || 10),
    stops: [...(route.stops || [])]
      .sort((a, b) => a.sequence - b.sequence)
      .map(rs => ({
        routeStopId: rs.id,
        name: rs.stop?.name || '',
        plannedEta: rs.plannedEta || '08:00',
        transportFee: rs.stop?.transportFee ?? 0,
        latitude: rs.stop?.latitude ?? '',
        longitude: rs.stop?.longitude ?? '',
      })),
  };
}

export default function RouteEditor({ route, onClose, onSaved }) {
  const [draft, setDraft] = useState(() => toDraft(route));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const setField = (key, value) => setDraft(d => ({ ...d, [key]: value }));
  const setStop = (index, key, value) =>
    setDraft(d => ({ ...d, stops: d.stops.map((s, i) => (i === index ? { ...s, [key]: value } : s)) }));
  const move = (index, delta) => setDraft(d => {
    const target = index + delta;
    if (target < 0 || target >= d.stops.length) return d;
    const stops = [...d.stops];
    [stops[index], stops[target]] = [stops[target], stops[index]];
    return { ...d, stops };
  });
  const removeStop = (index) => setDraft(d => ({ ...d, stops: d.stops.filter((_, i) => i !== index) }));
  const addStop = () => setDraft(d => ({
    ...d,
    stops: [...d.stops, { name: `Pickup point ${d.stops.length + 1}`, plannedEta: '08:00', transportFee: 0, latitude: '', longitude: '' }],
  }));

  async function save(event) {
    event.preventDefault();
    setError('');
    if (!draft.stops.length) return setError('A route needs at least one pickup point.');
    setBusy(true);
    try {
      const payload = {
        ...draft,
        speedLimitKmph: Number(draft.speedLimitKmph),
        arrivalAlertMinutes: Number(draft.arrivalAlertMinutes),
        stops: draft.stops.map(s => ({ ...s, transportFee: Number(s.transportFee || 0) })),
      };
      const response = await api.patch(`/routes/${route.id}/details`, payload);
      onSaved(response.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not save the route.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Edit ${route.code}`} onClose={onClose}>
      <form className="route-editor" onSubmit={save}>
        <style>{EDITOR_CSS}</style>
        <div className="route-editor-grid">
          <label>Route code<input value={draft.code} onChange={e => setField('code', e.target.value)} required /></label>
          <label>Route name<input value={draft.name} onChange={e => setField('name', e.target.value)} required /></label>
          <label>Speed limit (km/h)<input type="number" min="10" max="120" value={draft.speedLimitKmph} onChange={e => setField('speedLimitKmph', e.target.value)} /></label>
          <label>Parent approach alert (min)<input type="number" min="1" max="30" value={draft.arrivalAlertMinutes} onChange={e => setField('arrivalAlertMinutes', e.target.value)} /></label>
          <label className="full">Description<input value={draft.description} onChange={e => setField('description', e.target.value)} /></label>
        </div>

        <h3 className="route-editor-section-title">Pickup points, in travel order</h3>
        <div className="route-editor-head" aria-hidden="true">
          <span>#</span><span>Name</span><span>Arrival</span><span>Fee (₹)</span><span>Actions</span>
        </div>
        {draft.stops.map((s, i) => (
          <div className={`route-editor-stop${s.routeStopId ? '' : ' is-new'}`} key={s.routeStopId || `new-${i}`}>
            <span className="index">{i + 1}</span>
            <input className="name" aria-label={`Stop ${i + 1} name`} value={s.name} onChange={e => setStop(i, 'name', e.target.value)} />
            <input aria-label={`Stop ${i + 1} arrival time`} type="time" value={s.plannedEta} onChange={e => setStop(i, 'plannedEta', e.target.value)} />
            <input aria-label={`Stop ${i + 1} fee`} type="number" min="0" value={s.transportFee} onChange={e => setStop(i, 'transportFee', e.target.value)} />
            {!s.routeStopId && <>
              <input aria-label={`Stop ${i + 1} latitude`} placeholder="Latitude" value={s.latitude} onChange={e => setStop(i, 'latitude', e.target.value)} />
              <input aria-label={`Stop ${i + 1} longitude`} placeholder="Longitude" value={s.longitude} onChange={e => setStop(i, 'longitude', e.target.value)} />
            </>}
            <div className="actions">
              <button type="button" className="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
              <button type="button" className="secondary" onClick={() => move(i, 1)} disabled={i === draft.stops.length - 1} aria-label="Move down">↓</button>
              <button type="button" className="secondary" onClick={() => removeStop(i)} aria-label="Remove stop">Remove</button>
            </div>
          </div>
        ))}
        <div><button type="button" className="secondary" onClick={addStop}>+ Add pickup point</button></div>
        <p className="route-editor-hint">New pickup points need latitude and longitude. Removing a pickup point is blocked while students are enrolled there.</p>

        {error && <div className="error" role="alert">{error}</div>}
        <div className="route-editor-actions">
          <button type="button" className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save route changes'}</button>
        </div>
      </form>
    </Dialog>
  );
}
