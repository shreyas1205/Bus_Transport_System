import {useEffect,useMemo,useState} from 'react';
import {api} from '../api';
import {useAuth} from '../auth';
import {io} from 'socket.io-client';
import {Link} from 'react-router-dom';
import './Dashboard.css';

const money=n=>`₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;
function Bars({data,valueKey='boarded',suffix=''}){const max=Math.max(1,...data.map(x=>Number(x[valueKey]||0)));return <div className="analytics-bars">{data.map(x=><div className="analytics-bar-col" key={x.key||x.label}><b>{x[valueKey]}{suffix}</b><div><i style={{height:`${Math.max(5,Number(x[valueKey]||0)/max*100)}%`}}/></div><span>{x.label}</span></div>)}</div>}
function Donut({value,label}){const v=Math.max(0,Math.min(100,Number(value||0)));return <div className="analytics-donut" style={{'--p':`${v*3.6}deg`}}><div><b>{v}%</b><span>{label}</span></div></div>}

// Parent-specific dashboard. Uses the existing Parent-authenticated API endpoint;
// the browser never downloads a list of students or supplies a student ID.
function ParentDashboard({user}) {
 const [snapshot,setSnapshot]=useState(null);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let mounted=true;
  setSnapshot(null);
  setLoading(true);
  setError('');
  const refresh=async()=>{
   try{
    const response=await api.get('/boarding/my-status');
    if(mounted){setSnapshot(response.data);setError('');}
   }catch(e){
    if(mounted){setSnapshot(null);setError(e.response?.data?.message||'Unable to load linked student details.');}
   }finally{if(mounted)setLoading(false);}
  };
  refresh();
  const timer=setInterval(refresh,30000);
  return()=>{mounted=false;clearInterval(timer);};
 },[user?.id,revision]);
 const student=snapshot?.student;
 const route=snapshot?.route;
 const currentStatus=snapshot?.status||'NOT_BOARDED';
 const displayStatus=currentStatus.replaceAll('_',' ');
 const journeyInfo=currentStatus==='DROPPED_OFF'?'Drop-off confirmed':currentStatus==='BOARDED'?'Student is boarded':'Not boarded today';
 const timestamp=currentStatus==='DROPPED_OFF'?snapshot?.droppedOffAt:snapshot?.boardedAt;
 const when=(value)=>{
  if(!value)return 'No event recorded';
  const date=new Date(value);
  return Number.isNaN(date.getTime())?'No event recorded':date.toLocaleString('en-IN',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});
 };
 return <div className="dashboard-page">
  <section className="dashboard-hero">
   <div><span className="eyebrow">FAMILY TRANSPORT</span><h2>Welcome, {user?.name||'Parent'}</h2><p>Your linked student’s campus bus, pickup point and today's journey status.</p></div>
   <div className="hero-status"><span className="status-ring"><i/></span><div><b>Family transport</b><small>Updates every 30 seconds</small></div></div>
  </section>
  {error&&<div className="error" role="alert">{error} <button type="button" onClick={()=>setRevision(v=>v+1)}>Retry</button></div>}
  {loading&&!snapshot?<div className="loading-card"><span className="loading-pulse"/> Loading linked student…</div>:!student?
   <section className="panel" style={{padding:24}}>
    <span className="panel-kicker">ACCOUNT CONNECTION</span>
    <h3>No linked student found</h3>
    <p>No verified student link is available. Contact Admin to verify your guardianship and student link. Phone matching alone does not verify guardianship.</p>
    <p>If the contact details were just updated, refresh this page after the account records are reconciled.</p>
    <button type="button" onClick={()=>setRevision(v=>v+1)}>Refresh student link</button>
   </section>
   :<>
    <section className="panel" style={{padding:24,marginBottom:20}}>
     <div className="panel-head"><div><span className="panel-kicker">MY STUDENT</span><h3>{student.name}</h3><p>College ID: {student.institutionId||'Not provided'}</p></div><span className="health-pill">Linked account</span></div>
     <p style={{marginTop:12}}>Daily transport details are loaded from your Parent account, not from a manually selected Student ID.</p>
    </section>
    <section className="stat-grid">
     <article className="stat-card"><div className="stat-card-top"><span className="stat-icon">✓</span></div><strong>{displayStatus}</strong><small>Today's boarding status</small><p>{journeyInfo}</p></article>
     <article className="stat-card"><div className="stat-card-top"><span className="stat-icon">↝</span></div><strong>{route?.code||'—'}</strong><small>Assigned route</small><p>{route?.name||'No route assigned'}</p></article>
     <article className="stat-card"><div className="stat-card-top"><span className="stat-icon">▤</span></div><strong>{route?.busNumber||route?.registrationNo||'—'}</strong><small>Assigned bus</small><p>{route?.registrationNo||'Bus details not available'}</p></article>
     <article className="stat-card"><div className="stat-card-top"><span className="stat-icon">⌖</span></div><strong>{snapshot?.pickupStop||'—'}</strong><small>Pickup stop</small><p>{snapshot?.pickupStop?'Registered pickup location':'No pickup stop assigned'}</p></article>
    </section>
    <section className="dashboard-grid">
     <article className="panel" style={{padding:24}}><span className="panel-kicker">TODAY’S JOURNEY</span><h3>{journeyInfo}</h3><p>Latest status update: {when(timestamp)}</p><p>Boarded: {snapshot?.boarded?'Yes':'No'} · Dropped off: {snapshot?.droppedOff?'Yes':'No'}</p></article>
     <article className="panel" style={{padding:24}}><span className="panel-kicker">ROUTE CONTACT</span><h3>{route?.name||'Route not yet assigned'}</h3><p>Regular assigned driver: {route?.driver?.name||'Not assigned'}</p><p>Driver phone: {route?.driver?.phone||'Not available'}</p><p style={{fontSize:12,opacity:.75}}>Temporary drivers may differ from the regular assigned driver.</p></article>
    </section>
    <button type="button" onClick={()=>setRevision(v=>v+1)} style={{marginTop:16}}>Refresh journey status</button>
   </>}
  <p style={{fontSize:12,opacity:.7,marginTop:16}}>For a real college deployment, guardian identity and contact ownership must be verified before enabling private student tracking.</p>
 </div>;
}

// Keep route identifiers readable and assignment fields aligned at every width.
export function RouteOverview({route}) {
 const estimates=(route.eta||[]).map(x=>x.etaMinutes).filter(x=>typeof x==='number'&&Number.isFinite(x)&&x>=0);
 const minutes=estimates.length?Math.min(...estimates):null;
 return <article className="overview-route">
  <div className="overview-route-identity"><span className="overview-route-code">{route.code||'Route'}</span><h4>{route.name||'Unnamed route'}</h4></div>
  <dl className="overview-route-assignments">
   <div><dt>Bus</dt><dd className={!route.assignedBus?'is-unassigned':undefined}>{route.assignedBus?.registrationNo||'Unassigned bus'}</dd></div>
   <div><dt>Driver</dt><dd className={!route.assignedDriver?'is-unassigned':undefined}>{route.assignedDriver?.name||'Unassigned driver'}</dd></div>
  </dl>
  <div className={`overview-route-eta ${minutes===null?'is-unavailable':''}`}><span>Nearest ETA</span><strong>{minutes===null?'Unavailable':minutes===0?'Arriving':<>{Math.ceil(minutes)} <small>min</small></>}</strong></div>
 </article>;
}

export default function Dashboard(){
 const {user}=useAuth(),[summary,setSummary]=useState(null),[analytics,setAnalytics]=useState(null),[alerts,setAlerts]=useState([]),[routes,setRoutes]=useState([]),[error,setError]=useState('');
 async function load(){if(user?.role==='PARENT')return;try{setError('');const calls=[api.get('/dashboard/summary'),api.get('/routes')];if(user?.role==='ADMIN')calls.push(api.get('/dashboard/analytics'));const out=await Promise.all(calls);setSummary(out[0].data);setRoutes(out[1].data);if(out[2])setAnalytics(out[2].data);if(['ADMIN','DRIVER'].includes(user?.role)){const r=await api.get('/incidents');setAlerts(r.data)}}catch(e){setError(e.response?.data?.message||'Unable to load command center.')}}
 useEffect(()=>{if(user?.role==='PARENT')return;load();const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');['sos:alert','accident:possible','accident:confirmed','fleet:breakdown','complaint:new'].forEach(ev=>socket.on(ev,load));const timer=setInterval(load,60000);return()=>{socket.disconnect();clearInterval(timer)}},[user?.role]);
 const stats=useMemo(()=>analytics?[
  ['Active fleet',`${analytics.fleet.active}/${analytics.fleet.total}`,'▤',`${analytics.fleet.breakdown} breakdown`],
  ['Active routes',analytics.network.activeRoutes,'↝',`${analytics.network.fullyAssigned} fully assigned`],
  ['Boarded today',analytics.boarding.todayBoarded,'✓',`${analytics.boarding.todayDropped} dropped off`],
  ['Collected',money(analytics.finance.collected),'₹',`${analytics.finance.collectionRate}% collection rate`],
  ['Open incidents',analytics.safety.open,'!','Last 7 days']
 ]:summary?[['Active buses',summary.vehicles,'▤','Fleet currently active'],['Active routes',summary.routes,'↝','Transport network'],['Boarded today',summary.todayBoarding,'✓','Verified boarding'],['Pending fees',summary.pendingFees,'₹','Payments requiring action'],['Open incidents',summary.incidents,'!','Safety cases']]:[],[summary,analytics]);
 if(user?.role==='PARENT')return <ParentDashboard user={user}/>;
 if(!summary)return <div className="loading-card" role={error?'alert':'status'}>{error?<>{error} <button type="button" onClick={load}>Retry</button></>:<><span className="loading-pulse"/> Loading command center…</>}</div>;
 return <div className="dashboard-page operations-dashboard">
  {error&&<div className="error">{error}</div>}
  <section className="dashboard-hero"><div><span className="eyebrow">TODAY'S OPERATIONS</span><h2>Transport command center</h2><p>{user?.role==='ADMIN'?'Live operational analytics across fleet, passengers, finance and safety.':'Monitor your transport operations from one live workspace.'}</p></div><div className="hero-status"><span className="status-ring"><i/></span><div><b>System operational</b><small>Live services connected</small></div></div></section>
  <section className="stat-grid">{stats.map(([l,v,i,n])=><article className="stat-card" key={l}><div className="stat-card-top"><span className="stat-icon">{i}</span><span className="stat-trend">LIVE</span></div><strong>{v??0}</strong><small>{l}</small><p>{n}</p></article>)}</section>
  <section className="dashboard-grid"><article className="panel routes-panel"><div className="panel-head"><div><span className="panel-kicker">NETWORK</span><h3>Routes at a glance</h3><p>Bus assignments, drivers and nearest stop estimates.</p></div><span className="panel-count">{routes.length} routes</span></div><div className="route-list">{routes.slice(0,5).map(route=><RouteOverview key={route.id} route={route}/>)}{!routes.length&&<div className="empty">No routes available. Assigned routes will appear here.</div>}</div><div className="routes-footer"><span>Showing {Math.min(routes.length,5)} of {routes.length} routes</span><Link to="/routes">View all routes <span aria-hidden="true">&rarr;</span></Link></div></article>
  <article className="panel safety-panel"><div className="panel-head"><div><span className="panel-kicker danger">SAFETY</span><h3>Incident feed</h3><p>Priority events requiring attention.</p></div><span className={`health-pill ${alerts.length?'attention':''}`}>{alerts.length?`${alerts.length} open`:'All clear'}</span></div><div className="incident-list">{alerts.length?alerts.slice(0,5).map(x=><div className="incident-row" key={x.id}><span className="danger-dot">!</span><div><b>{x.type}</b><p>{x.message}</p><small>{x.vehicle?.registrationNo||'No bus'} <i>•</i> {new Date(x.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</small></div></div>):<div className="safety-clear"><span>✓</span><b>No open incidents</b><p>Your active safety feed is clear.</p></div>}</div></article></section>
  {user?.role==='ADMIN'&&analytics&&<><section className="analytics-grid">
   <article className="panel analytics-chart-card"><div className="panel-head"><div><span className="panel-kicker">PASSENGER FLOW · 7 DAYS</span><h3>Daily boarding</h3><p>Verified QR boarding events.</p></div><b className="analytics-big">{analytics.boarding.uniqueToday}<small> unique today</small></b></div><Bars data={analytics.boarding.daily}/></article>
   <article className="panel finance-health"><div className="panel-head"><div><span className="panel-kicker">FINANCE</span><h3>Collection health</h3><p>Paid versus outstanding transport fees.</p></div></div><div className="finance-health-body"><Donut value={analytics.finance.collectionRate} label="collected"/><div className="finance-totals"><div><small>COLLECTED</small><b>{money(analytics.finance.collected)}</b></div><div><small>OUTSTANDING</small><b>{money(analytics.finance.outstanding)}</b></div><div><small>PAID / PENDING</small><b>{analytics.finance.paidCount} / {analytics.finance.pendingCount}</b></div></div></div></article>
  </section>
  <section className="analytics-mini-grid">
   <article className="panel mini-ops-card"><span className="panel-kicker">FLEET HEALTH</span><h3>{analytics.fleet.active} active buses</h3><div className="ops-meter"><i style={{width:`${analytics.fleet.total?analytics.fleet.active/analytics.fleet.total*100:0}%`}}/></div><p>{analytics.fleet.breakdown} breakdown · {analytics.fleet.other} other status</p></article>
   <article className="panel mini-ops-card"><span className="panel-kicker">ROUTE READINESS</span><h3>{analytics.network.fullyAssigned}/{analytics.network.activeRoutes} assigned</h3><div className="ops-meter"><i style={{width:`${analytics.network.activeRoutes?analytics.network.fullyAssigned/analytics.network.activeRoutes*100:0}%`}}/></div><p>{analytics.network.unassigned} route(s) need bus or driver</p></article>
   <article className="panel mini-ops-card"><span className="panel-kicker danger">SAFETY · 7 DAYS</span><h3>{analytics.safety.open} open incidents</h3><div className="analytics-tags">{analytics.safety.byType.slice(0,3).map(x=><span key={x.label}>{x.label} <b>{x.value}</b></span>)}</div><p>{analytics.safety.resolved} resolved in period</p></article>
   <article className="panel mini-ops-card"><span className="panel-kicker">SERVICE</span><h3>{analytics.service.openComplaints} open complaints</h3><div className="analytics-tags">{analytics.service.byStatus.slice(0,3).map(x=><span key={x.label}>{x.label.replaceAll('_',' ')} <b>{x.value}</b></span>)}</div><p>{analytics.service.resolvedComplaints} resolved in period</p></article>
  </section></>}

 </div>
}
