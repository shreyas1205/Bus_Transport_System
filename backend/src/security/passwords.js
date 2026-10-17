import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const OPTIONS = {
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024
};

export function passwordProblem(password) {
  if (
    typeof password !== 'string' ||
    password.length < 12 ||
    password.length > 128
  ) {
    return 'Use a password between 12 and 128 characters.';
  }

  return null;
}

export async function hashPassword(password) {
  const salt =
    crypto.randomBytes(16).toString('hex');

  const key =
    await scrypt(
      password,
      salt,
      64,
      OPTIONS
    );

  return (
    'scrypt$32768$8$3$' +
    salt +
    '$' +
    key.toString('hex')
  );
}

export async function verifyPassword(
  password,
  stored
) {
  if (
    typeof password !== 'string' ||
    password.length > 128 ||
    typeof stored !== 'string'
  ) {
    return false;
  }

  // Keep accounts created by
  // the existing admin/seed
  // code working.
  if (
    /^[a-f0-9]{64}$/i.test(stored)
  ) {
    const actual =
      crypto
        .createHash('sha256')
        .update(password)
        .digest();

    return crypto.timingSafeEqual(
      actual,
      Buffer.from(
        stored,
        'hex'
      )
    );
  }

  const parts =
    stored.split('$');

  if (
    parts.length !== 6 ||
    parts
      .slice(0, 4)
      .join('$') !==
      'scrypt$32768$8$3' ||
    !/^[a-f0-9]{32}$/.test(
      parts[4]
    ) ||
    !/^[a-f0-9]{128}$/.test(
      parts[5]
    )
  ) {
    return false;
  }

  const actual =
    await scrypt(
      password,
      parts[4],
      64,
      OPTIONS
    );

  return crypto.timingSafeEqual(
    actual,
    Buffer.from(
      parts[5],
      'hex'
    )
  );
}

export function publicUser(user) {
  if (!user) {
    return user;
  }

  const {
    passwordHash,
    passwordVersion,
    passwordResetRequestedAt,
    ...safe
  } = user;

  return safe;
}