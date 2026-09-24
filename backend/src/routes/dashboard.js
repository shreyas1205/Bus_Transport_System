import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();
router.get('/summary', auth, allow('ADMIN','FLEET_MANAGER','DRIVER','STUDENT','STAFF','PARENT'), async (req, res) => {
  const [users, vehicles, routes, incidents, pendingFees, todayBoarding] = await Promise.all([
    prisma.user.count(), prisma.vehicle.count({ where: { status: 'ACTIVE' } }), prisma.route.count({ where: { isActive: true } }),
    prisma.incident.count({ where: { status: { not: 'RESOLVED' } } }), prisma.fee.count({ where: { status: 'PENDING' } }),
    prisma.boardingEvent.count({ where: { scannedAt: { gte: new Date(new Date().setHours(0,0,0,0)) }, status: 'BOARDED' } })
  ]);
  res.json({ users, vehicles, routes, incidents, pendingFees, todayBoarding });
});
export default router;
