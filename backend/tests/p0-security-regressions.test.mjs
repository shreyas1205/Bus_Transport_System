import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { readFile } from 'node:fs/promises';
import { prisma } from '../src/prisma.js';
import { createSocketAuthenticator, emitEmergencyUpdate } from '../src/security/socketAuth.js';
import { default as authRouter } from '../src/routes/auth.js';
import { default as paymentRouter } from '../src/routes/payments.js';
import { default as usersRouter } from '../src/routes/users.js';

const response = () => ({
  statusCode: 200,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; }
});
const handlerFor = (router, method, path) => {
  const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
  return route.stack.at(-1).handle;
};

const originalEnv = process.env.VERIFIED_GUARDIAN_LINKS;
const originals = {
  findUser: prisma.user.findUnique,
  updateUser: prisma.user.update,
  transaction: prisma.$transaction,
  findPayment: prisma.payment.findUnique,
  findParent: prisma.parentProfile.findUnique
};

try {
  process.env.VERIFIED_GUARDIAN_LINKS = '[]';

  // A Parent cannot change the phone number used by automatic guardian matching.
  prisma.user.findUnique = async () => ({ phone: '9876543210' });
  let writes = 0;
  prisma.$transaction = async () => { writes++; throw new Error('Unexpected profile write'); };
  const profileResponse = response();
  await handlerFor(authRouter, 'patch', '/profile')({
    user: { id: 'parent-synthetic', role: 'PARENT' },
    body: { phone: '9123456789' }
  }, profileResponse, error => { throw error; });
  assert.equal(profileResponse.statusCode, 403);
  assert.equal(writes, 0);

  // A raw ParentProfile link cannot grant access to a student's receipt.
  prisma.payment.findUnique = async () => ({
    id: 'payment-synthetic', status: 'PAID', userId: 'student-synthetic',
    fee: { userId: 'student-synthetic', academicYear: '2026-27', user: { name: 'Synthetic student', email: 'student@example.invalid', institutionId: 'TEST' }, pickupStop: null }
  });
  prisma.parentProfile.findUnique = async () => ({ studentId: 'student-synthetic' });
  const receiptResponse = response();
  await handlerFor(paymentRouter, 'get', '/:paymentId/receipt')({
    user: { id: 'parent-synthetic', role: 'PARENT' },
    params: { paymentId: 'payment-synthetic' }
  }, receiptResponse, error => { throw error; });
  assert.equal(receiptResponse.statusCode, 403);
  assert.equal(receiptResponse.body?.student, undefined);

  // Changing roles returns the public user projection, never a stored hash.
  prisma.user.update = async () => ({ id: 'user-synthetic', role: 'DRIVER', passwordHash: 'synthetic-hash' });
  const roleResponse = response();
  await handlerFor(usersRouter, 'patch', '/:id/role')({
    user: { id: 'admin-synthetic', role: 'ADMIN' },
    params: { id: 'user-synthetic' }, body: { role: 'DRIVER' }
  }, roleResponse, error => { throw error; });
  assert.equal(roleResponse.body.passwordHash, undefined);

  // Socket authentication checks token validity, database role/version, and target rooms.
  const secret = 'synthetic-audit-secret-that-is-never-logged';
  const users = new Map([['admin-synthetic', { id: 'admin-synthetic', role: 'ADMIN', name: 'Admin', passwordVersion: 0 }], ['driver-synthetic', { id: 'driver-synthetic', role: 'DRIVER', name: 'Driver', passwordVersion: 1 }]]);
  const authenticate = createSocketAuthenticator({ getSecret: () => secret, findUserById: async id => users.get(id) });
  async function connect(token) {
    const rooms = [];
    const socket = { handshake: { auth: token ? { token } : {} }, data: {}, join: async room => rooms.push(room) };
    const error = await new Promise(resolve => authenticate(socket, resolve));
    return { socket, rooms, error };
  }
  assert.ok((await connect(null)).error);
  assert.ok((await connect(jwt.sign({ id: 'missing' }, secret, { algorithm: 'HS256' }))).error);
  assert.ok((await connect(jwt.sign({ id: 'driver-synthetic', pv: 0 }, secret, { algorithm: 'HS256' }))).error);
  const admin = await connect(jwt.sign({ id: 'admin-synthetic', pv: 0 }, secret, { algorithm: 'HS256' }));
  const driver = await connect(jwt.sign({ id: 'driver-synthetic', pv: 1 }, secret, { algorithm: 'HS256' }));
  assert.equal(admin.error, undefined);
  assert.deepEqual(admin.rooms, ['user:admin-synthetic', 'role:ADMIN']);
  assert.deepEqual(driver.rooms, ['user:driver-synthetic']);

  const emitted = [];
  const io = { to: room => ({ emit: (event, payload) => emitted.push({ room, event, payload }) }) };
  const incident = { id: 'incident-synthetic', driverId: 'driver-synthetic', guardianPhone: 'private' };
  emitEmergencyUpdate(io, 'accident:possible', incident);
  assert.deepEqual(emitted.map(item => item.room), ['role:ADMIN', 'user:driver-synthetic']);
  emitted.length = 0;
  emitEmergencyUpdate(io, 'emergency:autonomous-dispatch', incident, { incident, distressPacket: { student: 'private' } }, true);
  assert.deepEqual(emitted.map(item => item.room), ['role:ADMIN']);
  const serverSource = await readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(serverSource, /io\.use\(createSocketAuthenticator/);
  console.log('PASS: parent contact/link and receipt isolation, password hash redaction, authenticated and targeted emergency sockets');
} finally {
  prisma.user.findUnique = originals.findUser;
  prisma.user.update = originals.updateUser;
  prisma.payment.findUnique = originals.findPayment;
  prisma.parentProfile.findUnique = originals.findParent;
  prisma.$transaction = originals.transaction;
  if (originalEnv === undefined) delete process.env.VERIFIED_GUARDIAN_LINKS;
  else process.env.VERIFIED_GUARDIAN_LINKS = originalEnv;
  await prisma.$disconnect();
}
