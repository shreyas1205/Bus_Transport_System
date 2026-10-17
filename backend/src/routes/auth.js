import express from 'express';
import jwt from 'jsonwebtoken';
import passwordRecoveryRoutes from './passwordRecovery.js';
import {
  hashPassword,
  verifyPassword,
  publicUser
} from '../security/passwords.js';
import { jwtSecret } from '../security/settings.js';
import {
  consumeRate
} from '../services/passwordRecovery.js';
import { prisma } from '../prisma.js';
import { auth } from '../middleware.js';

const router = express.Router();

router.use(passwordRecoveryRoutes);

let dummyPasswordHash;

router.post(
  '/login',
  async (req, res, next) => {
    try {
      const {
        email,
        password
      } = req.body || {};

      if (
        typeof email !== 'string' ||
        !email.trim() ||
        email.length > 254 ||
        typeof password !== 'string' ||
        password.length > 128
      ) {
        return res.status(400).json({
          message:
            'Enter your email and password.'
        });
      }

      const secret = jwtSecret();

      if (
        !await consumeRate(
          prisma,
          secret,
          'login-ip',
          req.ip,
          50,
          900
        ) ||
        !await consumeRate(
          prisma,
          secret,
          'login-account',
          email.trim().toLowerCase(),
          20,
          900
        )
      ) {
        return res.status(429).json({
          message:
            'Too many login attempts. Please try again later.'
        });
      }

      const user =
        await prisma.user.findUnique({
          where: {
            email: email.trim()
          }
        });

      if (
        !user &&
        !dummyPasswordHash
      ) {
        dummyPasswordHash =
          hashPassword(
            'Dummy account password only'
          );
      }

      const valid =
        await verifyPassword(
          password,
          user?.passwordHash ||
            await dummyPasswordHash
        );

      if (!user || !valid) {
        return res.status(401).json({
          message:
            'Invalid email or password'
        });
      }

      if (
        !user.passwordHash.startsWith(
          'scrypt$'
        )
      ) {
        const encoded =
          await hashPassword(password);

        const updated =
          await prisma.user.updateMany({
            where: {
              id: user.id,
              passwordHash:
                user.passwordHash,
              passwordVersion:
                user.passwordVersion
            },

            data: {
              passwordHash: encoded
            }
          });

        if (updated.count !== 1) {
          return res.status(401).json({
            message:
              'Your account changed. Please log in again.'
          });
        }
      }

      const token = jwt.sign(
        {
          id: user.id,
          role: user.role,
          name: user.name,
          pv: user.passwordVersion
        },

        secret,

        {
          expiresIn: '8h',
          algorithm: 'HS256'
        }
      );

      res.json({
        token,

        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          institutionId:
            user.institutionId
        }
      });
    } catch (error) {
      next(error);
    }
  }
);


// ==========================
// CURRENT USER
// ==========================
router.get(
  '/me',
  auth,
  async (req, res) => {
    try {
      const user =
        await prisma.user.findUnique({
          where: {
            id: req.user.id
          },

          include: {
            assignedRoute: true,
            pickupStop: true,
            driverProfile: true,

            driverRoutes: {
              include: {
                assignedBus: true
              }
            }
          }
        });

      if (!user) {
        return res.status(404).json({
          message: 'User not found'
        });
      }

      res.json(
        publicUser(user)
      );

    } catch (error) {
      console.error(error);

      res.status(500).json({
        message:
          'Could not load profile.'
      });
    }
  }
);


// ==========================
// UPDATE PROFILE
// ==========================
router.patch(
  '/profile',
  auth,
  async (req, res, next) => {
    try {
      const {
        name,
        phone,
        pickupStopId,
        assignedRouteId,
        licenseNumber,
        licenseExpiry,
        licensePhoto
      } = req.body;


      // ==========================
      // LICENSE PHOTO VALIDATION
      // ==========================
      if (
        licensePhoto !== undefined &&
        licensePhoto !== null &&
        licensePhoto !== '' &&
        !String(
          licensePhoto
        ).startsWith(
          'data:image/'
        )
      ) {
        return res.status(400).json({
          message:
            'License photo must be an image.'
        });
      }


      if (
        typeof licensePhoto === 'string' &&
        licensePhoto.length >
          8 * 1024 * 1024
      ) {
        return res.status(400).json({
          message:
            'License photo is too large. Please use a smaller image.'
        });
      }


      // ==========================
      // LICENSE EXPIRY
      // ==========================
      let parsedExpiry;

      if (
        licenseExpiry !== undefined
      ) {
        if (
          licenseExpiry === '' ||
          licenseExpiry === null
        ) {
          parsedExpiry = null;
        } else {
          parsedExpiry =
            new Date(
              licenseExpiry
            );

          if (
            Number.isNaN(
              parsedExpiry.getTime()
            )
          ) {
            return res.status(400).json({
              message:
                'Invalid license expiry date.'
            });
          }
        }
      }


      // ==========================
      // DATABASE TRANSACTION
      // ==========================
      const updatedUser =
        await prisma.$transaction(
          async (tx) => {

            // ==========================
            // NORMAL PROFILE FIELDS
            // ==========================
            const allowed = {
              name,
              phone,
              pickupStopId,
              assignedRouteId
            };

            const userData =
              Object.fromEntries(
                Object.entries(
                  allowed
                ).filter(
                  ([, value]) =>
                    value !== undefined
                )
              );


            if (
              Object.keys(
                userData
              ).length
            ) {
              await tx.user.update({
                where: {
                  id: req.user.id
                },

                data: userData
              });
            }


            // ==========================
            // DRIVER LICENSE
            // ==========================
            if (
              req.user.role ===
              'DRIVER'
            ) {
              const driverData = {};


              const existingProfile =
                await tx.driverProfile
                  .findUnique({
                    where: {
                      userId:
                        req.user.id
                    }
                  });


              let licenseChanged =
                false;


              // --------------------------
              // LICENSE NUMBER
              // --------------------------
              if (
                licenseNumber !==
                undefined
              ) {
                const newLicenseNumber =
                  String(
                    licenseNumber
                  ).trim() ||
                  'PENDING';

                driverData.licenseNumber =
                  newLicenseNumber;


                if (
                  existingProfile
                    ?.licenseNumber !==
                  newLicenseNumber
                ) {
                  licenseChanged =
                    true;
                }
              }


              // --------------------------
              // LICENSE EXPIRY
              // --------------------------
              if (
                licenseExpiry !==
                undefined
              ) {
                driverData.licenseExpiry =
                  parsedExpiry;


                const oldExpiry =
                  existingProfile
                    ?.licenseExpiry
                    ? existingProfile
                        .licenseExpiry
                        .getTime()
                    : null;


                const newExpiry =
                  parsedExpiry
                    ? parsedExpiry
                        .getTime()
                    : null;


                if (
                  oldExpiry !==
                  newExpiry
                ) {
                  licenseChanged =
                    true;
                }
              }


              // --------------------------
              // LICENSE PHOTO
              // --------------------------
              if (
                licensePhoto !==
                undefined
              ) {
                const newPhoto =
                  licensePhoto ||
                  null;

                driverData.licensePhoto =
                  newPhoto;


                const oldPhoto =
                  existingProfile
                    ?.licensePhoto ||
                  null;


                if (
                  oldPhoto !==
                  newPhoto
                ) {
                  licenseChanged =
                    true;
                }
              }


              // ==========================
              // RESET VERIFICATION
              // ==========================
              if (
                licenseChanged
              ) {
                driverData.licenseStatus =
                  'PENDING';

                driverData
                  .licenseReviewNote =
                  null;

                driverData
                  .licenseReviewedAt =
                  null;
              }


              // ==========================
              // SAVE DRIVER PROFILE
              // ==========================
              if (
                Object.keys(
                  driverData
                ).length
              ) {
                await tx.driverProfile
                  .upsert({
                    where: {
                      userId:
                        req.user.id
                    },

                    update:
                      driverData,

                    create: {
                      userId:
                        req.user.id,

                      licenseNumber:
                        String(
                          licenseNumber ||
                            ''
                        ).trim() ||
                        'PENDING',

                      licenseExpiry:
                        licenseExpiry !==
                        undefined
                          ? parsedExpiry
                          : null,

                      licensePhoto:
                        licensePhoto ||
                        null,

                      licenseStatus:
                        'PENDING',

                      licenseReviewNote:
                        null,

                      licenseReviewedAt:
                        null
                    }
                  });
              }
            }


            // ==========================
            // RETURN UPDATED USER
            // ==========================
            return tx.user.findUnique({
              where: {
                id: req.user.id
              },

              include: {
                assignedRoute: true,
                pickupStop: true,
                driverProfile: true,

                driverRoutes: {
                  include: {
                    assignedBus: true
                  }
                }
              }
            });
          }
        );


      res.json(
        publicUser(
          updatedUser
        )
      );

    } catch (error) {
      next(error);
    }
  }
);


export default router;
