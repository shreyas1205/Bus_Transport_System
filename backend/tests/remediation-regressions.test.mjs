// Regression tests for the October 2026 remediation pass (audit items 4, 8, 10, 11-backend).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const allowContext = vm.createContext({});
vm.runInContext(fs.readFileSync('src/middleware.js', 'utf8').split('export function allow')[1].replace(/^/, 'function allow'), allowContext);

function load(file, db, extra = {}) {
  const handlers = new Map();
  const c = vm.createContext({
    isDemoMode: () => false, console, process: { env: {} }, prisma: db, Date, Math, Number, JSON,
    express: { Router: () => Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(m => [m, (p, ...h) => handlers.set(m + ' ' + p, h)])) },
    auth: (q, s, n) => q.user ? n() : s.status(401).json({}), allow: allowContext.allow,
    requireVerifiedParentTransport: (q, s, n) => { q.verifiedStudentId = 'child'; n(); },
    emitEmergencyUpdate: () => {}, verifiedParentStudent: async () => null,
    activateAutonomousEmergencyResponse: async () => ({}), isAutonomousDispatchEligible: () => false,
    syncTemporaryDriverAssignments: async () => {}, calculateEtaMinutes: () => 0,
    ...extra
  });
  vm.runInContext(fs.readFileSync(file, 'utf8').replace(/^import [\s\S]*?;\r?\n/gm, '').replace('export default router;', ''), c);
  return Object.assign(async (method, path, body = {}, user = { role: 'ADMIN', id: 'admin' }) => {
    const req = { body, params: { id: 'bus' }, query: {}, user, app: { get: () => null } };
    const res = { code: 200, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } };
    const chain = handlers.get(method + ' ' + path); assert(chain, method + ' ' + path);
    let i = 0; async function next() { let f; await chain[i++]?.(req, res, () => f = next()); await f; } await next();
    return res;
  }, { context: c });
}

test('driver emergencies are scoped to the assigned bus and validate sensor ranges', async () => {
  const created = [];
  const db = {
    route: { findMany: async ({ where }) => where.assignedDriverId === 'driver' ? [{ assignedBusId: 'bus-1' }] : [] },
    vehicle: { findUnique: async ({ where }) => ({ id: where.id }) },
    incident: { create: async ({ data }) => { created.push(data); return { id: String(created.length), ...data }; } },
    user: { findMany: async () => [] },
    notification: { createMany: async () => {} }
  };
  const call = load('src/routes/incidents.js', db);
  const driver = { role: 'DRIVER', id: 'driver' };
  assert.equal((await call('post', '/sos', { vehicleId: 'someone-else' }, driver)).code, 403);
  assert.equal((await call('post', '/sos', { latitude: 999, longitude: 999 }, driver)).code, 400);
  const sos = await call('post', '/sos', {}, driver);
  assert.equal(sos.code, 201); assert.equal(sos.data.vehicleId, 'bus-1', 'SOS auto-attaches the assigned bus');
  assert.equal((await call('post', '/accident-detection', { vehicleId: 'someone-else', speedBefore: 60, speedAfter: 0, impactGForce: 6 }, driver)).code, 403);
  assert.equal((await call('post', '/accident-detection', { speedBefore: 60, speedAfter: 0, impactGForce: 500 }, driver)).code, 400);
  const unassigned = await call('post', '/accident-detection', { speedBefore: 60, speedAfter: 0 }, { role: 'DRIVER', id: 'other' });
  assert.equal(unassigned.code, 400);
});

test('bus capacity must be a positive whole number', async () => {
  const db = { vehicle: { findFirst: async () => null, findUnique: async () => ({ id: 'bus', capacity: 40, status: 'ACTIVE', registrationNo: 'R', model: 'M' }), create: async ({ data }) => data, update: async ({ data }) => data } };
  const call = load('src/routes/vehicles.js', db);
  for (const capacity of [-1, 0, 2.5, 'abc', 500]) {
    assert.equal((await call('post', '/', { registrationNo: 'KA01', model: 'Bus', capacity })).code, 400, `capacity ${capacity}`);
    assert.equal((await call('patch', '/:id', { capacity })).code, 400, `patch capacity ${capacity}`);
  }
});

test('riders and drivers only see their own bus in /vehicles', async () => {
  let lastWhere;
  const db = {
    vehicle: { findMany: async ({ where }) => { lastWhere = where; return []; } },
    user: { findUnique: async ({ where }) => ({ assignedRoute: { assignedBusId: where.id === 'stu' ? 'bus-s' : 'bus-c' } }) },
    route: { findMany: async () => [{ assignedBusId: 'bus-d' }] }
  };
  const call = load('src/routes/vehicles.js', db);
  await call('get', '/', {}, { role: 'STUDENT', id: 'stu' }); assert.equal(JSON.stringify(lastWhere.id.in), JSON.stringify(['bus-s']));
  await call('get', '/', {}, { role: 'PARENT', id: 'par' }); assert.equal(JSON.stringify(lastWhere.id.in), JSON.stringify(['bus-c']));
  await call('get', '/', {}, { role: 'DRIVER', id: 'drv' }); assert.equal(JSON.stringify(lastWhere.id.in), JSON.stringify(['bus-d']));
  await call('get', '/', {}, { role: 'ADMIN', id: 'adm' }); assert.equal(JSON.stringify(lastWhere), '{}');
});

test('analytics final amount handles zero base and legacy rows', () => {
  const c = vm.createContext({});
  const src = fs.readFileSync('src/routes/dashboard.js', 'utf8');
  vm.runInContext(src.slice(src.indexOf('const finalAmount'), src.indexOf('router.get')).replace('const finalAmount', 'var finalAmount'), c);
  assert.equal(c.finalAmount({ baseAmount: 0, amount: 100, adjustmentAmount: 100 }), 100);
  assert.equal(c.finalAmount({ baseAmount: null, amount: 100, adjustmentAmount: 100 }), 100);
  assert.equal(c.finalAmount({ baseAmount: 500, discountAmount: 50, adjustmentAmount: 10 }), 460);
  assert.equal(c.finalAmount({ baseAmount: 10, discountAmount: 50 }), 0);
});
