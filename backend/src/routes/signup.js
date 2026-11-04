// ======================================================
// SELF SIGN-UP (college)
// ------------------------------------------------------
// Parent: enters their name, email, password, the student's
//   USN and the student's phone number. Both must match the
//   student record. A 6-digit code is sent to the STUDENT's
//   phone; the parent enters it to activate the account.
// Staff: signs up, then waits for admin approval.
// Admin creates driver and student accounts directly
// (users.js); those are unaffected.
// ======================================================

import crypto from 'crypto';
import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { jwtSecret } from '../security/settings.js';
import { hashPassword, passwordProblem } from '../security/passwords.js';
import { sendEmail } from '../services/locationAlerts.js';
import { deliveryChannels } from '../services/otpDelivery.js';

const router = express.Router();

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_WAIT_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;

function hashCode(userId, code) {
  return crypto
    .createHmac('sha256', jwtSecret())
    .update(`${userId}:${code}`)
    .digest('hex');
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Sends a fresh code to the student's phone for a pending parent
async function sendStudentCode(parentId, studentId, studentEmail) {
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  await prisma.parentLinkOtp.upsert({
    where: { parentId },
    create: {
      parentId,
      studentId,
      codeHash: hashCode(parentId, code),
      attempts: 0,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      createdAt: new Date()
    },
    update: {
      studentId,
      codeHash: hashCode(parentId, code),
      attempts: 0,
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
      createdAt: new Date()
    }
  });
  await sendEmail(
    studentEmail,
    'NaviGuard: parent sign-up code',
    `A parent is signing up for your NaviGuard bus account.\n\n` +
      `Share this code with your parent only if they are your parent: ${code}\n\n` +
      'It expires in 10 minutes. If this was not you, ignore this email.'
  );
}

// Parent sign-up: match USN + student phone, then send code to student
router.post('/parent', async (req, res) => {
  try {
    const name = cleanText(req.body?.name, 120);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const usn = cleanText(req.body?.usn, 60);
    const studentEmail = cleanText(req.body?.studentEmail, 254).toLowerCase();

    if (!name || !validEmail(email) || !usn || !validEmail(studentEmail)) {
      return res.status(400).json({ message: 'Enter your name, email, the student USN and the student email.' });
    }
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: problem });
    if (!deliveryChannels().email) {
      return res.status(503).json({ message: 'Email is not configured on this server. Contact the transport office.' });
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    const student = await prisma.user.findFirst({
      where: { role: 'STUDENT', institutionId: usn },
      select: { id: true, email: true }
    });
    if (!student || student.email.toLowerCase() !== studentEmail) {
      return res.status(400).json({ message: 'The USN and student email do not match our records.' });
    }

    const parent = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: 'PARENT',
        approvalStatus: 'PENDING_OTP',
        parentProfile: { create: { studentId: student.id } }
      }
    });

    await sendStudentCode(parent.id, student.id, student.email);
    res.status(201).json({
      message: 'A code was sent to the student email. Enter it to activate your account.',
      email
    });
  } catch (error) {
    console.error('Parent sign-up error:', error);
    res.status(500).json({ message: 'Could not create the account. Try again.' });
  }
});

// Parent: resend the student code (one per minute)
router.post('/parent/resend', async (req, res) => {
  try {
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.approvalStatus !== 'PENDING_OTP') {
      return res.status(400).json({ message: 'No pending sign-up for this email.' });
    }
    const row = await prisma.parentLinkOtp.findUnique({ where: { parentId: user.id } });
    if (row && Date.now() - row.createdAt.getTime() < RESEND_WAIT_MS) {
      return res.status(429).json({ message: 'Please wait a minute before requesting another code.' });
    }
    const profile = await prisma.parentProfile.findUnique({ where: { userId: user.id } });
    const student = await prisma.user.findUnique({ where: { id: profile.studentId }, select: { id: true, email: true } });
    if (!student?.email) return res.status(400).json({ message: 'The student has no email on record.' });
    await sendStudentCode(user.id, student.id, student.email);
    res.json({ message: 'A new code was sent to the student email.' });
  } catch (error) {
    console.error('Parent resend error:', error);
    res.status(500).json({ message: 'Could not send a new code.' });
  }
});

// Parent: enter the code to activate the account
router.post('/parent/verify', async (req, res) => {
  try {
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: 'Enter the 6-digit code.' });

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.approvalStatus !== 'PENDING_OTP') {
      return res.status(400).json({ message: 'No pending sign-up for this email.' });
    }
    const row = await prisma.parentLinkOtp.findUnique({ where: { parentId: user.id } });
    if (!row || row.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ message: 'No valid code. Request a new code.' });
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many wrong attempts. Request a new code.' });
    }

    const expected = Buffer.from(row.codeHash, 'hex');
    const given = Buffer.from(hashCode(user.id, code), 'hex');
    const matches = expected.length === given.length && crypto.timingSafeEqual(expected, given);
    if (!matches) {
      await prisma.parentLinkOtp.update({ where: { parentId: user.id }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ message: 'Incorrect code.' });
    }

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { approvalStatus: 'APPROVED' } }),
      prisma.parentProfile.update({
        where: { userId: user.id },
        data: { verifiedStudentId: row.studentId, verifiedAt: new Date(), verifiedBy: 'STUDENT_SIGNUP_CODE' }
      }),
      prisma.parentLinkOtp.delete({ where: { parentId: user.id } })
    ]);
    res.json({ message: 'Your account is active. You can log in now.' });
  } catch (error) {
    console.error('Parent verify error:', error);
    res.status(500).json({ message: 'Could not verify the code.' });
  }
});

// Staff sign-up: waits for admin approval
router.post('/staff', async (req, res) => {
  try {
    const name = cleanText(req.body?.name, 120);
    const email = cleanText(req.body?.email, 254).toLowerCase();
    const department = cleanText(req.body?.department, 120) || null;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name || !validEmail(email)) {
      return res.status(400).json({ message: 'Enter your name and a valid email.' });
    }
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: problem });
    if (await prisma.user.findUnique({ where: { email } })) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }
    await prisma.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password),
        role: 'STAFF',
        approvalStatus: 'PENDING_ADMIN',
        staffProfile: { create: { department } }
      }
    });
    res.status(201).json({ message: 'Sign-up received. An admin must approve your account before you can log in.' });
  } catch (error) {
    console.error('Staff sign-up error:', error);
    res.status(500).json({ message: 'Could not create the account. Try again.' });
  }
});

// Admin: list staff waiting for approval
router.get('/pending', auth, allow('ADMIN'), async (req, res) => {
  const rows = await prisma.user.findMany({
    where: { approvalStatus: 'PENDING_ADMIN' },
    select: { id: true, name: true, email: true, createdAt: true, staffProfile: { select: { department: true } } },
    orderBy: { createdAt: 'asc' }
  });
  res.json(rows);
});

// Admin: approve or reject a staff sign-up
router.post('/:id/decision', auth, allow('ADMIN'), async (req, res) => {
  try {
    const decision = String(req.body?.decision || '').toUpperCase();
    if (!['APPROVE', 'REJECT'].includes(decision)) {
      return res.status(400).json({ message: 'Decision must be APPROVE or REJECT.' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user || user.approvalStatus !== 'PENDING_ADMIN') {
      return res.status(400).json({ message: 'This sign-up is not waiting for approval.' });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { approvalStatus: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED' }
    });
    res.json({ message: decision === 'APPROVE' ? 'Staff account approved.' : 'Staff sign-up rejected.' });
  } catch (error) {
    console.error('Sign-up decision error:', error);
    res.status(500).json({ message: 'Could not update this sign-up.' });
  }
});

export default router;
