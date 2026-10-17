import express from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

function finalFeeAmount({ baseAmount = 0, discountAmount = 0, adjustmentAmount = 0 }) {
  return Math.max(0, Number(baseAmount) - Number(discountAmount) + Number(adjustmentAmount));
}

async function ensureBusPass(tx, studentId) {
  const user = await tx.user.findUnique({
    where: { id: studentId },
    select: { id: true, role: true, assignedRouteId: true },
  });
  if (!user || user.role !== 'STUDENT') return null;

  const existing = await tx.busPass.findFirst({
    where: { userId: studentId },
    orderBy: { validUntil: 'desc' },
  });

  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setFullYear(validUntil.getFullYear() + 1);

  if (existing) {
    return tx.busPass.update({
      where: { id: existing.id },
      data: {
        status: 'ACTIVE',
        validFrom: now,
        validUntil,
        routeId: user.assignedRouteId || existing.routeId,
        renewalRequestedAt: null,
      },
    });
  }

  return tx.busPass.create({
    data: {
      userId: studentId,
      routeId: user.assignedRouteId,
      passNumber: `CB-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      validFrom: now,
      validUntil,
      status: 'ACTIVE',
      qrPayload: crypto.randomBytes(24).toString('hex'),
    },
  });
}

async function sendAutomaticFeeReminders() {
  const now = new Date();
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + 5);

  const fees = await prisma.fee.findMany({
    where: {
      status: 'PENDING',
      dueDate: { lte: horizon },
    },
    include: { user: true },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  for (const fee of fees) {
    const days = Math.ceil((new Date(fee.dueDate) - now) / 86400000);
    const title = days < 0 ? 'Transport fee overdue' : days === 0 ? 'Transport fee due today' : `Transport fee due in ${days} day${days === 1 ? '' : 's'}`;
    const parentProfiles = await prisma.parentProfile.findMany({
      where: { studentId: fee.userId },
      select: { userId: true },
    });
    const recipients = [fee.userId, ...parentProfiles.map(p => p.userId)];

    for (const userId of recipients) {
      const duplicate = await prisma.notification.findFirst({
        where: {
          userId,
          title,
          createdAt: { gte: todayStart },
        },
      });
      if (!duplicate) {
        await prisma.notification.create({
          data: {
            userId,
            studentId: fee.userId,
            type: 'GENERAL',
            title,
            message: `₹${Number(fee.amount).toLocaleString('en-IN')} for ${fee.academicYear} is pending. Due ${new Date(fee.dueDate).toLocaleDateString('en-IN')}.`,
          },
        });
      }
    }
  }
}

let reminderTimerStarted = false;
if (!reminderTimerStarted) {
  reminderTimerStarted = true;
  setTimeout(() => sendAutomaticFeeReminders().catch(() => {}), 30000);
  setInterval(() => sendAutomaticFeeReminders().catch(() => {}), 6 * 60 * 60 * 1000);
}


function academicYearFor(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 5 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

async function feeOwnerIdFor(user) {
  if (user.role !== 'PARENT') return user.id;
  const parent = await prisma.parentProfile.findUnique({
    where: { userId: user.id },
    select: { studentId: true },
  });
  return parent?.studentId || null;
}

router.get('/my', auth, allow('STUDENT','STAFF','PARENT'), async (req,res)=> {
  const ownerId = await feeOwnerIdFor(req.user);
  if (!ownerId) return res.status(404).json({ message: 'No student is linked to this parent account.' });

  const [fees, owner] = await Promise.all([
    prisma.fee.findMany({
      where: { userId: ownerId },
      include: {
        payments: { orderBy: { createdAt: 'desc' } },
        pickupStop: { select: { id:true, name:true, locationText:true } },
      },
      orderBy: { dueDate: 'desc' },
    }),
    prisma.user.findUnique({
      where: { id: ownerId },
      select: { id:true, name:true, email:true, institutionId:true },
    }),
  ]);

  res.json({ owner, fees, viewerRole: req.user.role });
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
    googleMapsUrl: stop.googleMapsUrl || null,
    amount: Number(stop.transportFee || 0),
    users: stop._count.pickupUsers,
    routes: stop.routes.map(r => ({ id: r.route.id, code: r.route.code, name: r.route.name })),
  })));
});

router.get('/admin/summary', auth, allow('ADMIN'), async (req,res) => {
  const [total, pending, paid, overdue, collected, outstanding, methods] = await Promise.all([
    prisma.fee.count(),
    prisma.fee.count({ where: { status:'PENDING' } }),
    prisma.fee.count({ where: { status:'PAID' } }),
    prisma.fee.count({ where: { status:'PENDING', dueDate:{ lt:new Date() } } }),
    prisma.payment.aggregate({ where:{ status:'PAID' }, _sum:{ amount:true } }),
    prisma.fee.aggregate({ where:{ status:'PENDING' }, _sum:{ amount:true } }),
    prisma.payment.groupBy({ by:['gateway'], where:{status:'PAID'}, _count:{_all:true}, _sum:{amount:true} }),
  ]);
  res.json({
    total, pending, paid, overdue,
    collected:Number(collected._sum.amount || 0),
    outstanding:Number(outstanding._sum.amount || 0),
    collectionRate: total ? Math.round((paid / total) * 100) : 0,
    methods: methods.map(m=>({gateway:m.gateway,count:m._count._all,amount:Number(m._sum.amount||0)})),
  });
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
        await tx.fee.update({ where: { id: existing.id }, data: { amount, baseAmount: amount, discountAmount: 0, adjustmentAmount: 0, pickupStopId: stop.id } });
      } else {
        await tx.fee.create({ data: { userId: user.id, pickupStopId:stop.id, academicYear, amount, baseAmount:amount, discountAmount:0, adjustmentAmount:0, dueDate } });
      }
    }
  });

  res.json({ message: `Fee updated for ${stop.name}`, amount });
});


router.get('/admin/records', auth, allow('ADMIN'), async (req,res) => {
  const q = String(req.query.q || '').trim();
  const where = q ? {
    OR: [
      { user: { name: { contains: q } } },
      { user: { email: { contains: q } } },
      { user: { institutionId: { contains: q } } },
      { academicYear: { contains: q } },
    ],
  } : {};

  const records = await prisma.fee.findMany({
    where,
    include: {
      user: { select:{id:true,name:true,email:true,institutionId:true,role:true} },
      pickupStop: { select:{id:true,name:true} },
      payments: { orderBy:{createdAt:'desc'} },
    },
    orderBy: { dueDate:'desc' },
    take: 100,
  });
  res.json(records);
});

router.patch('/admin/:feeId/correct', auth, allow('ADMIN'), async (req,res) => {
  const fee = await prisma.fee.findUnique({ where:{id:req.params.feeId} });
  if (!fee || fee.status === 'PAID') return res.status(400).json({message:'Only unpaid fees can be corrected.'});

  const baseAmount = Number(req.body.baseAmount);
  const discountAmount = Number(req.body.discountAmount || 0);
  const adjustmentAmount = Number(req.body.adjustmentAmount || 0);
  if (![baseAmount,discountAmount,adjustmentAmount].every(Number.isFinite) || baseAmount < 0 || discountAmount < 0) {
    return res.status(400).json({message:'Enter valid fee amounts.'});
  }
  const amount = finalFeeAmount({baseAmount,discountAmount,adjustmentAmount});
  const updated = await prisma.fee.update({
    where:{id:fee.id},
    data:{baseAmount,discountAmount,adjustmentAmount,amount},
  });
  res.json({message:'Fee breakdown corrected.',fee:updated});
});

router.post('/admin/:feeId/refund', auth, allow('ADMIN'), async (req,res) => {
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) return res.status(400).json({message:'Refund reason is required.'});

  const fee = await prisma.fee.findUnique({
    where:{id:req.params.feeId},
    include:{payments:{where:{status:'PAID'},orderBy:{paidAt:'desc'}}},
  });
  const payment = fee?.payments?.[0];
  if (!fee || !payment) return res.status(400).json({message:'No paid transaction is available to refund.'});

  await prisma.$transaction(async tx => {
    await tx.payment.update({
      where:{id:payment.id},
      data:{status:'REFUNDED',refundedAt:new Date(),refundReason:reason},
    });
    await tx.fee.update({where:{id:fee.id},data:{status:'PENDING'}});
    const pass = await tx.busPass.findFirst({where:{userId:fee.userId},orderBy:{validUntil:'desc'}});
    if (pass) await tx.busPass.update({where:{id:pass.id},data:{status:'PENDING_RENEWAL'}});
    await tx.notification.create({
      data:{
        userId:fee.userId,
        studentId:fee.userId,
        type:'GENERAL',
        title:'Transport payment refunded',
        message:`A refund of ₹${Number(payment.amount).toLocaleString('en-IN')} was recorded. Reason: ${reason}`,
      },
    });
  });
  res.json({message:'Refund recorded and bus pass moved to renewal pending.'});
});

router.post('/admin/run-reminders', auth, allow('ADMIN'), async (req,res) => {
  await sendAutomaticFeeReminders();
  res.json({message:'Fee reminder check completed.'});
});

router.post('/:feeId/remind', auth, allow('ADMIN'), async (req,res) => {
  const fee = await prisma.fee.findUnique({ where:{ id:req.params.feeId }, include:{ user:true } });
  if (!fee || fee.status === 'PAID') return res.status(400).json({ message:'Pending fee not found.' });

  const parentProfiles = await prisma.parentProfile.findMany({
    where:{ studentId:fee.userId },
    select:{ userId:true },
  });
  const recipients = [fee.userId, ...parentProfiles.map(p=>p.userId)];
  await prisma.notification.createMany({
    data: recipients.map(userId => ({
      userId,
      studentId: fee.userId,
      type:'GENERAL',
      title:'Transport fee reminder',
      message:`₹${Number(fee.amount).toLocaleString('en-IN')} for ${fee.academicYear} is pending. Due ${new Date(fee.dueDate).toLocaleDateString('en-IN')}.`,
    })),
  });
  res.json({ message:`Reminder sent to ${recipients.length} account${recipients.length===1?'':'s'}.` });
});

router.post('/pay-demo', auth, allow('STUDENT','STAFF','PARENT'), async (req,res)=>{
  const ownerId = await feeOwnerIdFor(req.user);
  const fee = await prisma.fee.findUnique({ where: { id: req.body.feeId } });
  if (!fee || fee.userId !== ownerId || fee.status === 'PAID') return res.status(400).json({message:'Invalid or already paid fee'});
  const payment = await prisma.$transaction(async tx => {
    const p = await tx.payment.create({
      data: { userId:req.user.id, feeId:fee.id, amount:fee.amount, gateway:`SANDBOX_${String(req.body.method||'UPI').toUpperCase()}`, status:'PAID', paidAt:new Date(), gatewayPaymentId:`sandbox_${Date.now()}` }
    });
    await tx.fee.update({ where:{ id:fee.id }, data:{ status:'PAID' } });
    await ensureBusPass(tx, fee.userId);
    return p;
  });
  res.json({ message:'Sandbox payment successful', payment });
});

export default router;
