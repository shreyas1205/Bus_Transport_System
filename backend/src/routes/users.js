import express from 'express';
import crypto from 'crypto';

import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

import {
  findCollegeRecord
} from '../services/collegeDirectory.js';


const router = express.Router();


// ======================================================
// PASSWORD HASH
// ======================================================

const hash = (text) =>
  crypto
    .createHash('sha256')
    .update(text)
    .digest('hex');


// ======================================================
// ALLOWED ROLES
// ======================================================

const allowedCreateRoles = new Set([
  'DRIVER',
  'STUDENT',
  'STAFF',
  'PARENT'
]);


const aiCreateRoles = new Set([
  'DRIVER',
  'STUDENT',
  'PARENT'
]);


const allRoles = new Set([
  'ADMIN',
  'DRIVER',
  'STUDENT',
  'STAFF',
  'PARENT'
]);


// ======================================================
// HELPERS
// ======================================================

const slugify = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\.{2,}/g, '.');


// ======================================================
// ROLE NORMALIZER
// ======================================================

const roleFromText = (value) => {

  const role =
    String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_');


  const aliases = {

    STUDENT: 'STUDENT',
    STUDENTS: 'STUDENT',
    STUD: 'STUDENT',
    S: 'STUDENT',

    DRIVER: 'DRIVER',
    DRIVERS: 'DRIVER',
    DRV: 'DRIVER',
    D: 'DRIVER',

    PARENT: 'PARENT',
    PARENTS: 'PARENT',
    MOM: 'PARENT',
    DAD: 'PARENT'

  };


  return (
    aliases[role] ||
    (
      aiCreateRoles.has(role)
        ? role
        : null
    )
  );
};


// ======================================================
// TEMP PASSWORD
// ======================================================

function generateTempPassword() {

  return `Cb!${crypto
    .randomBytes(5)
    .toString('hex')}`;

}


// ======================================================
// COLLEGE RECORD LOOKUP
// ADMIN ONLY
// ======================================================

router.get(
  '/college-record/:identifier',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    try {

      const identifier =
        String(
          req.params.identifier || ''
        ).trim();


      if (!identifier) {

        return res
          .status(400)
          .json({
            message:
              'Enter a student USN or staff ID.'
          });

      }


      const record =
        await findCollegeRecord(
          identifier
        );


      if (!record) {

        return res
          .status(404)
          .json({
            message:
              'No matching student or staff record was found in the college directory.'
          });

      }


      const conditions = [

        {
          institutionId:
            record.institutionId
        }

      ];


      if (record.email) {

        conditions.push({

          email:
            record.email
              .trim()
              .toLowerCase()

        });

      }


      const existing =
        await prisma.user.findFirst({

          where: {

            OR:
              conditions

          },

          select: {

            id: true,

            name: true,

            email: true,

            role: true,

            institutionId: true

          }

        });


      return res.json({

        found:
          true,

        record,

        alreadyRegistered:
          Boolean(existing),

        existingUser:
          existing || null

      });


    } catch (error) {

      console.error(
        'COLLEGE RECORD LOOKUP ERROR:',
        error
      );


      return res
        .status(500)
        .json({

          message:
            'Could not retrieve the college record.'

        });

    }

  }
);


// ======================================================
// IMPORT COLLEGE RECORD
// ADMIN ONLY
// ======================================================

router.post(
  '/import-college-record',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    try {

      const identifier =
        String(
          req.body?.identifier || ''
        ).trim();


      if (!identifier) {

        return res
          .status(400)
          .json({

            message:
              'Student USN or Staff ID is required.'

          });

      }


      // ----------------------------------------------
      // FETCH FROM COLLEGE DIRECTORY
      // ----------------------------------------------

      const record =
        await findCollegeRecord(
          identifier
        );


      if (!record) {

        return res
          .status(404)
          .json({

            message:
              'College record not found.'

          });

      }


      // ----------------------------------------------
      // ONLY STUDENT / STAFF
      // ----------------------------------------------

      if (
        record.role !== 'STUDENT' &&
        record.role !== 'STAFF'
      ) {

        return res
          .status(400)
          .json({

            message:
              'Only STUDENT and STAFF college records can be imported.'

          });

      }


      // ----------------------------------------------
      // EMAIL REQUIRED
      // ----------------------------------------------

      if (!record.email) {

        return res
          .status(400)
          .json({

            message:
              'The college record does not contain an email address.'

          });

      }


      // ----------------------------------------------
      // CHECK DUPLICATE ACCOUNT
      // ----------------------------------------------

      const existing =
        await prisma.user.findFirst({

          where: {

            OR: [

              {
                institutionId:
                  record.institutionId
              },

              {
                email:
                  record.email
                    .trim()
                    .toLowerCase()
              }

            ]

          },

          select: {

            id: true,

            name: true,

            email: true,

            role: true,

            institutionId: true

          }

        });


      if (existing) {

        return res
          .status(409)
          .json({

            message:
              'This college member already has a CampusBus account.',

            user:
              existing

          });

      }


      // ----------------------------------------------
      // GENERATE INTERNAL TEMP PASSWORD
      // ----------------------------------------------

      const temporaryPassword =
        generateTempPassword();


      // ----------------------------------------------
      // CREATE ACCOUNT
      // ----------------------------------------------

      const created =
        await prisma.$transaction(

          async (tx) => {


            const user =
              await tx.user.create({

                data: {

                  name:
                    record.name,

                  email:
                    record.email
                      .trim()
                      .toLowerCase(),

                  passwordHash:
                    hash(
                      temporaryPassword
                    ),

                  role:
                    record.role,

                  phone:
                    record.phone ||
                    null,

                  institutionId:
                    record.institutionId

                }

              });


            // ========================================
            // STUDENT PROFILE
            // ========================================

            if (
              record.role ===
              'STUDENT'
            ) {

              await tx.studentProfile.create({

                data: {

                  userId:
                    user.id,

                  course:
                    record.course ||
                    null,

                  semester:
                    record.semester ||
                    null

                }

              });

            }


            // ========================================
            // STAFF PROFILE
            // ========================================

            if (
              record.role ===
              'STAFF'
            ) {

              await tx.staffProfile.create({

                data: {

                  userId:
                    user.id,

                  department:
                    record.department ||
                    null

                }

              });

            }


            return user;

          }

        );


      return res
        .status(201)
        .json({

          message:
            'CampusBus account created from college record.',

          user: {

            id:
              created.id,

            name:
              created.name,

            email:
              created.email,

            role:
              created.role,

            phone:
              created.phone,

            institutionId:
              created.institutionId

          },

          passwordSetup:
            'OTP_REQUIRED'

        });


    } catch (error) {

      console.error(
        'IMPORT COLLEGE RECORD ERROR:',
        error
      );


      if (
        error.code ===
        'P2002'
      ) {

        return res
          .status(409)
          .json({

            message:
              'Email or institution ID already exists.'

          });

      }


      return res
        .status(500)
        .json({

          message:
            'Could not create CampusBus account from college record.'

        });

    }

  }
);


// ======================================================
// GET ALL USERS
// ADMIN ONLY
// ======================================================

router.get(
  '/',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    try {

      const where =
        req.query.role
          ? {
              role:
                req.query.role
            }
          : {};


      const users =
        await prisma.user.findMany({

          where,

          select: {

            id: true,

            name: true,

            email: true,

            role: true,

            phone: true,

            institutionId: true,

            assignedRoute:
              true,

            pickupStop:
              true,

            driverProfile:
              true

          },

          orderBy: {

            name:
              'asc'

          }

        });


      res.json(
        users
      );


    } catch (error) {

      console.error(
        'GET /users ERROR:',
        error
      );


      res
        .status(500)
        .json({

          message:
            'Could not load users'

        });

    }

  }
);


// ======================================================
// CREATE SINGLE ACCOUNT
// ADMIN ONLY
// ======================================================

router.post(
  '/',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    const {

      name,

      email,

      password,

      role,

      phone,

      institutionId,

      licenseNumber,

      licenseExpiry,

      course,

      semester,

      department,

      studentId

    } = req.body || {};


    // ----------------------------------------------
    // REQUIRED FIELDS
    // ----------------------------------------------

    if (
      !name?.trim() ||
      !email?.trim() ||
      !password ||
      !role
    ) {

      return res
        .status(400)
        .json({

          message:
            'Name, email, password and role are required'

        });

    }


    // ----------------------------------------------
    // ROLE VALIDATION
    // ----------------------------------------------

    if (
      !allowedCreateRoles.has(
        role
      )
    ) {

      return res
        .status(400)
        .json({

          message:
            'This account role cannot be created from the Admin panel'

        });

    }


    // ----------------------------------------------
    // PASSWORD LENGTH
    // ----------------------------------------------

    if (
      String(password).length <
      6
    ) {

      return res
        .status(400)
        .json({

          message:
            'Password must be at least 6 characters'

        });

    }


    try {

      const created =
        await prisma.$transaction(

          async (tx) => {


            // ========================================
            // USER
            // ========================================

            const user =
              await tx.user.create({

                data: {

                  name:
                    name.trim(),

                  email:
                    email
                      .trim()
                      .toLowerCase(),

                  passwordHash:
                    hash(
                      String(
                        password
                      )
                    ),

                  role,

                  phone:
                    phone?.trim() ||
                    null,

                  institutionId:
                    institutionId
                      ?.trim() ||
                    null

                }

              });


            // ========================================
            // DRIVER PROFILE
            // ========================================

            if (
              role ===
              'DRIVER'
            ) {

              await tx.driverProfile.create({

                data: {

                  userId:
                    user.id,

                  licenseNumber:
                    licenseNumber
                      ?.trim() ||
                    'PENDING',

                  licenseExpiry:
                    licenseExpiry
                      ? new Date(
                          licenseExpiry
                        )
                      : null,

                  licenseStatus:
                    'PENDING',

                  licenseReviewNote:
                    null,

                  licenseReviewedAt:
                    null

                }

              });

            }


            // ========================================
            // STUDENT PROFILE
            // ========================================

            if (
              role ===
              'STUDENT'
            ) {

              await tx.studentProfile.create({

                data: {

                  userId:
                    user.id,

                  course:
                    course?.trim() ||
                    null,

                  semester:
                    semester?.trim() ||
                    null

                }

              });

            }


            // ========================================
            // STAFF PROFILE
            // ========================================

            if (
              role ===
              'STAFF'
            ) {

              await tx.staffProfile.create({

                data: {

                  userId:
                    user.id,

                  department:
                    department
                      ?.trim() ||
                    null

                }

              });

            }


            // ========================================
            // PARENT PROFILE
            // ========================================

            if (
              role ===
              'PARENT'
            ) {

              await tx.parentProfile.create({

                data: {

                  userId:
                    user.id,

                  studentId:
                    studentId
                      ?.trim() ||
                    null

                }

              });

            }


            return user;

          }

        );


      res
        .status(201)
        .json({

          id:
            created.id,

          name:
            created.name,

          email:
            created.email,

          role:
            created.role,

          phone:
            created.phone,

          institutionId:
            created.institutionId,

          passwordProvided:
            true

        });


    } catch (error) {

      console.error(
        'CREATE USER ERROR:',
        error
      );


      if (
        error.code ===
        'P2002'
      ) {

        return res
          .status(409)
          .json({

            message:
              'Email or institution ID already exists'

          });

      }


      return res
        .status(500)
        .json({

          message:
            'Could not create account'

        });

    }

  }
);


// ======================================================
// AI BULK ACCOUNT CREATION
// ======================================================

router.post(
  '/ai-bulk-create',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    const raw =
      Array.isArray(
        req.body?.records
      )
        ? req.body.records
        : [];


    // ----------------------------------------------
    // EMPTY INPUT
    // ----------------------------------------------

    if (!raw.length) {

      return res
        .status(400)
        .json({

          message:
            'Add at least one roster record'

        });

    }


    // ----------------------------------------------
    // MAX 100
    // ----------------------------------------------

    if (
      raw.length >
      100
    ) {

      return res
        .status(400)
        .json({

          message:
            'You can create up to 100 accounts at a time'

        });

    }


    // ----------------------------------------------
    // NORMALIZE RECORDS
    // ----------------------------------------------

    const records =
      raw.map(
        (
          record,
          index
        ) => ({

          index,

          name:
            String(
              record?.name ||
              ''
            ).trim(),

          role:
            roleFromText(
              record?.role
            ),

          phone:
            String(
              record?.phone ||
              ''
            ).trim(),

          institutionId:
            String(
              record
                ?.institutionId ||
              ''
            ).trim(),

          studentId:
            String(
              record
                ?.studentId ||
              ''
            ).trim(),

          course:
            String(
              record?.course ||
              ''
            ).trim(),

          semester:
            String(
              record?.semester ||
              ''
            ).trim(),

          licenseNumber:
            String(
              record
                ?.licenseNumber ||
              ''
            ).trim(),

          licenseExpiry:
            String(
              record
                ?.licenseExpiry ||
              ''
            ).trim()

        })
      );


    // ----------------------------------------------
    // VALIDATE
    // ----------------------------------------------

    const invalid =
      records.filter(
        record =>
          !record.name ||
          !record.role
      );


    if (
      invalid.length
    ) {

      return res
        .status(400)
        .json({

          message:
            'Each line needs a name and role (Driver, Student or Parent)',

          invalid:
            invalid.map(
              record => ({

                index:
                  record.index +
                  1,

                name:
                  record.name,

                role:
                  record.role

              })
            )

        });

    }


    try {

      const created =
        await prisma.$transaction(

          async (tx) => {


            // ----------------------------------------
            // EXISTING USERS
            // ----------------------------------------

            const existing =
              await tx.user.findMany({

                select: {

                  email:
                    true,

                  institutionId:
                    true

                }

              });


            const emails =
              new Set(

                existing.map(
                  item =>
                    String(
                      item.email
                    ).toLowerCase()
                )

              );


            const ids =
              new Set(

                existing

                  .map(
                    item =>
                      item.institutionId
                  )

                  .filter(
                    Boolean
                  )

              );


            const output =
              [];


            const year =
              new Date()
                .getFullYear();


            // ----------------------------------------
            // UNIQUE EMAIL GENERATOR
            // ----------------------------------------

            const nextEmail =
              (name) => {

                const base =
                  slugify(
                    name
                  ) ||
                  `user${Date.now()}`;


                let email =
                  `${base}@campusbus.local`;


                let number =
                  2;


                while (
                  emails.has(
                    email
                  )
                ) {

                  email =
                    `${base}.${number++}@campusbus.local`;

                }


                emails.add(
                  email
                );


                return email;

              };


            // ----------------------------------------
            // UNIQUE INSTITUTION ID
            // ----------------------------------------

            const nextInstitutionId =
              (role) => {

                const prefix =

                  role ===
                  'DRIVER'

                    ? 'DRV'

                    : role ===
                      'PARENT'

                    ? 'PAR'

                    : 'STU';


                let number =
                  1;


                let id =
                  `${prefix}-${year}-${String(
                    number
                  ).padStart(
                    3,
                    '0'
                  )}`;


                while (
                  ids.has(
                    id
                  )
                ) {

                  id =
                    `${prefix}-${year}-${String(
                      ++number
                    ).padStart(
                      3,
                      '0'
                    )}`;

                }


                ids.add(
                  id
                );


                return id;

              };


            // ----------------------------------------
            // CREATE EACH ACCOUNT
            // ----------------------------------------

            for (
              const record of
              records
            ) {

              const email =
                nextEmail(
                  record.name
                );


              const password =
                generateTempPassword();


              const institutionId =
                record
                  .institutionId ||
                nextInstitutionId(
                  record.role
                );


              // Prevent duplicate IDs inside batch.

              if (
                record.institutionId &&
                ids.has(
                  record.institutionId
                )
              ) {

                throw new Error(
                  `Duplicate institution ID: ${record.institutionId}`
                );

              }


              if (
                record.institutionId
              ) {

                ids.add(
                  record.institutionId
                );

              }


              const user =
                await tx.user.create({

                  data: {

                    name:
                      record.name,

                    email,

                    passwordHash:
                      hash(
                        password
                      ),

                    role:
                      record.role,

                    phone:
                      record.phone ||
                      null,

                    institutionId

                  }

                });


              // ======================================
              // DRIVER
              // ======================================

              if (
                record.role ===
                'DRIVER'
              ) {

                await tx.driverProfile.create({

                  data: {

                    userId:
                      user.id,

                    licenseNumber:
                      record
                        .licenseNumber ||
                      'PENDING',

                    licenseExpiry:
                      record
                        .licenseExpiry

                        ? new Date(
                            record
                              .licenseExpiry
                          )

                        : null,

                    licenseStatus:
                      'PENDING',

                    licenseReviewNote:
                      null,

                    licenseReviewedAt:
                      null

                  }

                });

              }


              // ======================================
              // STUDENT
              // ======================================

              if (
                record.role ===
                'STUDENT'
              ) {

                await tx.studentProfile.create({

                  data: {

                    userId:
                      user.id,

                    course:
                      record.course ||
                      null,

                    semester:
                      record.semester ||
                      null

                  }

                });

              }


              // ======================================
              // PARENT
              // ======================================

              if (
                record.role ===
                'PARENT'
              ) {

                await tx.parentProfile.create({

                  data: {

                    userId:
                      user.id,

                    studentId:
                      record.studentId ||
                      null

                  }

                });

              }


              output.push({

                id:
                  user.id,

                name:
                  user.name,

                role:
                  user.role,

                email,

                password,

                institutionId,

                phone:
                  user.phone

              });

            }


            return output;

          }

        );


      res
        .status(201)
        .json({

          message:
            `Created ${created.length} account${
              created.length === 1
                ? ''
                : 's'
            } automatically.`,

          created

        });


    } catch (error) {

      console.error(
        'AI CREATE ERROR:',
        error
      );


      if (
        error.code ===
        'P2002'
      ) {

        return res
          .status(409)
          .json({

            message:
              'A generated account conflicted with an existing email or institution ID. Please retry this batch.'

          });

      }


      return res
        .status(500)
        .json({

          message:
            error.message ||
            'AI account generation failed'

        });

    }

  }
);


// ======================================================
// ADMIN LICENSE VERIFICATION
// ======================================================

router.patch(
  '/:id/license-review',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    try {

      const {

        status,

        note

      } = req.body || {};


      const allowedStatuses = [

        'VERIFIED',

        'REJECTED'

      ];


      if (
        !allowedStatuses.includes(
          status
        )
      ) {

        return res
          .status(400)
          .json({

            message:
              'Status must be VERIFIED or REJECTED'

          });

      }


      if (
        status ===
          'REJECTED' &&
        !String(
          note || ''
        ).trim()
      ) {

        return res
          .status(400)
          .json({

            message:
              'Please enter a reason for rejection.'

          });

      }


      // ----------------------------------------------
      // FIND DRIVER
      // ----------------------------------------------

      const driver =
        await prisma.user.findUnique({

          where: {

            id:
              req.params.id

          },

          include: {

            driverProfile:
              true

          }

        });


      if (!driver) {

        return res
          .status(404)
          .json({

            message:
              'Driver not found'

          });

      }


      if (
        driver.role !==
        'DRIVER'
      ) {

        return res
          .status(400)
          .json({

            message:
              'License verification is only available for drivers.'

          });

      }


      if (
        !driver.driverProfile
      ) {

        return res
          .status(404)
          .json({

            message:
              'Driver profile not found.'

          });

      }


      // ----------------------------------------------
      // LICENSE NUMBER
      // ----------------------------------------------

      if (
        !driver
          .driverProfile
          .licenseNumber ||

        driver
          .driverProfile
          .licenseNumber ===
          'PENDING'
      ) {

        return res
          .status(400)
          .json({

            message:
              'Driver has not submitted a license number yet.'

          });

      }


      // ----------------------------------------------
      // LICENSE PHOTO
      // ----------------------------------------------

      if (
        !driver
          .driverProfile
          .licensePhoto
      ) {

        return res
          .status(400)
          .json({

            message:
              'Driver must upload a license photo before verification.'

          });

      }


      // ----------------------------------------------
      // UPDATE
      // ----------------------------------------------

      const profile =
        await prisma.driverProfile.update({

          where: {

            userId:
              req.params.id

          },

          data: {

            licenseStatus:
              status,

            licenseReviewNote:

              status ===
              'REJECTED'

                ? String(
                    note
                  ).trim()

                : null,

            licenseReviewedAt:
              new Date()

          }

        });


      res.json({

        message:

          status ===
          'VERIFIED'

            ? 'Driver license verified successfully.'

            : 'Driver license rejected.',

        driverProfile:
          profile

      });


    } catch (error) {

      console.error(
        'LICENSE REVIEW ERROR:',
        error
      );


      res
        .status(500)
        .json({

          message:
            'Could not update license verification.'

        });

    }

  }
);


// ======================================================
// CHANGE USER ROLE
// ======================================================

router.patch(
  '/:id/role',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    try {

      const newRole =
        String(
          req.body?.role ||
          ''
        )
          .trim()
          .toUpperCase();


      if (
        !allRoles.has(
          newRole
        )
      ) {

        return res
          .status(400)
          .json({

            message:
              'Invalid CampusBus role'

          });

      }


      const user =
        await prisma.user.update({

          where: {

            id:
              req.params.id

          },

          data: {

            role:
              newRole

          }

        });


      res.json(
        user
      );


    } catch (error) {

      console.error(
        'ROLE UPDATE ERROR:',
        error
      );


      res
        .status(500)
        .json({

          message:
            'Could not update user role'

        });

    }

  }
);


// ======================================================
// UPDATE DRIVER PHONE
// ======================================================

router.patch(
  '/:id/phone',
  auth,
  allow('ADMIN'),

  async (req, res) => {

    try {

      const phone =

        typeof req.body.phone ===
        'string'

          ? req.body.phone.trim()

          : '';


      const target =
        await prisma.user.findUnique({

          where: {

            id:
              req.params.id

          },

          select: {

            id:
              true,

            role:
              true

          }

        });


      if (!target) {

        return res
          .status(404)
          .json({

            message:
              'User not found'

          });

      }


      if (
        target.role !==
        'DRIVER'
      ) {

        return res
          .status(400)
          .json({

            message:
              'Only driver phone numbers can be changed here'

          });

      }


      const user =
        await prisma.user.update({

          where: {

            id:
              req.params.id

          },

          data: {

            phone:
              phone ||
              null

          },

          select: {

            id:
              true,

            name:
              true,

            email:
              true,

            role:
              true,

            phone:
              true,

            institutionId:
              true

          }

        });


      res.json(
        user
      );


    } catch (error) {

      console.error(
        'PHONE UPDATE ERROR:',
        error
      );


      res
        .status(500)
        .json({

          message:
            'Could not update driver phone'

        });

    }

  }
);


export default router;