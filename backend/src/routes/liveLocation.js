import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

async function getViewerVehicleIds(user) {
  if (user.role === 'ADMIN') {
    const vehicles = await prisma.vehicle.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    return vehicles.map(v => v.id);
  }

  let viewer = null;
  if (user.role === 'STUDENT') {
    viewer = await prisma.user.findUnique({
      where: { id: user.id },
      include: { assignedRoute: { select: { assignedBusId: true } } },
    });
  } else if (user.role === 'PARENT') {
    viewer = await prisma.user.findUnique({
      where: { id: user.id },
      include: { parentProfile: { select: { studentId: true } } },
    });
    const studentId = viewer?.parentProfile?.studentId;
    if (studentId) {
      viewer = await prisma.user.findUnique({
        where: { id: studentId },
        include: { assignedRoute: { select: { assignedBusId: true } } },
      });
    }
  }

  const busId = viewer?.assignedRoute?.assignedBusId || null;
  return busId ? [busId] : [];
}

router.get('/', auth, allow('ADMIN', 'STUDENT', 'PARENT'), async (req, res) => {
  const vehicleIds = await getViewerVehicleIds(req.user);
  if (!vehicleIds.length) return res.json({ vehicles: [], message: 'No bus is currently assigned to this account.' });

  const vehicles = await prisma.vehicle.findMany({
    where: { id: { in: vehicleIds } },
    include: {
      routes: {
        where: { isActive: true },
        select: {
          id: true,
          code: true,
          name: true,
          assignedDriver: { select: { name: true, phone: true } },
        },
      },
      locations: { orderBy: { recordedAt: 'desc' }, take: 1 },
    },
    orderBy: { busNumber: 'asc' },
  });

  res.json({
    vehicles: vehicles.map(v => ({
      id: v.id,
      busNumber: v.busNumber,
      registrationNo: v.registrationNo,
      model: v.model,
      capacity: v.capacity,
      status: v.status,
      latitude: v.latitude,
      longitude: v.longitude,
      speedKmph: v.speedKmph,
      updatedAt: v.updatedAt,
      lastLocationAt: v.locations[0]?.recordedAt || null,
      routes: v.routes,
    })),
  });
});

export default router;
