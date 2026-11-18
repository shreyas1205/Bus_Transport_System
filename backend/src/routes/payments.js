import { blockDemoAction } from '../demoMode.js';
import express from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { verifiedParentStudent } from '../services/parentTransportAccess.js';

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
  return verifiedParentStudent(user.id);
}

router.post('/create-order', auth, allow('STUDENT','STAFF','PARENT'), blockDemoAction, async (req,res)=>{
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

router.post('/verify', auth, allow('STUDENT','STAFF','PARENT'), blockDemoAction, async(req,res)=>{
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

  // Claim the fee atomically: only the first genuine payment can mark it PAID.
  // A second captured payment for the same fee (e.g. two browser tabs) is kept as a
  // duplicate needing a refund instead of silently recording a double payment.
  let outcome = 'PAID';
  await prisma.$transaction(async tx => {
    const claimedPayment = await tx.payment.updateMany({
      where:{id:payment.id,status:'PENDING'},
      data:{status:'FAILED',gatewayPaymentId:razorpay_payment_id},
    });
    if (!claimedPayment.count) { outcome = 'ALREADY_PROCESSED'; return; }
    const claimedFee = await tx.fee.updateMany({
      where:{id:payment.feeId,status:{not:'PAID'}},
      data:{status:'PAID'},
    });
    if (!claimedFee.count) {
      outcome = 'DUPLICATE';
      await tx.payment.update({
        where:{id:payment.id},
        data:{refundReason:'DUPLICATE PAYMENT: fee was already paid. Refund this payment in the Razorpay dashboard.'},
      });
      return;
    }
    await tx.payment.update({
      where:{id:payment.id},
      data:{status:'PAID',paidAt:new Date()},
    });
    const fee = await tx.fee.findUnique({where:{id:payment.feeId}});
    await ensureBusPass(tx, fee.userId);
  });
  if (outcome === 'ALREADY_PROCESSED') return res.status(400).json({message:'Invalid payment.'});
  if (outcome === 'DUPLICATE') {
    const admins = await prisma.user.findMany({where:{role:'ADMIN'},select:{id:true}});
    if (admins.length) await prisma.notification.createMany({data:admins.map(a=>({
      userId:a.id,type:'GENERAL',title:'Duplicate payment needs refund',
      message:`Payment ${razorpay_payment_id} (₹${Number(payment.amount).toLocaleString('en-IN')}) was made for a fee that was already paid. Refund it in the Razorpay dashboard.`,
    }))});
    return res.status(409).json({duplicate:true,message:'This fee was already paid. Your second payment has been flagged and will be refunded.'});
  }
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
    if (payment.fee.userId !== ownerId) {
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
