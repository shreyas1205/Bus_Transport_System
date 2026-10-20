import MapViewport from '../components/MapViewport';
import Dialog from '../components/Dialog';
import {useEffect,useMemo,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {api} from '../api';
import {useAuth} from '../auth';
import {io} from 'socket.io-client';
import {MapContainer,TileLayer,Marker,Popup,Polyline,useMapEvents} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

const busIcon=L.divIcon({className:'bus-marker',html:'🚌',iconSize:[30,30],iconAnchor:[15,15]});
const emptyForm={code:'',name:'',description:'',assignedBusId:'',assignedDriverId:'',busNumber:'',speedLimitKmph:40,arrivalAlertMinutes:10,stops:[]};
const mapCenter=[12.9716,77.5946];

function localDateTimeValue(date){
  const d=new Date(date);
  const pad=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function makeTempForm(){
  const start=new Date(Date.now()+5*60*1000);
  const end=new Date(start.getTime()+8*60*60*1000);
  return {temporaryDriverId:'',startsAt:localDateTimeValue(start),endsAt:localDateTimeValue(end),reason:'Regular driver unavailable'};
}

function formatWhen(value){
  if(!value)return '—';
  return new Date(value).toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

function routePointIcon(index){
  return L.divIcon({className:'route-builder-marker-wrap',html:`<div class="route-builder-marker">${index+1}</div>`,iconSize:[32,32],iconAnchor:[16,16]});
}

function RouteClickCapture({onAdd}){
  useMapEvents({click(e){onAdd(e.latlng);}});
  return null;
}

export default function Routes(){
 const {user}=useAuth();
 const navigate=useNavigate();
 const isAdmin=user?.role==='ADMIN';
 const ops=isAdmin;
 const [detailsOpen,setDetailsOpen]=useState(false);
 const [routeLoading,setRouteLoading]=useState(true);
 const [routeError,setRouteError]=useState('');
 const [statusBusy,setStatusBusy]=useState(false);
 const [routes,setRoutes]=useState([]);
 const [selected,setSelected]=useState(null);
 const [notice,setNotice]=useState('');
 const [vehicles,setVehicles]=useState([]);
 const [drivers,setDrivers]=useState([]);
 const [showCreate,setShowCreate]=useState(false);
 const [form,setForm]=useState(emptyForm);
 const [assign,setAssign]=useState({busId:'',driverId:'',busNumber:'',reason:'Road closure / operational change'});
 const [safety,setSafety]=useState({speedLimitKmph:40,arrivalAlertMinutes:10});
 const [notificationState,setNotificationState]=useState('');
 const [tempForm,setTempForm]=useState(makeTempForm());
 const [tempHistory,setTempHistory]=useState([]);
 const [tempBusy,setTempBusy]=useState(false);

 const verifiedDrivers=useMemo(()=>drivers.filter(d=>d.driverProfile?.licenseStatus==='VERIFIED'),[drivers]);
 const selectedFormDriver=useMemo(()=>drivers.find(d=>d.id===form.assignedDriverId),[drivers,form.assignedDriverId]);
 const selectedAssignDriver=useMemo(()=>drivers.find(d=>d.id===assign.driverId),[drivers,assign.driverId]);
 const selectedTempDriver=useMemo(()=>drivers.find(d=>d.id===tempForm.temporaryDriverId),[drivers,tempForm.temporaryDriverId]);
 const activeTemp=useMemo(()=>tempHistory.find(x=>x.status==='ACTIVE')||selected?.temporaryDriverAssignments?.find(x=>x.status==='ACTIVE')||null,[tempHistory,selected]);
 const scheduledTemps=useMemo(()=>tempHistory.filter(x=>x.status==='SCHEDULED'),[tempHistory]);
 const builderPositions=useMemo(()=>form.stops.filter(s=>s.latitude!==null&&s.latitude!==''&&s.longitude!==null&&s.longitude!==''&&Number.isFinite(Number(s.latitude))&&Number.isFinite(Number(s.longitude))).map(s=>[Number(s.latitude),Number(s.longitude)]),[form.stops]);

 const load=async()=>{setRouteError('');try{const r=await api.get('/routes');setRoutes(r.data);setSelected(cur=>cur?r.data.find(x=>x.id===cur.id)||r.data[0]:r.data[0]);}catch(e){setRouteError(e.response?.data?.message||'Could not load routes')}finally{setRouteLoading(false)}};
 const loadOps=async()=>{if(!ops)return;try{const [v,d]=await Promise.all([api.get('/vehicles'),api.get('/users?role=DRIVER')]);setVehicles(v.data);setDrivers(d.data)}catch{}};
 const loadTempHistory=async(routeId)=>{if(!ops||!routeId){setTempHistory([]);return;}try{const r=await api.get(`/routes/${routeId}/temporary-drivers`);setTempHistory(r.data.assignments||[]);}catch{setTempHistory([])}};

 useEffect(()=>{load();loadOps()},[user?.role]);
 useEffect(()=>{if(!selected)return;setSafety({speedLimitKmph:Number(selected.speedLimitKmph||40),arrivalAlertMinutes:Number(selected.arrivalAlertMinutes||10)});setAssign({busId:selected.assignedBusId||'',driverId:selected.assignedDriverId||'',busNumber:selected.assignedBus?.busNumber||'',reason:'Road closure / operational change'});},[selected?.id]);
 useEffect(()=>{if(selected?.id)loadTempHistory(selected.id)},[selected?.id]);
 useEffect(()=>{const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');const refresh=()=>{load();if(selected?.id)loadTempHistory(selected.id)};socket.on('vehicle:location',refresh);socket.on('route:temporary-driver',refresh);return()=>{socket.off('vehicle:location',refresh);socket.off('route:temporary-driver',refresh);socket.disconnect()}},[selected?.id]);

 async function enableNotifications(){if(!('Notification' in window)){setNotificationState('Browser notifications are not supported on this device.');return}const p=await Notification.requestPermission();setNotificationState(p==='granted'?'Notifications enabled. You will be alerted before your bus arrives.':`Notification permission: ${p}.`)}
 function setStop(index,key,value){setForm(f=>({...f,stops:f.stops.map((s,i)=>i===index?{...s,[key]:value}:s)}))}
 function addMapStop(latlng){setForm(f=>{const n=f.stops.length+1;return {...f,stops:[...f.stops,{name:`Pickup Point ${n}`,latitude:Number(latlng.lat.toFixed(6)),longitude:Number(latlng.lng.toFixed(6)),googleMapsUrl:`https://www.google.com/maps?q=${Number(latlng.lat.toFixed(6))},${Number(latlng.lng.toFixed(6))}`,plannedEta:'08:00',transportFee:''}]}})}
 function addManualStop(){setForm(f=>({...f,stops:[...f.stops,{name:`Pickup Point ${f.stops.length+1}`,latitude:null,longitude:null,googleMapsUrl:'',plannedEta:'08:00',transportFee:''}]}))}
 function removeStop(index){setForm(f=>({...f,stops:f.stops.filter((_,i)=>i!==index).map((s,i)=>({...s,name:s.name||`Pickup Point ${i+1}`}))}))}
 function clearStops(){setForm(f=>({...f,stops:[]}))}
 function undoStop(){setForm(f=>({...f,stops:f.stops.slice(0,-1)}))}

 async function createRoute(e){
   e.preventDefault();
   if(!form.stops.length){setNotice('Click the map to add at least one pickup point.');return;}
   if(form.stops.some(s=>s.latitude==null||s.longitude==null||s.latitude===''||s.longitude===''||!Number.isFinite(Number(s.latitude))||!Number.isFinite(Number(s.longitude))||Math.abs(Number(s.latitude))>90||Math.abs(Number(s.longitude))>180)){setNotice('Enter valid latitude and longitude for every stop.');return;}
   try{
     await api.post('/routes',{code:form.code,name:form.name,description:form.description,assignedBusId:form.assignedBusId||null,assignedDriverId:form.assignedDriverId||null,busNumber:form.busNumber||null,speedLimitKmph:Number(form.speedLimitKmph||40),arrivalAlertMinutes:Number(form.arrivalAlertMinutes||10),stops:form.stops.map(s=>({...s,geofenceM:150,transportFee:Math.max(0,Number(s.transportFee||0))}))});
     setNotice('Route created successfully with pickup-point fees saved.');setShowCreate(false);setForm(emptyForm);await load();await loadOps();
   }catch(e){setNotice(e.response?.data?.message||'Route creation failed')}
 }
 async function toggleRoute(){
   if(!isAdmin||!selected||statusBusy)return;
   if(!window.confirm((selected.isActive?'Deactivate ':'Activate ')+selected.code+' ? '+selected.name+'? History and assignments will be preserved.'))return;
   setStatusBusy(true);
   try{const {data}=await api.patch('/routes/'+selected.id+'/status',{isActive:!selected.isActive});setRoutes(rows=>rows.map(r=>r.id===data.id?{...r,isActive:data.isActive}:r));setSelected(r=>r?.id===data.id?{...r,isActive:data.isActive}:r);setNotice(data.isActive?'Route activated.':'Route deactivated.');}catch(e){setNotice(e.response?.data?.message||'Could not update route status.')}finally{setStatusBusy(false)}
 }
 async function optimize(){if(!selected)return;try{const r=await api.post('/routes/optimize',{routeId:selected.id});setNotice(r.data.message);load()}catch(e){setNotice(e.response?.data?.message||'Optimization failed')}}
 async function reassign(e){e.preventDefault();if(!selected)return;if(!window.confirm('Save permanent bus and driver assignment for '+selected.code+'? Review both selections before continuing.'))return;try{await api.post(`/routes/${selected.id}/reassign`,assign);setNotice('Route permanently reassigned.');await load();await loadOps()}catch(e){setNotice(e.response?.data?.message||'Reassignment failed')}}
 async function updateSafety(e){e.preventDefault();if(!selected)return;try{const r=await api.patch(`/routes/${selected.id}/safety-settings`,{speedLimitKmph:Number(safety.speedLimitKmph),arrivalAlertMinutes:Number(safety.arrivalAlertMinutes)});setNotice(r.data.message);await load()}catch(e){setNotice(e.response?.data?.message||'Could not update route safety settings')}}
 async function assignTemporaryDriver(e){
   e.preventDefault();if(!selected||tempBusy)return;
   if(!tempForm.temporaryDriverId){setNotice('Select a verified temporary driver.');return;}
   setTempBusy(true);
   try{
     const r=await api.post(`/routes/${selected.id}/temporary-driver`,{temporaryDriverId:tempForm.temporaryDriverId,startsAt:new Date(tempForm.startsAt).toISOString(),endsAt:new Date(tempForm.endsAt).toISOString(),reason:tempForm.reason});
     setNotice(r.data.message);setTempForm(makeTempForm());await load();await loadTempHistory(selected.id);
   }catch(e){setNotice(e.response?.data?.message||'Could not assign temporary driver.')}finally{setTempBusy(false)}
 }
 async function cancelTemporaryDriver(assignment){
   if(!selected||tempBusy)return;
   setTempBusy(true);
   try{const r=await api.post(`/routes/${selected.id}/temporary-driver/${assignment.id}/cancel`);setNotice(r.data.message);await load();await loadTempHistory(selected.id);}catch(e){setNotice(e.response?.data?.message||'Could not end temporary assignment.')}finally{setTempBusy(false)}
 }

 return <>
  <div className="page-title"><div><span className="eyebrow">ROUTE OPERATIONS</span><h2>Routes, stops & ETA</h2><p>{isAdmin?'Build routes visually, set pickup fees, and manage regular or temporary drivers.':'View assigned routes, pickup points and live ETA information.'}</p></div><div className="button-row">{user?.role!=='ADMIN'&&<button className="secondary" onClick={enableNotifications}>🔔 Enable arrival alerts</button>}{isAdmin&&<button className="secondary" onClick={()=>setShowCreate(v=>!v)}>{showCreate?'Close route builder':'＋ Build route on map'}</button>}{isAdmin&&selected&&<button className="secondary" disabled={statusBusy} onClick={toggleRoute}>{selected.isActive?'Deactivate route':'Activate route'}</button>}{selected&&<button className="secondary" onClick={()=>setDetailsOpen(true)}>View details</button>}{ops&&selected&&<button className="secondary" onClick={()=>{document.getElementById("route-settings").scrollIntoView({behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});document.getElementById("route-settings").focus({preventScroll:true});}}>Edit route settings</button>}{ops&&selected&&<button className="secondary" onClick={optimize}>Optimize selected</button>}</div></div>
  {routeError&&<div className="error" role="alert">{routeError} <button className="secondary" onClick={load}>Retry</button></div>}{routeLoading&&<div className="loading-card" role="status">Loading routes...</div>}{!routeLoading&&!routeError&&!routes.length&&<div className="panel empty">No routes are available for your account.</div>}
  {notificationState&&<div className="success">{notificationState}</div>}{notice&&<div className="success">{notice}</div>}

  {showCreate&&isAdmin&&<section className="panel route-builder-panel">
    <div className="route-builder-head"><div><span className="eyebrow">ADMIN · VISUAL ROUTE BUILDER</span><h3>Build the route visually</h3><p>Click the map in travel order, then name each pickup point, set arrival time and annual fee before creating the route.</p><div className="route-builder-steps"><span><b>1</b> Click map</span><span><b>2</b> Name stops</span><span><b>3</b> Set fees</span><span><b>4</b> Create route</span></div></div><div className="route-builder-actions"><span className="route-builder-count">{form.stops.length} point{form.stops.length===1?'':'s'}</span><button type="button" className="secondary small" disabled={!form.stops.length} onClick={undoStop}>↶ Undo</button><button type="button" className="secondary small" disabled={!form.stops.length} onClick={clearStops}>Clear</button></div></div>
    <div className="route-builder-map"><MapContainer center={mapCenter} zoom={13} scrollWheelZoom><MapViewport /><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><RouteClickCapture onAdd={addMapStop}/>{builderPositions.length>1&&<Polyline positions={builderPositions}/>} {form.stops.map((s,i)=>s.latitude!==null&&s.latitude!==''&&s.longitude!==null&&s.longitude!==''&&Number.isFinite(Number(s.latitude))&&Number.isFinite(Number(s.longitude))?<Marker key={`${s.latitude}-${s.longitude}-${i}`} position={[Number(s.latitude),Number(s.longitude)]} icon={routePointIcon(i)}><Popup><b>{i+1}. {s.name}</b><br/>{Number(s.latitude).toFixed(5)}, {Number(s.longitude).toFixed(5)}<br/>Annual fee: {Number(s.transportFee||0)>0?`₹${Number(s.transportFee).toLocaleString('en-IN')}`:'Not set'}</Popup></Marker>:null)}</MapContainer><div className="route-builder-hint">📍 Click anywhere on the map to add the next pickup point</div></div>
    <form className="route-create" onSubmit={createRoute}>
      <label>Route code<input value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="NG-R2" required/></label><label>Route name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="South Campus Loop" required/></label>
      <label>Bus<select value={form.assignedBusId} onChange={e=>{const v=vehicles.find(x=>x.id===e.target.value);setForm({...form,assignedBusId:e.target.value,busNumber:v?.busNumber||''})}}><option value="">Select bus</option>{vehicles.filter(v=>v.status==='ACTIVE').map(v=><option value={v.id} key={v.id}>{v.busNumber?`Bus ${v.busNumber} · `:''}{v.registrationNo}</option>)}</select></label><label>Bus number<input value={form.busNumber} onChange={e=>setForm({...form,busNumber:e.target.value})} placeholder="1" inputMode="numeric"/></label>
      <label>Driver<select value={form.assignedDriverId} onChange={e=>setForm({...form,assignedDriverId:e.target.value})}><option value="">Unassigned</option>{verifiedDrivers.map(d=><option value={d.id} key={d.id}>{d.name} · verified</option>)}</select></label><label>Driver phone<input value={selectedFormDriver?.phone||''} placeholder="Selected driver's phone" readOnly/></label>
      <label>Speed limit (km/h)<input type="number" min="10" max="120" value={form.speedLimitKmph} onChange={e=>setForm({...form,speedLimitKmph:e.target.value})}/></label><label>Parent approach alert (min)<input type="number" min="1" max="30" value={form.arrivalAlertMinutes} onChange={e=>setForm({...form,arrivalAlertMinutes:e.target.value})}/></label><label className="full">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Main Gate → Hostel → College Gate"/></label>
      <div className="full route-builder-stops route-builder-stops-v2"><div className="route-builder-stops-head"><div><span className="eyebrow">PICKUP PLAN</span><h3>Stops, arrival times & fees</h3><p>Everything needed for this route is set here. Fees are saved with each pickup point and can still be edited later.</p></div><div className="route-builder-stops-actions"><span className="route-builder-price-chip">₹ Annual pricing</span><button type="button" className="secondary small" onClick={addManualStop}>＋ Manual stop</button></div></div>
        {form.stops.length===0?<div className="route-builder-empty"><div className="route-builder-empty-icon">⌖</div><strong>No pickup points yet</strong><span>Click the map above to add the first stop.</span></div>:<div className="route-builder-stop-list">{form.stops.map((s,i)=><div className="route-builder-stop-card" key={i}><div className="route-builder-stop-index"><small>STOP</small><strong>{String(i+1).padStart(2,'0')}</strong></div><div className="route-builder-stop-content"><div className="route-builder-stop-fields"><label className="route-stop-name-field"><span>Pickup point</span><input value={s.name} onChange={e=>setStop(i,'name',e.target.value)} placeholder={`Pickup Point ${i+1}`} required/></label><label><span>Arrival time</span><input type="time" value={s.plannedEta} onChange={e=>setStop(i,'plannedEta',e.target.value)} required/></label><label className="route-stop-fee-field"><span>Annual fee</span><div className="route-fee-input"><b>₹</b><input type="number" min="0" step="500" value={s.transportFee??''} onChange={e=>setStop(i,'transportFee',e.target.value)} placeholder="12000"/></div></label></div><div className="route-builder-location-row"><span className="route-builder-location-label">MAP POSITION</span><label><span>Lat</span><input value={s.latitude??''} onChange={e=>setStop(i,'latitude',e.target.value)} placeholder="12.971900" inputMode="decimal" required/></label><label><span>Lng</span><input value={s.longitude??''} onChange={e=>setStop(i,'longitude',e.target.value)} placeholder="77.593700" inputMode="decimal" required/></label>{Number(s.latitude)&&Number(s.longitude)?<a className="route-builder-map-link" href={`https://www.google.com/maps?q=${s.latitude},${s.longitude}`} target="_blank" rel="noreferrer">Open map ↗</a>:null}</div></div><button type="button" className="route-stop-remove" onClick={()=>removeStop(i)} title="Remove stop">×</button></div>)}</div>}
      </div>
      <div className="full route-builder-submit"><div><small>ROUTE SUMMARY</small><strong>{form.stops.length?`${form.stops.length} stops · ${form.stops.map((s,i)=>`${i+1}. ${s.name}`).join(' → ')}`:'Add map points to preview the route order'}</strong><span>{form.stops.length?`Fees: ${form.stops.map(s=>Number(s.transportFee||0)).some(Boolean)?`₹${Math.min(...form.stops.map(s=>Number(s.transportFee||0)).filter(v=>v>0)).toLocaleString('en-IN')} – ₹${Math.max(...form.stops.map(s=>Number(s.transportFee||0))).toLocaleString('en-IN')}`:'not set'}`:''}</span></div><button className="primary route-builder-create-btn" disabled={!form.stops.length}>Create route & save fees →</button></div>
    </form>
  </section>}

  <div className="route-layout"><section className="panel route-list">{routes.map(r=>{const temp=r.temporaryDriverAssignments?.find(x=>x.status==='ACTIVE');return <button className={selected?.id===r.id?'route-card selected':'route-card'} key={r.id} onClick={()=>{setSelected(r);setSafety({speedLimitKmph:Number(r.speedLimitKmph||40),arrivalAlertMinutes:Number(r.arrivalAlertMinutes||10)});setAssign({busId:r.assignedBusId||'',driverId:r.assignedDriverId||'',busNumber:r.assignedBus?.busNumber||'',reason:'Road closure / operational change'})}}><div><b>{r.code}</b><strong>{r.name}</strong><small>{r.assignedBus?.busNumber?`Bus ${r.assignedBus.busNumber} · `:''}{r.assignedBus?.registrationNo||'No bus'} · {r.assignedDriver?.name||'No driver'}{temp?' · TEMPORARY DRIVER':''} · {r.stops.length} pickup points · Limit {Math.round(Number(r.speedLimitKmph||40))} km/h</small></div><span className={temp?'status temp-driver-route-badge':'status'}>{!r.isActive?'INACTIVE':temp?'TEMP':'ACTIVE'}</span></button>})}</section>{selected?<section className="map-panel"><MapContainer center={[selected.stops[0]?.stop.latitude||12.9716,selected.stops[0]?.stop.longitude||77.5946]} zoom={13} scrollWheelZoom><MapViewport viewKey={selected.id} points={selected.stops.map(s=>[s.stop.latitude,s.stop.longitude])}/><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Polyline positions={selected.stops.map(s=>[s.stop.latitude,s.stop.longitude])}/>{selected.stops.map((s,i)=><Marker key={s.id} position={[s.stop.latitude,s.stop.longitude]} icon={busIcon}><Popup><b>{i+1}. {s.stop.name}</b><br/>Scheduled: {s.plannedEta||'—'}<br/>Live ETA: {selected.eta?.find(e=>e.stopId===s.stopId)?.etaMinutes??'—'} min<br/>Fee: {Number(s.stop.transportFee||0)>0?`₹${Number(s.stop.transportFee).toLocaleString('en-IN')}`:'Not configured'}<br/>Driver: {selected.assignedDriver?.name||'—'}{activeTemp?<><br/><b>Temporary coverage active</b></>:null}{selected.assignedDriver?.phone?<><br/>Phone: {selected.assignedDriver.phone}</>:null}<br/>{s.stop.googleMapsUrl&&<a href={s.stop.googleMapsUrl} target="_blank" rel="noreferrer">📍 Open in Google Maps</a>}</Popup></Marker>)}</MapContainer></section>:<div className="empty">Select a route.</div>}</div>

  {ops&&selected&&<section className="panel route-pricing-cta"><div><span className="eyebrow">ROUTE PRICING</span><h3>Review or adjust pickup fees</h3><p>Fees can be set while building a route. Use Fee settings later only when you need to revise pricing for an existing route.</p></div><button className="primary" onClick={()=>navigate(`/fees/settings?route=${encodeURIComponent(selected.id)}`)}>Manage fees for {selected.code} →</button></section>}

  {ops&&selected&&<section className="panel temp-driver-panel">
    <div className="temp-driver-head"><div><span className="eyebrow">DRIVER COVERAGE</span><h3>Temporary replacement driver</h3><p>Schedule a verified replacement without changing the regular route assignment. NaviGuard automatically activates and restores the regular driver.</p></div><span className={activeTemp?'temp-driver-status active':'temp-driver-status'}>{activeTemp?'TEMP DRIVER ACTIVE':'REGULAR COVERAGE'}</span></div>
    <div className="temp-driver-current">
      <div><small>CURRENT OPERATIONAL DRIVER</small><strong>{selected.assignedDriver?.name||'Unassigned'}</strong><span>{selected.assignedDriver?.phone||'No phone number'}</span></div>
      <div><small>REGULAR DRIVER</small><strong>{activeTemp?.originalDriver?.name||selected.assignedDriver?.name||'Unassigned'}</strong><span>{activeTemp?'Automatically restored at end time':'No temporary replacement active'}</span></div>
      <div><small>COVERAGE STATUS</small><strong>{activeTemp?`Until ${formatWhen(activeTemp.endsAt)}`:scheduledTemps.length?`${scheduledTemps.length} scheduled`:'Normal'}</strong><span>{activeTemp?.reason||scheduledTemps[0]?.reason||'—'}</span></div>
      {activeTemp&&<button className="secondary danger-soft" type="button" disabled={tempBusy} onClick={()=>cancelTemporaryDriver(activeTemp)}>End temporary coverage now</button>}
    </div>
    <form className="temp-driver-form" onSubmit={assignTemporaryDriver}>
      <label><span>Verified replacement driver</span><select value={tempForm.temporaryDriverId} onChange={e=>setTempForm({...tempForm,temporaryDriverId:e.target.value})} required><option value="">Select verified driver</option>{verifiedDrivers.filter(d=>d.id!==(activeTemp?.originalDriverId||selected.assignedDriverId)).map(d=><option value={d.id} key={d.id}>{d.name} · {d.driverProfile?.licenseNumber||'verified license'}</option>)}</select></label>
      <label><span>Driver phone</span><input value={selectedTempDriver?.phone||''} placeholder="Auto-filled" readOnly/></label>
      <label><span>Starts</span><input type="datetime-local" value={tempForm.startsAt} onChange={e=>setTempForm({...tempForm,startsAt:e.target.value})} required/></label>
      <label><span>Ends</span><input type="datetime-local" value={tempForm.endsAt} onChange={e=>setTempForm({...tempForm,endsAt:e.target.value})} required/></label>
      <label className="temp-driver-reason"><span>Reason</span><input value={tempForm.reason} onChange={e=>setTempForm({...tempForm,reason:e.target.value})} placeholder="Regular driver on leave" required/></label>
      <button className="primary temp-driver-assign-button" disabled={tempBusy}>{tempBusy?'Saving…':'Assign temporary driver →'}</button>
    </form>
    <div className="temp-driver-history"><div className="temp-driver-history-title"><div><small>ASSIGNMENT HISTORY</small><strong>Recent replacements for {selected.code}</strong></div><span>{tempHistory.length} record{tempHistory.length===1?'':'s'}</span></div>{tempHistory.length===0?<div className="temp-driver-empty">No temporary driver assignments yet.</div>:<div className="temp-driver-table"><div className="temp-driver-row temp-driver-row-head"><span>Driver</span><span>Period</span><span>Reason</span><span>Status</span><span></span></div>{tempHistory.map(item=><div className="temp-driver-row" key={item.id}><span><strong>{item.temporaryDriver?.name||'Driver'}</strong><small>{item.temporaryDriver?.phone||'No phone'}</small></span><span><strong>{formatWhen(item.startsAt)}</strong><small>to {formatWhen(item.endsAt)}</small></span><span>{item.reason}</span><span><b className={`temp-history-status ${item.status.toLowerCase()}`}>{item.status}</b></span><span>{['ACTIVE','SCHEDULED'].includes(item.status)?<button type="button" className="secondary small" disabled={tempBusy} onClick={()=>cancelTemporaryDriver(item)}>{item.status==='ACTIVE'?'End now':'Cancel'}</button>:null}</span></div>)}</div>}</div>
  </section>}

  {ops&&selected&&<section className="panel" id="route-settings" tabIndex={-1}><div className="panel-head"><div><span className="eyebrow">ROUTE SAFETY</span><h3>Speed & parent alert settings</h3><p>Overspeed warnings use the configured route limit. Parent approach alerts use the ETA threshold.</p></div></div><form className="assignment-form" onSubmit={updateSafety}><label className="assignment-field"><span>Speed limit (km/h)</span><input type="number" min="10" max="120" value={safety.speedLimitKmph} onChange={e=>setSafety({...safety,speedLimitKmph:e.target.value})}/></label><label className="assignment-field"><span>Approaching alert (minutes)</span><input type="number" min="1" max="30" value={safety.arrivalAlertMinutes} onChange={e=>setSafety({...safety,arrivalAlertMinutes:e.target.value})}/></label><div className="assignment-action"><button className="primary">Save safety settings</button></div></form></section>}

  {ops&&selected&&<section className="panel assignment-panel"><div className="assignment-head"><div><span className="assignment-kicker">PERMANENT ROUTE CHANGE</span><h3>Bus / regular driver reassignment</h3><p>Use this only for a lasting operational change. For leave or short-term replacement, use Temporary replacement driver above.</p></div><span className="assignment-badge">PERMANENT CHANGE</span></div><form className="assignment-form" onSubmit={reassign}><label className="assignment-field"><span>Replacement bus</span><select value={assign.busId} onChange={e=>{const v=vehicles.find(x=>x.id===e.target.value);setAssign({...assign,busId:e.target.value,busNumber:v?.busNumber||''})}}><option value="">Unassigned</option>{assign.busId&&!vehicles.some(v=>v.id===assign.busId&&v.status==='ACTIVE')&&<option value={assign.busId}>Current bus (unavailable for new assignment)</option>}{vehicles.filter(v=>v.status==='ACTIVE').map(v=><option value={v.id} key={v.id}>{v.busNumber?`Bus ${v.busNumber} · `:''}{v.registrationNo}</option>)}</select></label><label className="assignment-field"><span>Bus number</span><input value={assign.busNumber} placeholder="Auto-filled from selected bus" readOnly/></label><label className="assignment-field"><span>Regular driver</span><select value={assign.driverId} onChange={e=>setAssign({...assign,driverId:e.target.value})}><option value="">Unassigned</option>{assign.driverId&&!verifiedDrivers.some(d=>d.id===assign.driverId)&&<option value={assign.driverId}>Current driver (verification required)</option>}{verifiedDrivers.map(d=><option value={d.id} key={d.id}>{d.name} · verified</option>)}</select></label><label className="assignment-field"><span>Driver phone</span><input value={selectedAssignDriver?.phone||''} placeholder="Auto-filled from selected driver" readOnly/></label><label className="assignment-field assignment-reason"><span>Reason for permanent reassignment</span><input value={assign.reason} onChange={e=>setAssign({...assign,reason:e.target.value})} placeholder="Permanent route staffing change"/></label><div className="assignment-action"><div className="assignment-route"><small>SELECTED ROUTE</small><strong>{selected.code} · {selected.name}</strong></div><button className="primary assignment-button">Save permanent assignment <span>→</span></button></div></form></section>}
 {detailsOpen&&selected&&<Dialog title={`${selected.code} - Route details`} onClose={()=>setDetailsOpen(false)}><p>{selected.name}</p><dl className="fleet-assignments"><dt>Assigned bus</dt><dd>{selected.assignedBus?.registrationNo||'Unassigned'}</dd><dt>Assigned driver</dt><dd>{selected.assignedDriver?.name||'Unassigned'}</dd></dl><h3>Stops in travel order</h3><ol className="route-detail-stops">{[...selected.stops].sort((a,b)=>a.sequence-b.sequence).map(s=><li key={s.id}><strong>{s.stop.name}</strong><span>Scheduled {s.plannedEta||'Not set'} / ETA {selected.eta?.find(e=>e.stopId===s.stopId)?.etaMinutes!=null?`${selected.eta.find(e=>e.stopId===s.stopId).etaMinutes} min`:'Unavailable'}</span></li>)}</ol>{ops&&<p>Use Edit route settings for safety limits, Manage fees for pricing, and the permanent reassignment form for bus or driver changes. Stop and route-name editing is not supported by the current API.</p>}</Dialog>}
 </>;
}
