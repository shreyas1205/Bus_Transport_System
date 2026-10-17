import {useEffect,useMemo,useRef,useState} from 'react';
import {api} from '../api';
import {useAuth} from '../auth';
import {io} from 'socket.io-client';
import {MapContainer,TileLayer,Marker,Popup,Polyline,CircleMarker,useMap} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const busIcon=L.divIcon({className:'bus-marker',html:'🚌',iconSize:[34,34],iconAnchor:[17,17]});
const fmtAge=s=>s==null?'No GPS yet':s<60?`${s}s ago`:`${Math.floor(s/60)}m ago`;
const fmtTime=v=>v?new Date(v).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}):'—';
function Fit({vehicles}){const map=useMap();useEffect(()=>{const resize=()=>map.invalidateSize({pan:false});resize();const timer=setTimeout(resize,180);const p=vehicles.filter(v=>Number.isFinite(v.latitude)&&Number.isFinite(v.longitude)).map(v=>[v.latitude,v.longitude]);if(p.length===1)map.setView(p[0],15);else if(p.length>1)map.fitBounds(p,{padding:[30,30]});return()=>clearTimeout(timer)},[vehicles,map]);return null}

export default function LiveLocation(){
 const {user}=useAuth(),isDriver=user?.role==='DRIVER';
 const [vehicles,setVehicles]=useState([]),[journey,setJourney]=useState(null),[trip,setTrip]=useState({active:false}),[notice,setNotice]=useState(''),[loading,setLoading]=useState(true),[gpsError,setGpsError]=useState('');
 const watchRef=useRef(null);
 async function load(){try{setLoading(true);const r=await api.get('/live-location');setVehicles(r.data.vehicles||[]);setJourney(r.data.journey||null);if(isDriver&&r.data.trip)setTrip(r.data.trip);setNotice(r.data.message||'')}catch(e){setNotice(e.response?.data?.message||'Could not load live tracking.')}finally{setLoading(false)}}
 useEffect(()=>{load();const timer=setInterval(load,30000);const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');socket.on('vehicle:location',u=>setVehicles(cur=>cur.map(v=>v.id===u.vehicleId?{...v,latitude:u.latitude,longitude:u.longitude,speedKmph:u.speedKmph,lastLocationAt:u.recordedAt,tracking:u.tracking||v.tracking}:v)));socket.on('trip:status',load);return()=>{clearInterval(timer);socket.disconnect();if(watchRef.current!=null)navigator.geolocation?.clearWatch(watchRef.current)}},[]);
 useEffect(()=>{if(!isDriver||!trip.active||!navigator.geolocation)return;
   setGpsError('');
   watchRef.current=navigator.geolocation.watchPosition(async p=>{try{await api.post('/live-location/update',{latitude:p.coords.latitude,longitude:p.coords.longitude,speedKmph:p.coords.speed==null?0:Math.max(0,p.coords.speed*3.6)});setGpsError('')}catch(e){setGpsError(e.response?.data?.message||'GPS update failed.')}},e=>setGpsError(e.message),{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
   return()=>{if(watchRef.current!=null){navigator.geolocation.clearWatch(watchRef.current);watchRef.current=null}}
 },[isDriver,trip.active]);
 async function startTrip(){try{const r=await api.post('/live-location/trip/start');setTrip(r.data.trip);setNotice(r.data.message);await load()}catch(e){setNotice(e.response?.data?.message||'Could not start trip.')}}
 async function endTrip(){try{const r=await api.post('/live-location/trip/end');setTrip(r.data.trip);setNotice(r.data.message);await load()}catch(e){setNotice(e.response?.data?.message||'Could not end trip.')}}
 const located=useMemo(()=>vehicles.filter(v=>Number.isFinite(v.latitude)&&Number.isFinite(v.longitude)),[vehicles]);
 const center=located.length?[located[0].latitude,located[0].longitude]:[12.9716,77.5946];
 const title=isDriver?'Driver trip control':user?.role==='ADMIN'?'Live fleet control':user?.role==='PARENT'?"Your child’s bus":'Your bus';
 return <><div className="page-title"><div><span className="eyebrow">LIVE GPS · ETA · TRIP CONTROL</span><h2>{title}</h2><p>Live position, upcoming-stop ETA, journey status and route safety in one view.</p></div><button className="secondary live-refresh-btn" onClick={load} title="Refresh live tracking">
  <span className="live-refresh-icon" aria-hidden="true">↻</span>
  <span>Refresh</span>
</button></div>
 {notice&&<div className="success">{notice}</div>}{gpsError&&<div className="error">{gpsError}</div>}
 {isDriver&&<section className="panel trip-control-card"><div><span className="eyebrow">DRIVER TRIP</span><h3>{trip.active?'Trip in progress':'Ready to start'}</h3><p>{trip.active?`Started ${fmtTime(trip.startedAt)} · GPS sharing active`:'Start the trip to begin secure browser GPS sharing.'}</p></div><div className="trip-actions"><span className={trip.active?'chip good':'chip warn'}>{trip.active?'● LIVE TRIP':'○ NOT STARTED'}</span>{trip.active?<button className="danger-button" onClick={endTrip}>End Trip</button>:<button className="primary" onClick={startTrip}>Start Trip</button>}</div></section>}
 {journey&&<section className="panel passenger-journey-card"><div><span className="eyebrow">{user?.role==='PARENT'?'LINKED STUDENT':'TODAY’S JOURNEY'}</span><h3>{journey.student?.name||'Student'}</h3><p>{journey.student?.institutionId||''} · Pickup: {journey.pickupStop?.name||'Not assigned'}</p></div><div className="journey-status-row"><span className={`journey-state ${journey.status.toLowerCase()}`}>{journey.status.replaceAll('_',' ')}</span><div><small>BOARDED</small><b>{fmtTime(journey.boardedAt)}</b></div><div><small>DROPPED OFF</small><b>{fmtTime(journey.droppedOffAt)}</b></div></div></section>}
 {loading?<div className="loading-card">Loading live tracking…</div>:!vehicles.length?<div className="panel empty">No active bus is assigned.</div>:
 <div className="live-control-layout"><section className="live-fleet-column">{vehicles.map(v=>{const r=v.routes?.[0],t=v.tracking||{};return <article className="panel live-bus-card" key={v.id}>
 <div className="live-bus-head"><div><span className="eyebrow">{r?.code||'NO ROUTE'}</span><h3>Bus {v.busNumber||'—'} <small>{v.registrationNo}</small></h3></div><span className={t.stale?'chip warn':'chip good'}>{t.stale?'GPS STALE':'LIVE'}</span></div>
 <div className="live-metrics"><div><small>SPEED</small><b>{v.speedKmph==null?'—':`${Math.round(v.speedKmph)} km/h`}</b></div><div><small>NEXT STOP</small><b>{t.nextStop?.name||'—'}</b></div><div><small>ETA</small><b>{t.etaMinutes?`${t.etaMinutes} min`:'—'}</b></div><div><small>LAST GPS</small><b>{fmtAge(t.ageSeconds)}</b></div></div>
 <div className={t.offRoute?'route-health danger':'route-health safe'}><b>{t.offRoute?'⚠ Route deviation detected':'✓ On assigned route'}</b><span>{t.distanceFromRouteM!=null?`${t.distanceFromRouteM} m from route`:'Waiting for route/GPS data'}</span></div>
 <div className="live-detail-grid"><div><small>ROUTE</small><b>{r?.name||'Not assigned'}</b></div><div><small>DRIVER</small><b>{r?.assignedDriver?.name||user?.name||'—'}</b><span>{r?.assignedDriver?.phone||''}</span></div><div><small>UPCOMING</small><b>{t.nextStop?.name||'—'}</b><span>{t.nextStop?.distanceM!=null?`${(t.nextStop.distanceM/1000).toFixed(1)} km away`:''}</span></div></div></article>})}</section>
 <section className="map-panel live-map-panel premium-live-map"><MapContainer center={center} zoom={14} scrollWheelZoom><TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"/><Fit vehicles={located}/>{vehicles.map(v=>{const stops=v.routes?.[0]?.stops||[];const line=stops.map(x=>[x.stop.latitude,x.stop.longitude]);return <span key={`route-${v.id}`}>{line.length>1&&<Polyline positions={line}/>} {stops.map(x=><CircleMarker key={x.id} center={[x.stop.latitude,x.stop.longitude]} radius={5}><Popup>{x.sequence}. {x.stop.name}<br/>Planned: {x.plannedEta||'—'}</Popup></CircleMarker>)}</span>})}{located.map(v=><Marker key={v.id} position={[v.latitude,v.longitude]} icon={busIcon}><Popup><b>Bus {v.busNumber||'—'}</b><br/>{v.routes?.[0]?.name||'No route'}<br/>Next: {v.tracking?.nextStop?.name||'—'}<br/>ETA: {v.tracking?.etaMinutes?`${v.tracking.etaMinutes} min`:'—'}<br/>{v.tracking?.offRoute?'⚠ Off route':'✓ On route'}</Popup></Marker>)}</MapContainer></section></div>}
 </>;
}
