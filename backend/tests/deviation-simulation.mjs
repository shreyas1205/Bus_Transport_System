// Route-deviation simulation for every role (Admin, Driver, Student, Parent).
// Loads the real live-location router + guardian checks, backs them with an in-memory
// database, drives a bus along its route and off it, and checks what each role sees.
//   node tests/deviation-simulation.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import { T, prisma, mk } from './sim-harness.mjs';

// ---------------- campus ----------------
mk('user', { id: 'admin', role: 'ADMIN', name: 'Transport Admin' });
mk('user', { id: 'drv', role: 'DRIVER', name: 'Ravi Kumar', phone: '9000000001' });
mk('user', { id: 'drv2', role: 'DRIVER', name: 'Suresh M', phone: '9000000005' });
mk('vehicle', { id: 'bus1', busNumber: '1', registrationNo: 'KA-01-CB-101', status: 'ACTIVE', capacity: 50 });
mk('vehicle', { id: 'bus2', busNumber: '2', registrationNo: 'KA-01-CB-102', status: 'ACTIVE', capacity: 40 });
const STOPS = [['sA', 'Main Gate', 12.9700, 77.5900], ['sB', 'Metro Station', 12.9750, 77.5950], ['sC', 'Hostel Block A', 12.9800, 77.6000]];
for (const [id, name, latitude, longitude] of STOPS) mk('stop', { id, name, latitude, longitude, geofenceM: 150 });
mk('route', { id: 'r1', code: 'CB-R1', name: 'North Campus Loop', isActive: true, assignedBusId: 'bus1', assignedDriverId: 'drv', speedLimitKmph: 40, approachAlertMinutes: 10 });
mk('route', { id: 'r2', code: 'CB-R2', name: 'South Loop', isActive: true, assignedBusId: 'bus2', assignedDriverId: 'drv2', speedLimitKmph: 40 });
STOPS.forEach(([id], i) => mk('routeStop', { id: `rs${i}`, routeId: 'r1', stopId: id, sequence: i + 1 }));
mk('routeStop', { id: 'rs9', routeId: 'r2', stopId: 'sA', sequence: 1 });
mk('user', { id: 'stu1', role: 'STUDENT', name: 'Aarav Shah', institutionId: 'STU-1', assignedRouteId: 'r1', pickupStopId: 'sC' });
mk('user', { id: 'stu2', role: 'STUDENT', name: 'Diya Rao', institutionId: 'STU-2', assignedRouteId: 'r2', pickupStopId: 'sA' });
mk('user', { id: 'par1', role: 'PARENT', name: 'Anita Shah' }); mk('parentProfile', { id: 'pp1', userId: 'par1', studentId: 'stu1' });
mk('user', { id: 'par2', role: 'PARENT', name: 'Meena Rao' }); mk('parentProfile', { id: 'pp2', userId: 'par2', studentId: 'stu2' });
mk('user', { id: 'parU', role: 'PARENT', name: 'Unverified Parent' }); mk('parentProfile', { id: 'ppU', userId: 'parU', studentId: 'stu1' });
const ENV = { VERIFIED_GUARDIAN_LINKS: JSON.stringify([{ parentId: 'par1', studentId: 'stu1' }, { parentId: 'par2', studentId: 'stu2' }]) };

// ---------------- load the real code ----------------
const events = [];
const io = { emit: (e, p) => events.push({ room: 'ALL', e, p }), to(room) { const rooms = [room]; const c = { to: r => (rooms.push(r), c), emit: (e, p) => rooms.forEach(rm => events.push({ room: rm, e, p })) }; return c; } };
const strip = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/^import [\s\S]*?;\r?\n/gm, '');
const allowCtx = vm.createContext({}); vm.runInContext('function allow' + fs.readFileSync(new URL('../src/middleware.js', import.meta.url), 'utf8').split('export function allow')[1], allowCtx);
const ctx = vm.createContext({
  prisma, console: { ...console, error: () => {} }, process: { env: ENV }, Date, Math, JSON, Number, String, Promise, Map, Set, URLSearchParams,
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
  detectGpsSuddenStop: async () => ({ possibleAccident: false }),
  sendLastKnownLocationAlert: async () => ({ sms: 0, email: 0, skipped: [], failed: 0 }),
  auth: (q, s, n) => q.user ? n() : s.status(401).json({}), allow: allowCtx.allow,
  express: { Router: () => { const h = new Map(); const r = Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(m => [m, (p, ...f) => h.set(`${m.toUpperCase()} ${p}`, f)])); r._h = h; return r; } },
});
vm.runInContext(strip('../src/services/parentTransportAccess.js').replace(/export /g, ''), ctx);
vm.runInContext(strip('../src/routes/liveLocation.js').replace('const router =', 'var router =').replace('export default router;', ''), ctx);
async function call(method, path, user, body = {}) {
  const chain = ctx.router._h.get(`${method} ${path}`); if (!chain) throw new Error('no route ' + path);
  const req = { body, params: {}, query: {}, user, app: { get: () => io } };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } };
  let i = 0; const next = async e => { if (e) throw e; let f; await chain[i++]?.(req, res, x => (f = next(x))); await f; }; await next();
  return res;
}
const tick = () => new Promise(r => setTimeout(r, 3));
const gps = async (latitude, longitude, speedKmph = 30, accuracy = 10) => { await tick(); return call('POST', '/update', U.drv, { latitude, longitude, speedKmph, accuracy, recordedAt: new Date().toISOString() }); };

// ---------------- helpers ----------------
const U = { admin: { id: 'admin', role: 'ADMIN' }, drv: { id: 'drv', role: 'DRIVER', name: 'Ravi Kumar' }, drv2: { id: 'drv2', role: 'DRIVER' },
  stu1: { id: 'stu1', role: 'STUDENT' }, stu2: { id: 'stu2', role: 'STUDENT' }, par1: { id: 'par1', role: 'PARENT' }, par2: { id: 'par2', role: 'PARENT' }, parU: { id: 'parU', role: 'PARENT' } };
const view = async who => { const r = await call('GET', '/', U[who]); const v = r.data?.vehicles?.find(x => x.id === 'bus1'); return { code: r.code, v, t: v?.tracking, all: r.data?.vehicles || [] }; };
const notes = (who, re) => T.notification.filter(n => n.userId === who && re.test(n.title));
const results = []; let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); ok ? pass++ : fail++; };
const ON = [12.9725, 77.5925];      // midway Main Gate -> Metro (on route)
const OFF = [12.9725, 77.5850];     // ~600 m west of the route
const ROLES = ['admin', 'drv', 'stu1', 'par1'];

// 1 GPS before trip
let r = await gps(...ON);
check('1. GPS before the driver starts the trip is refused', r.code === 409, r.data?.message);

// 2 start trip, drive on route
r = await call('POST', '/trip/start', U.drv);
check('2a. Driver starts the trip', r.code === 200 && r.data.trip?.active, r.data?.message);
r = await gps(...ON);
const onViews = Object.fromEntries(await Promise.all(ROLES.map(async w => [w, await view(w)])));
check('2b. On route: Admin, Driver, Student and Parent all see the bus "on route"',
  ROLES.every(w => onViews[w].t && onViews[w].t.offRoute === false && onViews[w].t.stale === false),
  ROLES.map(w => `${w}: ${onViews[w].t?.distanceFromRouteM ?? '—'} m`).join(', '));
check('2c. No deviation alert while on route', T.notification.filter(n => /ROUTE DEVIATION/.test(n.title)).length === 0);

// 3 low-accuracy fix off route -> ignored
r = await gps(...OFF, 30, 80);
const lowAcc = await view('admin');
check('3. Poor GPS accuracy (80 m) off route does NOT raise a false deviation', r.code === 200 && lowAcc.t.offRoute === false && T.notification.filter(n => /ROUTE DEVIATION/.test(n.title)).length === 0);

// 4 real deviation
events.length = 0;
r = await gps(...OFF);
const offViews = Object.fromEntries(await Promise.all(ROLES.map(async w => [w, await view(w)])));
const dist = offViews.admin.t?.distanceFromRouteM;
check('4a. Bus ~600 m off route is detected', r.code === 200 && offViews.admin.t?.offRoute === true && dist > 350, `${dist} m from route (limit 350 m + GPS accuracy)`);
check('4b. Admin is notified', notes('admin', /^ROUTE DEVIATION/).length === 1, notes('admin', /^ROUTE DEVIATION/)[0]?.message);
check('4c. The route driver is notified', notes('drv', /^ROUTE DEVIATION/).length === 1);
check('4d. Student and parent get NO alarm notification (design: caution shown on their bus card only)', notes('stu1', /DEVIATION/).length === 0 && notes('par1', /DEVIATION/).length === 0);
check('4e. Student and parent still SEE the deviation status on their live tracking card', offViews.stu1.t?.offRoute === true && offViews.par1.t?.offRoute === true,
  `student sees ${offViews.stu1.t?.distanceFromRouteM} m, parent sees ${offViews.par1.t?.distanceFromRouteM} m`);
check('4f. Other drivers / other-route students and parents are not notified', ['drv2', 'stu2', 'par2'].every(w => notes(w, /DEVIATION/).length === 0));
const dev = events.filter(e => e.e === 'route:deviation');
check('4g. Live refresh event carries no personal data', dev.length > 0 && dev.every(e => !JSON.stringify(e.p).match(/Aarav|Anita|phone|9000/)),
  `sent to ${[...new Set(dev.map(e => e.room))].join(', ')}: ${JSON.stringify(dev[0]?.p)}`);

// 5 isolation
const other = await view('stu2'), otherPar = await view('par2'), unver = await call('GET', '/', U.parU), drv2v = await view('drv2');
check("5a. Students/parents on another route cannot see this bus at all", !other.v && !otherPar.v && other.all.every(v => v.id !== 'bus1'));
check('5b. Unverified parent is blocked from live tracking', unver.code === 403, unver.data?.message);
check("5c. Another driver cannot see this bus", !drv2v.v);
check('5d. Admin and driver also get the trip timeline; students/parents do not', (offViews.admin.v?.timeline || []).length > 0 && (offViews.drv.v?.timeline || []).length > 0 && (offViews.stu1.v?.timeline || []).length === 0 && (offViews.par1.v?.timeline || []).length === 0,
  `timeline: ${(offViews.admin.v?.timeline || []).map(x => x.type || x.label).slice(0, 3).join(' | ')}`);

// 6 cooldown
r = await gps(OFF[0] + 0.0002, OFF[1]);
check('6. Staying off route does not spam (15-min cooldown)', notes('admin', /^ROUTE DEVIATION/).length === 1 && notes('drv', /^ROUTE DEVIATION/).length === 1);

// 7 inevitable deviation
r = await call('POST', '/deviation/inevitable', U.drv);
check('7a. Driver marks the deviation unavoidable → Admin is informed', r.code === 200 && notes('admin', /INEVITABLE/).length === 1, notes('admin', /INEVITABLE/)[0]?.message);
check('7b. "Unavoidable" notice goes to Admin only (not parents/students)', ['stu1', 'par1', 'stu2', 'par2'].every(w => notes(w, /INEVITABLE/).length === 0));
r = await call('POST', '/deviation/inevitable', { id: 'stu1', role: 'STUDENT' });
check('7c. Only drivers can send the "unavoidable" notice', r.code === 403);

// 8 back on route
r = await gps(12.9760, 77.5960);
const back = Object.fromEntries(await Promise.all(ROLES.map(async w => [w, await view(w)])));
check('8a. Back on route: every role sees "on route" again', ROLES.every(w => back[w].t?.offRoute === false), ROLES.map(w => `${w}: ${back[w].t?.distanceFromRouteM} m`).join(', '));
r = await call('POST', '/deviation/inevitable', U.drv);
check('8b. "Unavoidable" notice is refused when the bus is on route', r.code === 409, r.data?.message);

// 9 overspeed
r = await gps(12.9765, 77.5965, 62);
const os = await view('par1');
check('9a. Overspeed (62 km/h in a 40 zone) is flagged', os.t?.overspeed === true, `${os.t?.overspeedByKmph} km/h over`);
check('9b. Admin and driver are alerted about overspeed', notes('admin', /OVERSPEED|Overspeed/i).length >= 1 && notes('drv', /OVERSPEED|Overspeed/i).length >= 1,
  notes('admin', /OVERSPEED|Overspeed/i)[0]?.title);

// 10 end trip
r = await call('POST', '/trip/end', U.drv);
const ended = Object.fromEntries(await Promise.all(ROLES.map(async w => [w, await view(w)])));
check('10a. After the trip ends, nobody sees a live position or a deviation', ROLES.every(w => !ended[w].v || (ended[w].t?.offRoute === false && ended[w].v.latitude == null)));
r = await gps(...OFF);
check('10b. GPS after the trip ended is refused (no false deviation)', r.code === 409);

// ---------------- report ----------------
console.log('\nNaviGuard route deviation — simulated run for Admin, Driver, Student, Parent\n');
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? `\n      ${x.detail}` : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
