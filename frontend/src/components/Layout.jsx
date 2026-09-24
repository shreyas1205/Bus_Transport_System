import {NavLink,Outlet,useNavigate} from 'react-router-dom';
import {useAuth} from '../auth';
import {useEffect,useState} from 'react';
import {api} from '../api';
import {io} from 'socket.io-client';

const nav=[
  ['/', 'Dashboard', '▦', ['ADMIN','FLEET_MANAGER']],
  ['/routes', 'Routes & ETA', '↝', ['ADMIN','FLEET_MANAGER','DRIVER']],
  ['/live-location', 'Live Bus Location', '📍', ['ADMIN','STUDENT','PARENT']],
  ['/complaints', 'Complaints', '⚠', ['ADMIN','STUDENT']],
  ['/transport-selection', 'My Route', '🚌', ['STUDENT']],
  ['/boarding', 'Boarding', '✓', ['ADMIN','FLEET_MANAGER','DRIVER']],
  ['/boarding-status', 'Boarding Status', '✓', ['STUDENT','PARENT']],
  ['/fees', 'Fees', '₹', ['STUDENT','STAFF','PARENT']],
  ['/passes', 'Bus Pass', '▣', ['STUDENT','STAFF','PARENT']],
  ['/maintenance', 'Maintenance', '⚙', ['ADMIN','FLEET_MANAGER']],
  ['/sos', 'Incidents / SOS', '!', ['ADMIN','FLEET_MANAGER','DRIVER']],
  ['/profile', 'Profile', '◎', ['ADMIN','FLEET_MANAGER','DRIVER','STUDENT','STAFF','PARENT']],
  ['/users', 'Users & Accounts', '◌', ['ADMIN']],
  ['/fleet', 'Buses & Fleet', '🚌', ['ADMIN']],
  ['/fees/settings', 'Fee Settings', '₹', ['ADMIN']],
];

function ArrivalNotificationManager({user}){
  const [notice,setNotice]=useState('');
  useEffect(()=>{
    if(!user || !['STUDENT','STAFF','PARENT'].includes(user.role) || !user.assignedRouteId || !user.pickupStopId) return undefined;
    let cancelled=false;
    const check=async()=>{
      try{
        const response=await api.get('/routes');
        if(cancelled) return;
        const route=response.data.find(r=>r.id===user.assignedRouteId);
        const eta=route?.eta?.find(x=>x.stopId===user.pickupStopId);
        const stop=route?.stops?.find(x=>x.stopId===user.pickupStopId)?.stop;
        const mins=eta?.etaMinutes;
        if(mins==null || mins>10 || mins<1) return;
        const busId=route.assignedBusId || 'unknown-bus';
        const key=`campusbus-arrival:${new Date().toISOString().slice(0,10)}:${busId}:${user.pickupStopId}`;
        if(localStorage.getItem(key)) return;
        const busLabel=route.assignedBus?.busNumber ? `Bus ${route.assignedBus.busNumber}` : (route.assignedBus?.registrationNo || 'Your bus');
        const message=`${busLabel} is expected at ${stop?.name || 'your pickup point'} in about ${mins} minute${mins===1?'':'s'}.`;
        localStorage.setItem(key,'1');
        setNotice(message);
        if('Notification' in window && Notification.permission==='granted') new Notification('🚌 Bus arriving soon',{body:message,tag:key});
        setTimeout(()=>setNotice(''),12000);
      }catch{ /* keep the app usable if the network is temporarily unavailable */ }
    };
    check();
    const interval=setInterval(check,30000);
    const socket=io(import.meta.env.VITE_SOCKET_URL||'http://localhost:4000');
    const onLocation=()=>check();
    socket.on('vehicle:location',onLocation);
    return()=>{cancelled=true;clearInterval(interval);socket.off('vehicle:location',onLocation);socket.disconnect();};
  },[user?.assignedRouteId,user?.pickupStopId,user?.role]);
  return notice ? <div className="alert-banner">🔔 {notice}</div> : null;
}

export default function Layout(){
  const {user,logout}=useAuth(); const navigate=useNavigate();
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">CB</div><div><b>CampusBus</b><span>Ops Console</span></div></div><div className="role-pill">{user?.role?.replace('_',' ')}</div><nav>{nav.filter(n=>n[3].includes(user?.role)).map(n=><NavLink key={n[0]} to={n[0]} end={n[0]==='/'} className={({isActive})=>isActive?'nav-item active':'nav-item'}><span>{n[2]}</span>{n[1]}</NavLink>)}</nav><button className="logout" onClick={()=>{logout();navigate('/login')}}>Sign out</button></aside><main className="main"><header><div><div className="eyebrow">COLLEGE TRANSPORT PLATFORM</div><h1>Good to see you, {user?.name?.split(' ')[0]}</h1></div><div className="header-user"><span className="avatar">{user?.name?.[0]}</span><div><b>{user?.name}</b><small>{user?.institutionId || user?.email}</small></div></div></header><ArrivalNotificationManager user={user}/><Outlet/></main></div>
}
