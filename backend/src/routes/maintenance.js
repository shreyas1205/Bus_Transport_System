import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

async function affectedRecipients(routeId){
  const students=await prisma.user.findMany({where:{role:'STUDENT',assignedRouteId:routeId},select:{id:true}});
  const parents=students.length?await prisma.parentProfile.findMany({where:{studentId:{in:students.map(s=>s.id)}},select:{userId:true}}):[];
  return [...new Set([...students.map(s=>s.id),...parents.map(p=>p.userId)])];
}
async function notifyRoute(routeId,title,message){
  const ids=await affectedRecipients(routeId);
  if(ids.length)await prisma.notification.createMany({data:ids.map(userId=>({userId,type:'GENERAL',title,message}))});
}
async function notifyAdmins(title,message){
  const admins=await prisma.user.findMany({where:{role:'ADMIN'},select:{id:true}});
  if(admins.length)await prisma.notification.createMany({data:admins.map(a=>({userId:a.id,type:'GENERAL',title,message}))});
}

router.get('/alerts',auth,allow('ADMIN'),async(req,res)=>{
  const vehicles=await prisma.vehicle.findMany({include:{services:true}});
  const now=Date.now();
  const alerts=vehicles.filter(v=>{
    const kmDue=v.odometerKm-v.lastServiceKm>=v.serviceIntervalKm;
    const daysDue=v.lastServiceAt&&(now-v.lastServiceAt.getTime())/86400000>=v.serviceIntervalDays;
    return kmDue||daysDue||!v.lastServiceAt;
  }).map(v=>({id:v.id,registrationNo:v.registrationNo,busNumber:v.busNumber,odometerKm:v.odometerKm,lastServiceKm:v.lastServiceKm,lastServiceAt:v.lastServiceAt,reason:'Service interval reached or service history missing'}));
  res.json(alerts);
});

router.get('/breakdowns',auth,allow('ADMIN','DRIVER'),async(req,res)=>{
  const where=req.user.role==='DRIVER'?{assignedDriverId:req.user.id,isActive:true}:{isActive:true};
  const routes=await prisma.route.findMany({where,include:{assignedBus:true,assignedDriver:{select:{id:true,name:true,phone:true}}},orderBy:{code:'asc'}});
  const available=req.user.role==='ADMIN'?await prisma.vehicle.findMany({where:{status:'ACTIVE'},orderBy:{busNumber:'asc'}}):[];
  const brokenVehicles=req.user.role==='ADMIN'?await prisma.vehicle.findMany({where:{status:'BREAKDOWN'},orderBy:{busNumber:'asc'}}):[];
  const assignedIds=new Set((await prisma.route.findMany({where:{isActive:true,assignedBusId:{not:null}},select:{assignedBusId:true}})).map(r=>r.assignedBusId));
  res.json({routes,availableVehicles:available.filter(v=>!assignedIds.has(v.id)),breakdowns:routes.filter(r=>r.assignedBus?.status==='BREAKDOWN'),brokenVehicles});
});

router.post('/breakdown/report',auth,allow('DRIVER','ADMIN'),async(req,res)=>{
  const {vehicleId,reason='Vehicle breakdown reported'}=req.body||{};
  if(!vehicleId)return res.status(400).json({message:'Vehicle is required.'});
  const route=await prisma.route.findFirst({where:{assignedBusId:vehicleId,isActive:true}});
  if(!route)return res.status(404).json({message:'No active route is assigned to this bus.'});
  if(req.user.role==='DRIVER'&&route.assignedDriverId!==req.user.id)return res.status(403).json({message:'You can report only your assigned bus.'});
  const vehicle=await prisma.vehicle.update({where:{id:vehicleId},data:{status:'BREAKDOWN'}});
  await notifyAdmins(`Breakdown · Bus ${vehicle.busNumber||vehicle.registrationNo}`,`${reason}. Route ${route.code} requires a replacement bus.`);
  await notifyRoute(route.id,'Bus breakdown reported',`Bus ${vehicle.busNumber||vehicle.registrationNo} on ${route.code} has a breakdown. Transport admin is arranging a replacement.`);
  req.app.get('io')?.emit('fleet:breakdown',{vehicleId,routeId:route.id,status:'BREAKDOWN'});
  res.json({message:'Breakdown reported. Admin and affected passengers were notified.',vehicle,route});
});

router.post('/breakdown/replace',auth,allow('ADMIN'),async(req,res)=>{
  const {routeId,replacementVehicleId,reason='Breakdown replacement'}=req.body||{};
  if(!routeId||!replacementVehicleId)return res.status(400).json({message:'Route and replacement bus are required.'});
  const route=await prisma.route.findUnique({where:{id:routeId},include:{assignedBus:true}});
  const replacement=await prisma.vehicle.findUnique({where:{id:replacementVehicleId}});
  if(!route||!replacement)return res.status(404).json({message:'Route or replacement bus not found.'});
  if(replacement.status!=='ACTIVE')return res.status(409).json({message:'Replacement bus must be ACTIVE.'});
  const used=await prisma.route.findFirst({where:{isActive:true,assignedBusId:replacement.id,id:{not:route.id}}});
  if(used)return res.status(409).json({message:'Replacement bus is already assigned to another active route.'});
  await prisma.$transaction([
    prisma.route.update({where:{id:route.id},data:{assignedBusId:replacement.id}}),
    prisma.routeChange.create({data:{routeId:route.id,reason,fromBusId:route.assignedBusId,toBusId:replacement.id,fromDriverId:route.assignedDriverId,toDriverId:route.assignedDriverId}})
  ]);
  const old=route.assignedBus;
  await notifyRoute(route.id,'Replacement bus assigned',`Replacement bus ${replacement.busNumber||replacement.registrationNo} (${replacement.registrationNo}) is now assigned to route ${route.code}.`);
  await notifyAdmins(`Replacement assigned · ${route.code}`,`${replacement.registrationNo} replaced ${old?.registrationNo||'the unavailable bus'}.`);
  req.app.get('io')?.emit('route:reassigned',{routeId:route.id,fromBusId:route.assignedBusId,toBusId:replacement.id});
  res.json({message:'Replacement bus assigned and affected passengers notified.'});
});

router.post('/breakdown/restore/:vehicleId',auth,allow('ADMIN'),async(req,res)=>{
  const vehicle=await prisma.vehicle.update({where:{id:req.params.vehicleId},data:{status:'ACTIVE'}});
  res.json({message:'Bus returned to ACTIVE service.',vehicle});
});

router.get('/driver-documents',auth,allow('ADMIN'),async(req,res)=>{
  const drivers=await prisma.user.findMany({where:{role:'DRIVER'},select:{id:true,name:true,email:true,phone:true,driverProfile:true},orderBy:{name:'asc'}});
  const now=Date.now();
  res.json(drivers.map(d=>{
    const expiry=d.driverProfile?.licenseExpiry?new Date(d.driverProfile.licenseExpiry):null;
    const daysToExpiry=expiry?Math.ceil((expiry.getTime()-now)/86400000):null;
    return {...d,documentHealth:!d.driverProfile?'MISSING':daysToExpiry!=null&&daysToExpiry<0?'EXPIRED':daysToExpiry!=null&&daysToExpiry<=30?'EXPIRING_SOON':d.driverProfile.licenseStatus==='VERIFIED'?'VALID':'REVIEW_REQUIRED',daysToExpiry};
  }));
});

router.post('/:vehicleId/service',auth,allow('ADMIN'),async(req,res)=>{
  const v=await prisma.vehicle.findUnique({where:{id:req.params.vehicleId}});if(!v)return res.status(404).json({message:'Vehicle not found'});
  const [service,vehicle]=await prisma.$transaction([
    prisma.vehicleService.create({data:{vehicleId:v.id,serviceType:req.body.serviceType||'Preventive Service',serviceKm:v.odometerKm,notes:req.body.notes||null}}),
    prisma.vehicle.update({where:{id:v.id},data:{lastServiceAt:new Date(),lastServiceKm:v.odometerKm}})
  ]);res.json({service,vehicle});
});
router.post('/:vehicleId/odometer',auth,allow('ADMIN','DRIVER'),async(req,res)=>{
  const km=Number(req.body.odometerKm);if(!Number.isFinite(km)||km<0)return res.status(400).json({message:'Invalid odometer'});
  const vehicle=await prisma.vehicle.update({where:{id:req.params.vehicleId},data:{odometerKm:km}});res.json(vehicle);
});
export default router;
