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
  async function save(stop){setSaving(stop.id);setMsg('');setError('');try{const r=await api.patch(`/fees/settings/${stop.id}`,{amount:Number(stop.amount)});setMsg(r.data.message);await load()}catch(e){setError(e.response?.data?.message||'Fee update failed.')}finally{setSaving('')}}

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

  if(loading)return <div className="loading-card">Loading pickup-point fees…</div>;

  const routeOptions=useMemo(()=>{const m=new Map();for(const stop of stops){for(const route of stop.routes||[])m.set(route.id,route)}return [...m.values()].sort((a,b)=>String(a.code).localeCompare(String(b.code)));},[stops]);
  const visibleStops=routeFilter?stops.filter(s=>(s.routes||[]).some(r=>r.id===routeFilter)):stops;
  const selectedRoute=routeOptions.find(r=>r.id===routeFilter);
  const configuredStops=visibleStops.filter(s=>Number(s.amount)>0).length;
  const pendingCount=records.filter(r=>r.status!=='PAID').length;

  return <>
  <style>{`
    .fs-page{display:grid;gap:16px}
    .fs-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:20px}
.fs-hero h2{margin:5px 0 4px;font-size:25px;color:#edf7ff}.fs-hero p{margin:0;color:#7f9bb0}
    .fs-hero-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end}.fs-route-filter{min-width:190px;height:38px;padding:0 10px;border:1px solid rgba(91,161,216,.16);border-radius:9px;background:#071a2a;color:#cfe4f2}
    .fs-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}
    .fs-stat{padding:16px 17px;border:1px solid rgba(91,161,216,.12);border-radius:13px;background:linear-gradient(145deg,#0a2134,#071a2a)}
    .fs-stat small{display:block;color:#66869e;font-size:8px;font-weight:900;letter-spacing:.12em}.fs-stat strong{display:block;margin-top:8px;color:#edf7ff;font-size:20px}
    .fs-stat.good strong{color:#52d6a4}.fs-stat.warn strong{color:#ffc15a}.fs-stat.bad strong{color:#ff6f7d}
    .fs-panel{padding:0!important;overflow:hidden}.fs-panel-head{display:flex;justify-content:space-between;align-items:center;gap:15px;padding:18px 20px;border-bottom:1px solid rgba(91,161,216,.09)}
    .fs-panel-head h3{margin:4px 0;color:#eaf5fd;font-size:16px}.fs-panel-head p{margin:4px 0 0;color:#66869e;font-size:9px}
    .fs-count{display:inline-flex;align-items:center;padding:6px 9px;border-radius:999px;background:#09263d;color:#66c3ff;font-size:8px;font-weight:900}
    .fs-stop-list{display:grid;gap:8px;padding:14px}
    .fs-stop-row{display:grid;grid-template-columns:minmax(190px,1.2fr) minmax(120px,.75fr) minmax(110px,.7fr) 90px minmax(150px,.8fr) 105px;align-items:center;gap:12px;padding:12px 14px;border:1px solid rgba(91,161,216,.08);border-radius:11px;background:#071a2a}
    .fs-stop-row.header{padding:2px 14px 7px;border:0;background:transparent;color:#587a94;font-size:7px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
    .fs-stop-name b{display:block;color:#dcecf7;font-size:10px}.fs-stop-name small{display:block;margin-top:3px;color:#587a94;font-size:8px}
    .fs-route-pill{display:inline-flex;padding:5px 8px;border-radius:7px;background:#09263d;color:#8dcaf2;font-size:8px;font-weight:800}
    .fs-people{color:#c4d8e6;font-size:10px}.fs-people b{font-size:13px}
    .fs-money-input{display:flex;align-items:center;height:38px;border:1px solid rgba(91,161,216,.16);border-radius:9px;background:#051725;overflow:hidden}
    .fs-money-input span{padding:0 9px;color:#63baf1;font-weight:900}.fs-money-input input{width:100%!important;height:100%!important;border:0!important;background:transparent!important;padding:0 8px!important}
    .fs-searchbar{display:flex;gap:8px;padding:14px 20px;border-bottom:1px solid rgba(91,161,216,.08)}.fs-searchbar input{flex:1;min-width:0}
    .fs-record-list{display:grid;gap:8px;padding:14px}
    .fs-record{display:grid;grid-template-columns:minmax(180px,1.1fr) minmax(120px,.7fr) minmax(220px,1.25fr) 115px 100px 100px 150px;gap:12px;align-items:center;padding:13px 14px;border:1px solid rgba(91,161,216,.08);border-radius:11px;background:#071a2a}
    .fs-record.header{padding:2px 14px 7px;border:0;background:transparent;color:#587a94;font-size:7px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
    .fs-student{display:flex;align-items:center;gap:10px}.fs-avatar{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:#0b3150;color:#65c1ff;font-weight:950}
    .fs-student b{display:block;color:#dcecf7;font-size:10px}.fs-student small{display:block;margin-top:2px;color:#587a94;font-size:8px}
    .fs-breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.fs-breakdown div{padding:7px;border-radius:8px;background:#051725}.fs-breakdown span{display:block;color:#587a94;font-size:7px}.fs-breakdown b{display:block;margin-top:3px;color:#bcd5e6;font-size:8px}
    .fs-payable{font-size:12px;color:#edf7ff;font-weight:900}.fs-status{display:inline-flex;width:max-content;padding:6px 9px;border-radius:999px;font-size:8px;font-weight:950}.fs-status.paid{background:rgba(44,205,145,.1);color:#59d5a6}.fs-status.pending{background:rgba(255,183,77,.1);color:#ffc266}
    .fs-actions{display:flex;gap:6px}.fs-empty{padding:35px;text-align:center;color:#6b899f}
    @media(max-width:1150px){.fs-summary{grid-template-columns:repeat(3,1fr)}.fs-stop-row,.fs-record{grid-template-columns:1fr 1fr}.fs-stop-row.header,.fs-record.header{display:none}.fs-actions{justify-content:flex-start}}
    @media(max-width:700px){.fs-summary{grid-template-columns:1fr 1fr}.fs-hero,.fs-panel-head{align-items:flex-start;flex-direction:column}.fs-hero-actions{justify-content:flex-start;width:100%}.fs-route-filter{width:100%}.fs-stop-row,.fs-record{grid-template-columns:1fr}.fs-searchbar{flex-direction:column}}
  `}</style>

  <div className="fs-page">
    <div className="fs-hero">
      <div><span className="eyebrow">ADMIN · BILLING CONTROL</span><h2>Fee settings</h2><p>Configure transport pricing and manage student fee records from one place.</p></div>
      <div className="fs-hero-actions"><select className="fs-route-filter" value={routeFilter} onChange={e=>setRouteFilter(e.target.value)}><option value="">All routes</option>{routeOptions.map(r=><option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}</select><span className="fs-count">{configuredStops} of {visibleStops.length} stops priced</span></div>
    </div>

    {msg&&<div className="success">{msg}</div>}{error&&<div className="error">{error}</div>}

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
          <div>{stop.routes.length?<span className="fs-route-pill">{stop.routes.map(r=>r.code).join(', ')}</span>:'—'}</div>
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

  {editing&&<div className="receipt-overlay" onClick={()=>setEditing(null)}><div className="receipt-card" onClick={e=>e.stopPropagation()}><span className="eyebrow">FEE CORRECTION</span><h3>{editing.user?.name}</h3><div className="fee-edit-grid"><label>Base fee<input type="number" value={editing.baseAmount||editing.amount} onChange={e=>setEditing({...editing,baseAmount:e.target.value})}/></label><label>Discount<input type="number" value={editing.discountAmount||0} onChange={e=>setEditing({...editing,discountAmount:e.target.value})}/></label><label>Adjustment<input type="number" value={editing.adjustmentAmount||0} onChange={e=>setEditing({...editing,adjustmentAmount:e.target.value})}/></label></div><button className="primary" onClick={saveCorrection}>Save correction</button><button className="secondary" onClick={()=>setEditing(null)}>Cancel</button></div></div>}
  </>;
}
