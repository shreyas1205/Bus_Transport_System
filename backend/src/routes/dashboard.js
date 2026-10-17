import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router=express.Router();
const dayStart=()=>{const d=new Date();d.setHours(0,0,0,0);return d};
const finalAmount=f=>Math.max(0,Number(f.baseAmount||f.amount||0)-Number(f.discountAmount||0)+Number(f.adjustmentAmount||0));

router.get('/summary',auth,allow('ADMIN','DRIVER','STUDENT','STAFF','PARENT'),async(req,res)=>{
 const [users,vehicles,routes,incidents,pendingFees,todayBoarding]=await Promise.all([
  prisma.user.count(),prisma.vehicle.count({where:{status:'ACTIVE'}}),prisma.route.count({where:{isActive:true}}),
  prisma.incident.count({where:{status:{not:'RESOLVED'}}}),prisma.fee.count({where:{status:'PENDING'}}),
  prisma.boardingEvent.count({where:{scannedAt:{gte:dayStart()},status:'BOARDED'}})
 ]);
 res.json({users,vehicles,routes,incidents,pendingFees,todayBoarding});
});

router.get('/analytics',auth,allow('ADMIN'),async(req,res)=>{
 try{
  const start=dayStart(), seven=new Date(start);seven.setDate(seven.getDate()-6);
  const [vehicles,routes,fees,payments,incidents,complaints,boarding,students,drivers]=await Promise.all([
   prisma.vehicle.findMany({select:{id:true,status:true}}),
   prisma.route.findMany({where:{isActive:true},select:{id:true,assignedBusId:true,assignedDriverId:true,code:true,name:true}}),
   prisma.fee.findMany({select:{id:true,amount:true,baseAmount:true,discountAmount:true,adjustmentAmount:true,status:true}}),
   prisma.payment.findMany({where:{createdAt:{gte:seven}},select:{amount:true,status:true,gateway:true,createdAt:true}}),
   prisma.incident.findMany({where:{createdAt:{gte:seven}},select:{type:true,status:true,createdAt:true}}),
   prisma.complaint.findMany({where:{createdAt:{gte:seven}},select:{status:true,category:true,createdAt:true}}),
   prisma.boardingEvent.findMany({where:{scannedAt:{gte:seven}},select:{status:true,scannedAt:true,userId:true}}),
   prisma.user.count({where:{role:'STUDENT'}}),prisma.user.count({where:{role:'DRIVER'}})
  ]);
  const paidFees=fees.filter(f=>f.status==='PAID'),pending=fees.filter(f=>f.status==='PENDING');
  const collected=paidFees.reduce((s,f)=>s+finalAmount(f),0),outstanding=pending.reduce((s,f)=>s+finalAmount(f),0);
  const days=Array.from({length:7},(_,i)=>{const d=new Date(seven);d.setDate(d.getDate()+i);return {key:d.toISOString().slice(0,10),label:d.toLocaleDateString('en-IN',{weekday:'short'}),boarded:0,dropped:0,payments:0}});
  const byDay=Object.fromEntries(days.map(x=>[x.key,x]));
  boarding.forEach(x=>{const q=byDay[new Date(x.scannedAt).toISOString().slice(0,10)];if(q){if(x.status==='BOARDED')q.boarded++;if(x.status==='DROPPED_OFF')q.dropped++}});
  payments.filter(p=>p.status==='PAID').forEach(p=>{const q=byDay[new Date(p.createdAt).toISOString().slice(0,10)];if(q)q.payments+=Number(p.amount||0)});
  const group=(items,key)=>Object.entries(items.reduce((a,x)=>{const k=x[key]||'UNKNOWN';a[k]=(a[k]||0)+1;return a},{})).map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  const methods=Object.entries(payments.filter(p=>p.status==='PAID').reduce((a,p)=>{const k=(p.gateway||'OTHER').toUpperCase();a[k]=(a[k]||0)+Number(p.amount||0);return a},{})).map(([label,value])=>({label,value}));
  res.json({
   generatedAt:new Date(),
   fleet:{total:vehicles.length,active:vehicles.filter(v=>v.status==='ACTIVE').length,breakdown:vehicles.filter(v=>v.status==='BREAKDOWN').length,other:vehicles.filter(v=>!['ACTIVE','BREAKDOWN'].includes(v.status)).length},
   network:{activeRoutes:routes.length,fullyAssigned:routes.filter(r=>r.assignedBusId&&r.assignedDriverId).length,unassigned:routes.filter(r=>!r.assignedBusId||!r.assignedDriverId).length,students,drivers},
   boarding:{todayBoarded:boarding.filter(x=>x.status==='BOARDED'&&new Date(x.scannedAt)>=start).length,todayDropped:boarding.filter(x=>x.status==='DROPPED_OFF'&&new Date(x.scannedAt)>=start).length,uniqueToday:new Set(boarding.filter(x=>new Date(x.scannedAt)>=start).map(x=>x.userId)).size,daily:days},
   finance:{collected,outstanding,paidCount:paidFees.length,pendingCount:pending.length,collectionRate:collected+outstanding?Math.round(collected/(collected+outstanding)*100):0,methods},
   safety:{open:incidents.filter(i=>i.status!=='RESOLVED').length,resolved:incidents.filter(i=>i.status==='RESOLVED').length,byType:group(incidents,'type')},
   service:{openComplaints:complaints.filter(c=>!['RESOLVED','REJECTED'].includes(c.status)).length,resolvedComplaints:complaints.filter(c=>c.status==='RESOLVED').length,byStatus:group(complaints,'status')}
  });
 }catch(e){console.error('Dashboard analytics error:',e);res.status(500).json({message:'Unable to load transport analytics.'});}
});
export default router;
