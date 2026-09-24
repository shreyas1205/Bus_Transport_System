import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth } from '../middleware.js';

const router = express.Router();
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.passwordHash !== hash(password || '')) return res.status(401).json({ message: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id, role: user.role, name: user.name }, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, institutionId: user.institutionId } });
});

router.get('/me', auth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { assignedRoute: true, pickupStop: true } });
  res.json(user);
});

router.patch('/profile', auth, async (req,res) => {
  const allowed={name:req.body.name,phone:req.body.phone,pickupStopId:req.body.pickupStopId,assignedRouteId:req.body.assignedRouteId};
  const data=Object.fromEntries(Object.entries(allowed).filter(([,v])=>v!==undefined));
  const user=await prisma.user.update({where:{id:req.user.id},data,include:{assignedRoute:true,pickupStop:true}});
  res.json(user);
});

export default router;
