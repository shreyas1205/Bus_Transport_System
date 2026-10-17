import express from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

async function ensureBusPass(tx, studentId) {
  const user = await tx.user.findUnique({
    where:{id:studentId},
    select:{id:true,role:true,assignedRouteId:true},
  });
  if (!user || user.role !== 'STUDENT') return null;
  const existing = await tx.busPass.findFirst({where:{userId:studentId},orderBy:{validUntil:'desc'}});
  const now = new Date();
  const validUntil = new Date(now);
  validUntil.setFullYear(validUntil.getFullYear()+1);
  if (existing) {
    return tx.busPass.update({
      where:{id:existing.id},
      data:{status:'ACTIVE',validFrom:now,validUntil,routeId:user.assignedRouteId||existing.routeId,renewalRequestedAt:null},
    });
  }
  return tx.busPass.create({
    data:{
      userId:studentId,routeId:user.assignedRouteId,
      passNumber:`CB-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      validFrom:now,validUntil,status:'ACTIVE',qrPayload:crypto.randomBytes(24).toString('hex'),
    },
  });
}


async function feeOwnerIdFor(user) {
  if (user.role !== 'PARENT') return user.id;
  const parent = await prisma.parentProfile.findUnique({
    where:{ userId:user.id },
    select:{ studentId:true },
  });
  return parent?.studentId || null;
}

router.post('/create-order', auth, allow('STUDENT','STAFF','PARENT'), async (req,res)=>{
  const ownerId = await feeOwnerIdFor(req.user);
  const fee = await prisma.fee.findUnique({ where:{ id:req.body.feeId } });
  if (!fee || fee.userId !== ownerId || fee.status === 'PAID') {
    return res.status(400).json({message:'Invalid or already paid fee'});
  }

  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return res.json({
      demo:true,
      message:'Payment gateway is in sandbox mode. Choose a payment method and use Sandbox Pay.',
    });
  }

  const Razorpay = (await import('razorpay')).default;
  const razorpay = new Razorpay({
    key_id:process.env.RAZORPAY_KEY_ID,
    key_secret:process.env.RAZORPAY_KEY_SECRET,
  });
  const order = await razorpay.orders.create({
    amount:Math.round(fee.amount*100),
    currency:'INR',
    receipt:`fee_${fee.id}`.slice(0,40),
  });
  const payment = await prisma.payment.create({
    data:{
      userId:req.user.id,
      feeId:fee.id,
      amount:fee.amount,
      gateway:'RAZORPAY',
      gatewayOrderId:order.id,
    },
  });
  res.json({demo:false,order,payment,keyId:process.env.RAZORPAY_KEY_ID});
});

router.post('/verify', auth, allow('STUDENT','STAFF','PARENT'), async(req,res)=>{
  const { paymentId, razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body || {};
  const payment = await prisma.payment.findFirst({
    where:{ id:paymentId, userId:req.user.id },
  });
  if (!payment || payment.status === 'PAID') return res.status(400).json({message:'Invalid payment.'});
  if (!process.env.RAZORPAY_KEY_SECRET) return res.status(400).json({message:'Gateway verification is not configured.'});
  if (payment.gatewayOrderId !== razorpay_order_id) return res.status(400).json({message:'Order mismatch.'});

  const expected = crypto
    .createHmac('sha256',process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(razorpay_signature || ''));
  if (a.length !== b.length || !crypto.timingSafeEqual(a,b)) {
    await prisma.payment.update({ where:{id:payment.id}, data:{status:'FAILED'} });
    return res.status(400).json({message:'Payment verification failed.'});
  }

  await prisma.$transaction(async tx => {
    await tx.payment.update({
      where:{id:payment.id},
      data:{status:'PAID',paidAt:new Date(),gatewayPaymentId:razorpay_payment_id},
    });
    const fee = await tx.fee.update({where:{id:payment.feeId},data:{status:'PAID'}});
    await ensureBusPass(tx, fee.userId);
  });
  res.json({message:'Payment verified successfully.'});
});

router.get('/:paymentId/receipt', auth, allow('STUDENT','STAFF','PARENT','ADMIN'), async(req,res)=>{
  const payment = await prisma.payment.findUnique({
    where:{id:req.params.paymentId},
    include:{fee:{include:{user:true,pickupStop:true}}},
  });
  if (!payment || payment.status !== 'PAID') return res.status(404).json({message:'Paid receipt not found.'});

  if (req.user.role !== 'ADMIN') {
    const ownerId = await feeOwnerIdFor(req.user);
    if (payment.fee.userId !== ownerId && payment.userId !== req.user.id) {
      return res.status(403).json({message:'Not allowed.'});
    }
  }

  res.json({
    receiptNo:`CB-${payment.id.slice(-8).toUpperCase()}`,
    paymentId:payment.id,
    gatewayPaymentId:payment.gatewayPaymentId,
    paidAt:payment.paidAt,
    amount:payment.amount,
    gateway:payment.gateway,
    academicYear:payment.fee.academicYear,
    student:{name:payment.fee.user.name,email:payment.fee.user.email,institutionId:payment.fee.user.institutionId},
    pickupPoint:payment.fee.pickupStop?.name || null,
  });
});

export default router;
