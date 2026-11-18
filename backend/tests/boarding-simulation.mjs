// Boarding & drop-off simulation for Driver, Student, Parent and Admin.
// Loads the real passes (daily QR) + boarding routers and guardian checks, backed by an
// in-memory database.   node tests/boarding-simulation.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { T, prisma, mk } from './sim-harness.mjs';

const SECRET = 'sim-secret-'.repeat(4);
const ENV = { JWT_SECRET: SECRET, VERIFIED_GUARDIAN_LINKS: JSON.stringify([{ parentId: 'par1', studentId: 'stu1' }, { parentId: 'par3', studentId: 'stu3' }]) };

// ---------------- campus ----------------
mk('user', { id: 'admin', role: 'ADMIN', name: 'Transport Admin' });
mk('user', { id: 'drv', role: 'DRIVER', name: 'Ravi Kumar' });
mk('user', { id: 'drv2', role: 'DRIVER', name: 'Suresh M' });
mk('vehicle', { id: 'bus1', busNumber: '1', registrationNo: 'KA-01-CB-101', status: 'ACTIVE' });
mk('vehicle', { id: 'bus2', busNumber: '2', registrationNo: 'KA-01-CB-102', status: 'ACTIVE' });
mk('stop', { id: 'sA', name: 'Main Gate', latitude: 12.97, longitude: 77.59 });
mk('route', { id: 'r1', code: 'CB-R1', name: 'North Campus Loop', isActive: true, assignedBusId: 'bus1', assignedDriverId: 'drv', temporaryDriverAssignments: [] });
mk('route', { id: 'r2', code: 'CB-R2', name: 'South Loop', isActive: true, assignedBusId: 'bus2', assignedDriverId: 'drv2', temporaryDriverAssignments: [] });
mk('routeStop', { id: 'rs1', routeId: 'r1', stopId: 'sA', sequence: 1 });
const future = new Date(Date.now() + 30 * 864e5), past = new Date(Date.now() - 864e5);
for (const [id, name, route, inst] of [['stu1', 'Aarav Shah', 'r1', 'STU-1'], ['stu2', 'Diya Rao', 'r2', 'STU-2'], ['stu3', 'Kabir Nair', 'r1', 'STU-3'], ['stu4', 'No Pass', 'r1', 'STU-4']]) {
  mk('user', { id, role: 'STUDENT', name, institutionId: inst, assignedRouteId: route, pickupStopId: 'sA' });
  if (id !== 'stu4') mk('busPass', { id: `pass_${id}`, userId: id, routeId: route, passNumber: `P-${id}`, status: 'ACTIVE', validFrom: past, validUntil: future });
}
mk('user', { id: 'par1', role: 'PARENT', name: 'Anita Shah' }); mk('parentProfile', { id: 'pp1', userId: 'par1', studentId: 'stu1' });
mk('user', { id: 'par3', role: 'PARENT', name: 'Leela Nair' }); mk('parentProfile', { id: 'pp3', userId: 'par3', studentId: 'stu3' });
mk('user', { id: 'parU', role: 'PARENT', name: 'Unverified' }); mk('parentProfile', { id: 'ppU', userId: 'parU', studentId: 'stu1' });

// ---------------- load the real code ----------------
const events = [];
const io = { emit: (e, p) => events.push({ room: 'ALL', e, p }), to(room) { const rooms = [room]; const c = { to: r => (rooms.push(r), c), emit: (e, p) => rooms.forEach(rm => events.push({ room: rm, e, p })) }; return c; } };
const src = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/^import [\s\S]*?;\r?\n/gm, '');
const allowCtx = vm.createContext({}); vm.runInContext('function allow' + fs.readFileSync(new URL('../src/middleware.js', import.meta.url), 'utf8').split('export function allow')[1], allowCtx);
const makeCtx = () => vm.createContext({
  prisma, crypto, Buffer, Intl, console: { ...console, error: () => {} }, process: { env: ENV }, Date, Math, JSON, Number, String, Promise, Map, Set, URLSearchParams, setTimeout, clearTimeout,
  auth: (q, s, n) => q.user ? n() : s.status(401).json({}), allow: allowCtx.allow,
  express: { Router: () => { const h = new Map(); const r = Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(m => [m, (p, ...f) => h.set(`${m.toUpperCase()} ${p}`, f)])); r._h = h; return r; } },
});
const passesCtx = makeCtx(), boardCtx = makeCtx();
for (const c of [passesCtx, boardCtx]) vm.runInContext(src('../src/services/parentTransportAccess.js').replace(/export /g, ''), c);
vm.runInContext(src('../src/routes/passes.js').replace('const router =', 'var router =').replace('export default router;', ''), passesCtx);
vm.runInContext(src('../src/routes/boarding.js').replace('const router =', 'var router =').replace('export default router;', ''), boardCtx);
async function call(ctx, method, path, user, body = {}, query = {}) {
  const chain = ctx.router._h.get(`${method} ${path}`); if (!chain) throw new Error('no route ' + path);
  const req = { body, params: {}, query, user, app: { get: () => io } };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } };
  let i = 0; const next = async e => { if (e) throw e; let f; await chain[i++]?.(req, res, x => (f = next(x))); await f; }; await next();
  return res;
}
const B = (...a) => call(boardCtx, ...a), P = (...a) => call(passesCtx, ...a);
const U = { admin: { id: 'admin', role: 'ADMIN' }, drv: { id: 'drv', role: 'DRIVER', name: 'Ravi Kumar' }, drv2: { id: 'drv2', role: 'DRIVER' },
  stu1: { id: 'stu1', role: 'STUDENT' }, stu2: { id: 'stu2', role: 'STUDENT' }, stu3: { id: 'stu3', role: 'STUDENT' }, stu4: { id: 'stu4', role: 'STUDENT' },
  par1: { id: 'par1', role: 'PARENT' }, par3: { id: 'par3', role: 'PARENT' }, parU: { id: 'parU', role: 'PARENT' } };
const notes = (who, re = /./) => T.notification.filter(n => n.userId === who && re.test(`${n.title} ${n.message}`));
const results = []; let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); ok ? pass++ : fail++; };
const statusOf = d => d?.status || d?.journey?.status || d?.boardingStatus || d?.current?.status;
const forgeQr = (uid, pid, d) => { const enc = Buffer.from(JSON.stringify({ v: 1, uid, pid, d })).toString('base64url'); const sig = crypto.createHmac('sha256', SECRET).update(enc).digest('base64url'); return `CBQR1.${enc}.${sig}`; };

// 1 daily QR
let r = await P('GET', '/daily-qr', U.stu1); const qr1 = r.data?.token;
check('1a. Student with an active pass gets today\'s signed QR', r.code === 200 && /^CBQR1\./.test(qr1 || ''), `valid for ${r.data?.validFor} (${r.data?.date})`);
r = await P('GET', '/daily-qr', U.stu4);
check('1b. Student without an active pass cannot get a QR', r.code === 403, r.data?.message);

// 2 scan
events.length = 0;
r = await B('POST', '/scan', U.drv, { identifier: qr1, method: 'QR' });
const ev1 = T.boardingEvent.find(e => e.userId === 'stu1');
check('2a. Driver scans the QR → student BOARDED on the right bus', r.code < 300 && ev1?.status === 'BOARDED' && ev1.vehicleId === 'bus1', `${r.code} ${r.data?.message || r.data?.status || ''}`);
check('2b. Verified parent is notified the child boarded', notes('par1').length >= 1, notes('par1')[0]?.title);
check('2c. Unverified parent is NOT notified', notes('parU').length === 0);

// 3 duplicate & concurrency
const before = T.boardingEvent.length;
r = await B('POST', '/scan', U.drv, { identifier: qr1, method: 'QR' });
const conc = await Promise.all([1, 2, 3].map(() => B('POST', '/scan', U.drv, { identifier: qr1, method: 'QR' })));
check('3. Scanning the same QR again (incl. 3 at once) does not double-board', T.boardingEvent.length === before && T.boardingEvent.filter(e => e.userId === 'stu1' && e.status === 'BOARDED').length === 1,
  `repeat scan: ${r.code} ${r.data?.message || r.data?.status || ''}`);

// 4 invalid QRs
r = await B('POST', '/scan', U.drv, { identifier: qr1.slice(0, -4) + 'AAAA' });
check('4a. Tampered QR is rejected', r.code >= 400, r.data?.message);
r = await B('POST', '/scan', U.drv, { identifier: forgeQr('stu3', 'pass_stu3', '2020-01-01') });
check('4b. Old (expired) QR is rejected', r.code >= 400, r.data?.message);
r = await B('POST', '/scan', U.drv, { identifier: forgeQr('stu1', 'pass_stu3', new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())) });
check("4c. QR using someone else's pass is rejected", r.code >= 400, r.data?.message);
const qr2 = (await P('GET', '/daily-qr', U.stu2)).data?.token;
r = await B('POST', '/scan', U.drv, { identifier: qr2 });
check('4d. Student from another route is rejected by this driver', r.code >= 400 && !T.boardingEvent.some(e => e.userId === 'stu2'), r.data?.message);

// 5 role restrictions
r = await B('POST', '/scan', U.stu1, { identifier: qr1 });
const r5b = await B('POST', '/toggle', U.par1, { studentId: 'stu1', boarded: false });
check('5a. Students and parents cannot scan or mark boarding', r.code === 403 && r5b.code === 403);
r = await B('POST', '/toggle', U.drv2, { studentId: 'stu3', boarded: true });
check("5b. A driver cannot board a student on another driver's route", r.code >= 400 && !T.boardingEvent.some(e => e.userId === 'stu3'), r.data?.message);

// 6 what each role sees
const s1 = await B('GET', '/my-status', U.stu1), p1 = await B('GET', '/my-status', U.par1), pu = await B('GET', '/my-status', U.parU);
check('6a. Student sees "boarded"', s1.code === 200 && /BOARD/i.test(JSON.stringify(s1.data)), `student: ${statusOf(s1.data) || JSON.stringify(s1.data).slice(0, 80)}`);
check('6b. Verified parent sees their child boarded', p1.code === 200 && /BOARD/i.test(JSON.stringify(p1.data)) && /stu1|Aarav/.test(JSON.stringify(p1.data)));
check('6c. Unverified parent is blocked', pu.code === 403, pu.data?.message);
const roster = await B('GET', '/driver-roster', U.drv), today = await B('GET', '/today', U.admin);
check("6d. Driver roster shows own route's students with status", roster.code === 200 && /Aarav/.test(JSON.stringify(roster.data)) && !/Diya/.test(JSON.stringify(roster.data)));
check('6e. Admin sees today\'s boarding records', today.code === 200 && /Aarav|stu1/.test(JSON.stringify(today.data)));

// 7 manual board (no phone / QR)
r = await B('POST', '/toggle', U.drv, { studentId: 'stu3', boarded: true });
check('7a. Driver can board a student manually from the roster', r.code < 300 && T.boardingEvent.some(e => e.userId === 'stu3' && e.status === 'BOARDED'), `${r.code} ${r.data?.message || ''}`);
check('7b. That student\'s verified parent is notified', notes('par3').length >= 1, notes('par3')[0]?.title);

// 8 drop-off
const parBefore = notes('par1').length;
r = await B('POST', '/drop-off', U.drv, { studentId: 'stu1' });
check('8a. Driver drops the student off → DROPPED_OFF', r.code < 300 && T.boardingEvent.some(e => e.userId === 'stu1' && e.status === 'DROPPED_OFF'), `${r.code} ${r.data?.message || ''}`);
check('8b. Parent is notified of the drop-off', notes('par1').length > parBefore, notes('par1').at(-1)?.title);
const p1b = await B('GET', '/my-status', U.par1);
check('8c. Parent now sees "dropped off"', /DROPPED/i.test(JSON.stringify(p1b.data)));
r = await B('POST', '/drop-off', U.drv, { studentId: 'stu4' });
check('8d. Cannot drop off a student who never boarded', r.code >= 400, r.data?.message);

// 9 privacy of live events
const bad = events.filter(e => e.room === 'ALL' && /Aarav|Kabir|phone/.test(JSON.stringify(e.p || {})));
check('9. Boarding refresh events broadcast to everyone carry no student names', bad.length === 0, `${events.filter(e => e.room === 'ALL').length} global refresh event(s)`);

console.log('\nNaviGuard boarding & drop-off — simulated run for Driver, Student, Parent, Admin\n');
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? `\n      ${x.detail}` : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
