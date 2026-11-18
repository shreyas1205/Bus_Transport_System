// ======================================================
// PARENT LINK VERIFICATION
// ------------------------------------------------------
// Two ways to verify a parent's link to their child:
//  Parent enters a 6-digit code sent by SMS to the phone
//  number on the parent's account
//  (POST /request-code, then POST /confirm-code).
// The code is only sent to a phone number on file, expires
// after 10 minutes, and locks after 5 wrong attempts.
// ======================================================

import crypto from 'crypto';
import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { jwtSecret } from '../security/settings.js';
import { deliveryChannels } from '../services/otpDelivery.js';
import { sendEmail } from '../services/locationAlerts.js';
import { verifiedParentStudent } from '../services/parentTransportAccess.js';

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(parentId, code) {
  return crypto
    .createHmac('sha256', jwtSecret())
    .update(`${parentId}:${code}`)
    .digest('hex');
}

function maskEmail(email) {
  if (!email || !email.includes('@')) return null;
  const [name, domain] = email.split('@');
  return `${name.slice(0, 2)}***@${domain}`;
}

// Parent: current link and verification state
router.get('/status', auth, allow('PARENT'), async (req, res) => {
  try {
    const profile = await prisma.parentProfile.findUnique({
      where: { userId: req.user.id },
      select: { studentId: true }
    });
    const student = profile?.studentId
      ? await prisma.user.findUnique({
          where: { id: profile.studentId },
          select: { name: true }
        })
      : null;
    const verified = Boolean(await verifiedParentStudent(req.user.id));
    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { email: true }
    });
    res.json({
      hasStudentLink: Boolean(student),
      studentName: student?.name || null,
      verified,
      emailMasked: maskEmail(me?.email),
      emailConfigured: deliveryChannels().email
    });
  } catch (error) {
    console.error('Parent link status error:', error);
    res.status(500).json({ message: 'Unable to load link status.' });
  }
});

// Parent: send a 6-digit code to the phone number on their account
router.post('/request-code', auth, allow('PARENT'), async (req, res) => {
  try {
    const profile = await prisma.parentProfile.findUnique({
      where: { userId: req.user.id }
    });
    if (!profile?.studentId) {
      return res.status(400).json({
        message: 'No student is linked to your account yet. Contact the school admin.'
      });
    }
    if (await verifiedParentStudent(req.user.id)) {
      return res.status(400).json({ message: 'Your link to your child is already verified.' });
    }

    const me = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { email: true }
    });
    if (!me?.email) {
      return res.status(400).json({ message: 'No email is on your account. Contact the transport office.' });
    }
    if (!deliveryChannels().email) {
      return res.status(503).json({
        message: 'Email is not configured on this server. Contact the transport office.'
      });
    }

    const existing = await prisma.parentLinkOtp.findUnique({
      where: { parentId: req.user.id }
    });
    if (existing && Date.now() - existing.createdAt.getTime() < RESEND_WAIT_MS) {
      return res.status(429).json({ message: 'Please wait a minute before requesting another code.' });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    await prisma.parentLinkOtp.upsert({
      where: { parentId: req.user.id },
      create: {
        parentId: req.user.id,
        studentId: profile.studentId,
        codeHash: hashCode(req.user.id, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        createdAt: new Date()
      },
      update: {
        studentId: profile.studentId,
        codeHash: hashCode(req.user.id, code),
        attempts: 0,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        createdAt: new Date()
      }
    });

    await sendEmail(
      me.email,
      'NaviGuard: verify your link to your child',
      `Your NaviGuard code to verify your link to your child is ${code}.\n` +
        'It expires in 10 minutes. Do not share this code.'
    );

    res.json({
      message: `A code was sent to ${maskEmail(me.email)}. It expires in 10 minutes.`,
      sentTo: maskEmail(me.email)
    });
  } catch (error) {
    console.error('Parent link code error:', error);
    res.status(500).json({ message: 'Could not send the code. Try again or contact the school admin.' });
  }
});

// Parent: confirm the code
router.post('/confirm-code', auth, allow('PARENT'), async (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the 6-digit code.' });
    }

    const row = await prisma.parentLinkOtp.findUnique({
      where: { parentId: req.user.id }
    });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'No valid code. Request a new code.' });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many wrong attempts. Request a new code.' });
    }

    const expected = Buffer.from(row.codeHash, 'hex');
    const given = Buffer.from(hashCode(req.user.id, code), 'hex');
    const matches = expected.length === given.length && crypto.timingSafeEqual(expected, given);

    if (!matches) {
      await prisma.parentLinkOtp.update({
        where: { parentId: req.user.id },
        data: { attempts: { increment: 1 } }
      });
      return res.status(400).json({ message: 'Incorrect code.' });
    }

    const profile = await prisma.parentProfile.findUnique({
      where: { userId: req.user.id }
    });
    if (!profile?.studentId || profile.studentId !== row.studentId) {
      await prisma.parentLinkOtp.delete({ where: { parentId: req.user.id } });
      return res.status(400).json({ message: 'Your student link changed. Request a new code.' });
    }

    await prisma.$transaction([
      prisma.parentProfile.update({
        where: { userId: req.user.id },
        data: {
          verifiedStudentId: row.studentId,
          verifiedAt: new Date(),
          verifiedBy: 'PARENT_PHONE_CODE'
        }
      }),
      prisma.parentLinkOtp.delete({ where: { parentId: req.user.id } })
    ]);

    res.json({ message: 'Your link to your child is verified.' });
  } catch (error) {
    console.error('Parent link confirm error:', error);
    res.status(500).json({ message: 'Could not verify the code.' });
  }
});

// Admin: verify a parent's link after checking school records
router.post('/admin/:userId/verify', auth, allow('ADMIN'), async (req, res) => {
  try {
    const profile = await prisma.parentProfile.findUnique({
      where: { userId: req.params.userId }
    });
    if (!profile?.studentId) {
      return res.status(400).json({ message: 'This parent has no matching student to verify.' });
    }
    await prisma.parentProfile.update({
      where: { userId: req.params.userId },
      data: {
        verifiedStudentId: profile.studentId,
        verifiedAt: new Date(),
        verifiedBy: `ADMIN:${req.user.id}`
      }
    });
    res.json({ message: 'Parent link verified.' });
  } catch (error) {
    console.error('Admin parent verify error:', error);
    res.status(500).json({ message: 'Could not verify this parent link.' });
  }
});

// Admin: revoke a verified link
router.post('/admin/:userId/revoke', auth, allow('ADMIN'), async (req, res) => {
  try {
    await prisma.parentProfile.update({
      where: { userId: req.params.userId },
      data: { verifiedStudentId: null, verifiedAt: null, verifiedBy: null }
    });
    res.json({ message: 'Parent link verification removed.' });
  } catch (error) {
    console.error('Admin parent revoke error:', error);
    res.status(500).json({ message: 'Could not remove verification.' });
  }
});

export default router;
