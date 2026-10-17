import express from 'express';
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

function makeDailyQrToken({ userId, passId }) {
  const payload = {
    v: 1,
    uid: userId,
    pid: passId,
    d: indiaDateKey(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', dailyQrSecret())
    .update(encoded)
    .digest('base64url');
  return `CBQR1.${encoded}.${signature}`;
}


function academicYearFor(date = new Date()) {
  const year = date.getFullYear();
  const start = date.getMonth() >= 5 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}


router.get('/daily-qr', auth, allow('STUDENT'), async (req, res) => {
  try {
    const now = new Date();
    const pass = await prisma.busPass.findFirst({
      where: {
        userId: req.user.id,
        status: 'ACTIVE',
        validFrom: { lte: now },
        validUntil: { gte: now },
      },
      orderBy: { validUntil: 'desc' },
    });

    if (!pass) {
      return res.status(403).json({
        message: 'An active bus pass is required before generating today’s boarding QR.',
      });
    }

    const token = makeDailyQrToken({ userId: req.user.id, passId: pass.id });

    return res.json({
      token,
      date: indiaDateKey(now),
      passNumber: pass.passNumber,
      validFor: 'TODAY_ONLY',
    });
  } catch (error) {
    return res.status(500).json({
      message: error?.message || 'Unable to generate today’s boarding QR.',
    });
  }
});

router.get('/my', auth, allow('STUDENT', 'STAFF', 'PARENT'), async (req, res) => {
  try {
    const passes = await prisma.busPass.findMany({
      where: { userId: req.user.id },
      orderBy: { validUntil: 'desc' },
    });
    res.json(passes);
  } catch (error) {
    res.status(500).json({ message: error?.message || 'Unable to load bus passes.' });
  }
});

router.post('/request', auth, allow('STUDENT', 'STAFF', 'PARENT'), async (req, res) => {
  try {
    let routeId = req.body?.routeId || null;

    if (!routeId) {
      const academicYear = academicYearFor();
      const enrollment = await prisma.transportEnrollment.findUnique({
        where: {
          userId_academicYear: {
            userId: req.user.id,
            academicYear,
          },
        },
        select: { routeId: true },
      });
      routeId = enrollment?.routeId || null;
    }

    const existing = await prisma.busPass.findFirst({
      where: {
        userId: req.user.id,
        status: 'ACTIVE',
        validUntil: { gt: new Date() },
      },
      orderBy: { validUntil: 'desc' },
    });

    if (existing) {
      return res.json(existing);
    }

    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);

    const pass = await prisma.busPass.create({
      data: {
        userId: req.user.id,
        routeId,
        passNumber: `CB-${Date.now()}`,
        validFrom: start,
        validUntil: end,
        qrPayload: crypto.randomUUID(),
        status: 'ACTIVE',
      },
    });

    res.status(201).json(pass);
  } catch (error) {
    res.status(500).json({ message: error?.message || 'Unable to generate bus pass.' });
  }
});

router.post('/:id/renew', auth, allow('STUDENT', 'STAFF', 'PARENT'), async (req, res) => {
  try {
    const pass = await prisma.busPass.findUnique({ where: { id: req.params.id } });
    if (!pass || pass.userId !== req.user.id) {
      return res.status(404).json({ message: 'Pass not found' });
    }

    const base = pass.validUntil > new Date() ? new Date(pass.validUntil) : new Date();
    const end = new Date(base);
    end.setMonth(end.getMonth() + 1);

    const updated = await prisma.busPass.update({
      where: { id: pass.id },
      data: {
        validUntil: end,
        status: 'ACTIVE',
        renewalRequestedAt: new Date(),
      },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: error?.message || 'Unable to renew bus pass.' });
  }
});

export default router;

