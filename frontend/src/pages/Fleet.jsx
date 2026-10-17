import {useEffect,useState} from 'react';
import {api} from '../api';

const initial={busNumber:'',registrationNo:'',model:'',capacity:'',odometerKm:'0',status:'ACTIVE'};

export default function Fleet(){
  const [vehicles,setVehicles]=useState([]); const [form,setForm]=useState(initial); const [notice,setNotice]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const load=()=>api.get('/vehicles').then(r=>setVehicles(r.data)).catch(e=>setError(e.response?.data?.message||'Could not load buses'));
  useEffect(() => {
  load();
}, []);
  const change=(k,v)=>setForm(f=>({...f,[k]:v}));
  async function create(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{await api.post('/vehicles',form);setNotice('Bus added successfully.');setForm(initial);load();}catch(e){setError(e.response?.data?.message||'Could not add bus')}finally{setBusy(false)}}
  return <>
    <div className="page-title"><div><span className="eyebrow">FLEET ADMINISTRATION</span><h2>Buses & fleet</h2><p>Create and manage the buses available for route assignment.</p></div></div>
    {notice&&<div className="success">{notice}</div>}{error&&<div className="error">{error}</div>}
    <section className="panel">
      <div className="panel-head"><div><h3>Add a new bus</h3><p>Each bus gets a unique number so Admin can assign it to routes.</p></div></div>
      <form className="account-form" onSubmit={create}>
        <label>Bus number<input value={form.busNumber} onChange={e=>change('busNumber',e.target.value)} placeholder="3" required/></label>
        <label>Registration number<input value={form.registrationNo} onChange={e=>change('registrationNo',e.target.value)} placeholder="KA-01-CB-103" required/></label>
        <label>Model<input value={form.model} onChange={e=>change('model',e.target.value)} placeholder="Tata Starbus" required/></label>
        <label>Capacity<input type="number" min="1" value={form.capacity} onChange={e=>change('capacity',e.target.value)} placeholder="50" required/></label>
        <label>Current odometer (km)<input type="number" min="0" value={form.odometerKm} onChange={e=>change('odometerKm',e.target.value)}/></label>
        <label>Status<select value={form.status} onChange={e=>change('status',e.target.value)}><option>ACTIVE</option><option>INACTIVE</option><option>MAINTENANCE</option></select></label>
        <div className="full-row"><button className="primary" disabled={busy}>{busy?'Adding bus…':'＋ Add bus'}</button></div>
      </form>
    </section>
    <section className="panel"><div className="panel-head"><div><h3>Registered buses</h3><p>{vehicles.length} buses available in the fleet.</p></div></div>
      <div className="vehicle-grid">{vehicles.map(v=><div className="vehicle-card fleet-card" key={v.id}><div className="fleet-card-top"><span className="bus-badge">BUS {v.busNumber||'—'}</span><span className="chip good">{v.status}</span></div><b>{v.registrationNo}</b><span>{v.model} · {v.capacity} seats</span><small>{Number(v.odometerKm||0).toLocaleString('en-IN')} km</small></div>)}{!vehicles.length&&<div className="empty">No buses added yet.</div>}</div>
    </section>
  </>
}
