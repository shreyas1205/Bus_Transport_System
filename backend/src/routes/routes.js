import express from 'express';
import { requireVerifiedParentTransport } from '../services/parentTransportAccess.js';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { calculateEtaMinutes, nearestNeighbor, withinGeofence } from '../utils.js';
import { syncTemporaryDriverAssignments } from '../services/temporaryDriverAssignments.js';

const router = express.Router();

function extractGoogleMapsCoordinates(url) {
  if (!url) return null;
  try {
    const value = decodeURIComponent(String(url));
    const patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) {
        const latitude = Number(match[1]);
        const longitude = Number(match[2]);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    }
  } catch {}
  return null;
}

async function geocodeLocation(query) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q: `${query}, Bengaluru, India` });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { 'User-Agent': 'NaviGuard/1.0 (local demo)' },
  });
  if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`);
  const data = await response.json();
  if (!data.length) throw new Error(`Location not found: ${query}`);
  return { latitude: Number(data[0].lat), longitude: Number(data[0].lon) };
}

router.get('/', auth, requireVerifiedParentTransport, async (req, res) => {
  await syncTemporaryDriverAssignments(req.app.get('io'));
  let where = {};

  if (req.user.role === 'DRIVER') {
    where = { assignedDriverId: req.user.id };
  } else if (req.user.role === 'STUDENT' || req.user.role === 'STAFF') {
    const currentUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        assignedRouteId: true,
        transportEnrollments: {
          orderBy: { selectedAt: 'desc' },
          take: 1,
          select: { routeId: true },
        },
      },
    });
    const routeId = currentUser?.assignedRouteId || currentUser?.transportEnrollments?.[0]?.routeId;
    where = routeId ? { id: routeId } : { id: '__NO_ASSIGNED_ROUTE__' };
  } else if (req.user.role === 'PARENT') {
    // ParentProfile stores studentId as a scalar; it has no Prisma `student` relation.
    const parent = await prisma.parentProfile.findUnique({
      where: { userId: req.user.id },
      select: { studentId: true },
    });

    const student = parent?.studentId
      ? await prisma.user.findUnique({
          where: { id: parent.studentId },
          select: {
            assignedRouteId: true,
            transportEnrollments: {
              orderBy: { selectedAt: 'desc' },
              take: 1,
              select: { routeId: true },
            },
          },
        })
      : null;

    const routeId =
      student?.assignedRouteId ||
      student?.transportEnrollments?.[0]?.routeId;

    where = routeId ? { id: routeId } : { id: '__NO_ASSIGNED_ROUTE__' };
  }

  if (req.user.role !== 'ADMIN') where.isActive = true;
  if (req.user.role === 'DRIVER') where.assignedBus = { status: 'ACTIVE' };

  const routes = await prisma.route.findMany({
    where,
    include: {
      stops: { include: { stop: true }, orderBy: { sequence: 'asc' } },
      assignedBus: true,
      assignedDriver: { select: { id: true, name: true, phone: true } },
      temporaryDriverAssignments: {
        where: { status: { in: ['ACTIVE', 'SCHEDULED'] } },
        orderBy: { startsAt: 'asc' },
        include: {
          originalDriver: { select: { id: true, name: true, phone: true } },
          temporaryDriver: { select: { id: true, name: true, phone: true, driverProfile: true } },
        },
      },
    },
  });
  const enriched = routes.map(r => ({
    ...r,
    eta: r.assignedBus
      ? r.stops.map(rs => ({
          stopId: rs.stopId,
          plannedEta: rs.plannedEta,
          etaMinutes: calculateEtaMinutes(r.assignedBus, rs.stop),
        }))
      : [],
  }));
  res.json(enriched);
});

router.patch('/:id/status', auth, allow('ADMIN'), async (req, res) => {
  if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ message: 'isActive must be a boolean.' });
  const route = await prisma.route.findUnique({ where: { id: req.params.id }, include: { assignedBus: true } });
  if (!route) return res.status(404).json({ message: 'Route not found.' });
  if (req.body.isActive && route.assignedBus && route.assignedBus.status !== 'ACTIVE') return res.status(409).json({ message: 'Reactivate or replace the assigned bus first.' });
  res.json(await prisma.route.update({ where: { id: route.id }, data: { isActive: req.body.isActive } }));
});

// Admin-only route creation: supports direct map-click coordinates or a Google Maps/location fallback.
router.post('/', auth, allow('ADMIN'), async (req, res) => {
  const { code, name, description, assignedBusId, assignedDriverId, busNumber, speedLimitKmph = 40, arrivalAlertMinutes = 10, stops = [] } = req.body;
  if (!code || !name || !Array.isArray(stops) || !stops.length) {
    return res.status(400).json({ message: 'code, name and at least one pickup point are required' });
  }

  if (assignedBusId && !await prisma.vehicle.findFirst({ where: { id: assignedBusId, status: 'ACTIVE' } })) return res.status(409).json({ message: 'Only ACTIVE buses can be assigned to routes.' });
  try {
    const preparedStops = await Promise.all(stops.map(async (s, index) => {
      if (!s.name || !s.plannedEta) {
        throw new Error(`Pickup point ${index + 1} needs a name and arrival time.`);
      }

      const directLatitude = Number(s.latitude);
      const directLongitude = Number(s.longitude);
      let coords = null;

      if (
        Number.isFinite(directLatitude) && Number.isFinite(directLongitude) &&
        directLatitude >= -90 && directLatitude <= 90 &&
        directLongitude >= -180 && directLongitude <= 180
      ) {
        coords = { latitude: directLatitude, longitude: directLongitude };
      }

      if (!coords && s.googleMapsUrl) {
        coords = extractGoogleMapsCoordinates(s.googleMapsUrl);
      }

      if (!coords) {
        coords = await geocodeLocation(s.locationText || s.name);
      }

      const googleMapsUrl = String(s.googleMapsUrl || '').trim() ||
        `https://www.google.com/maps?q=${coords.latitude},${coords.longitude}`;

      return {
        name: String(s.name).trim(),
        locationText: String(s.locationText || s.name).trim(),
        googleMapsUrl,
        latitude: coords.latitude,
        longitude: coords.longitude,
        geofenceM: Number(s.geofenceM || 150),
        transportFee: Math.max(0, Number(s.transportFee || 0)),
        plannedEta: s.plannedEta,
        sequence: index + 1,
      };
    }));

    const route = await prisma.$transaction(async tx => {
      if (assignedBusId && busNumber) {
        await tx.vehicle.update({ where: { id: assignedBusId }, data: { busNumber: String(busNumber).trim() } });
      }
      const created = await tx.route.create({
        data: {
          code,
          name,
          description,
          speedLimitKmph: Math.max(10, Math.min(120, Number(speedLimitKmph) || 40)),
          arrivalAlertMinutes: Math.max(1, Math.min(30, Math.round(Number(arrivalAlertMinutes) || 10))),
          assignedBusId: assignedBusId || null,
          assignedDriverId: assignedDriverId || null,
          stops: { create: preparedStops.map(s => ({
            sequence: s.sequence,
            plannedEta: s.plannedEta,
            stop: { create: {
              name: s.name,
              locationText: s.locationText,
              googleMapsUrl: s.googleMapsUrl,
              latitude: s.latitude,
              longitude: s.longitude,
              geofenceM: s.geofenceM,
              transportFee: s.transportFee,
            } },
          })) },
        },
        include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } }, assignedBus: true },
      });
      return created;
    });

    res.status(201).json(route);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Could not create route' });
  }
});

router.post('/geocode', auth, allow('ADMIN'), async (req, res) => {
  try {
    if (!req.body.locationText) return res.status(400).json({ message: 'locationText is required' });
    const coords = await geocodeLocation(req.body.locationText);
    res.json(coords);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Location could not be found' });
  }
});

router.post('/geofence-check', auth, allow('ADMIN','DRIVER'), async (req,res) => {
  const { stopId, latitude, longitude } = req.body;
  const stop = await prisma.stop.findUnique({ where: { id: stopId } });
  if (!stop) return res.status(404).json({ message: 'Stop not found' });
  res.json({ inside: withinGeofence(Number(latitude), Number(longitude), stop), stop, checkedAt: new Date().toISOString() });
});

router.post(
  '/optimize',
  auth,
  allow('ADMIN'),
  async (req, res, next) => {
    try {
      const { routeId } = req.body;

      const route = await prisma.route.findUnique({
        where: {
          id: routeId
        },

        include: {
          stops: {
            include: {
              stop: true
            }
          }
        }
      });

      if (!route) {
        return res.status(404).json({
          message: 'Route not found'
        });
      }

      if (route.stops.length < 2) {
        return res.json({
          message: 'Route already optimized',
          ordered: route.stops.map(
            (item) => item.stop.name
          )
        });
      }

      const ordered = nearestNeighbor(
        route.stops.map(
          (item) => item.stop
        )
      );

      const routeStopByStopId = new Map(
        route.stops.map(
          (item) => [
            item.stopId,
            item
          ]
        )
      );

      const maxSequence = route.stops.reduce(
        (max, item) =>
          Math.max(
            max,
            item.sequence || 0
          ),
        0
      );

      const temporaryStart =
        maxSequence +
        route.stops.length +
        1000;

      await prisma.$transaction(
        async (tx) => {

          // STEP 1:
          // Move every stop to a temporary
          // sequence so there are no
          // unique-constraint collisions.
          for (
            let index = 0;
            index < ordered.length;
            index++
          ) {
            const stop =
              ordered[index];

            const routeStop =
              routeStopByStopId.get(
                stop.id
              );

            if (!routeStop) {
              throw new Error(
                `Route stop not found for stop ${stop.id}`
              );
            }

            await tx.routeStop.update({
              where: {
                id: routeStop.id
              },

              data: {
                sequence:
                  temporaryStart +
                  index
              }
            });
          }


          // STEP 2:
          // Apply final sequence values.
          for (
            let index = 0;
            index < ordered.length;
            index++
          ) {
            const stop =
              ordered[index];

            const routeStop =
              routeStopByStopId.get(
                stop.id
              );

            await tx.routeStop.update({
              where: {
                id: routeStop.id
              },

              data: {
                sequence:
                  index + 1
              }
            });
          }
        }
      );

      res.json({
        message:
          'Route optimized with nearest-neighbour heuristic',

        ordered:
          ordered.map(
            (stop) => stop.name
          )
      });

    } catch (error) {
      next(error);
    }
  }
);


router.patch('/:id/safety-settings', auth, allow('ADMIN'), async (req, res) => {
  try {
    const route = await prisma.route.findUnique({ where: { id: req.params.id } });
    if (!route) return res.status(404).json({ message: 'Route not found' });

    const data = {};
    if (req.body.speedLimitKmph !== undefined) {
      const speedLimitKmph = Number(req.body.speedLimitKmph);
      if (!Number.isFinite(speedLimitKmph) || speedLimitKmph < 10 || speedLimitKmph > 120) {
        return res.status(400).json({ message: 'Speed limit must be between 10 and 120 km/h.' });
      }
      data.speedLimitKmph = speedLimitKmph;
    }

    if (req.body.arrivalAlertMinutes !== undefined) {
      const arrivalAlertMinutes = Math.round(Number(req.body.arrivalAlertMinutes));
      if (!Number.isFinite(arrivalAlertMinutes) || arrivalAlertMinutes < 1 || arrivalAlertMinutes > 30) {
        return res.status(400).json({ message: 'Arrival alert must be between 1 and 30 minutes.' });
      }
      data.arrivalAlertMinutes = arrivalAlertMinutes;
    }

    if (!Object.keys(data).length) {
      return res.status(400).json({ message: 'No safety settings were provided.' });
    }

    const updated = await prisma.route.update({
      where: { id: route.id },
      data,
      include: {
        stops: { include: { stop: true }, orderBy: { sequence: 'asc' } },
        assignedBus: true,
        assignedDriver: { select: { id: true, name: true, phone: true } }
      }
    });

    res.json({ message: 'Route safety settings updated.', route: updated });
  } catch (error) {
    console.error('Route safety settings error:', error);
    res.status(500).json({ message: 'Could not update route safety settings.' });
  }
});

router.get('/:id/temporary-drivers', auth, allow('ADMIN'), async (req, res) => {
  await syncTemporaryDriverAssignments(req.app.get('io'));

  const route = await prisma.route.findUnique({
    where: { id: req.params.id },
    select: { id: true, code: true, name: true },
  });

  if (!route) return res.status(404).json({ message: 'Route not found' });

  const assignments = await prisma.temporaryDriverAssignment.findMany({
    where: { routeId: route.id },
    include: {
      originalDriver: { select: { id: true, name: true, phone: true } },
      temporaryDriver: {
        select: {
          id: true,
          name: true,
          phone: true,
          driverProfile: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.json({ route, assignments });
});

router.post('/:id/temporary-driver', auth, allow('ADMIN'), async (req, res) => {
  try {
    await syncTemporaryDriverAssignments(req.app.get('io'));

    const { temporaryDriverId, startsAt, endsAt, reason } = req.body || {};
    if (!temporaryDriverId || !startsAt || !endsAt || !String(reason || '').trim()) {
      return res.status(400).json({
        message: 'Temporary driver, start time, end time and reason are required.',
      });
    }

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Enter valid temporary assignment dates.' });
    }
    if (end <= start) {
      return res.status(400).json({ message: 'End time must be after the start time.' });
    }
    if (end <= new Date()) {
      return res.status(400).json({ message: 'Temporary assignment must end in the future.' });
    }

    const [route, driver] = await Promise.all([
      prisma.route.findUnique({
        where: { id: req.params.id },
        include: { assignedDriver: { select: { id: true, name: true, phone: true } } },
      }),
      prisma.user.findUnique({
        where: { id: temporaryDriverId },
        include: { driverProfile: true },
      }),
    ]);

    if (!route) return res.status(404).json({ message: 'Route not found' });
    if (!driver || driver.role !== 'DRIVER') {
      return res.status(400).json({ message: 'Select a valid driver.' });
    }
    if (driver.driverProfile?.licenseStatus !== 'VERIFIED') {
      return res.status(400).json({
        message: 'Only drivers with a VERIFIED license can be assigned temporarily.',
      });
    }
    if (route.assignedDriverId === temporaryDriverId) {
      return res.status(400).json({ message: 'That driver is already assigned to this route.' });
    }

    const overlap = await prisma.temporaryDriverAssignment.findFirst({
      where: {
        routeId: route.id,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        startsAt: { lt: end },
        endsAt: { gt: start },
      },
    });

    if (overlap) {
      return res.status(409).json({
        message: 'This route already has a temporary driver assignment during that time.',
      });
    }

    const assignment = await prisma.temporaryDriverAssignment.create({
      data: {
        routeId: route.id,
        originalDriverId: route.assignedDriverId || null,
        temporaryDriverId,
        reason: String(reason).trim(),
        startsAt: start,
        endsAt: end,
      },
      include: {
        originalDriver: { select: { id: true, name: true, phone: true } },
        temporaryDriver: { select: { id: true, name: true, phone: true, driverProfile: true } },
      },
    });

    await prisma.notification.create({
      data: {
        userId: temporaryDriverId,
        type: 'GENERAL',
        title: 'Temporary route assignment',
        message: `You are assigned to ${route.code} · ${route.name} from ${start.toLocaleString('en-IN')} until ${end.toLocaleString('en-IN')}. Reason: ${String(reason).trim()}`,
      },
    });

    await syncTemporaryDriverAssignments(req.app.get('io'));

    const refreshed = await prisma.temporaryDriverAssignment.findUnique({
      where: { id: assignment.id },
      include: {
        originalDriver: { select: { id: true, name: true, phone: true } },
        temporaryDriver: { select: { id: true, name: true, phone: true, driverProfile: true } },
      },
    });

    res.status(201).json({
      message: refreshed?.status === 'ACTIVE'
        ? 'Temporary driver is now active on this route.'
        : 'Temporary driver assignment scheduled.',
      assignment: refreshed,
    });
  } catch (error) {
    console.error('Temporary driver assignment error:', error);
    res.status(500).json({ message: 'Could not assign temporary driver.' });
  }
});

router.post('/:id/temporary-driver/:assignmentId/cancel', auth, allow('ADMIN'), async (req, res) => {
  try {
    await syncTemporaryDriverAssignments(req.app.get('io'));

    const assignment = await prisma.temporaryDriverAssignment.findFirst({
      where: {
        id: req.params.assignmentId,
        routeId: req.params.id,
      },
      include: { route: true },
    });

    if (!assignment) return res.status(404).json({ message: 'Temporary assignment not found.' });
    if (!['SCHEDULED', 'ACTIVE'].includes(assignment.status)) {
      return res.status(409).json({ message: 'This temporary assignment has already ended.' });
    }

    await prisma.$transaction(async tx => {
      if (assignment.status === 'ACTIVE') {
        await tx.route.updateMany({
          where: {
            id: assignment.routeId,
            assignedDriverId: assignment.temporaryDriverId,
          },
          data: { assignedDriverId: assignment.originalDriverId || null },
        });
      }

      await tx.temporaryDriverAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          restoredAt: assignment.status === 'ACTIVE' ? new Date() : null,
        },
      });

      await tx.routeChange.create({
        data: {
          routeId: assignment.routeId,
          reason: `Temporary driver assignment cancelled: ${assignment.reason}`,
          fromBusId: assignment.route.assignedBusId,
          toBusId: assignment.route.assignedBusId,
          fromDriverId: assignment.status === 'ACTIVE' ? assignment.temporaryDriverId : assignment.originalDriverId,
          toDriverId: assignment.originalDriverId || null,
        },
      });
    });

    req.app.get('io')?.emit('route:temporary-driver', {
      routeId: assignment.routeId,
      assignmentId: assignment.id,
      status: 'CANCELLED',
    });

    res.json({ message: 'Temporary driver assignment ended/cancelled.' });
  } catch (error) {
    console.error('Cancel temporary driver error:', error);
    res.status(500).json({ message: 'Could not end temporary driver assignment.' });
  }
});

router.post('/:id/reassign', auth, allow('ADMIN'), async (req, res) => {
  const { busId, driverId, reason = 'Operational reassignment', busNumber } = req.body;
  await syncTemporaryDriverAssignments(req.app.get('io'));
  const route = await prisma.route.findUnique({ where: { id: req.params.id } });
  if (!route) return res.status(404).json({ message: 'Route not found' });
  const activeTemporary = await prisma.temporaryDriverAssignment.findFirst({
    where: { routeId: route.id, status: 'ACTIVE' },
  });
  if (activeTemporary) {
    return res.status(409).json({
      message: 'End the active temporary driver assignment before permanently reassigning this route.',
    });
  }
  if (busId && !await prisma.vehicle.findFirst({ where: { id: busId, status: 'ACTIVE' } })) return res.status(409).json({ message: 'Only ACTIVE buses can be assigned to routes.' });
  if (busId && busNumber) await prisma.vehicle.update({ where: { id: busId }, data: { busNumber: String(busNumber).trim() } });
  await prisma.$transaction([
    prisma.route.update({ where: { id: route.id }, data: { assignedBusId: busId || null, assignedDriverId: driverId || null } }),
    prisma.routeChange.create({ data: { routeId: route.id, reason, fromBusId: route.assignedBusId, toBusId: busId || null, fromDriverId: route.assignedDriverId, toDriverId: driverId || null } })
  ]);
  res.json({ message: 'Route dynamically reassigned' });
});

export default router;

