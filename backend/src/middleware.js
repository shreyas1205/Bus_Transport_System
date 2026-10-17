import jwt from 'jsonwebtoken';
import { prisma } from './prisma.js';
import { jwtSecret } from './security/settings.js';

export async function auth(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');

  if (!match) {
    return res.status(401).json({
      message: 'Authentication required'
    });
  }

  let payload;

  try {
    payload = jwt.verify(
      match[1],
      jwtSecret(),
      {
        algorithms: ['HS256']
      }
    );

    if (
      typeof payload !== 'object' ||
      typeof payload.id !== 'string'
    ) {
      throw new Error('Invalid token');
    }
  } catch {
    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: {
        id: payload.id
      },

      select: {
        id: true,
        role: true,
        name: true,
        passwordVersion: true
      }
    });

    // Legacy tokens issued before this update have version 0.
    const version =
      payload.pv === undefined
        ? 0
        : payload.pv;

    if (
      !user ||
      !Number.isInteger(version) ||
      version !== user.passwordVersion
    ) {
      return res.status(401).json({
        message:
          'Session expired. Please log in again.'
      });
    }

    req.user = {
      ...payload,
      id: user.id,
      role: user.role,
      name: user.name
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function allow(...roles) {
  return (req, res, next) => {
    if (
      !req.user ||
      !roles.includes(req.user.role)
    ) {
      return res.status(403).json({
        message: 'Forbidden for this role'
      });
    }

    next();
  };
}