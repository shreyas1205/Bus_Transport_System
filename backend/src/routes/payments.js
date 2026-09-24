import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();
router.post('/create-order', auth, allow('STUDENT','STAFF','PARENT'), async (req,res)=>{
  const fee = await prisma.fee.findUnique({ where: { id:req.body.feeId } });
  if (!fee || fee.userId !== req.user.id || fee.status === 'PAID') return res.status(400).json({message:'Invalid or already paid fee'});
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) return res.json({ demo:true, message:'Razorpay credentials are not configured. Use the demo payment button.' });
  const Razorpay = (await import('razorpay')).default;
  const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
  const order = await razorpay.orders.create({ amount: Math.round(fee.amount * 100), currency:'INR', receipt:`fee_${fee.id}` });
  const payment = await prisma.payment.create({ data:{ userId:req.user.id, feeId:fee.id, amount:fee.amount, gateway:'RAZORPAY', gatewayOrderId:order.id } });
  res.json({ demo:false, order, payment, keyId:process.env.RAZORPAY_KEY_ID });
});

router.post('/confirm-demo', auth, allow('STUDENT','STAFF','PARENT'), async(req,res)=>{
  const payment = await prisma.payment.findFirst({ where:{ id:req.body.paymentId, userId:req.user.id } });
  if (!payment) return res.status(404).json({message:'Payment not found'});
  await prisma.$transaction([
    prisma.payment.update({where:{id:payment.id},data:{status:'PAID',paidAt:new Date(),gatewayPaymentId:'demo_payment'}}),
    prisma.fee.update({where:{id:payment.feeId},data:{status:'PAID'}})
  ]);
  res.json({message:'Payment confirmed'});
});
export default router;
