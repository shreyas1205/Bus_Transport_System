import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import {
  activateAutonomousEmergencyResponse,
  isAutonomousDispatchEligible,
  scheduleDriverNonResponseEscalation
} from '../services/emergencyResponse.js';

const router = express.Router();

const VERIFICATION_WINDOW_MS = 30 * 1000;
const ACCIDENT_THRESHOLD = 0.55;

// ======================================================
// HELPERS
// ======================================================

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function calculateAccidentRisk({
  speedBefore,
  speedAfter,
  impactGForce,
  tiltDegrees
}) {
  const before = Math.max(0, numberOrNull(speedBefore) ?? 0);
  const after = Math.max(0, numberOrNull(speedAfter) ?? 0);
  const impact = Math.abs(numberOrNull(impactGForce) ?? 0);
  const tilt = Math.abs(numberOrNull(tiltDegrees) ?? 0);

  const speedDrop = Math.max(0, before - after);

  const suddenStopDetected =
    before >= 20 &&
    (
      speedDrop >= 20 ||
      after <= before * 0.25
    );

  const impactDetected = impact >= 3;

  const rolloverDetected = tilt >= 65;

  let score = 0;

  if (suddenStopDetected) {
    score += 0.30;
  }

  if (impactDetected) {
    score += 0.45;
  }

  if (rolloverDetected) {
    score += 0.35;
  }

  if (impact >= 5) {
    score += 0.20;
  }

  if (tilt >= 80) {
    score += 0.10;
  }

  if (speedDrop >= 40) {
    score += 0.10;
  }

  score = Math.min(1, score);

  return {
    confidence: Number(score.toFixed(2)),
    suddenStopDetected,
    impactDetected,
    rolloverDetected,
    speedDrop
  };
}

async function notifyAdmins({
  title,
  message
}) {
  try {
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN'
      },
      select: {
        id: true
      }
    });

    if (!admins.length) {
      return;
    }

    await prisma.notification.createMany({
      data: admins.map((admin) => ({
        userId: admin.id,
        type: 'GENERAL',
        title,
        message
      }))
    });
  } catch (error) {
    console.error('Admin notification failed:', error);
  }
}

async function notifyParentsForConfirmedAccident(incident) {
  try {
    if (!incident.vehicleId) {
      return {
        affectedStudents: 0,
        onboardStudents: 0,
        parentsNotified: 0
      };
    }

    // ======================================================
    // 1. FIND STUDENTS CURRENTLY ONBOARD
    // ======================================================

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const boardingEvents = await prisma.boardingEvent.findMany({
      where: {
        vehicleId: incident.vehicleId,
        scannedAt: {
          gte: startOfToday
        },
        user: {
          role: 'STUDENT'
        }
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            institutionId: true
          }
        }
      },
      orderBy: {
        scannedAt: 'asc'
      }
    });

    /*
      For each student, only the latest boarding event matters.
      If the latest event is BOARDED, we consider the student
      currently onboard.
    */

    const latestByStudent = new Map();

    for (const event of boardingEvents) {
      latestByStudent.set(event.userId, event);
    }

    const onboardEvents = [...latestByStudent.values()].filter(
      (event) => event.status === 'BOARDED'
    );

    // ======================================================
    // 2. FIND ACTIVE ROUTES USING THE AFFECTED BUS
    // ======================================================

    const routes = await prisma.route.findMany({
      where: {
        assignedBusId: incident.vehicleId,
        isActive: true
      },
      select: {
        id: true
      }
    });

    const routeIds = routes.map((route) => route.id);

    // ======================================================
    // 3. FIND STUDENTS ASSIGNED TO THOSE ROUTES
    // ======================================================

    let routeStudents = [];

    if (routeIds.length > 0) {
      routeStudents = await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          assignedRouteId: {
            in: routeIds
          }
        },
        select: {
          id: true,
          name: true,
          institutionId: true
        }
      });
    }

    // ======================================================
    // 4. COMBINE ONBOARD + ROUTE-ASSIGNED STUDENTS
    // ======================================================

    /*
      Emergency notifications should not depend only on whether
      a QR boarding scan happened today.

      We therefore notify parents when their linked student is:

      1. currently onboard according to boarding records, OR
      2. assigned to an active route using the affected bus.
    */

    const affectedStudentIds = new Set();

    for (const event of onboardEvents) {
      if (event.user?.id) {
        affectedStudentIds.add(event.user.id);
      }

      if (event.user?.institutionId) {
        affectedStudentIds.add(event.user.institutionId);
      }
    }

    for (const student of routeStudents) {
      if (student.id) {
        affectedStudentIds.add(student.id);
      }

      if (student.institutionId) {
        affectedStudentIds.add(student.institutionId);
      }
    }

    if (!affectedStudentIds.size) {
      return {
        affectedStudents: 0,
        onboardStudents: onboardEvents.length,
        parentsNotified: 0
      };
    }

    // ======================================================
    // 5. FIND PARENTS LINKED TO AFFECTED STUDENTS
    // ======================================================

    /*
      In the current NaviGuard database ParentProfile.studentId
      may contain either:

      - the student's User ID
      - the student's institution ID

      Support both formats.
    */

    const parents = await prisma.user.findMany({
      where: {
        role: 'PARENT'
      },
      include: {
        parentProfile: true
      }
    });

    const relevantParents = parents.filter((parent) => {
      const linkedStudent = parent.parentProfile?.studentId;

      return (
        linkedStudent &&
        affectedStudentIds.has(linkedStudent)
      );
    });

    if (!relevantParents.length) {
      return {
        affectedStudents: affectedStudentIds.size,
        onboardStudents: onboardEvents.length,
        parentsNotified: 0
      };
    }

    // ======================================================
    // 6. BUILD EMERGENCY MESSAGE
    // ======================================================

    const busLabel =
      incident.vehicle?.busNumber ||
      incident.vehicle?.registrationNo ||
      'Campus bus';

    let locationText = '';

    if (
      incident.latitude !== null &&
      incident.latitude !== undefined &&
      incident.longitude !== null &&
      incident.longitude !== undefined
    ) {
      locationText =
        ` Location: https://maps.google.com/?q=${incident.latitude},${incident.longitude}`;
    }

    // ======================================================
    // 7. CREATE PARENT NOTIFICATIONS
    // ======================================================

    await prisma.notification.createMany({
      data: relevantParents.map((parent) => ({
        userId: parent.id,
        type: 'GENERAL',
        title: 'Confirmed NaviGuard Emergency',
        message:
          `${busLabel} has reported a confirmed accident. ` +
          `Campus transport administration has been alerted.` +
          locationText
      }))
    });

    return {
      affectedStudents: affectedStudentIds.size,
      onboardStudents: onboardEvents.length,
      parentsNotified: relevantParents.length
    };
  } catch (error) {
    console.error(
      'Parent accident notification failed:',
      error
    );

    return {
      affectedStudents: 0,
      onboardStudents: 0,
      parentsNotified: 0
    };
  }
}



async function getIncidentWithVehicle(id) {
  return prisma.incident.findUnique({
    where: {
      id
    },
    include: {
      vehicle: true,
      driver: {
        select: {
          id: true,
          name: true,
          phone: true
        }
      }
    }
  });
}


// ======================================================
// DRIVER SOS
// ======================================================

router.post(
  '/sos',
  auth,
  allow('DRIVER'),
  async (req, res) => {
    try {
      const incident = await prisma.incident.create({
        data: {
          driverId: req.user.id,

          vehicleId:
            req.body.vehicleId ||
            null,

          type:
            req.body.type ||
            'SOS',

          priority: 10,

          message:
            req.body.message ||
            'Driver triggered emergency SOS',

          latitude:
            numberOrNull(req.body.latitude),

          longitude:
            numberOrNull(req.body.longitude)
        }
      });

      req.app.get('io')?.emit(
        'sos:alert',
        incident
      );

      await notifyAdmins({
        title: 'Driver SOS Alert',
        message: incident.message
      });

      res.status(201).json(incident);
    } catch (error) {
      console.error('SOS error:', error);

      res.status(500).json({
        message: 'Unable to create SOS incident'
      });
    }
  }
);


// ======================================================
// ACCIDENT SENSOR DETECTION
// ======================================================
//
// IMPORTANT:
//
// This is currently a rule-based accident risk engine.
// It is not claiming to be a trained ML model.
//
// Later we can replace calculateAccidentRisk() with a
// machine-learning model while keeping the same API.
// ======================================================

router.post(
  '/accident-detection',
  auth,
  allow('DRIVER'),
  async (req, res) => {
    try {
      const {
        vehicleId,
        speedBefore,
        speedAfter,
        impactGForce,
        tiltDegrees,
        latitude,
        longitude
      } = req.body;

      if (!vehicleId) {
        return res.status(400).json({
          message: 'vehicleId is required'
        });
      }

      const vehicle = await prisma.vehicle.findUnique({
        where: {
          id: vehicleId
        }
      });

      if (!vehicle) {
        return res.status(404).json({
          message: 'Vehicle not found'
        });
      }

      const result = calculateAccidentRisk({
        speedBefore,
        speedAfter,
        impactGForce,
        tiltDegrees
      });

      /*
        Low-risk sensor activity does NOT create an emergency incident.
        This helps suppress false alarms.
      */
      if (result.confidence < ACCIDENT_THRESHOLD) {
        return res.json({
          possibleAccident: false,

          confidence:
            result.confidence,

          threshold:
            ACCIDENT_THRESHOLD,

          signals: {
            suddenStopDetected:
              result.suddenStopDetected,

            impactDetected:
              result.impactDetected,

            rolloverDetected:
              result.rolloverDetected,

            speedDrop:
              result.speedDrop
          },

          message:
            'Sensor data does not currently indicate a probable accident'
        });
      }

      const verificationDeadline =
        new Date(
          Date.now() +
          VERIFICATION_WINDOW_MS
        );

      const incident =
        await prisma.incident.create({
          data: {
            driverId:
              req.user.id,

            vehicleId,

            type:
              'CRASH',

            status:
              'OPEN',

            priority:
              result.confidence >= 0.8
                ? 10
                : 8,

            message:
              'Possible bus accident detected. NaviGuard is evaluating autonomous emergency escalation.',

            latitude:
              numberOrNull(latitude),

            longitude:
              numberOrNull(longitude),

            aiConfidence:
              result.confidence,

            speedBefore:
              numberOrNull(speedBefore),

            speedAfter:
              numberOrNull(speedAfter),

            impactGForce:
              numberOrNull(impactGForce),

            tiltDegrees:
              numberOrNull(tiltDegrees),

            suddenStopDetected:
              result.suddenStopDetected,

            impactDetected:
              result.impactDetected,

            rolloverDetected:
              result.rolloverDetected,

            detectionSignals: {
              speedDrop:
                result.speedDrop,

              threshold:
                ACCIDENT_THRESHOLD,

              algorithm:
                'RULE_BASED_V1'
            },

            verificationStatus:
              'PENDING',

            verificationDeadline,

            emergencyDispatchStatus:
              'PENDING'
          },
          include: {
            vehicle: true,
            driver: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          }
        });

      const autonomousDispatchTriggered =
        isAutonomousDispatchEligible(incident);

      if (autonomousDispatchTriggered) {
        void activateAutonomousEmergencyResponse({
          incidentId: incident.id,
          io: req.app.get('io'),
          activationReason: 'HIGH_CONFIDENCE_SENSOR_ACCIDENT'
        }).catch(error => {
          console.error(
            'Autonomous sensor emergency response failed:',
            error
          );
        });
      } else {
        req.app.get('io')?.emit(
          'accident:possible',
          incident
        );

        await notifyAdmins({
          title:
            'Possible Bus Accident',

          message:
            `Possible accident detected with confidence ` +
            `${Math.round(result.confidence * 100)}%. ` +
            `Driver/admin verification is still required.`
        });

        scheduleDriverNonResponseEscalation({
          incidentId: incident.id,
          verificationDeadline,
          io: req.app.get('io')
        });
      }

      return res.status(201).json({
        possibleAccident: true,

        requiresVerification: !autonomousDispatchTriggered,

        autonomousDispatchTriggered,

        verificationWindowSeconds:
          autonomousDispatchTriggered
            ? 0
            : VERIFICATION_WINDOW_MS / 1000,

        incident
      });
    } catch (error) {
      console.error(
        'Accident detection error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to process accident sensor data'
      });
    }
  }
);


// ======================================================
// GET PENDING ACCIDENT VERIFICATIONS
// ======================================================

router.get(
  '/pending-verification',
  auth,
  allow('ADMIN', 'DRIVER'),
  async (req, res) => {
    try {
      const where = {
        type: 'CRASH',
        verificationStatus: 'PENDING'
      };

      if (req.user.role === 'DRIVER') {
        where.driverId = req.user.id;
      }

      const incidents =
        await prisma.incident.findMany({
          where,

          include: {
            vehicle: true,

            driver: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          },

          orderBy: {
            createdAt: 'desc'
          }
        });

      res.json(incidents);
    } catch (error) {
      console.error(
        'Pending incident error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to load pending accident verifications'
      });
    }
  }
);


// ======================================================
// DRIVER ACCIDENT RESPONSE
// ======================================================
//
// response = SAFE
// response = EMERGENCY
// ======================================================

router.patch(
  '/:id/driver-response',
  auth,
  allow('DRIVER'),
  async (req, res) => {
    try {
      const response =
        String(req.body.response || '')
          .trim()
          .toUpperCase();

      if (
        response !== 'SAFE' &&
        response !== 'EMERGENCY'
      ) {
        return res.status(400).json({
          message:
            'response must be SAFE or EMERGENCY'
        });
      }

      const existing =
        await getIncidentWithVehicle(
          req.params.id
        );

      if (!existing) {
        return res.status(404).json({
          message: 'Incident not found'
        });
      }

      if (
        existing.driverId !==
        req.user.id
      ) {
        return res.status(403).json({
          message:
            'You cannot respond to another driver incident'
        });
      }

      if (
        existing.type !== 'CRASH'
      ) {
        return res.status(400).json({
          message:
            'This response is only available for crash incidents'
        });
      }

      if (
        existing.verificationStatus !==
        'PENDING'
      ) {
        return res.status(409).json({
          message:
            'This accident has already been verified',

          verificationStatus:
            existing.verificationStatus
        });
      }

      // ==================================================
      // DRIVER SAYS "I'M SAFE"
      // ==================================================

      if (response === 'SAFE') {
        const incident =
          await prisma.incident.update({
            where: {
              id: existing.id
            },

            data: {
              driverResponse:
                'SAFE',

              verificationStatus:
                'FALSE_ALARM',

              confirmationSource:
                'DRIVER',

              falseAlarmAt:
                new Date(),

              emergencyDispatchStatus:
                'NOT_REQUIRED',

              status:
                'RESOLVED',

              resolvedAt:
                new Date(),

              message:
                'Possible accident rejected by driver as a false alarm.'
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

        req.app.get('io')?.emit(
          'accident:false-alarm',
          incident
        );

        /*
          IMPORTANT:
          No parent or emergency-service notification.
        */

        return res.json({
          message:
            'False alarm recorded. No emergency notifications were sent.',

          incident
        });
      }

      // ==================================================
      // DRIVER CONFIRMS EMERGENCY
      // ==================================================

      const confirmedAt =
        new Date();

      const incident =
        await prisma.incident.update({
          where: {
            id: existing.id
          },

          data: {
            driverResponse:
              'EMERGENCY',

            verificationStatus:
              'CONFIRMED',

            confirmationSource:
              'DRIVER',

            confirmedAt,

            priority:
              10,

            message:
              'Bus accident confirmed by driver.',

            emergencyDispatchStatus:
              'PENDING'
          }
        });

      const responseResult =
        await activateAutonomousEmergencyResponse({
          incidentId: incident.id,
          io: req.app.get('io'),
          force: true,
          activationReason: 'DRIVER_CONFIRMED_ACCIDENT'
        });

      return res.json({
        message:
          responseResult.dispatch?.status === 'DISPATCHED'
            ? 'Emergency confirmed and distress packet dispatched through the configured integration.'
            : 'Emergency confirmed. Autonomous emergency response activated in demo mode.',

        onboardStudents:
          responseResult.onboardStudents || 0,

        parentsNotified:
          responseResult.parentsNotified || 0,

        emergencyResources:
          responseResult.resources || null,

        dispatch:
          responseResult.dispatch || null,

        incident:
          responseResult.incident || incident
      });
    } catch (error) {
      console.error(
        'Driver accident response error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to process driver accident response'
      });
    }
  }
);


// ======================================================
// ADMIN ACCIDENT VERIFICATION
// ======================================================
//
// action = CONFIRM
// action = FALSE_ALARM
// ======================================================

router.patch(
  '/:id/verify',
  auth,
  allow('ADMIN'),
  async (req, res) => {
    try {
      const action =
        String(req.body.action || '')
          .trim()
          .toUpperCase();

      if (
        action !== 'CONFIRM' &&
        action !== 'FALSE_ALARM'
      ) {
        return res.status(400).json({
          message:
            'action must be CONFIRM or FALSE_ALARM'
        });
      }

      const existing =
        await getIncidentWithVehicle(
          req.params.id
        );

      if (!existing) {
        return res.status(404).json({
          message: 'Incident not found'
        });
      }

      if (
        existing.type !== 'CRASH'
      ) {
        return res.status(400).json({
          message:
            'Only crash incidents require accident verification'
        });
      }

      if (
        existing.verificationStatus !==
        'PENDING'
      ) {
        return res.status(409).json({
          message:
            'This accident has already been verified',

          verificationStatus:
            existing.verificationStatus
        });
      }

      // ==================================================
      // ADMIN MARKS FALSE ALARM
      // ==================================================

      if (
        action === 'FALSE_ALARM'
      ) {
        const incident =
          await prisma.incident.update({
            where: {
              id: existing.id
            },

            data: {
              verificationStatus:
                'FALSE_ALARM',

              confirmationSource:
                'ADMIN',

              falseAlarmAt:
                new Date(),

              emergencyDispatchStatus:
                'NOT_REQUIRED',

              status:
                'RESOLVED',

              resolvedAt:
                new Date(),

              message:
                'Possible accident reviewed by admin and marked as false alarm.'
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

        req.app.get('io')?.emit(
          'accident:false-alarm',
          incident
        );

        return res.json({
          message:
            'False alarm recorded. No parent or emergency notifications were sent.',

          incident
        });
      }

      // ==================================================
      // ADMIN CONFIRMS CRASH
      // ==================================================

      const confirmedAt =
        new Date();

      const incident =
        await prisma.incident.update({
          where: {
            id: existing.id
          },

          data: {
            verificationStatus:
              'CONFIRMED',

            confirmationSource:
              'ADMIN',

            confirmedAt,

            priority:
              10,

            message:
              'Bus accident confirmed by transport administrator.',

            emergencyDispatchStatus:
              'PENDING'
          }
        });

      const responseResult =
        await activateAutonomousEmergencyResponse({
          incidentId: incident.id,
          io: req.app.get('io'),
          force: true,
          activationReason: 'ADMIN_CONFIRMED_ACCIDENT'
        });

      return res.json({
        message:
          responseResult.dispatch?.status === 'DISPATCHED'
            ? 'Accident confirmed and distress packet dispatched through the configured integration.'
            : 'Accident confirmed. Autonomous emergency response activated in demo mode.',

        onboardStudents:
          responseResult.onboardStudents || 0,

        parentsNotified:
          responseResult.parentsNotified || 0,

        emergencyResources:
          responseResult.resources || null,

        dispatch:
          responseResult.dispatch || null,

        incident:
          responseResult.incident || incident
      });
    } catch (error) {
      console.error(
        'Admin accident verification error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to verify accident'
      });
    }
  }
);


// ======================================================
// ACTIVE INCIDENTS
// ======================================================

router.get(
  '/',
  auth,
  allow('ADMIN', 'DRIVER'),
  async (req, res) => {
    try {
      const where = {
        status: {
          not: 'RESOLVED'
        }
      };

      if (
        req.user.role === 'DRIVER'
      ) {
        where.driverId =
          req.user.id;
      }

      const incidents =
        await prisma.incident.findMany({
          where,

          include: {
            vehicle: true,

            driver: {
              select: {
                id: true,
                name: true,
                phone: true
              }
            }
          },

          orderBy: {
            createdAt: 'desc'
          }
        });

      res.json(incidents);
    } catch (error) {
      console.error(
        'Incident list error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to load incidents'
      });
    }
  }
);


// ======================================================
// NORMAL INCIDENT STATUS
// ======================================================

router.patch(
  '/:id/status',
  auth,
  allow('ADMIN'),
  async (req, res) => {
    try {
      const status =
        String(req.body.status || '')
          .trim()
          .toUpperCase();

      const allowedStatuses = [
        'OPEN',
        'ACKNOWLEDGED',
        'RESOLVED'
      ];

      if (
        !allowedStatuses.includes(status)
      ) {
        return res.status(400).json({
          message:
            'Invalid incident status'
        });
      }

      const existing =
        await prisma.incident.findUnique({
          where: {
            id: req.params.id
          }
        });

      if (!existing) {
        return res.status(404).json({
          message: 'Incident not found'
        });
      }

      const data = {
        status
      };

      if (
        status === 'ACKNOWLEDGED'
      ) {
        data.acknowledgedAt =
          new Date();
      }

      if (
        status === 'RESOLVED'
      ) {
        data.resolvedAt =
          new Date();
      }

      const incident =
        await prisma.incident.update({
          where: {
            id: req.params.id
          },

          data
        });

      req.app.get('io')?.emit(
        'incident:update',
        incident
      );

      res.json(incident);
    } catch (error) {
      console.error(
        'Incident status error:',
        error
      );

      res.status(500).json({
        message:
          'Unable to update incident status'
      });
    }
  }
);

export default router;