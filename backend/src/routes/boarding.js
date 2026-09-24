import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

function startOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

async function getTodayBoarding(studentId) {
  return prisma.boardingEvent.findFirst({
    where: { userId: studentId, scannedAt: { gte: startOfToday() }, status: 'BOARDED' },
    orderBy: { scannedAt: 'desc' },
  });
}

router.post('/scan', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async (req, res) => {
  const { identifier, method = 'QR', routeId, stopId, vehicleId } = req.body;
  const pass = await prisma.busPass.findFirst({ where: { OR: [{ passNumber: identifier }, { qrPayload: identifier }] } });
  const user = pass ? await prisma.user.findUnique({ where: { id: pass.userId } }) : await prisma.user.findFirst({ where: { OR: [{ id: identifier }, { email: identifier }, { institutionId: identifier }] } });
  if (!user) return res.status(404).json({ status: 'REJECTED', message: 'Student/staff identifier or bus pass not found' });
  if (pass && (pass.status !== 'ACTIVE' || pass.validUntil < new Date())) return res.status(403).json({ status: 'REJECTED', message: 'Bus pass is expired or inactive' });
  const dup = await getTodayBoarding(user.id);
  if (dup) return res.status(409).json({ status: 'REJECTED', message: `${user.name} is already marked boarded today.` });
  const event = await prisma.boardingEvent.create({ data: { userId: user.id, identifier, method, routeId: routeId || user.assignedRouteId, stopId: stopId || user.pickupStopId, vehicleId: vehicleId || null } });
  req.app.get('io')?.emit('boarding:update');
  res.json({ status: 'BOARDED', event, user: { name: user.name, institutionId: user.institutionId }, passValidated: Boolean(pass) });
});

router.get('/today', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async (req, res) => {
  const events = await prisma.boardingEvent.findMany({ where: { scannedAt: { gte: startOfToday() } }, include: { user: { select: { name: true, institutionId: true, role: true } } }, orderBy: { scannedAt: 'desc' } });
  res.json(events);
});

router.get('/driver-roster', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async (req, res) => {
  let route;
  if (req.user.role === 'DRIVER') {
    route = await prisma.route.findFirst({
      where: { assignedDriverId: req.user.id, isActive: true },
      include: { assignedBus: true, stops: { orderBy: { sequence: 'asc' }, include: { stop: true } } },
    });
  } else if (req.query.routeId) {
    route = await prisma.route.findUnique({
      where: { id: req.query.routeId },
      include: { assignedBus: true, stops: { orderBy: { sequence: 'asc' }, include: { stop: true } } },
    });
  }

  if (!route) return res.json({ route: null, students: [] });

  const students = await prisma.user.findMany({
    where: { role: 'STUDENT', assignedRouteId: route.id },
    select: { id: true, name: true, institutionId: true, pickupStopId: true, pickupStop: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  const ids = students.map(s => s.id);
  const events = ids.length ? await prisma.boardingEvent.findMany({
    where: { userId: { in: ids }, scannedAt: { gte: startOfToday() }, status: 'BOARDED' },
    orderBy: { scannedAt: 'desc' },
  }) : [];
  const latest = new Map();
  for (const event of events) if (!latest.has(event.userId)) latest.set(event.userId, event);

  res.json({
    route: { id: route.id, code: route.code, name: route.name, busNumber: route.assignedBus?.busNumber || null, registrationNo: route.assignedBus?.registrationNo || null },
    students: students.map(s => ({
      id: s.id,
      name: s.name,
      institutionId: s.institutionId,
      pickupStop: s.pickupStop?.name || '—',
      boarded: latest.has(s.id),
      boardedAt: latest.get(s.id)?.scannedAt || null,
    })),
  });
});

router.post('/toggle', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async (req, res) => {
  const { studentId, boarded } = req.body || {};
  if (!studentId || typeof boarded !== 'boolean') return res.status(400).json({ message: 'studentId and boarded are required.' });

  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { id: true, name: true, role: true, institutionId: true, assignedRouteId: true, pickupStopId: true } });
  if (!student || student.role !== 'STUDENT') return res.status(404).json({ message: 'Student not found.' });

  const route = student.assignedRouteId ? await prisma.route.findUnique({ where: { id: student.assignedRouteId }, include: { assignedBus: true } }) : null;
  if (!route) return res.status(400).json({ message: 'Student is not assigned to a route.' });
  if (req.user.role === 'DRIVER' && route.assignedDriverId !== req.user.id) return res.status(403).json({ message: 'You can only update students on your assigned route.' });

  const existing = await getTodayBoarding(student.id);
  if (boarded) {
    if (existing) return res.json({ student: { id: student.id, name: student.name }, boarded: true, boardedAt: existing.scannedAt, message: 'Already marked boarded.' });
    const event = await prisma.boardingEvent.create({ data: {
      userId: student.id,
      identifier: student.institutionId || student.id,
      method: 'ID',
      routeId: route.id,
      stopId: student.pickupStopId || null,
      vehicleId: route.assignedBusId || null,
    } });
    req.app.get('io')?.emit('boarding:update');
    return res.json({ student: { id: student.id, name: student.name }, boarded: true, boardedAt: event.scannedAt, message: `${student.name} marked boarded.` });
  }

  if (existing) await prisma.boardingEvent.delete({ where: { id: existing.id } });
  req.app.get('io')?.emit('boarding:update');
  res.json({ student: { id: student.id, name: student.name }, boarded: false, boardedAt: null, message: `${student.name} marked not boarded.` });
});

router.get('/my-status', auth, allow('STUDENT','PARENT'), async (req, res) => {
  let studentId = req.user.id;
  if (req.user.role === 'PARENT') {
    const parent = await prisma.parentProfile.findUnique({ where: { userId: req.user.id } });
    studentId = parent?.studentId || '';
  }
  if (!studentId) return res.json({ student: null, boarded: false, boardedAt: null });

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    select: {
      id: true, name: true, institutionId: true, assignedRoute: { select: { id: true, code: true, name: true, assignedBus: { select: { busNumber: true, registrationNo: true } }, assignedDriver: { select: { name: true, phone: true } } } },
      pickupStop: { select: { name: true } },
    },
  });
  if (!student) return res.json({ student: null, boarded: false, boardedAt: null });

  const event = await getTodayBoarding(student.id);
  res.json({
    student: { id: student.id, name: student.name, institutionId: student.institutionId },
    route: student.assignedRoute ? { id: student.assignedRoute.id, code: student.assignedRoute.code, name: student.assignedRoute.name, busNumber: student.assignedRoute.assignedBus?.busNumber || null, registrationNo: student.assignedRoute.assignedBus?.registrationNo || null, driver: student.assignedRoute.assignedDriver || null } : null,
    pickupStop: student.pickupStop?.name || null,
    boarded: Boolean(event),
    boardedAt: event?.scannedAt || null,
  });
});

export default router;
