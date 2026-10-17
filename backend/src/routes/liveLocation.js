import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();
const STALE_SECONDS = 90;
const OFF_ROUTE_METERS = 350;
const tripSessions = new Map();

function tripSnapshot(driverId) {
  const t = tripSessions.get(driverId);
  return t ? {...t, active: true} : {active:false, startedAt:null, endedAt:null};
}

function haversineM(aLat,aLon,bLat,bLon){
  const R=6371000,toRad=v=>v*Math.PI/180;
  const dLat=toRad(bLat-aLat),dLon=toRad(bLon-aLon);
  const x=Math.sin(dLat/2)**2+Math.cos(toRad(aLat))*Math.cos(toRad(bLat))*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(x));
}
function pointSegmentDistanceM(p,a,b){
  const lat0=p.latitude*Math.PI/180;
  const xScale=111320*Math.cos(lat0),yScale=110540;
  const px=p.longitude*xScale,py=p.latitude*yScale;
  const ax=a.longitude*xScale,ay=a.latitude*yScale,bx=b.longitude*xScale,by=b.latitude*yScale;
  const dx=bx-ax,dy=by-ay;
  const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy||1)));
  return Math.hypot(px-(ax+t*dx),py-(ay+t*dy));
}
function routeDistanceM(point,stops){
  if(!stops.length)return null;
  if(stops.length===1)return haversineM(point.latitude,point.longitude,stops[0].latitude,stops[0].longitude);
  return Math.min(...stops.slice(0,-1).map((s,i)=>pointSegmentDistanceM(point,s,stops[i+1])));
}
function tracking(route,vehicle){
  const now=Date.now(), last=vehicle.locations?.[0]?.recordedAt || null;
  const ageSeconds=last?Math.max(0,Math.round((now-new Date(last).getTime())/1000)):null;
  const stale=ageSeconds==null || ageSeconds>STALE_SECONDS;
  const lat=Number(vehicle.latitude),lon=Number(vehicle.longitude);
  const hasGps=Number.isFinite(lat)&&Number.isFinite(lon);
  const stops=(route?.stops||[]).map(x=>x.stop).filter(s=>Number.isFinite(s.latitude)&&Number.isFinite(s.longitude));
  if(!hasGps||!stops.length)return {stale,ageSeconds,offRoute:false,distanceFromRouteM:null,nextStop:null,etaMinutes:null};
  const p={latitude:lat,longitude:lon};
  const ranked=(route.stops||[]).map(rs=>({...rs,distanceM:haversineM(lat,lon,rs.stop.latitude,rs.stop.longitude)}));
  const nearest=ranked.reduce((a,b)=>!a||b.distanceM<a.distanceM?b:a,null);
  let next=nearest;
  if(nearest && nearest.distanceM<Math.max(nearest.stop.geofenceM||150,180)){
    const idx=ranked.findIndex(x=>x.id===nearest.id);
    next=ranked[Math.min(idx+1,ranked.length-1)];
  }
  const speed=Math.max(Number(vehicle.speedKmph||0),18);
  const eta=next?Math.max(1,Math.round((next.distanceM/1000)/speed*60)):null;
  const dist=routeDistanceM(p,stops);
  return {
    stale,ageSeconds,
    offRoute:dist!=null && dist>OFF_ROUTE_METERS,
    distanceFromRouteM:dist==null?null:Math.round(dist),
    nextStop:next?{id:next.stop.id,name:next.stop.name,distanceM:Math.round(next.distanceM),plannedEta:next.plannedEta}:null,
    etaMinutes:eta
  };
}
async function viewerVehicleIds(user){
  if(user.role==='ADMIN') return (await prisma.vehicle.findMany({where:{status:'ACTIVE'},select:{id:true}})).map(v=>v.id);
  if(user.role==='DRIVER'){
    const route=await prisma.route.findFirst({where:{assignedDriverId:user.id,isActive:true},select:{assignedBusId:true}});
    return route?.assignedBusId?[route.assignedBusId]:[];
  }
  let studentId=user.id;
  if(user.role==='PARENT'){
    const p=await prisma.parentProfile.findUnique({where:{userId:user.id},select:{studentId:true}});
    studentId=p?.studentId;
  }
  if(!studentId)return [];
  const student=await prisma.user.findUnique({where:{id:studentId},include:{assignedRoute:{select:{assignedBusId:true}}}});
  return student?.assignedRoute?.assignedBusId?[student.assignedRoute.assignedBusId]:[];
}
async function recipientsForRoute(routeId){
  const students=await prisma.user.findMany({where:{assignedRouteId:routeId,role:'STUDENT'},select:{id:true}});
  const parents=await prisma.parentProfile.findMany({where:{studentId:{in:students.map(s=>s.id)}},select:{userId:true}});
  return [...new Set([...students.map(s=>s.id),...parents.map(p=>p.userId)])];
}
async function deviationAlert(route,vehicle,distanceM){
  const since=new Date(Date.now()-15*60*1000);
  const title=`Route deviation · Bus ${vehicle.busNumber||vehicle.registrationNo}`;
  const existing=await prisma.notification.findFirst({where:{title,createdAt:{gte:since}}});
  if(existing)return;
  const adminIds=(await prisma.user.findMany({where:{role:'ADMIN'},select:{id:true}})).map(x=>x.id);
  const ids=[...new Set([...adminIds,...await recipientsForRoute(route.id)])];
  if(ids.length)await prisma.notification.createMany({data:ids.map(userId=>({userId,type:'GENERAL',title,message:`Bus ${vehicle.busNumber||vehicle.registrationNo} is about ${Math.round(distanceM)} m away from its assigned route ${route.code}.`}))});
}

router.get('/',auth,allow('ADMIN','DRIVER','STUDENT','PARENT'),async(req,res)=>{
  const ids=await viewerVehicleIds(req.user);
  if(!ids.length)return res.json({vehicles:[],message:'No bus is currently assigned to this account.'});
  const vehicles=await prisma.vehicle.findMany({
    where:{id:{in:ids}},
    include:{
      routes:{where:{isActive:true},include:{
        stops:{include:{stop:true},orderBy:{sequence:'asc'}},
        assignedDriver:{select:{id:true,name:true,phone:true,driverProfile:{select:{licenseNumber:true,licenseExpiry:true,licensePhoto:true,licenseStatus:true}}}}
      }},
      locations:{orderBy:{recordedAt:'desc'},take:1}
    },orderBy:{busNumber:'asc'}
  });
  const result=[];
  for(const v of vehicles){
    const route=v.routes?.[0]||null;
    const t=tracking(route,v);
    if(route&&t.offRoute) deviationAlert(route,v,t.distanceFromRouteM).catch(()=>{});
    result.push({
      id:v.id,busNumber:v.busNumber,registrationNo:v.registrationNo,model:v.model,capacity:v.capacity,status:v.status,
      latitude:v.latitude,longitude:v.longitude,speedKmph:v.speedKmph,updatedAt:v.updatedAt,lastLocationAt:v.locations[0]?.recordedAt||null,
      routes:route?[route]:[],tracking:t
    });
  }
  let journey=null;
  if(['STUDENT','PARENT'].includes(req.user.role)){
    let studentId=req.user.id;
    if(req.user.role==='PARENT'){
      const p=await prisma.parentProfile.findUnique({where:{userId:req.user.id},select:{studentId:true}});
      studentId=p?.studentId||'';
    }
    if(studentId){
      const start=new Date(); start.setHours(0,0,0,0);
      const events=await prisma.boardingEvent.findMany({where:{userId:studentId,scannedAt:{gte:start}},orderBy:{scannedAt:'desc'}});
      const boarded=events.find(e=>e.status==='BOARDED');
      const dropped=events.find(e=>e.status==='DROPPED_OFF');
      const student=await prisma.user.findUnique({where:{id:studentId},select:{id:true,name:true,institutionId:true,pickupStop:{select:{id:true,name:true}}}});
      journey={student,pickupStop:student?.pickupStop||null,status:dropped?'DROPPED_OFF':boarded?'BOARDED':'NOT_BOARDED',boardedAt:boarded?.scannedAt||null,droppedOffAt:dropped?.scannedAt||null};
    }
  }
  res.json({vehicles:result,journey,trip:req.user.role==='DRIVER'?tripSnapshot(req.user.id):null});
});

router.get('/trip',auth,allow('DRIVER'),async(req,res)=>{
  const route=await prisma.route.findFirst({where:{assignedDriverId:req.user.id,isActive:true},include:{assignedBus:true,stops:{include:{stop:true},orderBy:{sequence:'asc'}}}});
  res.json({trip:tripSnapshot(req.user.id),route});
});
router.post('/trip/start',auth,allow('DRIVER'),async(req,res)=>{
  const route=await prisma.route.findFirst({where:{assignedDriverId:req.user.id,isActive:true},include:{assignedBus:true}});
  if(!route?.assignedBusId)return res.status(404).json({message:'No active route and bus are assigned to you.'});
  const current=tripSessions.get(req.user.id);
  if(current)return res.json({message:'Trip is already active.',trip:{...current,active:true},route});
  const trip={driverId:req.user.id,routeId:route.id,vehicleId:route.assignedBusId,startedAt:new Date().toISOString()};
  tripSessions.set(req.user.id,trip);
  req.app.get('io')?.emit('trip:status',{...trip,active:true});
  res.json({message:'Trip started. Live GPS sharing is enabled.',trip:{...trip,active:true},route});
});
router.post('/trip/end',auth,allow('DRIVER'),async(req,res)=>{
  const current=tripSessions.get(req.user.id);
  if(!current)return res.json({message:'No active trip.',trip:{active:false}});
  tripSessions.delete(req.user.id);
  const ended={...current,active:false,endedAt:new Date().toISOString()};
  req.app.get('io')?.emit('trip:status',ended);
  res.json({message:'Trip ended. GPS sharing is stopped.',trip:ended});
});

router.post('/update',auth,allow('DRIVER'),async(req,res)=>{
  if(!tripSessions.has(req.user.id))return res.status(409).json({message:'Start the trip before sharing live GPS.'});
  const latitude=Number(req.body.latitude),longitude=Number(req.body.longitude),speedKmph=Math.max(0,Number(req.body.speedKmph||0));
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude))return res.status(400).json({message:'Valid latitude and longitude are required.'});
  const route=await prisma.route.findFirst({where:{assignedDriverId:req.user.id,isActive:true},include:{stops:{include:{stop:true},orderBy:{sequence:'asc'}},assignedBus:true}});
  if(!route?.assignedBusId)return res.status(404).json({message:'No active bus is assigned to this driver.'});
  const [vehicle]=await prisma.$transaction([
    prisma.vehicle.update({where:{id:route.assignedBusId},data:{latitude,longitude,speedKmph}}),
    prisma.vehicleLocation.create({data:{vehicleId:route.assignedBusId,latitude,longitude,speedKmph}})
  ]);
  const t=tracking(route,{...vehicle,locations:[{recordedAt:new Date()}]});
  if(t.offRoute)deviationAlert(route,vehicle,t.distanceFromRouteM).catch(()=>{});
  const payload={vehicleId:vehicle.id,latitude,longitude,speedKmph,recordedAt:new Date().toISOString(),tracking:t};
  const io=req.app.get('io'); if(io)io.emit('vehicle:location',payload);
  res.json({message:'Live location updated.',...payload});
});

export default router;
