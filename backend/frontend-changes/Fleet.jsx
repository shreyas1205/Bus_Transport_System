import {useEffect,useState} from 'react';
import {useAuth} from '../auth';
import {api} from '../api';

const initial={busNumber:'',registrationNo:'',model:'',capacity:'',odometerKm:'0',status:'ACTIVE'};

export default function Fleet(){
  const {user}=useAuth();
  const [vehicles,setVehicles]=useState([]); const [form,setForm]=useState(initial); const [notice,setNotice]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const load=()=>api.get('/vehicles').then(r=>setVehicles(r.data)).catch(e=>setError(e.response?.data?.message||'Could not load buses'));
  useEffect(() => {
  load();
}, []);
  const change=(k,v)=>setForm(f=>({...f,[k]:v}));
  async function create(e){e.preventDefault();setBusy(true);setError('');setNotice('');try{await api.post('/vehicles',form);setNotice('Bus added successfully.');setForm(initial);load();}catch(e){setError(e.response?.data?.message||'Could not add bus')}finally{setBusy(false)}}
  async function manage(vehicle, action){
    if(busy || user?.role!=='ADMIN')return;
    const deleting=action==='DELETE';
    if(!window.confirm(deleting ? 'Delete '+vehicle.registrationNo+'? Only buses without operational or historical records can be deleted. Otherwise deactivate the bus.' : (action==='INACTIVE'?'Deactivate ':'Reactivate ')+vehicle.registrationNo+'?'))return;
    setBusy(true);setError('');setNotice('');
    try{
      if(deleting){await api.delete('/vehicles/'+vehicle.id);setVehicles(rows=>rows.filter(v=>v.id!==vehicle.id));}
      else{const {data}=await api.patch('/vehicles/'+vehicle.id,{status:action});setVehicles(rows=>rows.map(v=>v.id===vehicle.id?data:v));}
      setNotice(deleting?'Bus deleted.':action==='INACTIVE'?'Bus deactivated. History preserved.':'Bus reactivated.');
    }catch(e){setError(e.response?.data?.message||'Could not update bus.')}finally{setBusy(false)}
  }
  if(user?.role!=='ADMIN')return <div className="error">Admin access required.</div>;
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
        <label>Status<select value={form.status} onChange={e=>change('status',e.target.value)}><option>ACTIVE</option><option>INACTIVE</option><option>BREAKDOWN</option><option>MAINTENANCE</option></select></label>
        <div className="full-row"><button className="primary" disabled={busy}>{busy?'Adding bus…':'＋ Add bus'}</button></div>
      </form>
    </section>
    <section className="panel"><div className="panel-head"><div><h3>Registered buses</h3><p>{vehicles.length} buses available in the fleet.</p></div></div>
      <div className="vehicle-grid">{vehicles.map(v=><div className="vehicle-card fleet-card" key={v.id}><div className="fleet-card-top"><span className="bus-badge">BUS {v.busNumber||'—'}</span><span className={v.status==='ACTIVE'?'chip good':'chip'}>{v.status}</span></div><b>{v.registrationNo}</b><span>{v.model} · {v.capacity} seats</span><small>{Number(v.odometerKm||0).toLocaleString('en-IN')} km</small><div className="button-row"><button className="secondary" disabled={busy} onClick={()=>manage(v,v.status==='INACTIVE'?'ACTIVE':'INACTIVE')}>{v.status==='INACTIVE'?'Reactivate':'Deactivate'}</button>{v.status!=='ACTIVE'&&v.status!=='INACTIVE'&&<button className="secondary" disabled={busy} onClick={()=>manage(v,'ACTIVE')}>Reactivate</button>}<button className="secondary" disabled={busy} onClick={()=>manage(v,'DELETE')}>Delete</button></div></div>)}{!vehicles.length&&<div className="empty">No buses added yet.</div>}</div>
    </section>
  </>
}
