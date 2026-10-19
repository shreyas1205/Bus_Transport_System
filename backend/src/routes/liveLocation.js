import express from 'express';
import { requireVerifiedParentTransport } from '../services/parentTransportAccess.js';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { detectGpsSuddenStop } from '../services/emergencyResponse.js';

const router = express.Router();

const STALE_SECONDS = Number(process.env.GPS_STALE_SECONDS || 90);
const OFF_ROUTE_METERS = Number(process.env.ROUTE_DEVIATION_METERS || 350);
const DEVIATION_COOLDOWN_MS = 15 * 60 * 1000;
const INEVITABLE_DEVIATION_COOLDOWN_MS = 30 * 60 * 1000;
const OVERSPEED_COOLDOWN_MS = 5 * 60 * 1000;
const STALE_ALERT_COOLDOWN_MS = 10 * 60 * 1000;
const tripSessions = new Map();

function todayStart() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

function tripSnapshot(driverId) {
  const session = tripSessions.get(driverId);

  if (!session) {
    return {
      active: false,
      startedAt: null,
      endedAt: null,
      queuedEvents: 0
    };
  }

  return {
    ...session,
    timeline: undefined
  };
}

function addTimelineEvent(driverId, event) {
  const session = tripSessions.get(driverId);
  if (!session) return;

  session.timeline = Array.isArray(session.timeline)
    ? session.timeline
    : [];

  session.timeline.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...event
  });

  if (session.timeline.length > 120) {
    session.timeline = session.timeline.slice(-120);
  }
}

function haversineM(aLat, aLon, bLat, bLon) {
  const R = 6371000;
  const toRad = value => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) *
      Math.cos(toRad(bLat)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(x));
}

function pointSegmentDistanceM(point, a, b) {
  const lat0 = (point.latitude * Math.PI) / 180;
  const xScale = 111320 * Math.cos(lat0);
  const yScale = 110540;
  const px = point.longitude * xScale;
  const py = point.latitude * yScale;
  const ax = a.longitude * xScale;
  const ay = a.latitude * yScale;
  const bx = b.longitude * xScale;
  const by = b.latitude * yScale;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)
  );

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function routeDistanceM(point, stops) {
  if (!stops.length) return null;

  if (stops.length === 1) {
    return haversineM(
      point.latitude,
      point.longitude,
      stops[0].latitude,
      stops[0].longitude
    );
  }

  return Math.min(
    ...stops
      .slice(0, -1)
      .map((stop, index) =>
        pointSegmentDistanceM(point, stop, stops[index + 1])
      )
  );
}

function tracking(route, vehicle) {
  const now = Date.now();
  const last = vehicle.locations?.[0]?.recordedAt || null;
  const ageSeconds = last
    ? Math.max(0, Math.round((now - new Date(last).getTime()) / 1000))
    : null;
  const stale = ageSeconds == null || ageSeconds > STALE_SECONDS;
  const latitude = Number(vehicle.latitude);
  const longitude = Number(vehicle.longitude);
  const hasGps = Number.isFinite(latitude) && Number.isFinite(longitude);
  const speedKmph = Math.max(0, Number(vehicle.speedKmph || 0));
  const speedLimitKmph = Math.max(10, Number(route?.speedLimitKmph || 40));
  const overspeed = speedKmph > speedLimitKmph;
  const overspeedByKmph = overspeed
    ? Math.round(speedKmph - speedLimitKmph)
    : 0;

  const routeStops = route?.stops || [];
  const stops = routeStops
    .map(item => item.stop)
    .filter(
      stop =>
        Number.isFinite(stop.latitude) &&
        Number.isFinite(stop.longitude)
    );

  if (!hasGps || !stops.length) {
    return {
      stale,
      ageSeconds,
      staleThresholdSeconds: STALE_SECONDS,
      offRoute: false,
      distanceFromRouteM: null,
      nextStop: null,
      etaMinutes: null,
      speedLimitKmph,
      overspeed,
      overspeedByKmph
    };
  }

  const point = { latitude, longitude };
  const ranked = routeStops.map(routeStop => ({
    ...routeStop,
    distanceM: haversineM(
      latitude,
      longitude,
      routeStop.stop.latitude,
      routeStop.stop.longitude
    )
  }));

  const nearest = ranked.reduce(
    (best, item) => (!best || item.distanceM < best.distanceM ? item : best),
    null
  );

  let next = nearest;

  if (
    nearest &&
    nearest.distanceM < Math.max(nearest.stop.geofenceM || 150, 180)
  ) {
    const index = ranked.findIndex(item => item.id === nearest.id);
    next = ranked[Math.min(index + 1, ranked.length - 1)];
  }

  const etaSpeed = Math.max(speedKmph, 18);
  const etaMinutes = next
    ? Math.max(1, Math.round((next.distanceM / 1000 / etaSpeed) * 60))
    : null;
  const distanceFromRoute = routeDistanceM(point, stops);

  return {
    stale,
    ageSeconds,
    staleThresholdSeconds: STALE_SECONDS,
    offRoute:
      distanceFromRoute != null && distanceFromRoute > OFF_ROUTE_METERS,
    distanceFromRouteM:
      distanceFromRoute == null ? null : Math.round(distanceFromRoute),
    nextStop: next
      ? {
          id: next.stop.id,
          name: next.stop.name,
          sequence: next.sequence,
          distanceM: Math.round(next.distanceM),
          plannedEta: next.plannedEta
        }
      : null,
    etaMinutes,
    speedLimitKmph,
    overspeed,
    overspeedByKmph
  };
}

function stopAtCurrentPosition(route, latitude, longitude) {
  const ranked = (route?.stops || [])
    .map(routeStop => ({
      ...routeStop,
      distanceM: haversineM(
        latitude,
        longitude,
        routeStop.stop.latitude,
        routeStop.stop.longitude
      )
    }))
    .sort((a, b) => a.distanceM - b.distanceM);

  const nearest = ranked[0];
  if (!nearest) return null;

  const geofence = Math.max(nearest.stop.geofenceM || 150, 150);
  return nearest.distanceM <= geofence ? nearest : null;
}

async function viewerVehicleIds(user) {
  if (user.role === 'ADMIN') {
    return (
      await prisma.vehicle.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true }
      })
    ).map(vehicle => vehicle.id);
  }

  if (user.role === 'DRIVER') {
    const route = await prisma.route.findFirst({
      where: { assignedDriverId: user.id, isActive: true },
      select: { assignedBusId: true }
    });

    return route?.assignedBusId ? [route.assignedBusId] : [];
  }

  let studentId = user.id;

  if (user.role === 'PARENT') {
    const parent = await prisma.parentProfile.findUnique({
      where: { userId: user.id },
      select: { studentId: true }
    });
    studentId = parent?.studentId;
  }

  if (!studentId) return [];

  const student = await prisma.user.findUnique({
    where: { id: studentId },
    include: {
      assignedRoute: {
        select: { assignedBusId: true }
      }
    }
  });

  return student?.assignedRoute?.assignedBusId
    ? [student.assignedRoute.assignedBusId]
    : [];
}

async function adminIds() {
  return (
    await prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true }
    })
  ).map(user => user.id);
}

async function parentUsersForStudents(students) {
  const ids = students.flatMap(student =>
    [student.id, student.institutionId].filter(Boolean)
  );

  if (!ids.length) return [];

  return prisma.user.findMany({
    where: {
      role: 'PARENT',
      parentProfile: {
        is: {
          studentId: { in: ids }
        }
      }
    },
    select: {
      id: true,
      parentProfile: { select: { studentId: true } }
    }
  });
}

async function createDedupedNotification({
  userId,
  studentId = null,
  title,
  message,
  since = todayStart()
}) {
  const existing = await prisma.notification.findFirst({
    where: {
      userId,
      studentId,
      title,
      createdAt: { gte: since }
    },
    select: { id: true }
  });

  if (existing) return false;

  await prisma.notification.create({
    data: {
      userId,
      studentId,
      type: 'GENERAL',
      title,
      message
    }
  });

  return true;
}

async function deviationAlert(route, vehicle, distanceM, io) {
  const since = new Date(Date.now() - DEVIATION_COOLDOWN_MS);
  const title = `ROUTE DEVIATION · Bus ${vehicle.busNumber || vehicle.registrationNo}`;
  const existing = await prisma.notification.findFirst({
    where: { title, createdAt: { gte: since } }
  });

  if (existing) return false;

  const admins = await adminIds();
  const ids = [
    ...new Set([
      ...admins,
      ...(route.assignedDriverId ? [route.assignedDriverId] : [])
    ])
  ];

  const message =
    `Bus ${vehicle.busNumber || vehicle.registrationNo} is about ` +
    `${Math.round(distanceM)} m away from assigned route ${route.code}.`;

  if (ids.length) {
    await prisma.notification.createMany({
      data: ids.map(userId => ({
        userId,
        type: 'GENERAL',
        title,
        message
      }))
    });
  }

  io?.emit('route:deviation', {
    routeId: route.id,
    vehicleId: vehicle.id,
    distanceFromRouteM: Math.round(distanceM),
    message
  });
  io?.emit('notification:update', { userIds: ids });
  return true;
}

async function inevitableDeviationAlert(route, vehicle, driver, trackingInfo, io) {
  const since = new Date(Date.now() - INEVITABLE_DEVIATION_COOLDOWN_MS);
  const busLabel = vehicle.busNumber || vehicle.registrationNo;
  const title = `INEVITABLE ROUTE DEVIATION · Bus ${busLabel}`;
  const existing = await prisma.notification.findFirst({
    where: {
      title,
      createdAt: { gte: since }
    }
  });

  const admins = await adminIds();
  const message =
    `Driver ${driver.name || driver.email || 'Driver'} reported that the deviation ` +
    `for Bus ${busLabel} on route ${route.code} is unavoidable. ` +
    `Current deviation: ${Math.round(trackingInfo.distanceFromRouteM || 0)} m. ` +
    `Continue monitoring live GPS.`;

  if (!existing && admins.length) {
    await prisma.notification.createMany({
      data: admins.map(userId => ({
        userId,
        type: 'GENERAL',
        title,
        message
      }))
    });
  }

  io?.emit('route:deviation:inevitable', {
    routeId: route.id,
    vehicleId: vehicle.id,
    driverId: driver.id,
    distanceFromRouteM: Math.round(trackingInfo.distanceFromRouteM || 0),
    message
  });

  if (admins.length) {
    io?.emit('notification:update', { userIds: admins });
  }

  return {
    notified: !existing,
    adminCount: admins.length,
    message
  };
}

async function overspeedAlert(route, vehicle, trackingInfo, io) {
  if (!trackingInfo.overspeed) return false;

  const since = new Date(Date.now() - OVERSPEED_COOLDOWN_MS);
  const title = `OVERSPEED · Bus ${vehicle.busNumber || vehicle.registrationNo}`;
  const existing = await prisma.notification.findFirst({
    where: { title, createdAt: { gte: since } }
  });

  if (existing) return false;

  const admins = await adminIds();
  const ids = [
    ...new Set([
      ...admins,
      ...(route.assignedDriverId ? [route.assignedDriverId] : [])
    ])
  ];
  const message =
    `Bus ${vehicle.busNumber || vehicle.registrationNo} is travelling at ` +
    `${Math.round(vehicle.speedKmph || 0)} km/h. Route ${route.code} limit is ` +
    `${trackingInfo.speedLimitKmph} km/h.`;

  if (ids.length) {
    await prisma.notification.createMany({
      data: ids.map(userId => ({
        userId,
        type: 'GENERAL',
        title,
        message
      }))
    });
  }

  io?.emit('vehicle:overspeed', {
    routeId: route.id,
    vehicleId: vehicle.id,
    speedKmph: Number(vehicle.speedKmph || 0),
    speedLimitKmph: trackingInfo.speedLimitKmph,
    message
  });
  io?.emit('notification:update', { userIds: ids });
  return true;
}

async function staleGpsAlert(route, vehicle, trackingInfo, io) {
  if (!trackingInfo.stale) return false;

  const since = new Date(Date.now() - STALE_ALERT_COOLDOWN_MS);
  const title = `GPS STALE · Bus ${vehicle.busNumber || vehicle.registrationNo}`;
  const existing = await prisma.notification.findFirst({
    where: { title, createdAt: { gte: since } }
  });

  if (existing) return false;

  const admins = await adminIds();
  const ids = [
    ...new Set([
      ...admins,
      ...(route?.assignedDriverId ? [route.assignedDriverId] : [])
    ])
  ];
  const ageText =
    trackingInfo.ageSeconds == null
      ? 'no GPS update has been received'
      : `last update was ${Math.max(1, Math.floor(trackingInfo.ageSeconds / 60))} minute(s) ago`;
  const message =
    `Bus ${vehicle.busNumber || vehicle.registrationNo} location may be unavailable; ${ageText}.`;

  if (ids.length) {
    await prisma.notification.createMany({
      data: ids.map(userId => ({ userId, type: 'GENERAL', title, message }))
    });
  }

  io?.emit('gps:stale', {
    routeId: route?.id || null,
    vehicleId: vehicle.id,
    ageSeconds: trackingInfo.ageSeconds,
    message
  });
  io?.emit('notification:update', { userIds: ids });
  return true;
}

async function approachingParentAlerts(route, vehicle, trackingInfo, io) {
  if (
    !trackingInfo.nextStop?.id ||
    trackingInfo.etaMinutes == null ||
    trackingInfo.etaMinutes < 1 ||
    trackingInfo.etaMinutes > Math.max(1, route.arrivalAlertMinutes || 10)
  ) {
    return 0;
  }

  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      assignedRouteId: route.id,
      pickupStopId: trackingInfo.nextStop.id
    },
    select: { id: true, name: true, institutionId: true }
  });

  if (!students.length) return 0;

  const parents = await parentUsersForStudents(students);
  if (!parents.length) return 0;

  const studentByLink = new Map();
  for (const student of students) {
    studentByLink.set(student.id, student);
    if (student.institutionId) studentByLink.set(student.institutionId, student);
  }

  const busLabel = vehicle.busNumber
    ? `Bus ${vehicle.busNumber}`
    : vehicle.registrationNo || 'Your bus';
  let created = 0;
  const notifiedUserIds = [];

  for (const parent of parents) {
    const student = studentByLink.get(parent.parentProfile?.studentId);
    if (!student) continue;

    const title = 'Bus approaching your pickup stop';
    const message =
      `${busLabel} is approaching ${trackingInfo.nextStop.name}. ` +
      `ETA about ${trackingInfo.etaMinutes} minute${trackingInfo.etaMinutes === 1 ? '' : 's'} for ${student.name}.`;

    if (
      await createDedupedNotification({
        userId: parent.id,
        studentId: student.id,
        title,
        message
      })
    ) {
      created += 1;
      notifiedUserIds.push(parent.id);
    }
  }

  if (notifiedUserIds.length) {
    io?.emit('notification:update', { userIds: notifiedUserIds });
    io?.emit('bus:approaching', {
      routeId: route.id,
      vehicleId: vehicle.id,
      stop: trackingInfo.nextStop,
      etaMinutes: trackingInfo.etaMinutes,
      userIds: notifiedUserIds
    });
  }

  return created;
}

async function missedBoardingForStop(route, vehicle, stopId, io) {
  const students = await prisma.user.findMany({
    where: {
      role: 'STUDENT',
      assignedRouteId: route.id,
      pickupStopId: stopId
    },
    select: {
      id: true,
      name: true,
      institutionId: true,
      pickupStop: { select: { id: true, name: true } }
    }
  });

  if (!students.length) return 0;

  const studentIds = students.map(student => student.id);
  const events = await prisma.boardingEvent.findMany({
    where: {
      userId: { in: studentIds },
      scannedAt: { gte: todayStart() },
      status: { in: ['BOARDED', 'DROPPED_OFF'] }
    },
    select: { userId: true, status: true }
  });
  const completed = new Set(events.map(event => event.userId));
  const missed = students.filter(student => !completed.has(student.id));

  if (!missed.length) return 0;

  const parents = await parentUsersForStudents(missed);
  const studentByLink = new Map();
  for (const student of missed) {
    studentByLink.set(student.id, student);
    if (student.institutionId) studentByLink.set(student.institutionId, student);
  }

  const admins = await adminIds();
  const busLabel = vehicle.busNumber
    ? `Bus ${vehicle.busNumber}`
    : vehicle.registrationNo || 'Campus bus';
  const notificationUserIds = new Set();
  let created = 0;

  for (const student of missed) {
    const title = 'Student did not board today';
    const message =
      `${student.name} was not recorded as boarded when ${busLabel} passed ` +
      `${student.pickupStop?.name || 'the assigned pickup stop'} on route ${route.code}.`;

    for (const adminId of admins) {
      if (
        await createDedupedNotification({
          userId: adminId,
          studentId: student.id,
          title,
          message
        })
      ) {
        created += 1;
        notificationUserIds.add(adminId);
      }
    }
  }

  for (const parent of parents) {
    const student = studentByLink.get(parent.parentProfile?.studentId);
    if (!student) continue;

    const title = 'Student did not board today';
    const message =
      `${student.name} was not recorded as boarded when ${busLabel} passed ` +
      `${student.pickupStop?.name || 'the assigned pickup stop'}.`;

    if (
      await createDedupedNotification({
        userId: parent.id,
        studentId: student.id,
        title,
        message
      })
    ) {
      created += 1;
      notificationUserIds.add(parent.id);
    }
  }

  if (notificationUserIds.size) {
    io?.emit('notification:update', {
      userIds: [...notificationUserIds]
    });
    io?.emit('boarding:missed', {
      routeId: route.id,
      vehicleId: vehicle.id,
      stopId,
      students: missed.map(student => ({
        id: student.id,
        name: student.name
      }))
    });
  }

  return created;
}

async function timelineForVehicle(vehicleId) {
  const session = [...tripSessions.values()].find(
    item => item.vehicleId === vehicleId
  );

  const start = session?.startedAt
    ? new Date(session.startedAt)
    : todayStart();

  const [boardingEvents, incidents] = await Promise.all([
    prisma.boardingEvent.findMany({
      where: {
        vehicleId,
        scannedAt: { gte: start },
        status: { in: ['BOARDED', 'DROPPED_OFF'] }
      },
      include: {
        user: { select: { name: true, institutionId: true } }
      },
      orderBy: { scannedAt: 'asc' },
      take: 100
    }),
    prisma.incident.findMany({
      where: {
        vehicleId,
        createdAt: { gte: start }
      },
      orderBy: { createdAt: 'asc' },
      take: 50
    })
  ]);

  const persisted = [
    ...boardingEvents.map(event => ({
      id: `boarding-${event.id}`,
      at: event.scannedAt,
      type: event.status,
      label:
        event.status === 'BOARDED'
          ? `${event.user?.name || 'Passenger'} boarded`
          : `${event.user?.name || 'Passenger'} dropped off`
    })),
    ...incidents.map(incident => ({
      id: `incident-${incident.id}`,
      at: incident.createdAt,
      type: 'INCIDENT',
      label: `${incident.type}: ${incident.message}`
    }))
  ];

  return [
    ...(session?.timeline || []),
    ...persisted
  ]
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .slice(-80);
}

router.get(
  '/',
  auth,
  allow('ADMIN', 'DRIVER', 'STUDENT', 'PARENT'),
  requireVerifiedParentTransport,
  async (req, res) => {
    const ids = await viewerVehicleIds(req.user);

    if (!ids.length) {
      return res.json({
        vehicles: [],
        message: 'No bus is currently assigned to this account.'
      });
    }

    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', routes: { some: { isActive: true } } },
      include: {
        routes: {
          where: { isActive: true },
          include: {
            stops: {
              include: { stop: true },
              orderBy: { sequence: 'asc' }
            },
            assignedDriver: {
              select: {
                id: true,
                name: true,
                phone: true,
                driverProfile: {
                  select: {
                    licenseNumber: true,
                    licenseExpiry: true,
                    licensePhoto: true,
                    licenseStatus: true
                  }
                }
              }
            }
          }
        },
        locations: { orderBy: { recordedAt: 'desc' }, take: 1 }
      },
      orderBy: { busNumber: 'asc' }
    });

    const io = req.app.get('io');
    const result = [];

    for (const vehicle of vehicles) {
      const route = vehicle.routes?.[0] || null;
      const trackingInfo = tracking(route, vehicle);

      if (route && trackingInfo.offRoute) {
        deviationAlert(route, vehicle, trackingInfo.distanceFromRouteM, io).catch(
          () => {}
        );
      }

      if (route && trackingInfo.overspeed) {
        overspeedAlert(route, vehicle, trackingInfo, io).catch(() => {});
      }

      if (trackingInfo.stale) {
        staleGpsAlert(route, vehicle, trackingInfo, io).catch(() => {});
      }

      result.push({
        id: vehicle.id,
        busNumber: vehicle.busNumber,
        registrationNo: vehicle.registrationNo,
        model: vehicle.model,
        capacity: vehicle.capacity,
        status: vehicle.status,
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
        speedKmph: vehicle.speedKmph,
        updatedAt: vehicle.updatedAt,
        lastLocationAt: vehicle.locations[0]?.recordedAt || null,
        routes: route ? [route] : [],
        tracking: trackingInfo,
        timeline:
          ['ADMIN', 'DRIVER'].includes(req.user.role)
            ? await timelineForVehicle(vehicle.id)
            : []
      });
    }

    let journey = null;

    if (['STUDENT', 'PARENT'].includes(req.user.role)) {
      let studentId = req.user.id;

      if (req.user.role === 'PARENT') {
        const parent = await prisma.parentProfile.findUnique({
          where: { userId: req.user.id },
          select: { studentId: true }
        });
        studentId = parent?.studentId || '';
      }

      if (studentId) {
        const events = await prisma.boardingEvent.findMany({
          where: {
            userId: studentId,
            scannedAt: { gte: todayStart() }
          },
          orderBy: { scannedAt: 'desc' }
        });
        const boarded = events.find(event => event.status === 'BOARDED');
        const dropped = events.find(event => event.status === 'DROPPED_OFF');
        const student = await prisma.user.findUnique({
          where: { id: studentId },
          select: {
            id: true,
            name: true,
            institutionId: true,
            pickupStop: { select: { id: true, name: true } }
          }
        });

        journey = {
          student,
          pickupStop: student?.pickupStop || null,
          status: dropped
            ? 'DROPPED_OFF'
            : boarded
              ? 'BOARDED'
              : 'NOT_BOARDED',
          boardedAt: boarded?.scannedAt || null,
          droppedOffAt: dropped?.scannedAt || null
        };
      }
    }

    res.json({
      vehicles: result,
      journey,
      trip:
        req.user.role === 'DRIVER' ? tripSnapshot(req.user.id) : null
    });
  }
);

router.get('/trip', auth, allow('DRIVER'), async (req, res) => {
  const route = await prisma.route.findFirst({
    where: { assignedDriverId: req.user.id, isActive: true, assignedBus: { status: 'ACTIVE' } },
    include: {
      assignedBus: true,
      stops: { include: { stop: true }, orderBy: { sequence: 'asc' } }
    }
  });

  const trip = tripSnapshot(req.user.id);
  res.json({ trip: route && trip.routeId === route.id && trip.vehicleId === route.assignedBusId ? trip : { active: false }, route });
});

router.post('/trip/start', auth, allow('DRIVER'), async (req, res) => {
  const route = await prisma.route.findFirst({
    where: { assignedDriverId: req.user.id, isActive: true, assignedBus: { status: 'ACTIVE' } },
    include: { assignedBus: true }
  });

  if (!route?.assignedBusId) {
    return res.status(404).json({
      message: 'No active route and bus are assigned to you.'
    });
  }

  const existing = tripSessions.get(req.user.id);
  if (existing?.active && (existing.routeId !== route.id || existing.vehicleId !== route.assignedBusId)) return res.status(409).json({ message: 'Assignment changed. End and restart your trip.' });
  if (existing?.active) {
    return res.json({
      message: 'Trip is already active.',
      trip: tripSnapshot(req.user.id),
      route
    });
  }

  const trip = {
    driverId: req.user.id,
    routeId: route.id,
    vehicleId: route.assignedBusId,
    startedAt: new Date().toISOString(),
    endedAt: null,
    active: true,
    atStopId: null,
    atStopSequence: null,
    passedStopIds: [],
    timeline: []
  };

  tripSessions.set(req.user.id, trip);
  addTimelineEvent(req.user.id, {
    type: 'TRIP_STARTED',
    label: `Trip started on route ${route.code}`
  });

  req.app.get('io')?.emit('trip:status', tripSnapshot(req.user.id));

  res.json({
    message: 'Trip started. Live GPS sharing is enabled.',
    trip: tripSnapshot(req.user.id),
    route
  });
});

router.post('/trip/end', auth, allow('DRIVER'), async (req, res) => {
  const current = tripSessions.get(req.user.id);

  if (!current?.active) {
    return res.json({ message: 'No active trip.', trip: { active: false } });
  }

  addTimelineEvent(req.user.id, {
    type: 'TRIP_ENDED',
    label: 'Trip ended'
  });

  current.active = false;
  current.endedAt = new Date().toISOString();
  current.atStopId = null;
  current.atStopSequence = null;

  const ended = tripSnapshot(req.user.id);
  req.app.get('io')?.emit('trip:status', ended);

  res.json({
    message: 'Trip ended. GPS sharing is stopped.',
    trip: ended
  });
});

router.post('/deviation/inevitable', auth, allow('DRIVER'), async (req, res) => {
  const route = await prisma.route.findFirst({
    where: { assignedDriverId: req.user.id, isActive: true, assignedBus: { status: 'ACTIVE' } },
    include: {
      stops: {
        include: { stop: true },
        orderBy: { sequence: 'asc' }
      },
      assignedBus: true
    }
  });

  if (!route?.assignedBusId) {
    return res.status(404).json({
      message: 'No active bus is assigned to this driver.'
    });
  }

  const vehicle = await prisma.vehicle.findUnique({
    where: { id: route.assignedBusId },
    include: {
      locations: { orderBy: { recordedAt: 'desc' }, take: 1 }
    }
  });

  if (!vehicle) {
    return res.status(404).json({ message: 'Assigned bus was not found.' });
  }

  const trackingInfo = tracking(route, vehicle);

  if (!trackingInfo.offRoute) {
    return res.status(409).json({
      message: 'The bus is currently on its assigned route.'
    });
  }

  const driver = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, name: true, email: true }
  });

  const result = await inevitableDeviationAlert(
    route,
    vehicle,
    driver || { id: req.user.id, name: 'Driver' },
    trackingInfo,
    req.app.get('io')
  );

  addTimelineEvent(req.user.id, {
    type: 'INEVITABLE_ROUTE_DEVIATION',
    label: `Driver reported unavoidable route deviation (${Math.round(
      trackingInfo.distanceFromRouteM || 0
    )} m from route)`
  });

  return res.json({
    message: 'Admin notified that the route deviation is unavoidable.',
    tracking: trackingInfo,
    notification: result
  });
});

router.post('/update', auth, allow('DRIVER'), async (req, res) => {
  const session = tripSessions.get(req.user.id);

  if (!session?.active) {
    return res.status(409).json({
      message: 'Start the trip before sharing live GPS.'
    });
  }

  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const speedKmph = Math.max(0, Number(req.body.speedKmph || 0));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return res.status(400).json({
      message: 'Valid latitude and longitude are required.'
    });
  }

  const route = await prisma.route.findFirst({
    where: { assignedDriverId: req.user.id, isActive: true, assignedBus: { status: 'ACTIVE' } },
    include: {
      stops: {
        include: { stop: true },
        orderBy: { sequence: 'asc' }
      },
      assignedBus: true
    }
  });

  if (!route?.assignedBusId) {
    return res.status(404).json({
      message: 'No active bus is assigned to this driver.'
    });
  }

  if (session.routeId !== route.id || session.vehicleId !== route.assignedBusId) return res.status(409).json({ message: 'Assignment changed. End and restart your trip.' });

  const previousLocation = await prisma.vehicleLocation.findFirst({
    where: { vehicleId: route.assignedBusId },
    orderBy: { recordedAt: 'desc' }
  });

  const recordedAt = new Date();
  const [vehicle] = await prisma.$transaction([
    prisma.vehicle.update({
      where: { id: route.assignedBusId },
      data: { latitude, longitude, speedKmph }
    }),
    prisma.vehicleLocation.create({
      data: {
        vehicleId: route.assignedBusId,
        latitude,
        longitude,
        speedKmph,
        recordedAt
      }
    })
  ]);

  const trackingInfo = tracking(route, {
    ...vehicle,
    locations: [{ recordedAt }]
  });
  const io = req.app.get('io');

  if (trackingInfo.offRoute) {
    const created = await deviationAlert(
      route,
      vehicle,
      trackingInfo.distanceFromRouteM,
      io
    );

    if (created) {
      addTimelineEvent(req.user.id, {
        type: 'ROUTE_DEVIATION',
        label: `Route deviation: ${trackingInfo.distanceFromRouteM} m from assigned route`
      });
    }
  }

  if (trackingInfo.overspeed) {
    const created = await overspeedAlert(route, vehicle, trackingInfo, io);

    if (created) {
      addTimelineEvent(req.user.id, {
        type: 'OVERSPEED',
        label:
          `Overspeed: ${Math.round(speedKmph)} km/h ` +
          `(limit ${trackingInfo.speedLimitKmph} km/h)`
      });
    }
  }

  await approachingParentAlerts(route, vehicle, trackingInfo, io);

  const insideStop = stopAtCurrentPosition(route, latitude, longitude);

  if (insideStop) {
    if (session.atStopId !== insideStop.stop.id) {
      session.atStopId = insideStop.stop.id;
      session.atStopSequence = insideStop.sequence;
      addTimelineEvent(req.user.id, {
        type: 'STOP_REACHED',
        label: `Reached stop ${insideStop.stop.name}`,
        stopId: insideStop.stop.id
      });
    }
  } else if (session.atStopId) {
    const passedStopId = session.atStopId;
    const passedStop = route.stops.find(item => item.stopId === passedStopId);

    if (!session.passedStopIds.includes(passedStopId)) {
      session.passedStopIds.push(passedStopId);
      await missedBoardingForStop(route, vehicle, passedStopId, io);
      addTimelineEvent(req.user.id, {
        type: 'STOP_PASSED',
        label: `Passed stop ${passedStop?.stop?.name || 'pickup stop'}`,
        stopId: passedStopId
      });
    }

    session.atStopId = null;
    session.atStopSequence = null;
  }

  const accidentDetection = await detectGpsSuddenStop({
    vehicleId: vehicle.id,
    driverId: req.user.id,
    latitude,
    longitude,
    currentSpeed: req.body.speedKmph == null ? null : speedKmph,
    previousLocation,
    io
  });

  if (accidentDetection.possibleAccident) {
    addTimelineEvent(req.user.id, {
      type: 'POSSIBLE_ACCIDENT',
      label:
        `Possible accident: ${Math.round(accidentDetection.previousSpeed || 0)} ` +
        `→ ${Math.round(accidentDetection.currentSpeed || 0)} km/h`
    });
  }

  const payload = {
    vehicleId: vehicle.id,
    latitude,
    longitude,
    speedKmph,
    recordedAt: recordedAt.toISOString(),
    tracking: trackingInfo,
    accidentDetection
  };

  // Broadcast only an invalidation signal; coordinates require the scoped HTTP API.
  io?.emit('vehicle:location', {});

  res.json({
    message: 'Live location updated.',
    ...payload
  });
});

export default router;
