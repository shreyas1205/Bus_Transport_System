import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

router.get('/', auth, async(req,res)=>res.json(await prisma.vehicle.findMany({orderBy:{registrationNo:'asc'}})));

router.post('/', auth, allow('ADMIN'), async(req,res)=>{
  const {busNumber, registrationNo, model, capacity, odometerKm=0, status='ACTIVE'} = req.body || {};
  if(!registrationNo?.trim() || !model?.trim() || !capacity) return res.status(400).json({message:'Registration number, model and capacity are required'});
  const normalizedBusNumber = busNumber?.toString().trim() || null;
  if(!normalizedBusNumber) return res.status(400).json({message:'Bus number is required'});
  try {
    const vehicle = await prisma.vehicle.create({
      data:{
        busNumber:normalizedBusNumber,
        registrationNo:registrationNo.trim().toUpperCase(),
        model:model.trim(),
        capacity:Number(capacity),
        odometerKm:Number(odometerKm||0),
        status:String(status||'ACTIVE').toUpperCase()
      }
    });
    res.status(201).json(vehicle);
  } catch(e){
    if(e.code==='P2002') return res.status(409).json({message:'Bus number or registration number already exists'});
    throw e;
  }
});

router.patch('/:id', auth, allow('ADMIN'), async(req,res)=>{
  const data={};
  for(const key of ['busNumber','registrationNo','model','status']) if(req.body?.[key]!==undefined) data[key]=String(req.body[key]).trim();
  if(req.body?.capacity!==undefined) data.capacity=Number(req.body.capacity);
  if(req.body?.odometerKm!==undefined) data.odometerKm=Number(req.body.odometerKm);
  try { res.json(await prisma.vehicle.update({where:{id:req.params.id},data})); }
  catch(e){ if(e.code==='P2002') return res.status(409).json({message:'Bus number or registration number already exists'}); throw e; }
});

router.post('/:id/location', auth, allow('DRIVER','FLEET_MANAGER','ADMIN'), async(req,res)=>{
  const { latitude, longitude, speedKmph=0 }=req.body;
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({message:'Valid latitude and longitude are required'});
  }
  if (req.user.role === 'DRIVER') {
    const assigned = await prisma.route.findFirst({ where: { assignedDriverId: req.user.id, assignedBusId: req.params.id, isActive: true } });
    if (!assigned) return res.status(403).json({message:'This driver is not assigned to this bus'});
  }
  const v=await prisma.vehicle.update({where:{id:req.params.id},data:{latitude:Number(latitude),longitude:Number(longitude),speedKmph:Number(speedKmph)}});
  await prisma.vehicleLocation.create({data:{vehicleId:v.id,latitude:Number(latitude),longitude:Number(longitude),speedKmph:Number(speedKmph)}});
  req.app.get('io')?.emit('vehicle:location', {vehicleId:v.id,latitude:v.latitude,longitude:v.longitude,speedKmph:v.speedKmph});
  res.json(v);
});

export default router;
