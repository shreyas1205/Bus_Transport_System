import {useEffect,useMemo,useState} from 'react';
import {api} from '../api';
import {useAuth} from '../auth';
import {io} from 'socket.io-client';
import {MapContainer,TileLayer,Marker,Popup,Polyline} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
const icon=L.divIcon({className:'bus-marker',html:'🚌',iconSize:[30,30],iconAnchor:[15,15]});
const defaultStop={name:'Main Gate',googleMapsUrl:'',plannedEta:'08:00',transportFee:0};
const emptyForm={code:'',name:'',description:'',assignedBusId:'',assignedDriverId:'',busNumber:'',stops:[{...defaultStop}]};

export default function Routes(){
 const {user}=useAuth();
const isAdmin=user?.role==='ADMIN';
const ops=user?.role==='ADMIN';
 const [routes,setRoutes]=useState([]); const [selected,setSelected]=useState(null); const [notice,setNotice]=useState(''); const [vehicles,setVehicles]=useState([]); const [drivers,setDrivers]=useState([]); const [showCreate,setShowCreate]=useState(false); const [form,setForm]=useState(emptyForm); const [assign,setAssign]=useState({busId:'',driverId:'',busNumber:'',reason:'Road closure / operational change'}); const [notificationState,setNotificationState]=useState(''); const [lastAlert,setLastAlert]=useState('');
 const load=async()=>{try{const r=await api.get('/routes');setRoutes(r.data);setSelected(cur=>cur?r.data.find(x=>x.id===cur.id)||r.data[0]:r.data[0]);}catch(e){setNotice(e.response?.data?.message||'Could not load routes')}};
 const loadOps=async()=>{if(!ops)return;try{const [v,d]=await Promise.all([api.get('/vehicles'),api.get('/users?role=DRIVER')]);setVehicles(v.data);setDrivers(d.data)}catch{}}
 useEffect(()=>{load();loadOps()},[user?.role]);
 useEffect(()=>{const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');const onLocation=()=>load();socket.on('vehicle:location',onLocation);return()=>{socket.off('vehicle:location',onLocation);socket.disconnect()}},[]);
 const selectedStopData=useMemo(()=>selected?.stops||[],[selected]);
 const selectedFormDriver=useMemo(()=>drivers.find(d=>d.id===form.assignedDriverId),[drivers,form.assignedDriverId]);
 const selectedAssignDriver=useMemo(()=>drivers.find(d=>d.id===assign.driverId),[drivers,assign.driverId]);
 async function enableNotifications(){if(!('Notification' in window)){setNotificationState('Browser notifications are not supported on this device.');return}const p=await Notification.requestPermission();setNotificationState(p==='granted'?'Notifications enabled. You will be alerted about 10 minutes before your bus arrives.':`Notification permission: ${p}.`)}
 function setStop(index,key,value){setForm(f=>({...f,stops:f.stops.map((s,i)=>i===index?{...s,[key]:value}:s)}))}
 function addStop(){setForm(f=>({...f,stops:[...f.stops,{name:`Pickup Point ${f.stops.length+1}`,googleMapsUrl:'',plannedEta:'08:00',transportFee:0}]}))}
 function removeStop(index){setForm(f=>({...f,stops:f.stops.filter((_,i)=>i!==index)}))}
 async function createRoute(e){e.preventDefault();try{await api.post('/routes',{code:form.code,name:form.name,description:form.description,assignedBusId:form.assignedBusId||null,assignedDriverId:form.assignedDriverId||null,busNumber:form.busNumber||null,stops:form.stops.map(s=>({...s,geofenceM:150}))});setNotice('Route created successfully.');setShowCreate(false);setForm(emptyForm);load();loadOps()}catch(e){setNotice(e.response?.data?.message||'Route creation failed')}}
 async function optimize(){if(!selected)return;try{const r=await api.post('/routes/optimize',{routeId:selected.id});setNotice(r.data.message);load()}catch(e){setNotice(e.response?.data?.message||'Optimization failed')}}
 async function reassign(e){e.preventDefault();if(!selected)return;try{await api.post(`/routes/${selected.id}/reassign`,assign);setNotice('Route dynamically reassigned.');load();loadOps()}catch(e){setNotice(e.response?.data?.message||'Reassignment failed')}}
 return <>
  <div className="page-title"><div><span className="eyebrow">ROUTE OPERATIONS</span><h2>Routes, stops & ETA</h2><p>{isAdmin?'Configure routes, buses, drivers, pickup points and scheduled arrival times.':'View assigned routes, pickup points and live ETA information.'}</p></div><div className="button-row">{user?.role!=='ADMIN'&&<button className="secondary" onClick={enableNotifications}>🔔 Enable 10-min alerts</button>}{isAdmin&&<button className="secondary" onClick={()=>setShowCreate(v=>!v)}>{showCreate?'Close':'Create route'}</button>}{ops&&<button className="secondary" onClick={optimize}>Optimize selected</button>}</div></div>
  {notificationState&&<div className="success">{notificationState}</div>}{notice&&<div className="success">{notice}</div>}
  {showCreate&&isAdmin&&<section className="panel"><h3>Create route</h3><form className="route-create" onSubmit={createRoute}><label>Route code<input value={form.code} onChange={e=>setForm({...form,code:e.target.value})} placeholder="CB-R2" required/></label><label>Route name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="South Campus Loop" required/></label><label>Bus<select value={form.assignedBusId} onChange={e=>{const v=vehicles.find(x=>x.id===e.target.value);setForm({...form,assignedBusId:e.target.value,busNumber:v?.busNumber||''})}}><option value="">Select bus</option>{vehicles.map(v=><option value={v.id} key={v.id}>{v.busNumber?`Bus ${v.busNumber} · `:''}{v.registrationNo}</option>)}</select></label><label>Bus number<input value={form.busNumber} onChange={e=>setForm({...form,busNumber:e.target.value})} placeholder="1" inputMode="numeric"/></label><label>Driver<select value={form.assignedDriverId} onChange={e=>setForm({...form,assignedDriverId:e.target.value})}><option value="">Unassigned</option>{drivers.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}</select></label><label>Driver phone<input value={selectedFormDriver?.phone||''} placeholder="Selected driver's phone" readOnly/></label><label className="full">Description<input value={form.description} onChange={e=>setForm({...form,description:e.target.value})} placeholder="Main Gate → Hostel → College Gate"/></label><div className="full"><div className="panel-head"><div><h3>Pickup points</h3><p>Enter the pickup-point name, paste its Google Maps location link, set the arrival time and fee. Coordinates are resolved automatically.</p></div><button type="button" className="secondary small" onClick={addStop}>+ Add pickup point</button></div>{form.stops.map((s,i)=><div className="stop-editor" key={i}><div className="stop-number">{i+1}</div><label>Pickup point<input value={s.name} onChange={e=>setStop(i,'name',e.target.value)} required/></label><label>Google Maps location<input type="url" value={s.googleMapsUrl} onChange={e=>setStop(i,'googleMapsUrl',e.target.value)} placeholder="https://maps.google.com/..." required/><small className="muted">Google Maps → Share → Copy link</small></label><label>Arrival time<input type="time" value={s.plannedEta} onChange={e=>setStop(i,'plannedEta',e.target.value)} required/></label><label>Fee (₹)<input type="number" min="0" step="100" value={s.transportFee} onChange={e=>setStop(i,'transportFee',e.target.value)} placeholder="12000" required/></label>{form.stops.length>1&&<button type="button" className="secondary small remove-stop" onClick={()=>removeStop(i)}>Remove</button>}</div>)}</div><button className="primary">Create route</button></form></section>}
  <div className="route-layout"><section className="panel route-list">{routes.map(r=><button className={selected?.id===r.id?'route-card selected':'route-card'} key={r.id} onClick={()=>{setSelected(r);setAssign({busId:r.assignedBusId||'',driverId:r.assignedDriverId||'',busNumber:r.assignedBus?.busNumber||'',reason:'Road closure / operational change'})}}><div><b>{r.code}</b><strong>{r.name}</strong><small>{r.assignedBus?.busNumber?`Bus ${r.assignedBus.busNumber} · `:''}{r.assignedBus?.registrationNo||'No bus'} · {r.assignedDriver?.name||'No driver'}{r.assignedDriver?.phone?` · ${r.assignedDriver.phone}`:''} · {r.stops.length} pickup points</small></div><span className="status">{r.isActive?'ACTIVE':'OFF'}</span></button>)}</section>{selected?<section className="map-panel"><MapContainer center={[selected.stops[0]?.stop.latitude||12.9716,selected.stops[0]?.stop.longitude||77.5946]} zoom={13} scrollWheelZoom><TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Polyline positions={selected.stops.map(s=>[s.stop.latitude,s.stop.longitude])}/>{selected.stops.map((s,i)=><Marker key={s.id} position={[s.stop.latitude,s.stop.longitude]} icon={icon}><Popup><b>{i+1}. {s.stop.name}</b><br/>Scheduled: {s.plannedEta||'—'}<br/>Live ETA: {selected.eta?.find(e=>e.stopId===s.stopId)?.etaMinutes??'—'} min<br/>Fee: ₹{Number(s.stop.transportFee||0).toLocaleString('en-IN')}<br/>Driver: {selected.assignedDriver?.name||'—'}{selected.assignedDriver?.phone?<><br/>Phone: {selected.assignedDriver.phone}</>:null}<br/>{s.stop.googleMapsUrl&&<a href={s.stop.googleMapsUrl} target="_blank" rel="noreferrer">📍 Open in Google Maps</a>}</Popup></Marker>)}</MapContainer></section>:<div className="empty">Select a route.</div>}</div>
  {ops&&selected&&<section className="panel assignment-panel">
    <div className="assignment-head">
      <div>
        <span className="assignment-kicker">ROUTE RECOVERY</span>
        <h3>Dynamic assignment</h3>
        <p>Move this route to another bus or driver during a breakdown, road closure or operational change.</p>
      </div>
      <span className="assignment-badge">EMERGENCY REASSIGNMENT</span>
    </div>

    <form className="assignment-form" onSubmit={reassign}>
      <label className="assignment-field">
        <span>Replacement bus</span>
        <select value={assign.busId} onChange={e=>{const v=vehicles.find(x=>x.id===e.target.value);setAssign({...assign,busId:e.target.value,busNumber:v?.busNumber||''})}}>
          <option value="">Unassigned</option>
          {vehicles.map(v=><option value={v.id} key={v.id}>{v.busNumber?`Bus ${v.busNumber} · `:''}{v.registrationNo}</option>)}
        </select>
      </label>

      <label className="assignment-field">
        <span>Bus number</span>
        <input value={assign.busNumber} placeholder="Auto-filled from selected bus" readOnly/>
      </label>

      <label className="assignment-field">
        <span>Replacement driver</span>
        <select value={assign.driverId} onChange={e=>setAssign({...assign,driverId:e.target.value})}>
          <option value="">Unassigned</option>
          {drivers.map(d=><option value={d.id} key={d.id}>{d.name}</option>)}
        </select>
      </label>

      <label className="assignment-field">
        <span>Driver phone</span>
        <input value={selectedAssignDriver?.phone||''} placeholder="Auto-filled from selected driver" readOnly/>
      </label>

      <label className="assignment-field assignment-reason">
        <span>Reason for reassignment</span>
        <input value={assign.reason} onChange={e=>setAssign({...assign,reason:e.target.value})} placeholder="Road closure / operational change"/>
      </label>

      <div className="assignment-action">
        <div className="assignment-route">
          <small>SELECTED ROUTE</small>
          <strong>{selected.code} · {selected.name}</strong>
        </div>
        <button className="primary assignment-button">Reassign route <span>→</span></button>
      </div>
    </form>
  </section>}
 </>;
}
