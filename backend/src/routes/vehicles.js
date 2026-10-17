import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

/*
  SIMPLE GPS-BASED ACCIDENT DETECTION

  We do not assume that the college buses have
  impact, tilt or other dedicated crash sensors.

  The driver's phone/GPS provides:
  - latitude
  - longitude
  - speed

  A sudden large speed drop creates a POSSIBLE accident.
  It does NOT immediately notify parents/emergency services.
*/

const MIN_SPEED_FOR_ACCIDENT_CHECK = 35;
const MIN_SPEED_DROP = 30;
const LOW_SPEED_AFTER_DROP = 8;
const VERIFICATION_WINDOW_MS = 45 * 1000;
const ACCIDENT_COOLDOWN_MS = 2 * 60 * 1000;


// ======================================================
// GET VEHICLES
// ======================================================

router.get(
  '/',
  auth,
  async (req, res) => {
    res.json(
      await prisma.vehicle.findMany({
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

      throw error;
    }
  }
);


// ======================================================
// GPS LOCATION UPDATE + SIMPLE ACCIDENT DETECTION
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
        const assigned =
          await prisma.route.findFirst({
            where: {
              assignedDriverId:
                req.user.id,

              assignedBusId:
                req.params.id,

              isActive: true
            }
          });

        if (!assigned) {
          return res.status(403).json({
            message:
              'This driver is not assigned to this bus'
          });
        }
      }


      // --------------------------------------------------
      // GET PREVIOUS GPS RECORD BEFORE SAVING NEW ONE
      // --------------------------------------------------

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
        {
          vehicleId: vehicle.id,
          latitude: vehicle.latitude,
          longitude: vehicle.longitude,
          speedKmph: vehicle.speedKmph
        }
      );


      // --------------------------------------------------
      // SIMPLE GPS-BASED ACCIDENT CHECK
      // --------------------------------------------------

      let possibleAccident = false;
      let incident = null;
      let speedDrop = 0;

      if (previousLocation) {
        const previousSpeed =
          Math.max(
            0,
            Number(
              previousLocation.speedKmph
            ) || 0
          );

        speedDrop =
          Math.max(
            0,
            previousSpeed - currentSpeed
          );

        /*
          Example:

          Previous speed = 48 km/h
          Current speed  = 4 km/h
          Drop           = 44 km/h

          This is suspicious enough to request
          confirmation from the driver.
        */

        const suspiciousStop =
          previousSpeed >=
            MIN_SPEED_FOR_ACCIDENT_CHECK &&
          speedDrop >= MIN_SPEED_DROP &&
          currentSpeed <=
            LOW_SPEED_AFTER_DROP;

        if (suspiciousStop) {

          // ----------------------------------------------
          // PREVENT DUPLICATE ACCIDENT ALERTS
          // ----------------------------------------------

          const cooldownStart =
            new Date(
              Date.now() -
              ACCIDENT_COOLDOWN_MS
            );

          const recentIncident =
            await prisma.incident.findFirst({
              where: {
                vehicleId: vehicle.id,
                type: 'CRASH',

                createdAt: {
                  gte: cooldownStart
                },

                verificationStatus: {
                  in: [
                    'PENDING',
                    'CONFIRMED'
                  ]
                }
              },

              orderBy: {
                createdAt: 'desc'
              }
            });


          if (!recentIncident) {
            possibleAccident = true;

            /*
              This is NOT ML confidence.

              It is only a simple rule-based
              severity score for the demo.
            */

            let confidence = 0.60;

            if (speedDrop >= 40) {
              confidence += 0.15;
            }

            if (currentSpeed <= 3) {
              confidence += 0.10;
            }

            confidence =
              Math.min(
                0.95,
                confidence
              );


            const verificationDeadline =
              new Date(
                Date.now() +
                VERIFICATION_WINDOW_MS
              );


            incident =
              await prisma.incident.create({
                data: {
                  driverId:
                    req.user.role === 'DRIVER'
                      ? req.user.id
                      : null,

                  vehicleId:
                    vehicle.id,

                  type:
                    'CRASH',

                  status:
                    'OPEN',

                  priority:
                    confidence >= 0.8
                      ? 10
                      : 8,

                  message:
                    'Possible accident detected from an unusual GPS speed drop. Driver confirmation required.',

                  latitude:
                    lat,

                  longitude:
                    lng,

                  aiConfidence:
                    Number(
                      confidence.toFixed(2)
                    ),

                  speedBefore:
                    previousSpeed,

                  speedAfter:
                    currentSpeed,

                  suddenStopDetected:
                    true,

                  impactDetected:
                    false,

                  rolloverDetected:
                    false,

                  detectionSignals: {
                    source:
                      'PHONE_GPS',

                    speedDrop,

                    previousSpeed,

                    currentSpeed,

                    algorithm:
                      'GPS_SUDDEN_STOP_V1'
                  },

                  verificationStatus:
                    'PENDING',

                  verificationDeadline,

                  emergencyDispatchStatus:
                    'NOT_REQUIRED'
                },

                include: {
                  vehicle: true,

                  driver: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              });


            // ----------------------------------------------
            // POSSIBLE ACCIDENT ONLY
            // ----------------------------------------------
            //
            // Parents and emergency services are NOT
            // contacted here.
            // ----------------------------------------------

            req.app.get('io')?.emit(
              'accident:possible',
              incident
            );


            // Notify admins inside the app.

            try {
              const admins =
                await prisma.user.findMany({
                  where: {
                    role: 'ADMIN'
                  },

                  select: {
                    id: true
                  }
                });

              if (admins.length) {
                await prisma.notification.createMany({
                  data:
                    admins.map(
                      admin => ({
                        userId:
                          admin.id,

                        type:
                          'GENERAL',

                        title:
                          'Possible Bus Accident',

                        message:
                          `Bus ${
                            vehicle.busNumber ||
                            vehicle.registrationNo
                          } showed an unusual speed drop ` +
                          `from ${previousSpeed} km/h to ` +
                          `${currentSpeed} km/h. ` +
                          `Waiting for driver confirmation.`
                      })
                    )
                });
              }
            } catch (notificationError) {
              console.error(
                'Possible accident notification failed:',
                notificationError
              );
            }
          }
        }
      }


      // --------------------------------------------------
      // RESPONSE
      // --------------------------------------------------

      res.json({
        vehicle,

        accidentDetection: {
          possibleAccident,

          previousSpeed:
            previousLocation
              ? Number(
                  previousLocation.speedKmph
                ) || 0
              : null,

          currentSpeed,

          speedDrop,

          requiresVerification:
            Boolean(incident),

          verificationWindowSeconds:
            incident
              ? VERIFICATION_WINDOW_MS /
                1000
              : null,

          incident
        }
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