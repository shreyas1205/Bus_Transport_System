// ======================================================
// LAST-KNOWN-LOCATION ALERTS (SMS + EMAIL)
// ------------------------------------------------------
// Sent when an accident is confirmed or a route deviation
// is detected. Recipients: all admins, and verified parents
// of students on the affected bus's route.
//
// Channels reuse the existing OTP delivery configuration:
//   SMTP_HOST / SMTP_USER / SMTP_PASS / SMTP_FROM   -> email
//   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN /
//   TWILIO_FROM_NUMBER (or MESSAGING_SERVICE_SID)   -> SMS
// In demo mode, or when a channel is not configured, the
// alert is still stored as an in-app notification and the
// skipped channels are reported in the return value.
// This function never throws: alert failures must not block
// the emergency workflow.
// ======================================================

import nodemailer from 'nodemailer';
import { prisma } from '../prisma.js';
import { deliveryChannels, normalisePhone } from './otpDelivery.js';
import { verifiedParentStudent } from './parentTransportAccess.js';

let transporter;

function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 587);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }
  return transporter;
}

export async function sendEmail(to, subject, text) {
  const result = await getTransporter().sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    text,
  });
  if (!result.accepted?.length) throw new Error('EMAIL_NOT_ACCEPTED');
}

export async function sendSms(to, body) {
  const params = new URLSearchParams({ To: to, Body: body });
  if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
    params.set('MessagingServiceSid', process.env.TWILIO_MESSAGING_SERVICE_SID);
  } else {
    params.set('From', process.env.TWILIO_FROM_NUMBER);
  }
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
      signal: AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) throw new Error(`SMS_HTTP_${response.status}`);
}

// Latest persisted GPS point for the bus, or null.
export async function lastKnownLocation(vehicleId) {
  const point = await prisma.vehicleLocation.findFirst({
    where: { vehicleId },
    orderBy: { recordedAt: 'desc' },
  });
  return point || null;
}

// Parents (verified only) of students who ride this route.
async function routeParents(routeId) {
  if (!routeId) return [];
  const students = await prisma.user.findMany({
    where: {
      role: { in: ['STUDENT', 'STAFF'] },
      OR: [
        { assignedRouteId: routeId },
        { transportEnrollments: { some: { routeId } } },
      ],
    },
    select: { id: true },
  });
  const studentIds = new Set(students.map(s => s.id));
  if (!studentIds.size) return [];

  const parents = await prisma.user.findMany({
    where: { role: 'PARENT' },
    include: { parentProfile: true },
  });
  const linked = parents.filter(
    p => p.parentProfile?.studentId && studentIds.has(p.parentProfile.studentId)
  );
  const verified = [];
  for (const parent of linked) {
    if (await verifiedParentStudent(parent.id)) verified.push(parent);
  }
  return verified;
}

async function adminUsers() {
  return prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true, name: true, email: true, phone: true },
  });
}

function formatLocationText(point) {
  if (!point) {
    return 'Last known location: not available (no GPS update received from this bus).';
  }
  const lat = Number(point.latitude).toFixed(5);
  const lng = Number(point.longitude).toFixed(5);
  const when = new Date(point.recordedAt).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    `Last known location: ${lat}, ${lng} (at ${when} IST)\n` +
    `Map: https://maps.google.com/?q=${lat},${lng}`
  );
}

/**
 * @param {object} opts
 * @param {'ACCIDENT_CONFIRMED'|'ROUTE_DEVIATION'} opts.reason
 * @param {string} opts.vehicleId
 * @param {string|null} [opts.routeId]  optional; looked up from the bus if omitted
 * @param {object|null} [opts.extraDetail]  e.g. { distanceM: 420 }
 */
export async function sendLastKnownLocationAlert({ reason, vehicleId, routeId = null, extraDetail = null }) {
  const summary = { sms: 0, email: 0, skipped: [], failed: 0 };
  try {
    const vehicle = vehicleId
      ? await prisma.vehicle.findUnique({ where: { id: vehicleId } })
      : null;
    const route = routeId
      ? await prisma.route.findUnique({ where: { id: routeId } })
      : vehicleId
        ? await prisma.route.findFirst({ where: { assignedBusId: vehicleId } })
        : null;

    const busLabel = vehicle?.busNumber || vehicle?.registrationNo || 'Campus bus';
    const point = vehicleId ? await lastKnownLocation(vehicleId) : null;
    const locationText = formatLocationText(point);

    const headline =
      reason === 'ACCIDENT_CONFIRMED'
        ? `NaviGuard ALERT: accident confirmed on bus ${busLabel}.`
        : `NaviGuard ALERT: bus ${busLabel} has deviated from route ${route?.code || 'assigned route'}.`;
    const detail = extraDetail?.distanceM != null
      ? ` Deviation about ${Math.round(extraDetail.distanceM)} m from route.`
      : '';
    const subject = headline.replace(/\.$/, '');
    const body = `${headline}${detail}\n${locationText}\n— NaviGuard`;
    const smsBody = `${headline}${detail} ${locationText.split('\n').slice(0, 2).join(' ')}`;

    const admins = await adminUsers();
    const parents = await routeParents(route?.id || null);
    const recipients = [...admins, ...parents];

    const channels = deliveryChannels();
    if (!channels.email) summary.skipped.push('email');
    if (!channels.sms) summary.skipped.push('sms');

    for (const user of recipients) {
      if (channels.email && user.email) {
        try {
          await sendEmail(user.email, subject, body);
          summary.email += 1;
        } catch (error) {
          summary.failed += 1;
          console.error('Location alert email failed:', error.message);
        }
      }
      const phone = channels.sms ? normalisePhone(user.phone || '') : null;
      if (phone) {
        try {
          await sendSms(phone, smsBody);
          summary.sms += 1;
        } catch (error) {
          summary.failed += 1;
          console.error('Location alert SMS failed:', error.message);
        }
      }
    }
  } catch (error) {
    summary.failed += 1;
    console.error('Location alert error:', error.message);
  }
  return summary;
}
