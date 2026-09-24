import express from 'express';
import crypto from 'crypto';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

function academicYearFor(date = new Date()) {
  const year = date.getFullYear();
  const start = date.getMonth() >= 5 ? year : year - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

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
