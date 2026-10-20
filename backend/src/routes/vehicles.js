import express from 'express';
import { requireVerifiedParentTransport } from '../services/parentTransportAccess.js';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { detectGpsSuddenStop } from '../services/emergencyResponse.js';

const router = express.Router();
const vehicleStatuses = ['ACTIVE', 'INACTIVE', 'BREAKDOWN', 'MAINTENANCE'];

/*
  SIMPLE GPS-BASED ACCIDENT DETECTION

  We do not assume that the college buses have
  impact, tilt or other dedicated crash sensors.

  The driver's phone/GPS provides:
  - latitude
  - longitude
  - speed

  A sudden large speed drop creates an accident candidate.
  High-confidence events can automatically activate the emergency-response
  workflow; lower-confidence events remain available for verification.
*/

// ======================================================
// GET VEHICLES
// ======================================================

router.get(
  '/',
  auth,
  requireVerifiedParentTransport,
  async (req, res) => {
    let where = {};
    if (req.user.role === 'PARENT') {
      const student = await prisma.user.findUnique({ where: { id: req.verifiedStudentId }, select: { assignedRoute: { select: { assignedBusId: true } } } });
      where = { id: { in: student?.assignedRoute?.assignedBusId ? [student.assignedRoute.assignedBusId] : [] } };
    }
    res.json(
      await prisma.vehicle.findMany({
        where,
        orderBy: {
          registrationNo: 'asc'
        }
      })
    );
  }
);


// ======================================================
// CREATE VEHICLE
// ======================================================

router.post(
  '/',
  auth,
  allow('ADMIN'),
  async (req, res) => {
    const {
      busNumber,
      registrationNo,
      model,
      capacity,
      odometerKm = 0,
      status = 'ACTIVE'
    } = req.body || {};

    if (
      !registrationNo?.trim() ||
      !model?.trim() ||
      !capacity
    ) {
      return res.status(400).json({
        message:
          'Registration number, model and capacity are required'
      });
    }

    if (!vehicleStatuses.includes(String(status).toUpperCase())) return res.status(400).json({ message: 'Invalid bus status.' });

    const normalizedBusNumber =
      busNumber?.toString().trim() || null;

    if (!normalizedBusNumber) {
      return res.status(400).json({
        message: 'Bus number is required'
      });
    }

    try {
      const vehicle =
        await prisma.vehicle.create({
          data: {
            busNumber: normalizedBusNumber,

            registrationNo:
              registrationNo
                .trim()
                .toUpperCase(),

            model: model.trim(),

            capacity:
              Number(capacity),

            odometerKm:
              Number(odometerKm || 0),

            status:
              String(status || 'ACTIVE')
                .toUpperCase()
          }
        });

      res.status(201).json(vehicle);
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          message:
            'Bus number or registration number already exists'
        });
      }

      throw error;
    }
  }
);


// ======================================================
// UPDATE VEHICLE
// ======================================================

router.patch(
  '/:id',
  auth,
  allow('ADMIN'),
  async (req, res) => {
    const data = {};

    for (
      const key of [
        'busNumber',
        'registrationNo',
        'model',
        'status'
      ]
    ) {
      if (req.body?.[key] !== undefined) {
        data[key] =
          String(req.body[key]).trim();
      }
    }

    if (req.body?.capacity !== undefined) {
      data.capacity =
        Number(req.body.capacity);
    }

    if (req.body?.odometerKm !== undefined) {
      data.odometerKm =
        Number(req.body.odometerKm);
    }

    if (data.status !== undefined) {
      data.status = data.status.toUpperCase();
      if (!vehicleStatuses.includes(data.status)) return res.status(400).json({ message: 'Invalid bus status.' });
      const current = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
      if (!current) return res.status(404).json({ message: 'Bus not found.' });
      if (data.status === 'ACTIVE' && (!(Number(data.capacity ?? current.capacity) > 0) || !String(data.registrationNo ?? current.registrationNo).trim() || !String(data.model ?? current.model).trim())) return res.status(409).json({ message: 'Bus needs a registration, model and positive capacity before reactivation.' });
    }
    try {
      res.json(
        await prisma.vehicle.update({
          where: {
            id: req.params.id
          },
          data
        })
      );
    } catch (error) {
      if (error.code === 'P2002') {
        return res.status(409).json({
          message:
            'Bus number or registration number already exists'
        });
      }

      if (error.code === 'P2025') return res.status(404).json({ message: 'Bus not found.' });
      throw error;
    }
  }
);

router.delete('/:id', auth, allow('ADMIN'), async (req, res) => {
  try {
    await prisma.$transaction(async tx => {
      // Lock dependent tables too: boarding and route-change bus IDs have no foreign keys.
      await tx.$executeRawUnsafe('LOCK TABLE "Vehicle", "Route", "VehicleLocation", "VehicleService", "Incident", "BoardingEvent", "RouteChange" IN SHARE ROW EXCLUSIVE MODE');
      const id = req.params.id;
      if (!await tx.vehicle.findUnique({ where: { id } })) throw Object.assign(new Error('Bus not found.'), { status: 404 });
      const counts = await Promise.all([
        tx.route.count({ where: { assignedBusId: id } }),
        tx.vehicleLocation.count({ where: { vehicleId: id } }),
        tx.vehicleService.count({ where: { vehicleId: id } }),
        tx.incident.count({ where: { vehicleId: id } }),
        tx.boardingEvent.count({ where: { vehicleId: id } }),
        tx.routeChange.count({ where: { OR: [{ fromBusId: id }, { toBusId: id }] } }),
      ]);
      if (counts.some(Boolean)) throw Object.assign(new Error('Bus has operational or historical records. Deactivate it instead to preserve history.'), { status: 409 });
      await tx.vehicle.delete({ where: { id } });
    });
    res.json({ message: 'Bus deleted.' });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (['P2003', 'P2034'].includes(error.code)) return res.status(409).json({ message: 'Bus is in use. Deactivate it instead.' });
    throw error;
  }
});

// ======================================================
// GPS LOCATION UPDATE + ACCIDENT DETECTION
// ======================================================

router.post(
  '/:id/location',
  auth,
  allow('DRIVER', 'ADMIN'),
  async (req, res) => {
    try {
      const {
        latitude,
        longitude,
        speedKmph = 0
      } = req.body;

      const lat = Number(latitude);
      const lng = Number(longitude);
      const currentSpeed =
        Math.max(0, Number(speedKmph) || 0);


      // --------------------------------------------------
      // VALIDATE GPS
      // --------------------------------------------------

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
      ) {
        return res.status(400).json({
          message:
            'Valid latitude and longitude are required'
        });
      }


      // --------------------------------------------------
      // VERIFY DRIVER IS ASSIGNED TO BUS
      // --------------------------------------------------

      if (req.user.role === 'DRIVER') {
        return res.status(403).json({ message: 'Use active trip GPS sharing at /live-location/update.' });

      }


      // --------------------------------------------------
      // GET PREVIOUS GPS RECORD BEFORE SAVING NEW ONE
      // --------------------------------------------------

      const operationalBus = await prisma.vehicle.findUnique({ where: { id: req.params.id } });
      if (!operationalBus || operationalBus.status !== 'ACTIVE') return res.status(409).json({ message: 'Only ACTIVE buses can perform trip operations.' });

      const previousLocation =
        await prisma.vehicleLocation.findFirst({
          where: {
            vehicleId: req.params.id
          },

          orderBy: {
            recordedAt: 'desc'
          }
        });


      // --------------------------------------------------
      // UPDATE VEHICLE
      // --------------------------------------------------

      const vehicle =
        await prisma.vehicle.update({
          where: {
            id: req.params.id
          },

          data: {
            latitude: lat,
            longitude: lng,
            speedKmph: currentSpeed
          }
        });


      // --------------------------------------------------
      // STORE LOCATION HISTORY
      // --------------------------------------------------

      await prisma.vehicleLocation.create({
        data: {
          vehicleId: vehicle.id,
          latitude: lat,
          longitude: lng,
          speedKmph: currentSpeed
        }
      });


      // --------------------------------------------------
      // LIVE LOCATION SOCKET UPDATE
      // --------------------------------------------------

      req.app.get('io')?.emit(
        'vehicle:location',
        {}
      );


      // --------------------------------------------------
      // GPS ACCIDENT DETECTION + AUTONOMOUS RESPONSE
      // --------------------------------------------------

      const accidentDetection =
        await detectGpsSuddenStop({
          vehicleId: vehicle.id,
          driverId:
            req.user.role === 'DRIVER'
              ? req.user.id
              : null,
          latitude: lat,
          longitude: lng,
          currentSpeed,
          previousLocation,
          io: req.app.get('io')
        });


      // --------------------------------------------------
      // RESPONSE
      // --------------------------------------------------

      res.json({
        vehicle,

        accidentDetection
      });

    } catch (error) {
      console.error(
        'Vehicle location update error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to update vehicle location'
      });
    }
  }
);


export default router;