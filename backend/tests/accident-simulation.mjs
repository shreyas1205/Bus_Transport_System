// End-to-end accident workflow simulation (no real database, no real dispatch).
// Loads the real incidents router + emergency response service, backs them with an
// in-memory database, and drives realistic scenarios with fake sensor/GPS data.
//   node tests/accident-simulation.mjs
import fs from 'node:fs';
import vm from 'node:vm';

// ---------------- in-memory database ----------------
const T = { user: [], vehicle: [], route: [], routeStop: [], stop: [], incident: [], notification: [], boardingEvent: [],
  parentProfile: [], studentProfile: [], driverProfile: [], vehicleLocation: [], busPass: [] };
let seq = 0;
const REL = { vehicle: ['vehicle', 'vehicleId'], driver: ['user', 'driverId'], assignedBus: ['vehicle', 'assignedBusId'], assignedDriver: ['user', 'assignedDriverId'],
  user: ['user', 'userId'], student: ['user', 'studentId'], route: ['route', 'routeId'], stop: ['stop', 'stopId'], pickupStop: ['stop', 'pickupStopId'], assignedRoute: ['route', 'assignedRouteId'] };
const BACK = { parentProfile: ['parentProfile', 'userId'], studentProfile: ['studentProfile', 'userId'], driverProfile: ['driverProfile', 'userId'],
  routes: ['route', 'assignedBusId', true], stops: ['routeStop', 'routeId', true], boardingEvents: ['boardingEvent', 'vehicleId', true],
  driverRoutes: ['route', 'assignedDriverId', true], students: ['user', 'assignedRouteId', true] };
const rel = (row, k) => {
  if (REL[k]) { const [t, f] = REL[k]; return T[t].find(r => r.id === row[f]) || null; }
  if (BACK[k]) { const [t, f, many] = BACK[k]; const list = T[t].filter(r => r[f] === row.id); return many ? list : list[0] || null; }
  return undefined;
};
function cmp(v, cond) {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return v instanceof Date && cond instanceof Date ? +v === +cond : v === cond;
  for (const [op, x] of Object.entries(cond)) {
    if (op === 'in' && !x.includes(v)) return false;
    if (op === 'notIn' && x.includes(v)) return false;
    if (op === 'not' && (x !== null && typeof x === 'object' ? cmp(v, x) : v === x)) return false;
    if (op === 'equals' && v !== x) return false;
    if (op === 'gte' && !(v >= x)) return false; if (op === 'gt' && !(v > x)) return false;
    if (op === 'lte' && !(v <= x)) return false; if (op === 'lt' && !(v < x)) return false;
    if (op === 'contains' && !String(v ?? '').toLowerCase().includes(String(x).toLowerCase())) return false;
    if (op === 'mode') continue;
  }
  return true;
}
function match(row, where = {}) {
  return Object.entries(where || {}).every(([k, c]) => {
    if (c === undefined) return true;
    if (k === 'OR') return c.some(w => match(row, w));
    if (k === 'AND') return (Array.isArray(c) ? c : [c]).every(w => match(row, w));
    if (k === 'NOT') return !(Array.isArray(c) ? c : [c]).some(w => match(row, w));
    const r = rel(row, k);
    if (r !== undefined && c && typeof c === 'object' && !(c instanceof Date)) {
      if (Array.isArray(r)) { if (c.some) return r.some(x => match(x, c.some)); if (c.none) return !r.some(x => match(x, c.none)); if (c.every) return r.every(x => match(x, c.every)); return true; }
      if (c.is !== undefined) return c.is === null ? !r : !!r && match(r, c.is);
      return !!r && match(r, c);
    }
    return cmp(row[k], c);
  });
}
function shape(row, args = {}) {
  if (!row) return row;
  const inc = args.include || args.select || {};
  const out = { ...row };
  for (const [k, v] of Object.entries(inc)) {
    if (!v) continue;
    const r = rel(row, k);
    if (r === undefined) continue;
    const sub = typeof v === 'object' ? v : {};
    out[k] = Array.isArray(r) ? r.filter(x => match(x, sub.where)).map(x => shape(x, sub)) : shape(r, sub);
  }
  return out;
}
const apply = (row, data) => { for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] || 0) + v.increment : v; row.updatedAt = new Date(); return row; };
function model(name) {
  const rows = T[name];
  const sortFn = ob => (a, b) => { for (const o of [].concat(ob || [])) for (const [k, d] of Object.entries(o)) { if (a[k] < b[k]) return d === 'desc' ? 1 : -1; if (a[k] > b[k]) return d === 'desc' ? -1 : 1; } return 0; };
  return {
    findUnique: async a => shape(rows.find(r => match(r, a.where)) || null, a),
    findFirst: async (a = {}) => shape([...rows].filter(r => match(r, a.where)).sort(sortFn(a.orderBy))[0] || null, a),
    findMany: async (a = {}) => [...rows].filter(r => match(r, a.where)).sort(sortFn(a.orderBy)).slice(0, a.take ?? Infinity).map(r => shape(r, a)),
    count: async (a = {}) => rows.filter(r => match(r, a.where)).length,
    create: async a => { const row = { id: `${name}_${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...a.data }; rows.push(row); return shape(row, a); },
    createMany: async a => { for (const d of a.data) rows.push({ id: `${name}_${++seq}`, createdAt: new Date(), ...d }); return { count: a.data.length }; },
    update: async a => { const row = rows.find(r => match(r, a.where)); if (!row) throw new Error(`${name} not found`); return shape(apply(row, a.data), a); },
    updateMany: async a => { const list = rows.filter(r => match(r, a.where)); list.forEach(r => apply(r, a.data)); return { count: list.length }; },
    deleteMany: async () => ({ count: 0 }),
  };
}
const prisma = Object.fromEntries(Object.keys(T).map(n => [n, model(n)]));
prisma.$transaction = async fn => typeof fn === 'function' ? fn(prisma) : Promise.all(fn);
prisma.$executeRaw = async () => 0; prisma.$queryRaw = async () => [];

// ---------------- campus scenario data ----------------
const mk = (t, d) => { const r = { id: d.id, createdAt: new Date(), ...d }; T[t].push(r); return r; };
mk('user', { id: 'admin', role: 'ADMIN', name: 'Transport Admin', email: 'admin@x' });
mk('user', { id: 'drv', role: 'DRIVER', name: 'Ravi Kumar', phone: '9000000001' });
mk('user', { id: 'drv2', role: 'DRIVER', name: 'Suresh M', phone: '9000000005' });
mk('vehicle', { id: 'bus1', busNumber: '1', registrationNo: 'KA-01-CB-101', status: 'ACTIVE', latitude: 12.97, longitude: 77.59, speedKmph: 0 });
mk('vehicle', { id: 'bus2', busNumber: '2', registrationNo: 'KA-01-CB-102', status: 'ACTIVE' });
mk('route', { id: 'r1', code: 'CB-R1', name: 'North Campus Loop', isActive: true, assignedBusId: 'bus1', assignedDriverId: 'drv' });
mk('route', { id: 'r2', code: 'CB-R2', name: 'South Loop', isActive: true, assignedBusId: 'bus2', assignedDriverId: 'drv2' });
for (const [i, n] of ['Aarav', 'Diya', 'Kabir'].entries()) {
  mk('user', { id: `stu${i}`, role: 'STUDENT', name: `${n} S`, institutionId: `STU-${i}`, assignedRouteId: 'r1', phone: `98000000${i}` });
  mk('user', { id: `par${i}`, role: 'PARENT', name: `Parent of ${n}`, phone: `97000000${i}` });
  mk('parentProfile', { id: `pp${i}`, userId: `par${i}`, studentId: `stu${i}` });
}
mk('user', { id: 'stuX', role: 'STUDENT', name: 'Other-route student', institutionId: 'STU-X', assignedRouteId: 'r2' });
mk('user', { id: 'parX', role: 'PARENT', name: 'Other-route parent', phone: '9600000000' });
mk('parentProfile', { id: 'ppX', userId: 'parX', studentId: 'stuX' });
const today = new Date();
for (const i of [0, 1]) mk('boardingEvent', { id: `be${i}`, userId: `stu${i}`, vehicleId: 'bus1', routeId: 'r1', status: 'BOARDED', type: 'BOARDED', scannedAt: today, createdAt: today });

// ---------------- load the real code ----------------
const events = []; const timers = [];
const io = { emit: (e, p) => events.push({ room: 'ALL', e, p }), to(room) { const rooms = [room]; const chain = { to: r => (rooms.push(r), chain), emit: (e, p) => rooms.forEach(rm => events.push({ room: rm, e, p })) }; return chain; } };
const strip = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/^import [\s\S]*?;\r?\n/gm, '');
const allowSrc = fs.readFileSync(new URL('../src/middleware.js', import.meta.url), 'utf8').split('export function allow')[1];
const allowCtx = vm.createContext({}); vm.runInContext('function allow' + allowSrc, allowCtx);
let httpCalls = 0;
const ctx = vm.createContext({
  prisma, console: { ...console, error: () => {} }, process: { env: { EMERGENCY_DISPATCH_MODE: 'demo' } }, Date, Math, JSON, Number, String, Promise, Map, Set, URLSearchParams, AbortController,
  sendLastKnownLocationAlert: async () => ({ sms: 0, email: 0, skipped: [], failed: 0 }),
  setTimeout: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; }, clearTimeout: t => { if (t) t.done = true; },
  fetch: async () => { httpCalls++; return { ok: true, json: async () => ({ elements: [
    { type: 'node', id: 1, lat: 12.972, lon: 77.592, tags: { amenity: 'hospital', name: 'City Hospital', phone: '080-1111' } },
    { type: 'node', id: 2, lat: 12.975, lon: 77.588, tags: { amenity: 'police', name: 'Campus Police Station', phone: '080-2222' } }] }) }; },
  isDemoMode: () => false,
  emitEmergencyUpdate: (io_, e, inc, p = inc, adminsOnly = false) => { io_.to('role:ADMIN').emit(e, p); if (!adminsOnly && inc?.driverId) io_.to(`user:${inc.driverId}`).emit(e, p); },
  verifiedParentStudent: async id => T.parentProfile.find(p => p.userId === id)?.studentId || null,
  auth: (q, s, n) => q.user ? n() : s.status(401).json({}), allow: allowCtx.allow,
  express: { Router: () => { const h = new Map(); const r = Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(m => [m, (p, ...f) => h.set(`${m.toUpperCase()} ${p}`, f)])); r._h = h; return r; } },
});
vm.runInContext(strip('../src/services/emergencyResponse.js').replace(/export /g, ''), ctx);
vm.runInContext(strip('../src/routes/incidents.js').replace('const router =', 'var router =').replace('export default router;', ''), ctx);
async function call(method, path, { body = {}, user, params = {} } = {}) {
  const chain = ctx.router._h.get(`${method} ${path}`); if (!chain) throw new Error('no route ' + path);
  const req = { body, params, query: {}, user, app: { get: () => io } };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } };
  let i = 0; const next = async () => { let f; await chain[i++]?.(req, res, () => (f = next())); await f; }; await next();
  await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  return res;
}
const runTimers = async () => { for (const t of timers.filter(t => !t.done)) { t.done = true; await t.fn(); } };
const settle = () => new Promise(r => setTimeout(r, 30));

// ---------------- scenarios ----------------
const results = []; let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); ok ? pass++ : fail++; };
const DRIVER = { id: 'drv', role: 'DRIVER', name: 'Ravi Kumar' };
const ADMIN = { id: 'admin', role: 'ADMIN' };
const notesFor = id => T.notification.filter(n => n.userId === id);
const reset = () => { events.length = 0; };

// 1 normal braking
reset(); let r = await call('POST', '/accident-detection', { user: DRIVER, body: { speedBefore: 42, speedAfter: 30, impactGForce: 0.4, tiltDegrees: 2, latitude: 12.97, longitude: 77.59 } });
check('1. Normal braking does not create an incident', r.code === 200 && r.data.possibleAccident === false && T.incident.length === 0, `confidence ${r.data.confidence}`);

// 2 spoofed bus
r = await call('POST', '/accident-detection', { user: DRIVER, body: { vehicleId: 'bus2', speedBefore: 60, speedAfter: 0, impactGForce: 6 } });
check("2. Driver cannot report an accident for another driver's bus", r.code === 403);

// 3 impossible sensor values
r = await call('POST', '/accident-detection', { user: DRIVER, body: { speedBefore: 60, speedAfter: 0, impactGForce: 500, latitude: 999, longitude: 999 } });
check('3. Impossible sensor / GPS values are rejected', r.code === 400, r.data?.message);

// 4 medium-confidence accident -> driver says SAFE
reset(); const beforeParents = T.notification.filter(n => n.userId.startsWith('par')).length;
r = await call('POST', '/accident-detection', { user: DRIVER, body: { speedBefore: 35, speedAfter: 3, impactGForce: 3.2, tiltDegrees: 8, latitude: 12.97, longitude: 77.59 } });
const inc4 = r.data.incident;
check('4a. Possible accident creates a PENDING incident needing verification', r.code === 201 && r.data.requiresVerification && inc4?.verificationStatus === 'PENDING' && inc4.vehicleId === 'bus1',
  `confidence ${inc4?.aiConfidence}, ${r.data.verificationWindowSeconds}s window`);
check('4b. Admin is alerted and the countdown starts', notesFor('admin').some(n => /Possible Bus Accident/.test(n.title)) && timers.some(t => !t.done));
check('4c. Alert goes only to admins + this driver (no global broadcast)', events.length > 0 && events.every(e => e.room === 'role:ADMIN' || e.room === 'user:drv'), events.map(e => `${e.room}:${e.e}`).join(', '));
reset(); r = await call('PATCH', '/:id/driver-response', { user: DRIVER, params: { id: inc4.id }, body: { response: 'SAFE' } });
const i4 = T.incident.find(x => x.id === inc4.id);
check('4d. Driver "I\'m safe" marks a FALSE ALARM and resolves it', r.code === 200 && i4.verificationStatus === 'FALSE_ALARM' && i4.status === 'RESOLVED' && i4.emergencyDispatchStatus === 'NOT_REQUIRED');
check('4e. No parents are notified for a false alarm', T.notification.filter(n => n.userId.startsWith('par')).length === beforeParents);
await runTimers();
check('4f. Countdown expiring after "safe" does not escalate', !notesFor('admin').some(n => n.title === 'Driver Not Responding'));

// 5 accident -> driver confirms EMERGENCY
for (const x of T.incident) { x.createdAt = new Date(Date.now() - 3600e3); } // move earlier incidents outside the cooldown window
reset(); const httpBefore = httpCalls;
r = await call('POST', '/accident-detection', { user: DRIVER, body: { speedBefore: 36, speedAfter: 2, impactGForce: 3.4, tiltDegrees: 10, latitude: 12.9705, longitude: 77.5905 } });
const inc5 = r.data.incident;
r = await call('PATCH', '/:id/driver-response', { user: DRIVER, params: { id: inc5.id }, body: { response: 'EMERGENCY' } }); await settle();
const i5 = T.incident.find(x => x.id === inc5.id);
const packet = i5?.detectionSignals?.autonomousEmergencyResponse?.distressPacket;
check('5a. Driver confirmation marks the accident CONFIRMED', r.code === 200 && i5.verificationStatus === 'CONFIRMED' && i5.confirmationSource === 'DRIVER', r.data?.message);
check('5b. Parents of students on this bus/route are notified; other routes are not', ['par0', 'par1', 'par2'].every(p => notesFor(p).length > 0) && notesFor('parX').length === 0,
  `on board: ${r.data.onboardStudents}, parents notified: ${r.data.parentsNotified}`);
check('5c. Distress packet has location, bus, driver and passengers', !!packet && packet.location?.latitude === 12.9705 && /12\.9705/.test(packet.location?.mapUrl || '') && packet.route?.code === 'CB-R1' && packet.driver?.name === 'Ravi Kumar' && packet.passengers?.onboardStudents === 2);
check('5d. Demo mode: nearest hospital/police found, NO real emergency service contacted', r.data.dispatch?.mode === 'DEMO' && r.data.dispatch?.realEmergencyServiceContacted === false,
  `hospital: ${r.data.emergencyResources?.hospitals?.[0]?.name || '—'}, police: ${r.data.emergencyResources?.police?.[0]?.name || '—'}, lookups: ${httpCalls - httpBefore}`);
r = await call('PATCH', '/:id/driver-response', { user: DRIVER, params: { id: inc5.id }, body: { response: 'EMERGENCY' } });
check('5e. Confirming twice is blocked (no duplicate dispatch)', r.code === 409);

// 6 driver never responds -> countdown escalation
for (const x of T.incident) { x.createdAt = new Date(Date.now() - 3600e3); }
reset();
r = await call('POST', '/accident-detection', { user: DRIVER, body: { speedBefore: 34, speedAfter: 4, impactGForce: 3.1, tiltDegrees: 5, latitude: 12.97, longitude: 77.59 } });
const inc6 = r.data.incident; await runTimers();
const i6 = T.incident.find(x => x.id === inc6.id);
check('6a. No driver response: admin gets "Driver Not Responding" after the countdown', notesFor('admin').some(n => n.title === 'Driver Not Responding') && i6.priority >= 9);
check('6b. Timeout alone does not trigger external dispatch', i6.verificationStatus === 'PENDING' && !i6.detectionSignals?.autonomousEmergencyResponse);
r = await call('PATCH', '/:id/verify', { user: ADMIN, params: { id: inc6.id }, body: { action: 'CONFIRM' } }); await settle();
const i6b = T.incident.find(x => x.id === inc6.id);
check('6c. Admin can then verify the accident', r.code < 300 && i6b.verificationStatus === 'CONFIRMED', `HTTP ${r.code} ${r.data?.message || ''}`);

// 7 high-confidence crash -> autonomous response
for (const x of T.incident) { x.createdAt = new Date(Date.now() - 3600e3); }
reset();
r = await call('POST', '/accident-detection', { user: DRIVER, body: { speedBefore: 70, speedAfter: 0, impactGForce: 7.5, tiltDegrees: 70, latitude: 12.971, longitude: 77.591 } }); await settle(); await settle();
const i7 = T.incident.find(x => x.id === r.data.incident?.id);
check('7. Severe crash (high confidence) triggers the autonomous response immediately', r.code === 201 && r.data.autonomousDispatchTriggered === true && i7?.verificationStatus === 'CONFIRMED',
  `confidence ${i7?.aiConfidence}, dispatch ${i7?.emergencyDispatchStatus}`);

// 8 duplicate detection
for (const x of T.incident) { x.createdAt = new Date(Date.now() - 3600e3); x.status = 'RESOLVED'; x.verificationStatus = x.verificationStatus === 'PENDING' ? 'FALSE_ALARM' : x.verificationStatus; }
const countBefore = T.incident.length;
const dup = await Promise.all([1, 2, 3].map(() => ctx.detectGpsSuddenStop({ vehicleId: 'bus1', driverId: 'drv', latitude: 12.97, longitude: 77.59, currentSpeed: 2, previousLocation: { speedKmph: 50, recordedAt: new Date() }, io })));
check('8. GPS sudden stop: 3 simultaneous readings create exactly one incident', T.incident.length - countBefore === 1, `${dup.filter(d => d?.possibleAccident).length} flagged, ${T.incident.length - countBefore} created`);

// 9 another driver cannot respond
r = await call('PATCH', '/:id/driver-response', { user: { id: 'drv2', role: 'DRIVER' }, params: { id: inc6.id }, body: { response: 'SAFE' } });
check("9. Another driver cannot respond to this driver's incident", r.code === 403 || r.code === 409, `HTTP ${r.code}`);

// 10 admin resolves
r = await call('PATCH', '/:id/status', { user: ADMIN, params: { id: inc5.id }, body: { status: 'RESOLVED' } });
check('10. Admin can resolve the incident afterwards', r.code < 300 && T.incident.find(x => x.id === inc5.id).status === 'RESOLVED', `HTTP ${r.code}`);

// ---------------- report ----------------
console.log('\nNaviGuard accident workflow — simulated run (demo dispatch, in-memory data)\n');
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? `\n      ${x.detail}` : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
