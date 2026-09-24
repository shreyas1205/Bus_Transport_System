import {useEffect,useState} from 'react';
import {api} from '../api';
import {useAuth} from '../auth';
import {io} from 'socket.io-client';

export default function BoardingStatus(){
  const {user}=useAuth();
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [notice,setNotice]=useState('');

  const load=async()=>{
    try{const r=await api.get('/boarding/my-status');setData(r.data);}catch(e){setNotice(e.response?.data?.message||'Could not load boarding status.');}finally{setLoading(false);}
  };
  useEffect(()=>{
    load();
    const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');
    const refresh=()=>load();
    socket.on('boarding:update',refresh);
    const interval=setInterval(load,30000);
    return()=>{socket.off('boarding:update',refresh);socket.disconnect();clearInterval(interval);};
  },[user?.id]);

  if(loading)return <div className="loading-card">Loading boarding status…</div>;
  if(notice)return <div className="error">{notice}</div>;
  if(!data?.student)return <div className="panel empty">No student is linked to this account.</div>;

  const title=user?.role==='PARENT' ? "Child's boarding status" : 'My boarding status';
  return <>
    <div className="page-title"><div><span className="eyebrow">TRAVEL SAFETY</span><h2>{title}</h2><p>Boarding status updates automatically when the driver checks the student in.</p></div><div className="button-row"><button className="secondary" onClick={load}>Refresh</button></div></div>
    <section className="panel">
      <div className="panel-head"><div><h3>{data.student.name}</h3><p>{data.student.institutionId||'—'}</p></div><span className={data.boarded?'status':'status muted-status'}>{data.boarded?'BOARDED':'NOT BOARDED YET'}</span></div>
      <div className="stat-grid small-stats">
        <div className="stat-card"><span>🚌</span><small>Bus</small><strong>{data.route?.busNumber ? `Bus ${data.route.busNumber}` : '—'}</strong></div>
        <div className="stat-card"><span>↝</span><small>Route</small><strong>{data.route?.name||'—'}</strong></div>
        <div className="stat-card"><span>📍</span><small>Pickup</small><strong>{data.pickupStop||'—'}</strong></div>
        <div className="stat-card"><span>✓</span><small>Boarded at</small><strong>{data.boardedAt ? new Date(data.boardedAt).toLocaleTimeString() : 'Not yet'}</strong></div>
      </div>
      <div className={data.boarded?'success':'hint'}>{data.boarded ? `✅ ${data.student.name} has boarded the bus${data.boardedAt ? ` at ${new Date(data.boardedAt).toLocaleTimeString()}` : ''}.` : `⏳ ${data.student.name} has not been marked as boarded yet.`}</div>
      {data.route?.driver && <div className="hint">Driver: <b>{data.route.driver.name}</b>{data.route.driver.phone ? ` · ${data.route.driver.phone}` : ''}</div>}
    </section>
  </>;
}
