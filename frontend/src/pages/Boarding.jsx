import {useEffect,useState} from 'react';
import {api} from '../api';
import {useAuth} from '../auth';
import {io} from 'socket.io-client';

export default function Boarding(){
  const {user}=useAuth();
  const [identifier,setIdentifier]=useState('23CSE001');
  const [status,setStatus]=useState(null);
  const [events,setEvents]=useState([]);
  const [roster,setRoster]=useState(null);
  const [loadingRoster,setLoadingRoster]=useState(false);
  const isDriver=user?.role==='DRIVER';

  const load=()=>api.get('/boarding/today').then(r=>setEvents(r.data));
  const loadRoster=async()=>{
    if(!isDriver)return;
    try{setLoadingRoster(true);const r=await api.get('/boarding/driver-roster');setRoster(r.data);}catch(e){setStatus({ok:false,text:e.response?.data?.message||'Could not load today\'s route roster'});}finally{setLoadingRoster(false);}
  };
  useEffect(()=>{
    load();
    loadRoster();
    const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');
    const refresh=()=>{load();loadRoster();};
    socket.on('boarding:update',refresh);
    return()=>socket.disconnect();
  },[user?.role]);

  async function scan(e){e.preventDefault();try{const r=await api.post('/boarding/scan',{identifier,method:'QR'});setStatus({ok:true,text:`${r.data.user.name} marked boarded.`});load();loadRoster()}catch(err){setStatus({ok:false,text:err.response?.data?.message||'Scan failed'})}}
  async function toggle(studentId, boarded){
    try{const r=await api.post('/boarding/toggle',{studentId,boarded});setStatus({ok:true,text:r.data.message});await loadRoster();await load();}
    catch(err){setStatus({ok:false,text:err.response?.data?.message||'Could not update boarding status'});await loadRoster();}
  }

  return <>
    <div className="page-title"><div><span className="eyebrow">BOARDING CONTROL</span><h2>Digital attendance</h2><p>{isDriver?'Tick students as they enter your bus and parents can see the boarding status in real time.':'Scan student/staff institution ID, email or internal user ID.'}</p></div></div>
    {status&&<div className={status.ok?'success':'error'}>{status.text}</div>}
    <div className="grid-2">
      <section className="panel">
        <h3>Board a passenger</h3>
        <form onSubmit={scan} className="stack"><label>QR / ID<input value={identifier} onChange={e=>setIdentifier(e.target.value)} placeholder="23CSE001"/></label><button className="primary">Verify & board</button></form>
        <div className="hint">Use this for QR/ID scanning. Drivers can also use the route roster beside it to tick students manually.</div>
      </section>
      {isDriver && <section className="panel">
        <div className="panel-head"><div><h3>Today's route roster</h3><p>{roster?.route ? `${roster.route.code} · ${roster.route.name} · Bus ${roster.route.busNumber||'—'}` : 'No active route assigned to you.'}</p></div></div>
        {loadingRoster ? <div className="loading-card">Loading students…</div> : !roster?.route ? <div className="empty">No active route is assigned to this driver.</div> : !roster.students.length ? <div className="empty">No students are assigned to this route yet.</div> : <div className="table-wrap"><table><thead><tr><th>Student</th><th>Pickup point</th><th>Boarded</th></tr></thead><tbody>{roster.students.map(s=><tr key={s.id}><td><b>{s.name}</b><small>{s.institutionId||'—'}</small></td><td>{s.pickupStop}</td><td><label className="board-check"><input type="checkbox" checked={s.boarded} onChange={e=>toggle(s.id,e.target.checked)}/><span>{s.boarded?'Boarded':'Not boarded'}</span></label>{s.boardedAt&&<small>{new Date(s.boardedAt).toLocaleTimeString()}</small>}</td></tr>)}</tbody></table></div>}
      </section>}
      <section className="panel" style={{gridColumn:'1 / -1'}}><div className="panel-head"><div><h3>Today's attendance</h3><p>{events.filter(e=>e.status==='BOARDED').length} successful boardings</p></div></div><div className="table-wrap"><table><thead><tr><th>Time</th><th>Passenger</th><th>ID</th><th>Method</th></tr></thead><tbody>{events.map(e=><tr key={e.id}><td>{new Date(e.scannedAt).toLocaleTimeString()}</td><td>{e.user.name}</td><td>{e.user.institutionId}</td><td>{e.method}</td></tr>)}</tbody></table></div></section>
    </div>
  </>;
}
