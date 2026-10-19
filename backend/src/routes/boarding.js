import express from 'express';
import { requireVerifiedParentTransport } from '../services/parentTransportAccess.js';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

function indiaDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function dailyQrSecret() {
  const secret = process.env.JWT_SECRET || process.env.DAILY_QR_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET (or DAILY_QR_SECRET) must be at least 32 characters.');
  }
  return secret;
}

function verifyDailyQrToken(token) {
  const parts = String(token || '').trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'CBQR1') {
    return { ok: false, message: 'This is not a valid NaviGuard daily QR.' };
  }

  const [, encoded, suppliedSignature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', dailyQrSecret())
    .update(encoded)
    .digest('base64url');

  const a = Buffer.from(suppliedSignature);
  const b = Buffer.from(expectedSignature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, message: 'QR verification failed.' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, message: 'QR payload is invalid.' };
  }

  if (payload?.v !== 1 || !payload?.uid || !payload?.pid || !payload?.d) {
    return { ok: false, message: 'QR payload is incomplete.' };
  }

  if (payload.d !== indiaDateKey()) {
    return { ok: false, message: 'This QR has expired. Ask the student to generate today’s QR.' };
  }

  return { ok: true, payload };
}


// ======================================================
// DATE HELPERS
// ======================================================

function startOfToday() {
  return getDayRange(indiaDateKey()).start;
}

function getDayRange(dateText = indiaDateKey()) {
  const key = dateText || indiaDateKey();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const start = new Date(`${key}T00:00:00+05:30`);
  if (!Number.isFinite(start.getTime()) || indiaDateKey(start) !== key) return null;
  return { start, end: new Date(start.getTime() + 86400000) };
}

// Serialize state checks and inserts across server processes, without schema changes.
async function createJourneyEvent({ data }) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${data.userId}))`;
    const route = data.routeId ? await tx.route.findUnique({ where: { id: data.routeId } }) : null;
    const bus = data.vehicleId ? await tx.vehicle.findUnique({ where: { id: data.vehicleId } }) : null;
    if (!route?.isActive || !bus || bus.status !== 'ACTIVE') throw Object.assign(new Error('An active route and ACTIVE bus are required.'), { status: 409 });
    const events = await tx.boardingEvent.findMany({
      where: { userId: data.userId, scannedAt: { gte: startOfToday() } }
    });
    if (events.some(e => e.status === data.status || e.status === 'DROPPED_OFF')) {
      throw Object.assign(new Error('This journey event is already recorded today.'), { status: 409 });
    }
    if (data.status === 'DROPPED_OFF' && !events.some(e => e.status === 'BOARDED' && e.routeId === data.routeId)) {
      throw Object.assign(new Error('Student must be boarded before drop-off.'), { status: 409 });
    }
    return tx.boardingEvent.create({ data });
  });
}

// ======================================================
// BOARDING EVENT HELPERS
// ======================================================

async function getTodayEvent(
  userId,
  status,
  routeId = null
) {
  const where = {
    userId,
    status,

    scannedAt: {
      gte:
        startOfToday()
    }
  };

  if (routeId) {
    where.routeId =
      routeId;
  }

  return prisma.boardingEvent.findFirst({
    where,

    orderBy: {
      scannedAt:
        'desc'
    }
  });
}

async function getTodayBoarding(
  userId,
  routeId = null
) {
  return getTodayEvent(
    userId,
    'BOARDED',
    routeId
  );
}

async function getTodayDropOff(
  userId,
  routeId = null
) {
  return getTodayEvent(
    userId,
    'DROPPED_OFF',
    routeId
  );
}

// ======================================================
// DRIVER ROUTE HELPER
// ======================================================

async function getDriverRoute(driverId) {
  const now = new Date();
  const routes = await prisma.route.findMany({
    where: { isActive: true, assignedBus: { status: 'ACTIVE' }, OR: [
      { assignedDriverId: driverId },
      { temporaryDriverAssignments: { some: {
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        OR: [{ temporaryDriverId: driverId }, { originalDriverId: driverId }]
      } } }
    ] },
    include: {
      assignedBus: true,
      stops: { orderBy: { sequence: 'asc' }, include: { stop: true } },
      temporaryDriverAssignments: {
        where: { status: { in: ['SCHEDULED', 'ACTIVE'] } },
        orderBy: { startsAt: 'desc' }
      }
    }
  });
  const operational = routes.filter(route => {
    const assignments = route.temporaryDriverAssignments || [];
    const current = assignments.find(a => a.startsAt <= now && a.endsAt > now);
    const expired = assignments.find(a => a.status === 'ACTIVE' && a.endsAt <= now && route.assignedDriverId === a.temporaryDriverId);
    return (current ? current.temporaryDriverId : expired ? expired.originalDriverId : route.assignedDriverId) === driverId;
  });
  // An active replacement duty takes precedence over the driver's regular route.
  return operational.find(r => r.temporaryDriverAssignments.some(a => a.temporaryDriverId === driverId && a.startsAt <= now && a.endsAt > now)) || operational[0] || null;
}

// ======================================================
// PARENT NOTIFICATION HELPERS
// ======================================================

function formatNotificationTime(
  value
) {
  return new Date(
    value
  ).toLocaleTimeString(
    'en-IN',
    {
      hour:
        '2-digit',

      minute:
        '2-digit',

      hour12:
        true,

      timeZone:
        'Asia/Kolkata'
    }
  );
}

function getBusLabel(
  route
) {
  const value =
    route?.assignedBus
      ?.busNumber ||
    route?.assignedBus
      ?.registrationNo;

  if (!value) {
    return 'the assigned bus';
  }

  return `Bus ${value}`;
}

async function createParentJourneyNotification({
  studentId,
  studentName,
  type,
  eventTime,
  route,
  io
}) {
  try {
    // Find all parent accounts linked
    // with this student.
    const parents =
      await prisma.parentProfile.findMany({
        where: {
          studentId
        },

        select: {
          userId:
            true
        }
      });

    if (
      !parents.length
    ) {
      return;
    }

    const busLabel =
      getBusLabel(
        route
      );

    const time =
      formatNotificationTime(
        eventTime
      );

    const isDropOff =
      type ===
      'DROPOFF';

    const title =
      isDropOff
        ? 'Student dropped off'
        : 'Student boarded';

    const message =
      isDropOff
        ? `${studentName} was safely dropped off from ${busLabel} at ${time}.`
        : `${studentName} boarded ${busLabel} at ${time}.`;

    await prisma.notification.createMany({
      data:
        parents.map(
          parent => ({
            userId:
              parent.userId,

            studentId,

            type,

            title,

            message
          })
        )
    });

    // Notify connected frontend clients.
    for (
      const parent of parents
    ) {
      io?.emit(
        'notification:update',
        {
          userId:
            parent.userId
        }
      );
    }
  } catch (error) {
    /*
      Notification failure should never
      stop boarding/drop-off itself.
    */
    console.error(
      'PARENT NOTIFICATION ERROR:',
      error
    );
  }
}

async function removeTodayBoardingNotifications(
  studentId,
  io
) {
  try {
    const parents =
      await prisma.parentProfile.findMany({
        where: {
          studentId
        },

        select: {
          userId:
            true
        }
      });

    if (
      !parents.length
    ) {
      return;
    }

    const parentIds =
      parents.map(
        parent =>
          parent.userId
      );

    await prisma.notification.deleteMany({
      where: {
        userId: {
          in:
            parentIds
        },

        studentId,

        type:
          'BOARDING',

        createdAt: {
          gte:
            startOfToday()
        }
      }
    });

    for (
      const parent of parents
    ) {
      io?.emit(
        'notification:update',
        {
          userId:
            parent.userId
        }
      );
    }
  } catch (error) {
    console.error(
      'PARENT NOTIFICATION CLEANUP ERROR:',
      error
    );
  }
}

// ======================================================
// SCAN / BOARD PASSENGER
// ======================================================

router.post(
  '/scan',

  auth,

  allow(
    'DRIVER'
  ),

  async (
    req,
    res
  ) => {
    try {
      const {
        identifier,
        method = 'QR',
        routeId,
        stopId,
        vehicleId
      } = req.body || {};

      const cleanIdentifier =
        String(
          identifier || ''
        ).trim();

      if (
        !cleanIdentifier
      ) {
        return res
          .status(400)
          .json({
            status:
              'REJECTED',

            message:
              'Passenger identifier is required.'
          });
      }

      // --------------------------------------------------
      // VERIFY TODAY'S STUDENT QR
      // --------------------------------------------------

      const verifiedQr = verifyDailyQrToken(cleanIdentifier);

      if (!verifiedQr.ok) {
        return res.status(403).json({
          status: 'REJECTED',
          message: verifiedQr.message
        });
      }

      const pass = await prisma.busPass.findUnique({
        where: { id: verifiedQr.payload.pid }
      });

      if (
        !pass ||
        pass.userId !== verifiedQr.payload.uid ||
        pass.status !== 'ACTIVE' ||
        new Date(pass.validFrom) > new Date() ||
        new Date(pass.validUntil) < new Date()
      ) {
        return res.status(403).json({
          status: 'REJECTED',
          message: 'The student bus pass is inactive or expired.'
        });
      }

      // --------------------------------------------------
      // FIND PASSENGER
      // --------------------------------------------------

      const passenger = await prisma.user.findUnique({
        where: { id: verifiedQr.payload.uid }
      });

      if (
        !passenger
      ) {
        return res
          .status(404)
          .json({
            status:
              'REJECTED',

            message:
              'Student/staff identifier or bus pass not found.'
          });
      }

      if (
        ![
          'STUDENT',
          'STAFF'
        ].includes(
          passenger.role
        )
      ) {
        return res
          .status(400)
          .json({
            status:
              'REJECTED',

            message:
              'Only student or staff accounts can be boarded.'
          });
      }

      // --------------------------------------------------
      // VALIDATE PASS
      // --------------------------------------------------

      if (pass) {
        const expired =
          pass.validUntil &&
          new Date(
            pass.validUntil
          ) <
            new Date();

        if (
          pass.status !==
            'ACTIVE' ||
          expired
        ) {
          return res
            .status(403)
            .json({
              status:
                'REJECTED',

              message:
                'Bus pass is expired or inactive.'
            });
        }
      }

      let effectiveRouteId =
        routeId ||
        passenger
          .assignedRouteId ||
        null;

      let effectiveStopId =
        stopId ||
        passenger
          .pickupStopId ||
        null;

      let effectiveVehicleId =
        vehicleId ||
        null;

      // --------------------------------------------------
      // DRIVER PERMISSION
      // --------------------------------------------------

      if (
        req.user.role ===
        'DRIVER'
      ) {
        const driverRoute =
          await getDriverRoute(
            req.user.id
          );

        if (
          !driverRoute
        ) {
          return res
            .status(400)
            .json({
              status:
                'REJECTED',

              message:
                'No active route is assigned to this driver.'
            });
        }

        if (
          passenger.role ===
            'STUDENT' &&
          passenger
            .assignedRouteId !==
            driverRoute.id
        ) {
          return res
            .status(403)
            .json({
              status:
                'REJECTED',

              message:
                `${passenger.name} is not assigned to your route.`
            });
        }

        effectiveRouteId =
          driverRoute.id;

        effectiveVehicleId =
          driverRoute
            .assignedBusId ||
          null;
      }

      // --------------------------------------------------
      // GET VEHICLE FROM ROUTE
      // --------------------------------------------------

      if (
        effectiveRouteId &&
        !effectiveVehicleId
      ) {
        const route =
          await prisma.route.findUnique({
            where: {
              id:
                effectiveRouteId
            },

            select: {
              assignedBusId:
                true
            }
          });

        effectiveVehicleId =
          route
            ?.assignedBusId ||
          null;
      }

      // --------------------------------------------------
      // PREVENT DUPLICATE BOARDING
      // --------------------------------------------------

      const existingBoarding =
        await getTodayBoarding(
          passenger.id,
          effectiveRouteId
        );

      if (
        existingBoarding
      ) {
        return res
          .status(409)
          .json({
            status:
              'REJECTED',

            message:
              `${passenger.name} is already marked boarded today.`
          });
      }

      const existingDropOff =
        await getTodayDropOff(
          passenger.id,
          effectiveRouteId
        );

      if (
        existingDropOff
      ) {
        return res
          .status(409)
          .json({
            status:
              'REJECTED',

            message:
              `${passenger.name}'s journey is already completed today.`
          });
      }

      // --------------------------------------------------
      // CREATE BOARDING EVENT
      // --------------------------------------------------

      const event =
        await createJourneyEvent({
          data: {
            userId:
              passenger.id,

            identifier:
              cleanIdentifier,

            method,

            status:
              'BOARDED',

            routeId:
              effectiveRouteId,

            stopId:
              effectiveStopId,

            vehicleId:
              effectiveVehicleId
          }
        });

      // --------------------------------------------------
      // CREATE PARENT NOTIFICATION
      // --------------------------------------------------

      if (
        passenger.role ===
        'STUDENT'
      ) {
        const notificationRoute =
          effectiveRouteId
            ? await prisma.route.findUnique({
                where: {
                  id:
                    effectiveRouteId
                },

                include: {
                  assignedBus:
                    true
                }
              })
            : null;

        await createParentJourneyNotification({
          studentId:
            passenger.id,

          studentName:
            passenger.name,

          type:
            'BOARDING',

          eventTime:
            event.scannedAt,

          route:
            notificationRoute,

          io:
            req.app.get(
              'io'
            )
        });
      }

      req.app
        .get('io')
        ?.emit(
          'boarding:update'
        );

      return res.json({
        status:
          'BOARDED',

        event,

        user: {
          id:
            passenger.id,

          name:
            passenger.name,

          institutionId:
            passenger
              .institutionId,

          role:
            passenger.role
        },

        passValidated:
          Boolean(pass)
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'BOARDING SCAN ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          status:
            'REJECTED',

          message:
            'Could not process boarding scan.'
        });
    }
  }
);

// ======================================================
// TODAY'S JOURNEY EVENTS
// ======================================================

router.get(
  '/today',

  auth,

  allow(
    'ADMIN',
    'DRIVER'
  ),

  async (
    req,
    res
  ) => {
    try {
      const where = {
        scannedAt: {
          gte:
            startOfToday()
        }
      };

      if (
        req.user.role ===
        'DRIVER'
      ) {
        const route =
          await getDriverRoute(
            req.user.id
          );

        if (
          !route
        ) {
          return res.json(
            []
          );
        }

        where.routeId =
          route.id;
      }

      const events =
        await prisma.boardingEvent.findMany({
          where,

          include: {
            user: {
              select: {
                id:
                  true,

                name:
                  true,

                institutionId:
                  true,

                role:
                  true
              }
            }
          },

          orderBy: {
            scannedAt:
              'desc'
          }
        });

      return res.json(
        events
      );
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'TODAY BOARDING ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Could not load today\'s attendance.'
        });
    }
  }
);

// ======================================================
// ADMIN / FLEET JOURNEY HISTORY
// ======================================================

router.get(
  '/history',

  auth,

  allow(
    'ADMIN'
  ),

  async (
    req,
    res
  ) => {
    try {
      const dateText =
        String(
          req.query.date ||
            ''
        ).trim();

      const selectedRouteId =
        String(
          req.query.routeId ||
            ''
        ).trim();

      const range =
        getDayRange(
          dateText
        );

      if (
        !range
      ) {
        return res
          .status(400)
          .json({
            message:
              'Invalid date. Use YYYY-MM-DD.'
          });
      }

      // --------------------------------------------------
      // ROUTES
      // --------------------------------------------------

      const routeWhere =
        selectedRouteId
          ? {
              id:
                selectedRouteId
            }
          : {};

      const routes =
        await prisma.route.findMany({
          where:
            routeWhere,

          include: {
            assignedBus:
              true,

            assignedDriver: {
              select: {
                id:
                  true,

                name:
                  true,

                phone:
                  true
              }
            }
          },

          orderBy: {
            code:
              'asc'
          }
        });

      const routeIds =
        routes.map(
          route =>
            route.id
        );

      const routeMap =
        new Map(
          routes.map(
            route => [
              route.id,
              route
            ]
          )
        );

      // --------------------------------------------------
      // STUDENTS
      // --------------------------------------------------

      const studentWhere = {
        role:
          'STUDENT'
      };

      if (
        selectedRouteId
      ) {
        studentWhere
          .assignedRouteId =
          selectedRouteId;
      } else if (
        routeIds.length
      ) {
        studentWhere
          .assignedRouteId = {
          in:
            routeIds
        };
      }

      const students =
        await prisma.user.findMany({
          where:
            studentWhere,

          select: {
            id:
              true,

            name:
              true,

            institutionId:
              true,

            phone:
              true,

            assignedRouteId:
              true,

            pickupStop: {
              select: {
                id:
                  true,

                name:
                  true
              }
            }
          },

          orderBy: {
            name:
              'asc'
          }
        });

      const studentIds =
        students.map(
          student =>
            student.id
        );

      // --------------------------------------------------
      // EVENTS
      // --------------------------------------------------

      const eventWhere = {
        scannedAt: {
          gte:
            range.start,

          lt:
            range.end
        },

        status: {
          in: [
            'BOARDED',
            'DROPPED_OFF'
          ]
        },

        userId: {
          in:
            studentIds
        }
      };

      if (
        selectedRouteId
      ) {
        eventWhere.routeId =
          selectedRouteId;
      }

      const events =
        studentIds.length
          ? await prisma.boardingEvent.findMany({
              where:
                eventWhere,

              orderBy: {
                scannedAt:
                  'asc'
              }
            })
          : [];

      // --------------------------------------------------
      // GROUP EVENTS
      // --------------------------------------------------

      const eventMap =
        new Map();

      for (
        const event of events
      ) {
        if (
          !eventMap.has(
            event.userId
          )
        ) {
          eventMap.set(
            event.userId,
            []
          );
        }

        eventMap
          .get(
            event.userId
          )
          .push(
            event
          );
      }

      // --------------------------------------------------
      // BUILD RECORDS
      // --------------------------------------------------

      const records =
        students.map(
          student => {
            const studentEvents =
              eventMap.get(
                student.id
              ) || [];

            const boardedEvent =
              studentEvents.find(
                event =>
                  event.status ===
                  'BOARDED'
              ) || null;

            const droppedEvent =
              studentEvents.find(
                event =>
                  event.status ===
                  'DROPPED_OFF'
              ) || null;

            let journeyStatus =
              'NOT_BOARDED';

            if (
              boardedEvent
            ) {
              journeyStatus =
                'BOARDED';
            }

            if (
              droppedEvent
            ) {
              journeyStatus =
                'DROPPED_OFF';
            }

            const eventRouteId =
              boardedEvent
                ?.routeId ||
              droppedEvent
                ?.routeId ||
              student
                .assignedRouteId ||
              null;

            const route =
              eventRouteId
                ? routeMap.get(
                    eventRouteId
                  )
                : null;

            return {
              student: {
                id:
                  student.id,

                name:
                  student.name,

                institutionId:
                  student
                    .institutionId,

                phone:
                  student.phone
              },

              route:
                route
                  ? {
                      id:
                        route.id,

                      code:
                        route.code,

                      name:
                        route.name,

                      driver:
                        route
                          .assignedDriver
                          ? {
                              id:
                                route
                                  .assignedDriver
                                  .id,

                              name:
                                route
                                  .assignedDriver
                                  .name,

                              phone:
                                route
                                  .assignedDriver
                                  .phone
                            }
                          : null,

                      busNumber:
                        route
                          .assignedBus
                          ?.busNumber ||
                        null,

                      registrationNo:
                        route
                          .assignedBus
                          ?.registrationNo ||
                        null
                    }
                  : null,

              pickupStop:
                student
                  .pickupStop
                  ?.name ||
                null,

              status:
                journeyStatus,

              boardedAt:
                boardedEvent
                  ?.scannedAt ||
                null,

              droppedOffAt:
                droppedEvent
                  ?.scannedAt ||
                null,

              boardingMethod:
                boardedEvent
                  ?.method ||
                null
            };
          }
        );

      // --------------------------------------------------
      // SUMMARY
      // --------------------------------------------------

      const summary = {
        total:
          records.length,

        notBoarded:
          records.filter(
            record =>
              record.status ===
              'NOT_BOARDED'
          ).length,

        boarded:
          records.filter(
            record =>
              record.status ===
              'BOARDED'
          ).length,

        droppedOff:
          records.filter(
            record =>
              record.status ===
              'DROPPED_OFF'
          ).length
      };

      // --------------------------------------------------
      // ROUTE OPTIONS
      // --------------------------------------------------

      const allRoutes =
        selectedRouteId
          ? await prisma.route.findMany({
              include: {
                assignedBus:
                  true
              },

              orderBy: {
                code:
                  'asc'
              }
            })
          : routes;

      return res.json({
        date:
          dateText ||
          indiaDateKey(),

        summary,

        routes:
          allRoutes.map(
            route => ({
              id:
                route.id,

              code:
                route.code,

              name:
                route.name,

              busNumber:
                route
                  .assignedBus
                  ?.busNumber ||
                null,

              registrationNo:
                route
                  .assignedBus
                  ?.registrationNo ||
                null
            })
          ),

        records
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'BOARDING HISTORY ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Could not load daily journey history.'
        });
    }
  }
);

// ======================================================
// DRIVER ROUTE ROSTER
// ======================================================

router.get(
  '/driver-roster',

  auth,

  allow(
    'ADMIN',
    'DRIVER'
  ),

  async (
    req,
    res
  ) => {
    try {
      let route =
        null;

      if (
        req.user.role ===
        'DRIVER'
      ) {
        route =
          await getDriverRoute(
            req.user.id
          );
      } else if (
        req.query.routeId
      ) {
        route =
          await prisma.route.findUnique({
            where: {
              id:
                req.query.routeId
            },

            include: {
              assignedBus:
                true,

              stops: {
                orderBy: {
                  sequence:
                    'asc'
                },

                include: {
                  stop:
                    true
                }
              }
            }
          });
      }

      if (!route) {
        return res.json({
          route:
            null,

          students:
            []
        });
      }

      const students =
        await prisma.user.findMany({
          where: {
            role:
              'STUDENT',

            assignedRouteId:
              route.id
          },

          select: {
            id:
              true,

            name:
              true,

            institutionId:
              true,

            pickupStopId:
              true,

            pickupStop: {
              select: {
                name:
                  true
              }
            }
          },

          orderBy: {
            name:
              'asc'
          }
        });

      const ids =
        students.map(
          student =>
            student.id
        );

      const events =
        ids.length
          ? await prisma.boardingEvent.findMany({
              where: {
                userId: {
                  in:
                    ids
                },

                routeId:
                  route.id,

                scannedAt: {
                  gte:
                    startOfToday()
                },

                status: {
                  in: [
                    'BOARDED',
                    'DROPPED_OFF'
                  ]
                }
              },

              orderBy: {
                scannedAt:
                  'desc'
              }
            })
          : [];

      const boardedMap =
        new Map();

      const droppedMap =
        new Map();

      for (
        const event of events
      ) {
        if (
          event.status ===
            'BOARDED' &&
          !boardedMap.has(
            event.userId
          )
        ) {
          boardedMap.set(
            event.userId,
            event
          );
        }

        if (
          event.status ===
            'DROPPED_OFF' &&
          !droppedMap.has(
            event.userId
          )
        ) {
          droppedMap.set(
            event.userId,
            event
          );
        }
      }

      return res.json({
        route: {
          id:
            route.id,

          code:
            route.code,

          name:
            route.name,

          busNumber:
            route
              .assignedBus
              ?.busNumber ||
            null,

          registrationNo:
            route
              .assignedBus
              ?.registrationNo ||
            null
        },

        students:
          students.map(
            student => {
              const boardEvent =
                boardedMap.get(
                  student.id
                );

              const dropEvent =
                droppedMap.get(
                  student.id
                );

              let journeyStatus =
                'NOT_BOARDED';

              if (
                boardEvent
              ) {
                journeyStatus =
                  'BOARDED';
              }

              if (
                dropEvent
              ) {
                journeyStatus =
                  'DROPPED_OFF';
              }

              return {
                id:
                  student.id,

                name:
                  student.name,

                institutionId:
                  student
                    .institutionId,

                pickupStop:
                  student
                    .pickupStop
                    ?.name ||
                  '—',

                boarded:
                  Boolean(
                    boardEvent
                  ),

                boardedAt:
                  boardEvent
                    ?.scannedAt ||
                  null,

                droppedOff:
                  Boolean(
                    dropEvent
                  ),

                droppedOffAt:
                  dropEvent
                    ?.scannedAt ||
                  null,

                journeyStatus
              };
            }
          )
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'DRIVER ROSTER ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Could not load driver route roster.'
        });
    }
  }
);

// ======================================================
// MANUAL BOARD / UNBOARD
// ======================================================

router.post(
  '/toggle',

  auth,

  allow(
    'DRIVER'
  ),

  async (
    req,
    res
  ) => {
    try {
      const {
        studentId,
        boarded
      } = req.body || {};

      if (
        !studentId ||
        typeof boarded !==
          'boolean'
      ) {
        return res
          .status(400)
          .json({
            message:
              'studentId and boarded are required.'
          });
      }

      const student =
        await prisma.user.findUnique({
          where: {
            id:
              studentId
          },

          select: {
            id:
              true,

            name:
              true,

            role:
              true,

            institutionId:
              true,

            assignedRouteId:
              true,

            pickupStopId:
              true
          }
        });

      if (
        !student ||
        student.role !==
          'STUDENT'
      ) {
        return res
          .status(404)
          .json({
            message:
              'Student not found.'
          });
      }

      const route =
        student
          .assignedRouteId
          ? await prisma.route.findUnique({
              where: {
                id:
                  student
                    .assignedRouteId
              },

              include: {
                assignedBus:
                  true
              }
            })
          : null;

      if (!route) {
        return res
          .status(400)
          .json({
            message:
              'Student is not assigned to a route.'
          });
      }

      if (
        req.user.role ===
          'DRIVER' &&
        (!route.isActive || (await getDriverRoute(req.user.id))?.id !== route.id)
      ) {
        return res
          .status(403)
          .json({
            message:
              'You can only update students on your assigned route.'
          });
      }

      const existingBoarding =
        await getTodayBoarding(
          student.id,
          route.id
        );

      const existingDropOff =
        await getTodayDropOff(
          student.id,
          route.id
        );

      // --------------------------------------------------
      // MARK BOARDED
      // --------------------------------------------------

      if (boarded) {
        if (
          existingDropOff
        ) {
          return res
            .status(409)
            .json({
              message:
                `${student.name}'s journey is already completed.`
            });
        }

        if (
          existingBoarding
        ) {
          return res.json({
            student: {
              id:
                student.id,

              name:
                student.name
            },

            boarded:
              true,

            boardedAt:
              existingBoarding
                .scannedAt,

            message:
              'Already marked boarded.'
          });
        }

        const event =
          await createJourneyEvent({
            data: {
              userId:
                student.id,

              identifier:
                student
                  .institutionId ||
                student.id,

              method:
                'ID',

              status:
                'BOARDED',

              routeId:
                route.id,

              stopId:
                student
                  .pickupStopId ||
                null,

              vehicleId:
                route
                  .assignedBusId ||
                null
            }
          });

        // ----------------------------------------------
        // PARENT NOTIFICATION
        // ----------------------------------------------

        await createParentJourneyNotification({
          studentId:
            student.id,

          studentName:
            student.name,

          type:
            'BOARDING',

          eventTime:
            event.scannedAt,

          route,

          io:
            req.app.get(
              'io'
            )
        });

        req.app
          .get('io')
          ?.emit(
            'boarding:update'
          );

        return res.json({
          student: {
            id:
              student.id,

            name:
              student.name
          },

          boarded:
            true,

          boardedAt:
            event.scannedAt,

          message:
            `${student.name} marked boarded.`
        });
      }

      // --------------------------------------------------
      // UNBOARD
      // --------------------------------------------------

      if (
        existingDropOff
      ) {
        return res
          .status(409)
          .json({
            message:
              'Cannot mark the student as not boarded after drop-off has been recorded.'
          });
      }

      if (
        existingBoarding
      ) {
        await prisma.boardingEvent.delete({
          where: {
            id:
              existingBoarding.id
          }
        });

        // Remove the boarding notification
        // because the boarding was undone.
        await removeTodayBoardingNotifications(
          student.id,
          req.app.get(
            'io'
          )
        );
      }

      req.app
        .get('io')
        ?.emit(
          'boarding:update'
        );

      return res.json({
        student: {
          id:
            student.id,

          name:
            student.name
        },

        boarded:
          false,

        boardedAt:
          null,

        message:
          `${student.name} marked not boarded.`
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'BOARDING TOGGLE ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Could not update boarding status.'
        });
    }
  }
);

// ======================================================
// DROP OFF
// ======================================================

router.post(
  '/drop-off',

  auth,

  allow(
    'DRIVER'
  ),

  async (
    req,
    res
  ) => {
    try {
      const {
        studentId
      } = req.body || {};

      if (
        !studentId
      ) {
        return res
          .status(400)
          .json({
            message:
              'studentId is required.'
          });
      }

      const student =
        await prisma.user.findUnique({
          where: {
            id:
              studentId
          },

          select: {
            id:
              true,

            name:
              true,

            role:
              true,

            institutionId:
              true,

            assignedRouteId:
              true,

            pickupStopId:
              true
          }
        });

      if (
        !student ||
        student.role !==
          'STUDENT'
      ) {
        return res
          .status(404)
          .json({
            message:
              'Student not found.'
          });
      }

      if (
        !student
          .assignedRouteId
      ) {
        return res
          .status(400)
          .json({
            message:
              'Student is not assigned to a route.'
          });
      }

      const route =
        await prisma.route.findUnique({
          where: {
            id:
              student
                .assignedRouteId
          },

          include: {
            assignedBus:
              true
          }
        });

      if (
        !route
      ) {
        return res
          .status(404)
          .json({
            message:
              'Assigned route not found.'
          });
      }

      if (
        req.user.role ===
          'DRIVER' &&
        (!route.isActive || (await getDriverRoute(req.user.id))?.id !== route.id)
      ) {
        return res
          .status(403)
          .json({
            message:
              'You can only drop off students on your assigned route.'
          });
      }

      const boardingEvent =
        await getTodayBoarding(
          student.id,
          route.id
        );

      if (
        !boardingEvent
      ) {
        return res
          .status(400)
          .json({
            message:
              `${student.name} must be marked boarded before drop-off.`
          });
      }

      const existingDropOff =
        await getTodayDropOff(
          student.id,
          route.id
        );

      if (
        existingDropOff
      ) {
        return res.json({
          student: {
            id:
              student.id,

            name:
              student.name
          },

          droppedOff:
            true,

          droppedOffAt:
            existingDropOff
              .scannedAt,

          message:
            `${student.name} is already marked dropped off.`
        });
      }

      // --------------------------------------------------
      // CREATE DROP-OFF EVENT
      // --------------------------------------------------

      const event =
        await createJourneyEvent({
          data: {
            userId:
              student.id,

            identifier:
              student
                .institutionId ||
              student.id,

            method:
              'ID',

            status:
              'DROPPED_OFF',

            routeId:
              route.id,

            stopId:
              student
                .pickupStopId ||
              null,

            vehicleId:
              route
                .assignedBusId ||
              null
          }
        });

      // --------------------------------------------------
      // PARENT DROP-OFF NOTIFICATION
      // --------------------------------------------------

      await createParentJourneyNotification({
        studentId:
          student.id,

        studentName:
          student.name,

        type:
          'DROPOFF',

        eventTime:
          event.scannedAt,

        route,

        io:
          req.app.get(
            'io'
          )
      });

      req.app
        .get('io')
        ?.emit(
          'boarding:update'
        );

      return res.json({
        student: {
          id:
            student.id,

          name:
            student.name
        },

        droppedOff:
          true,

        droppedOffAt:
          event.scannedAt,

        message:
          `${student.name} marked safely dropped off.`
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'DROP OFF ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Could not record drop-off.'
        });
    }
  }
);

// ======================================================
// STUDENT / PARENT CURRENT STATUS
// ======================================================

router.get(
  '/my-status',

  auth,
  requireVerifiedParentTransport,

  allow(
    'STUDENT',
    'PARENT'
  ),

  async (
    req,
    res
  ) => {
    try {
      let studentId =
        req.user.id;

      // --------------------------------------------------
      // PARENT -> LINKED STUDENT
      // --------------------------------------------------

      if (
        req.user.role ===
        'PARENT'
      ) {
        const parent =
          await prisma.parentProfile.findUnique({
            where: {
              userId:
                req.user.id
            }
          });

        studentId =
          parent
            ?.studentId ||
          '';
      }

      if (
        !studentId
      ) {
        return res.json({
          student:
            null,

          route:
            null,

          pickupStop:
            null,

          status:
            'NOT_BOARDED',

          boarded:
            false,

          boardedAt:
            null,

          droppedOff:
            false,

          droppedOffAt:
            null
        });
      }

      const student =
        await prisma.user.findUnique({
          where: {
            id:
              studentId
          },

          select: {
            id:
              true,

            name:
              true,

            institutionId:
              true,

            assignedRoute: {
              select: {
                id:
                  true,

                code:
                  true,

                name:
                  true,

                assignedBus: {
                  select: {
                    busNumber:
                      true,

                    registrationNo:
                      true
                  }
                },

                assignedDriver: {
                  select: {
                    name:
                      true,

                    phone:
                      true
                  }
                }
              }
            },

            pickupStop: {
              select: {
                name:
                  true
              }
            }
          }
        });

      if (
        !student
      ) {
        return res.json({
          student:
            null,

          route:
            null,

          pickupStop:
            null,

          status:
            'NOT_BOARDED',

          boarded:
            false,

          boardedAt:
            null,

          droppedOff:
            false,

          droppedOffAt:
            null
        });
      }

      const routeId =
        student
          .assignedRoute
          ?.id ||
        null;

      const boardingEvent =
        await getTodayBoarding(
          student.id,
          routeId
        );

      const dropOffEvent =
        await getTodayDropOff(
          student.id,
          routeId
        );

      let journeyStatus =
        'NOT_BOARDED';

      if (
        boardingEvent
      ) {
        journeyStatus =
          'BOARDED';
      }

      if (
        dropOffEvent
      ) {
        journeyStatus =
          'DROPPED_OFF';
      }

      return res.json({
        student: {
          id:
            student.id,

          name:
            student.name,

          institutionId:
            student
              .institutionId
        },

        route:
          student
            .assignedRoute
            ? {
                id:
                  student
                    .assignedRoute
                    .id,

                code:
                  student
                    .assignedRoute
                    .code,

                name:
                  student
                    .assignedRoute
                    .name,

                busNumber:
                  student
                    .assignedRoute
                    .assignedBus
                    ?.busNumber ||
                  null,

                registrationNo:
                  student
                    .assignedRoute
                    .assignedBus
                    ?.registrationNo ||
                  null,

                driver:
                  student
                    .assignedRoute
                    .assignedDriver ||
                  null
              }
            : null,

        pickupStop:
          student
            .pickupStop
            ?.name ||
          null,

        status:
          journeyStatus,

        boarded:
          Boolean(
            boardingEvent
          ),

        boardedAt:
          boardingEvent
            ?.scannedAt ||
          null,

        droppedOff:
          Boolean(
            dropOffEvent
          ),

        droppedOffAt:
          dropOffEvent
            ?.scannedAt ||
          null,

        method:
          boardingEvent
            ?.method ||
          null
      });
    } catch (error) {
      if (error.status === 409) return res.status(409).json({ message: error.message });
      console.error(
        'BOARDING STATUS ERROR:',
        error
      );

      return res
        .status(500)
        .json({
          message:
            'Could not load boarding status.'
        });
    }
  }
);

export default router;
