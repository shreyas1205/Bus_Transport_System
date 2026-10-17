import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

function academicYearFor(date = new Date()) {
  const year = date.getFullYear();
  // Campus academic year: June-May. Example: Sep 2026 => 2026-27.
  const start = date.getMonth() >= 5 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

router.get('/options', auth, allow('STUDENT'), async (req, res) => {
  const routes = await prisma.route.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    include: {
      assignedBus: { select: { busNumber: true, registrationNo: true } },
      assignedDriver: { select: { id: true, name: true, phone: true } },
      stops: {
        orderBy: { sequence: 'asc' },
        include: { stop: true },
      },
    },
  });

  res.json(routes.map(route => ({
    id: route.id,
    code: route.code,
    name: route.name,
    description: route.description,
    busNumber: route.assignedBus?.busNumber || null,
    registrationNo: route.assignedBus?.registrationNo || null,
    driver: route.assignedDriver || null,
    stops: route.stops.map(rs => ({
      routeStopId: rs.id,
      sequence: rs.sequence,
      plannedEta: rs.plannedEta,
      id: rs.stop.id,
      name: rs.stop.name,
      locationText: rs.stop.locationText || rs.stop.name,
      googleMapsUrl: rs.stop.googleMapsUrl,
      transportFee: Number(rs.stop.transportFee || 0),
    })),
  })));
});

router.get('/me', auth, allow('STUDENT'), async (req, res) => {
  const academicYear = academicYearFor();
  const enrollment = await prisma.transportEnrollment.findUnique({
    where: { userId_academicYear: { userId: req.user.id, academicYear } },
    include: { route: { include: { assignedBus: true, assignedDriver: { select: { name: true, phone: true } } } }, stop: true },
  });

  if (enrollment) {
    return res.json({
      academicYear,
      locked: true,
      selectedAt: enrollment.selectedAt,
      selection: {
        routeId: enrollment.routeId,
        routeName: enrollment.route.name,
        routeCode: enrollment.route.code,
        busNumber: enrollment.route.assignedBus?.busNumber || null,
        registrationNo: enrollment.route.assignedBus?.registrationNo || null,
        driver: enrollment.route.assignedDriver || null,
        stopId: enrollment.stopId,
        stopName: enrollment.stop.name,
        locationText: enrollment.stop.locationText || enrollment.stop.name,
        googleMapsUrl: enrollment.stop.googleMapsUrl,
        fee: Number(enrollment.stop.transportFee || 0),
      },
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { assignedRoute: { include: { assignedBus: true, assignedDriver: { select: { name: true, phone: true } } } }, pickupStop: true },
  });

  res.json({
    academicYear,
    locked: false,
    selection: user?.assignedRoute && user?.pickupStop ? {
      routeId: user.assignedRouteId,
      routeName: user.assignedRoute.name,
      routeCode: user.assignedRoute.code,
      busNumber: user.assignedRoute.assignedBus?.busNumber || null,
      registrationNo: user.assignedRoute.assignedBus?.registrationNo || null,
      driver: user.assignedRoute.assignedDriver || null,
      stopId: user.pickupStopId,
      stopName: user.pickupStop.name,
      locationText: user.pickupStop.locationText || user.pickupStop.name,
      googleMapsUrl: user.pickupStop.googleMapsUrl,
      fee: Number(user.pickupStop.transportFee || 0),
    } : null,
  });
});

router.post('/select', auth, allow('STUDENT'), async (req, res) => {
  const { routeId, stopId } = req.body;
  if (!routeId || !stopId) return res.status(400).json({ message: 'Route and pickup point are required.' });

  const academicYear = academicYearFor();
  const existing = await prisma.transportEnrollment.findUnique({
    where: { userId_academicYear: { userId: req.user.id, academicYear } },
  });
  if (existing) {
    return res.status(409).json({ message: `Your route for ${academicYear} is already locked. Contact Admin if it needs to be changed.` });
  }

  const route = await prisma.route.findFirst({
    where: { id: routeId, isActive: true },
    include: { stops: { where: { stopId } , include: { stop: true } } },
  });
  if (!route) return res.status(404).json({ message: 'Route not found.' });
  const routeStop = route.stops[0];
  if (!routeStop) return res.status(400).json({ message: 'That pickup point is not part of the selected route.' });

  const fee = Number(routeStop.stop.transportFee || 0);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 10);

  const result = await prisma.$transaction(async tx => {
    const enrollment = await tx.transportEnrollment.create({
      data: { userId: req.user.id, routeId, stopId, academicYear },
      include: { route: { include: { assignedBus: true, assignedDriver: { select: { name: true, phone: true } } } }, stop: true },
    });

    await tx.user.update({
      where: { id: req.user.id },
      data: { assignedRouteId: routeId, pickupStopId: stopId },
    });

    const feeRecord = await tx.fee.findFirst({ where: { userId: req.user.id, academicYear } });
    if (feeRecord && feeRecord.status !== 'PAID') {
      await tx.fee.update({ where: { id: feeRecord.id }, data: { amount: fee, dueDate } });
    } else if (!feeRecord) {
      await tx.fee.create({ data: { userId: req.user.id, academicYear, amount: fee, dueDate } });
    }

    return enrollment;
  });

  res.status(201).json({
    message: `Route locked for ${academicYear}. You cannot change it yourself during this academic year.`,
    academicYear,
    selection: {
      routeId: result.routeId,
      routeName: result.route.name,
      routeCode: result.route.code,
      busNumber: result.route.assignedBus?.busNumber || null,
      registrationNo: result.route.assignedBus?.registrationNo || null,
      driver: result.route.assignedDriver || null,
      stopId: result.stopId,
      stopName: result.stop.name,
      locationText: result.stop.locationText || result.stop.name,
      googleMapsUrl: result.stop.googleMapsUrl,
      fee,
    },
  });
});

export default router;

