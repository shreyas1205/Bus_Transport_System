import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();
router.get('/alerts', auth, allow('ADMIN','FLEET_MANAGER'), async(req,res)=>{
  const vehicles = await prisma.vehicle.findMany({ include:{services:true} });
  const now = Date.now();
  const alerts = vehicles.filter(v => {
    const kmDue = v.odometerKm - v.lastServiceKm >= v.serviceIntervalKm;
    const daysDue = v.lastServiceAt && (now - v.lastServiceAt.getTime()) / 86400000 >= v.serviceIntervalDays;
    return kmDue || daysDue || !v.lastServiceAt;
  }).map(v=>({id:v.id,registrationNo:v.registrationNo,odometerKm:v.odometerKm,lastServiceKm:v.lastServiceKm,lastServiceAt:v.lastServiceAt,reason:'Service interval reached or service history missing'}));
  res.json(alerts);
});
router.post('/:vehicleId/service', auth, allow('ADMIN','FLEET_MANAGER'), async(req,res)=>{
  const v=await prisma.vehicle.findUnique({where:{id:req.params.vehicleId}}); if(!v)return res.status(404).json({message:'Vehicle not found'});
  const [service,vehicle]=await prisma.$transaction([
    prisma.vehicleService.create({data:{vehicleId:v.id,serviceType:req.body.serviceType || 'Preventive Service',serviceKm:v.odometerKm,notes:req.body.notes || null}}),
    prisma.vehicle.update({where:{id:v.id},data:{lastServiceAt:new Date(),lastServiceKm:v.odometerKm}})
  ]); res.json({service,vehicle});
});
router.post('/:vehicleId/odometer', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async(req,res)=>{
  const km=Number(req.body.odometerKm); if(!Number.isFinite(km)||km<0)return res.status(400).json({message:'Invalid odometer'});
  const vehicle=await prisma.vehicle.update({where:{id:req.params.vehicleId},data:{odometerKm:km}}); res.json(vehicle);
});
export default router;
