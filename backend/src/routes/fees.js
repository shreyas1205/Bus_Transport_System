import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

function academicYearFor(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 5 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

router.get('/my', auth, async (req,res)=> {
  const fees = await prisma.fee.findMany({ where: { userId: req.user.id }, include: { payments: true }, orderBy: { dueDate: 'desc' } });
  res.json(fees);
});

router.get('/settings', auth, allow('ADMIN'), async (req, res) => {
  const stops = await prisma.stop.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { pickupUsers: true, routes: true } },
      routes: { include: { route: true } },
    },
  });
  res.json(stops.map(stop => ({
    id: stop.id,
    name: stop.name,
    locationText: stop.locationText || stop.name,
    amount: Number(stop.transportFee || 0),
    users: stop._count.pickupUsers,
    routes: stop.routes.map(r => ({ id: r.route.id, code: r.route.code, name: r.route.name })),
  })));
});

router.patch('/settings/:stopId', auth, allow('ADMIN'), async (req, res) => {
  const amount = Number(req.body.amount);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ message: 'Fee must be a non-negative number' });
  const stop = await prisma.stop.findUnique({ where: { id: req.params.stopId } });
  if (!stop) return res.status(404).json({ message: 'Pickup point not found' });

  const academicYear = academicYearFor();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 10);

  await prisma.$transaction(async tx => {
    await tx.stop.update({ where: { id: stop.id }, data: { transportFee: amount } });
    const users = await tx.user.findMany({ where: { pickupStopId: stop.id }, select: { id: true } });
    for (const user of users) {
      const existing = await tx.fee.findFirst({ where: { userId: user.id, academicYear } });
      if (existing && existing.status === 'PAID') continue;
      if (existing) {
        await tx.fee.update({ where: { id: existing.id }, data: { amount } });
      } else {
        await tx.fee.create({ data: { userId: user.id, academicYear, amount, dueDate } });
      }
    }
  });

  res.json({ message: `Fee updated for ${stop.name}`, amount });
});

router.post('/pay-demo', auth, allow('STUDENT','STAFF','PARENT'), async (req,res)=>{
  const fee = await prisma.fee.findUnique({ where: { id: req.body.feeId } });
  if (!fee || fee.userId !== req.user.id) return res.status(404).json({message:'Fee not found'});
  const payment = await prisma.$transaction(async tx => {
    const p = await tx.payment.create({ data: { userId: req.user.id, feeId: fee.id, amount: fee.amount, gateway:'DEMO', status:'PAID', paidAt:new Date() } });
    await tx.fee.update({ where: { id: fee.id }, data: { status:'PAID' } });
    return p;
  });
  res.json({ message:'Demo payment successful', payment });
});
export default router;
