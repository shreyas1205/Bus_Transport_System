import './FeeSettings.css';
import {useEffect,useMemo,useState} from 'react';
import {useLocation} from 'react-router-dom';
import {api} from '../api';

const money=v=>`₹${Number(v||0).toLocaleString('en-IN')}`;

export default function FeeSettings(){
  const location=useLocation();
  const initialRouteId=new URLSearchParams(location.search).get('route')||'';
  const [routeFilter,setRouteFilter]=useState(initialRouteId);
  const [stops,setStops]=useState([]),[summary,setSummary]=useState(null);
  const [loading,setLoading]=useState(true),[msg,setMsg]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState('');
  const [records,setRecords]=useState([]),[q,setQ]=useState(''),[editing,setEditing]=useState(null);
  async function load(){setLoading(true);setError('');try{const [a,b,c]=await Promise.all([api.get('/fees/settings'),api.get('/fees/admin/summary'),api.get('/fees/admin/records',{params:{q}})]);setStops(a.data.map(s=>({...s,amount:String(s.amount)})));setSummary(b.data);setRecords(c.data)}catch(e){setError(e.response?.data?.message||'Could not load fee settings.')}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  async function save(stop){if(stop.amount.trim()===''||!Number.isFinite(Number(stop.amount))||Number(stop.amount)<0){setError('Enter a valid, non-negative fee.');return;}setSaving(stop.id);setMsg('');setError('');try{const r=await api.patch(`/fees/settings/${stop.id}`,{amount:Number(stop.amount)});setMsg(r.data.message);await load()}catch(e){setError(e.response?.data?.message||'Fee update failed.')}finally{setSaving('')}}

  async function searchRecords(){try{const r=await api.get('/fees/admin/records',{params:{q}});setRecords(r.data)}catch(e){setError(e.response?.data?.message||'Search failed.')}}
  async function runReminders(){try{const r=await api.post('/fees/admin/run-reminders');setMsg(r.data.message)}catch(e){setError(e.response?.data?.message||'Reminder check failed.')}}
  async function saveCorrection(){
    try{
      const r=await api.patch(`/fees/admin/${editing.id}/correct`,{
        baseAmount:Number(editing.baseAmount),discountAmount:Number(editing.discountAmount||0),adjustmentAmount:Number(editing.adjustmentAmount||0)
      });
      setMsg(r.data.message);setEditing(null);await load();
    }catch(e){setError(e.response?.data?.message||'Correction failed.')}
  }
  async function refund(record){
    const reason=window.prompt('Reason for refund/correction:');
    if(!reason)return;
    try{const r=await api.post(`/fees/admin/${record.id}/refund`,{reason});setMsg(r.data.message);await load()}
    catch(e){setError(e.response?.data?.message||'Refund failed.')}
  }



  const routeOptions=useMemo(()=>{const m=new Map();for(const stop of stops){for(const route of stop.routes||[])m.set(route.id,route)}return [...m.values()].sort((a,b)=>String(a.code).localeCompare(String(b.code)));},[stops]);
  const visibleStops=routeFilter?stops.filter(s=>(s.routes||[]).some(r=>r.id===routeFilter)):stops;
  const selectedRoute=routeOptions.find(r=>r.id===routeFilter);
  const configuredStops=visibleStops.filter(s=>Number(s.amount)>0).length;
  const pendingCount=records.filter(r=>r.status!=='PAID').length;

  if(loading)return <div className="loading-card" role="status">Loading pickup-point fees...</div>;

  return <>


  <div className="fs-page">
    <div className="fs-hero">
      <div><span className="eyebrow">ADMIN · BILLING CONTROL</span><h2>Fee settings</h2><p>Configure transport pricing and manage student fee records from one place.</p></div>
      <div className="fs-hero-actions"><select className="fs-route-filter" value={routeFilter} onChange={e=>setRouteFilter(e.target.value)}><option value="">All routes</option>{routeOptions.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select><span className="fs-count">{configuredStops} of {visibleStops.length} stops priced</span></div>
    </div>

    {msg&&<div className="success">{msg}</div>}{error&&<div className="error" role="alert">{error} <button className="secondary" onClick={load}>Retry loading</button></div>}

    {summary&&<div className="fs-summary">
      <div className="fs-stat"><small>FEE RECORDS</small><strong>{summary.total}</strong></div>
      <div className="fs-stat good"><small>PAID</small><strong>{summary.paid}</strong></div>
      <div className="fs-stat warn"><small>OUTSTANDING</small><strong>{money(summary.outstanding)}</strong></div>
      <div className="fs-stat bad"><small>OVERDUE</small><strong>{summary.overdue}</strong></div>
      <div className="fs-stat"><small>COLLECTION RATE</small><strong>{summary.collectionRate}%</strong></div>
    </div>}

    <section className="panel fs-panel">
      <div className="fs-panel-head">
        <div><span className="eyebrow">PICKUP POINT PRICING</span><h3>{selectedRoute?`${selectedRoute.code} pickup-point fees`:'Transport fee by stop'}</h3><p>Map-created pickup points appear here automatically. Set the annual transport charge whenever pricing is finalized.</p></div>
        <button className="secondary" onClick={load}>↻ Refresh</button>
      </div>
      <div className="fs-stop-list">
        <div className="fs-stop-row header"><span>Pickup point</span><span>Location</span><span>Route</span><span>Members</span><span>Annual fee</span><span>Action</span></div>
        {visibleStops.length===0?<div className="fs-empty">No pickup points found for this route.</div>:visibleStops.map(stop=><div className="fs-stop-row" key={stop.id}>
          <div className="fs-stop-name"><b>{stop.name}</b><small>{Number(stop.amount)>0?'Fee configured':'Fee not configured'}</small></div>
          <div>{stop.googleMapsUrl?<a href={stop.googleMapsUrl} target="_blank" rel="noreferrer">View map ↗</a>:<span className="fs-people">{stop.locationText||'—'}</span>}</div>
          <div>{(stop.routes||[]).length?<span className="fs-route-pill">{(stop.routes||[]).map(r=>r.code).join(', ')}</span>:'—'}</div>
          <div className="fs-people"><b>{stop.users}</b> assigned</div>
          <div className="fs-money-input"><span>₹</span><input aria-label={`Annual fee for ${stop.name}`} type="number" min="0" step="100" value={stop.amount} onChange={e=>setStops(items=>items.map(x=>x.id===stop.id?{...x,amount:e.target.value}:x))}/></div>
          <button className="primary small" disabled={saving===stop.id} onClick={()=>save(stop)}>{saving===stop.id?'Saving…':'Save fee'}</button>
        </div>)}
      </div>
    </section>

    <section className="panel fs-panel">
      <div className="fs-panel-head">
        <div><span className="eyebrow">STUDENT FEE MANAGEMENT</span><h3>Student fee records</h3><p>{records.length} records shown · {pendingCount} currently pending</p></div>
        <button className="secondary" onClick={runReminders}>Send due reminders</button>
      </div>
      <div className="fs-searchbar"><input value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>e.key==='Enter'&&searchRecords()} placeholder="Search by student name, email or institution ID…"/><button className="primary" onClick={searchRecords}>Search records</button></div>
      <div className="fs-record-list">
        <div className="fs-record header"><span>Student</span><span>Pickup</span><span>Fee breakdown</span><span>Payable</span><span>Status</span><span>Payment</span><span>Actions</span></div>
        {records.length===0?<div className="fs-empty">No fee records match this search.</div>:records.map(r=>{const p=r.payments?.[0];return <div className="fs-record" key={r.id}>
          <div className="fs-student"><div className="fs-avatar">{(r.user.name||'?').charAt(0).toUpperCase()}</div><div><b>{r.user.name}</b><small>{r.user.institutionId||r.user.email}</small></div></div>
          <div className="fs-people">{r.pickupStop?.name||'Not assigned'}</div>
          <div className="fs-breakdown"><div><span>BASE</span><b>{money(r.baseAmount||r.amount)}</b></div><div><span>DISCOUNT</span><b>-{money(r.discountAmount||0)}</b></div><div><span>ADJUSTMENT</span><b>{money(r.adjustmentAmount||0)}</b></div></div>
          <div className="fs-payable">{money(r.amount)}</div>
          <span className={`fs-status ${r.status==='PAID'?'paid':'pending'}`}>{r.status}</span>
          <div className="fs-people">{p?p.gateway:'—'}</div>
          <div className="fs-actions"><button className="secondary small" disabled={r.status==='PAID'} onClick={()=>setEditing({...r})}>Correct</button><button className="secondary small" disabled={r.status!=='PAID'} onClick={()=>refund(r)}>Refund</button></div>
        </div>})}
      </div>
    </section>
  </div>

  {editing&&<div className="receipt-overlay" onClick={()=>setEditing(null)}><div className="receipt-card" onClick={e=>e.stopPropagation()}><span className="eyebrow">FEE CORRECTION</span><h3>{editing.user?.name}</h3><div className="fee-edit-grid"><label>Base fee<input type="number" value={editing.baseAmount??editing.amount} onChange={e=>setEditing({...editing,baseAmount:e.target.value})}/></label><label>Discount<input type="number" value={editing.discountAmount||0} onChange={e=>setEditing({...editing,discountAmount:e.target.value})}/></label><label>Adjustment<input type="number" value={editing.adjustmentAmount||0} onChange={e=>setEditing({...editing,adjustmentAmount:e.target.value})}/></label></div><button className="primary" onClick={saveCorrection}>Save correction</button><button className="secondary" onClick={()=>setEditing(null)}>Cancel</button></div></div>}
  </>;
}
