import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { generateAndSendDailyReport } from '../jobs/dailyReport.js';

const router = express.Router();
router.get('/daily', auth, allow('ADMIN','FLEET_MANAGER'), async(req,res)=>{
  const date=req.query.date ? new Date(req.query.date) : new Date(); date.setHours(0,0,0,0);
  const end=new Date(date); end.setDate(end.getDate()+1);
  const [boarded,rejected]=await Promise.all([
    prisma.boardingEvent.count({where:{scannedAt:{gte:date,lt:end},status:'BOARDED'}}),
    prisma.boardingEvent.count({where:{scannedAt:{gte:date,lt:end},status:'REJECTED'}})
  ]);
  res.json({date:date.toISOString().slice(0,10),boarded,rejected});
});
router.post('/daily/send', auth, allow('ADMIN'), async(req,res)=>res.json(await generateAndSendDailyReport(new Date(req.body.date || Date.now()))));
export default router;
