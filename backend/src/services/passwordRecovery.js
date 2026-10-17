import crypto from 'node:crypto';
import {
  hashPassword,
  passwordProblem
} from '../security/passwords.js';
import {
  normalisePhone
} from './otpDelivery.js';

const TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

const GENERIC_MESSAGE =
  'If a matching account has that contact method, a code will be sent. Check your inbox or phone.';

export async function serialTransaction(
  db,
  work
) {
  for (
    let attempt = 0;
    attempt < 3;
    attempt++
  ) {
    try {
      return await db.$transaction(
        work,
        {
          isolationLevel:
            'Serializable',
          maxWait: 5000,
          timeout: 15000,
        }
      );

    } catch (error) {
      if (
        error.code === 'P2034' &&
        attempt < 2
      ) {
        continue;
      }

      throw error;
    }
  }
}

export function digest(
  secret,
  values
) {
  return crypto
    .createHmac(
      'sha256',
      secret
    )
    .update(
      JSON.stringify(values)
    )
    .digest('hex');
}

export async function consumeRate(
  db,
  secret,
  scope,
  value,
  limit,
  seconds,
  time = new Date()
) {
  const bucket =
    Math.floor(
      time.getTime() /
        (seconds * 1000)
    );

  const key =
    digest(
      secret,
      [
        'rate',
        scope,
        value,
        bucket
      ]
    );

  const row =
    await db.authRateLimit
      .upsert({
        where: {
          key
        },

        create: {
          key,
          count: 1,

          expiresAt:
            new Date(
              (bucket + 1) *
                seconds *
                1000
            )
        },

        update: {
          count: {
            increment: 1
          }
        }
      });

  return row.count <= limit;
}

function codeMatches(
  secret,
  challenge,
  code
) {
  if (
    !/^[a-f0-9]{64}$/.test(
      challenge.codeHash
    )
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    Buffer.from(
      digest(
        secret,
        [
          'otp',
          challenge.id,
          code
        ]
      ),
      'hex'
    ),

    Buffer.from(
      challenge.codeHash,
      'hex'
    )
  );
}

function active(
  challenge,
  now
) {
  return (
    challenge &&
    !challenge.consumedAt &&
    challenge.deliveredAt &&
    challenge.expiresAt > now &&
    challenge.attempts <
      MAX_ATTEMPTS
  );
}

function httpError(
  status,
  message
) {
  return Object.assign(
    new Error(message),
    {
      status
    }
  );
}

export function makePasswordRecovery({
  db,
  secret,
  deliver,
  channels,
  clock = () => new Date()
}) {

  async function findAccount(
    identifier
  ) {

    if (
      identifier.includes('@')
    ) {
      const users =
        await db.user.findMany({
          where: {
            email: {
              equals:
                identifier,

              mode:
                'insensitive'
            }
          },

          take: 2,
        });

      return users.length === 1
        ? users[0]
        : null;
    }


    const institutional =
      await db.user.findUnique({
        where: {
          institutionId:
            identifier
        }
      });

    if (institutional) {
      return institutional;
    }


    const phone =
      normalisePhone(
        identifier
      );

    if (!phone) {
      return null;
    }


    const digits =
      phone.slice(1);

    const national =
      digits.startsWith('91') &&
      digits.length === 12
        ? digits.slice(2)
        : digits;


    // Static SQL with bound
    // parameters.
    // No user input is
    // interpolated into SQL.
    //
    // Match legacy formatted
    // numbers while rejecting
    // ambiguous/shared numbers.
    const matches =
      await db.$queryRawUnsafe(
        'SELECT "id" FROM "User" WHERE ' +
        'regexp_replace(COALESCE("phone", \'\'), \'[^0-9]\', \'\', \'g\') IN ($1, $2) LIMIT 2',

        digits,
        national
      );


    return matches.length === 1
      ? db.user.findUnique({
          where: {
            id:
              matches[0].id
          }
        })
      : null;
  }


  async function request({
    identifier,
    channel,
    ip
  }) {

    if (
      typeof identifier !==
        'string' ||
      !identifier.trim() ||
      identifier.length > 254 ||
      ![
        'email',
        'sms'
      ].includes(channel)
    ) {
      throw httpError(
        400,
        'Enter your registered email, phone number or institution ID, and choose email or SMS.'
      );
    }


    if (
      !channels()[channel]
    ) {
      throw httpError(
        503,
        'This delivery method is not configured. Contact your administrator.'
      );
    }


    const time =
      clock();


    if (
      !await consumeRate(
        db,
        secret,
        'recovery-request-ip',
        ip,
        30,
        900,
        time
      )
    ) {
      throw httpError(
        429,
        'Too many requests. Please try again later.'
      );
    }


    const clean =
      identifier.trim();


    const challengeId =
      crypto.randomUUID();


    const body = {
      message:
        GENERIC_MESSAGE,

      challengeId,

      expiresInSeconds:
        TTL_SECONDS,

      resendAfterSeconds: 60,
    };


    if (
      !await consumeRate(
        db,
        secret,
        'recovery-identifier',
        clean.toLowerCase(),
        5,
        3600,
        time
      )
    ) {
      return {
        body
      };
    }


    const user =
      await findAccount(
        clean
      );


    const destination =
      channel === 'email'
        ? user?.email
        : normalisePhone(
            user?.phone
          );


    if (
      !user ||
      !destination
    ) {
      return {
        body
      };
    }


    const code =
      String(
        crypto.randomInt(
          0,
          1000000
        )
      ).padStart(
        6,
        '0'
      );


    const saved =
      await serialTransaction(
        db,

        async tx => {

          const allowed =
            await consumeRate(
              tx,
              secret,
              'recovery-user',
              user.id,
              5,
              3600,
              time
            );


          if (!allowed) {
            return false;
          }


          const claimed =
            await tx.user
              .updateMany({
                where: {
                  id: user.id,

                  passwordVersion:
                    user
                      .passwordVersion,

                  OR: [
                    {
                      passwordResetRequestedAt:
                        null
                    },

                    {
                      passwordResetRequestedAt:
                        {
                          lte:
                            new Date(
                              time.getTime() -
                                60000
                            )
                        }
                    }
                  ]
                },

                data: {
                  passwordResetRequestedAt:
                    time
                }
              });


          if (
            claimed.count !== 1
          ) {
            return false;
          }


          await tx
            .passwordResetChallenge
            .updateMany({
              where: {
                userId:
                  user.id,

                consumedAt:
                  null
              },

              data: {
                consumedAt:
                  time
              }
            });


          await tx
            .passwordResetChallenge
            .create({
              data: {
                id:
                  challengeId,

                userId:
                  user.id,

                channel,

                codeHash:
                  digest(
                    secret,
                    [
                      'otp',
                      challengeId,
                      code
                    ]
                  ),

                passwordVersion:
                  user
                    .passwordVersion,

                expiresAt:
                  new Date(
                    time.getTime() +
                      TTL_SECONDS *
                        1000
                  )
              }
            });


          return true;
        }
      );


    if (!saved) {
      return {
        body
      };
    }


    return {
      body,

      async dispatch() {

        try {

          const latest =
            await db
              .passwordResetChallenge
              .findUnique({
                where: {
                  id:
                    challengeId
                }
              });


          if (
            !latest ||
            latest.consumedAt ||
            latest.expiresAt <=
              clock()
          ) {
            return;
          }


          await deliver({
            channel,
            destination,
            code
          });


          await db
            .passwordResetChallenge
            .updateMany({
              where: {
                id:
                  challengeId,

                consumedAt:
                  null,

                expiresAt: {
                  gt:
                    clock()
                }
              },

              data: {
                deliveredAt:
                  clock()
              }
            });

        } catch {

          await db
            .passwordResetChallenge
            .updateMany({
              where: {
                id:
                  challengeId,

                consumedAt:
                  null
              },

              data: {
                consumedAt:
                  clock()
              }
            });


          console.error(
            'Password recovery delivery failed for challenge ' +
              challengeId +
              '. Check the configured email/SMS service.'
          );
        }
      },
    };
  }


  async function reset({
    challengeId,
    code,
    newPassword,
    ip
  }) {

    const time =
      clock();


    if (
      !await consumeRate(
        db,
        secret,
        'recovery-confirm-ip',
        ip,
        30,
        900,
        time
      )
    ) {
      throw httpError(
        429,
        'Too many attempts. Please try again later.'
      );
    }


    if (
      typeof challengeId !==
        'string' ||
      !/^[a-f0-9-]{36}$/i.test(
        challengeId
      ) ||
      typeof code !==
        'string' ||
      !/^\d{6}$/.test(
        code
      )
    ) {
      throw httpError(
        400,
        'Enter the six-digit code from your latest request.'
      );
    }


    const problem =
      passwordProblem(
        newPassword
      );


    if (problem) {
      throw httpError(
        400,
        problem
      );
    }


    const candidate =
      await db
        .passwordResetChallenge
        .findUnique({
          where: {
            id:
              challengeId
          }
        });


    const encoded =
      active(
        candidate,
        time
      ) &&
      codeMatches(
        secret,
        candidate,
        code
      )
        ? await hashPassword(
            newPassword
          )
        : null;


    const succeeded =
      await serialTransaction(
        db,

        async tx => {

          const currentTime =
            clock();


          const challenge =
            await tx
              .passwordResetChallenge
              .findUnique({
                where: {
                  id:
                    challengeId
                }
              });


          if (
            !active(
              challenge,
              currentTime
            )
          ) {
            return false;
          }


          if (
            !codeMatches(
              secret,
              challenge,
              code
            )
          ) {

            const attempts =
              challenge.attempts +
              1;


            await tx
              .passwordResetChallenge
              .update({
                where: {
                  id:
                    challengeId
                },

                data: {
                  attempts,

                  ...(attempts >=
                  MAX_ATTEMPTS
                    ? {
                        consumedAt:
                          currentTime
                      }
                    : {})
                }
              });


            // Return instead of
            // throwing so the
            // failed attempt
            // is committed.
            return false;
          }


          if (!encoded) {
            return false;
          }


          const updated =
            await tx.user
              .updateMany({
                where: {
                  id:
                    challenge.userId,

                  passwordVersion:
                    challenge
                      .passwordVersion
                },

                data: {
                  passwordHash:
                    encoded,

                  passwordVersion:
                    {
                      increment: 1
                    }
                }
              });


          if (
            updated.count !== 1
          ) {
            return false;
          }


          await tx
            .passwordResetChallenge
            .updateMany({
              where: {
                userId:
                  challenge.userId,

                consumedAt:
                  null
              },

              data: {
                consumedAt:
                  currentTime
              }
            });


          return true;
        }
      );


    if (!succeeded) {
      throw httpError(
        400,
        'The code is invalid, expired or already used. Request a new code.'
      );
    }


    return {
      message:
        'Password changed. Please log in with your new password.'
    };
  }


  async function cleanup() {

    const cutoff =
      new Date(
        clock().getTime() -
          86400000
      );


    await db
      .passwordResetChallenge
      .deleteMany({
        where: {
          expiresAt: {
            lt:
              cutoff
          }
        }
      });


    await db.authRateLimit
      .deleteMany({
        where: {
          expiresAt: {
            lt:
              cutoff
          }
        }
      });
  }


  return {
    request,
    reset,
    cleanup
  };
}