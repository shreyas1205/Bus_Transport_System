import { useEffect, useState } from 'react';
import { api } from '../api';

export default function TransportSelection() {
  const [routes, setRoutes] = useState([]);
  const [current, setCurrent] = useState(null);
  const [routeId, setRouteId] = useState('');
  const [stopId, setStopId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const [options, mine] = await Promise.all([
        api.get('/transport-selection/options'),
        api.get('/transport-selection/me'),
      ]);
      setRoutes(options.data);
      setCurrent(mine.data);
      if (!mine.data.locked) {
        setRouteId(mine.data.selection?.routeId || '');
        setStopId(mine.data.selection?.stopId || '');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load route selection.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const selectedRoute = routes.find(r => r.id === routeId);
  const selectedStop = selectedRoute?.stops.find(s => s.id === stopId);

  async function confirmSelection(e) {
    e.preventDefault();
    if (!routeId || !stopId) { setError('Choose a route and pickup point.'); return; }
    const ok = window.confirm(`Lock ${selectedRoute?.name} / ${selectedStop?.name} for ${current?.academicYear}? You will not be able to change it yourself during this academic year.`);
    if (!ok) return;
    setSaving(true); setError(''); setMsg('');
    try {
      const r = await api.post('/transport-selection/select', { routeId, stopId });
      setMsg(r.data.message);
      setCurrent({ academicYear: r.data.academicYear, locked: true, selection: r.data.selection });
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save route selection.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-card">Loading route choices…</div>;

  if (current?.locked) {
    const s = current.selection;
    return <><div className="page-title"><div><span className="eyebrow">ACADEMIC YEAR {current.academicYear}</span><h2>My CampusBus Route</h2><p>Your route selection is locked for this academic year.</p></div><span className="chip good">LOCKED</span></div>
      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}
      <section className="panel transport-selection-card">
        <div><small className="eyebrow">SELECTED ROUTE</small><h3>{s.routeCode} · {s.routeName}</h3><p>🚌 {s.busNumber ? `Bus ${s.busNumber}` : (s.registrationNo || 'Bus not assigned yet')}</p></div>
        <div className="selection-grid"><div><small>Pickup point</small><b>{s.stopName}</b></div><div><small>Scheduled / location</small><b>{s.locationText}</b>{s.googleMapsUrl && <a href={s.googleMapsUrl} target="_blank" rel="noreferrer">📍 Open in Google Maps</a>}</div><div><small>Annual transport fee</small><b>₹{Number(s.fee || 0).toLocaleString('en-IN')}</b></div><div><small>Driver</small><b>{s.driver?.name || '—'}</b><span>{s.driver?.phone || ''}</span></div></div>
      </section>
      <div className="hint">This selection is permanent for {current.academicYear}. Contact Admin if a change is required.</div>
    </>;
  }

  return <><div className="page-title"><div><span className="eyebrow">ACADEMIC YEAR {current?.academicYear}</span><h2>Choose your CampusBus route</h2><p>Select the route and pickup point you want to use. Once confirmed, it stays fixed for the whole academic year.</p></div></div>
    {msg && <div className="success">{msg}</div>}
    {error && <div className="error">{error}</div>}
    <section className="panel"><form className="stack" onSubmit={confirmSelection}>
      <label>Route<select className="select" value={routeId} onChange={e=>{setRouteId(e.target.value);setStopId('')}} required><option value="">Select a route</option>{routes.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}{r.busNumber ? ` · Bus ${r.busNumber}` : ''}</option>)}</select></label>
      {selectedRoute && <div className="hint"><b>{selectedRoute.description || selectedRoute.name}</b>{selectedRoute.driver?.name && <span> Driver: {selectedRoute.driver.name}{selectedRoute.driver.phone ? ` · ${selectedRoute.driver.phone}` : ''}</span>}</div>}
      <label>Pickup point<select className="select" value={stopId} onChange={e=>setStopId(e.target.value)} disabled={!selectedRoute} required><option value="">Select your pickup point</option>{selectedRoute?.stops.map(s=><option key={s.id} value={s.id}>{s.sequence}. {s.name} · {s.plannedEta || 'Time not set'} · ₹{Number(s.transportFee||0).toLocaleString('en-IN')}</option>)}</select></label>
      {selectedStop && <div className="panel selection-preview"><h3>{selectedStop.name}</h3><p>Arrival: <b>{selectedStop.plannedEta || '—'}</b></p><p>Annual transport fee: <b>₹{Number(selectedStop.transportFee||0).toLocaleString('en-IN')}</b></p><p>{selectedStop.locationText}</p>{selectedStop.googleMapsUrl && <a href={selectedStop.googleMapsUrl} target="_blank" rel="noreferrer">📍 Open pickup point in Google Maps</a>}</div>}
      <button className="primary" type="submit" disabled={saving || !routeId || !stopId}>{saving ? 'Saving…' : `Confirm route for ${current?.academicYear || 'this year'}`}</button>
    </form></section>
  </>;
}
