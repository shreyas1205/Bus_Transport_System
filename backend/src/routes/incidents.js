import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();
router.post('/sos', auth, allow('DRIVER'), async(req,res)=>{
  const incident=await prisma.incident.create({data:{driverId:req.user.id,vehicleId:req.body.vehicleId||null,type:req.body.type||'SOS',priority:10,message:req.body.message||'Driver triggered emergency SOS',latitude:req.body.latitude ?? null,longitude:req.body.longitude ?? null}});
  req.app.get('io')?.emit('sos:alert', incident);
  res.status(201).json(incident);
});
router.get('/', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async(req,res)=>{
  res.json(await prisma.incident.findMany({where:{status:{not:'RESOLVED'}},include:{vehicle:true,driver:{select:{name:true}}},orderBy:{createdAt:'desc'}}));
});
router.patch('/:id/status', auth, allow('ADMIN','FLEET_MANAGER'), async(req,res)=>{
  const status=req.body.status;
  const data={status}; if(status==='ACKNOWLEDGED') data.acknowledgedAt=new Date(); if(status==='RESOLVED') data.resolvedAt=new Date();
  const incident=await prisma.incident.update({where:{id:req.params.id},data}); req.app.get('io')?.emit('incident:update',incident); res.json(incident);
});
export default router;
