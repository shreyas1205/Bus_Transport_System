// Fees & payments simulation (fake Razorpay, no real money).
// Loads the real payments + fees routers, backed by an in-memory database.
//   node tests/payment-simulation.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { T, prisma, mk } from './sim-harness.mjs';

const KEY_SECRET = 'rzp_test_secret_simulation';
const ENV = { RAZORPAY_KEY_ID: 'rzp_test_sim', RAZORPAY_KEY_SECRET: KEY_SECRET, JWT_SECRET: 'x'.repeat(40),
  VERIFIED_GUARDIAN_LINKS: JSON.stringify([{ parentId: 'par1', studentId: 'stu1' }]) };

// ---------------- campus ----------------
mk('user', { id: 'admin', role: 'ADMIN', name: 'Transport Admin' });
mk('route', { id: 'r1', code: 'CB-R1', name: 'North Loop', isActive: true });
mk('stop', { id: 'sA', name: 'Hostel Block A' });
for (const [id, name] of [['stu1', 'Aarav Shah'], ['stu2', 'Diya Rao']]) mk('user', { id, role: 'STUDENT', name, email: `${id}@x`, institutionId: id.toUpperCase(), assignedRouteId: 'r1' });
mk('user', { id: 'stf1', role: 'STAFF', name: 'Prof. Rao', email: 'stf1@x' });
mk('user', { id: 'par1', role: 'PARENT', name: 'Anita Shah' }); mk('parentProfile', { id: 'pp1', userId: 'par1', studentId: 'stu1' });
mk('user', { id: 'parU', role: 'PARENT', name: 'Unverified' }); mk('parentProfile', { id: 'ppU', userId: 'parU', studentId: 'stu1' });
const due = new Date(Date.now() + 10 * 864e5);
mk('fee', { id: 'fee1', userId: 'stu1', academicYear: '2026-27', amount: 18000, baseAmount: 18000, discountAmount: 0, adjustmentAmount: 0, status: 'PENDING', dueDate: due, pickupStopId: 'sA' });
mk('fee', { id: 'fee2', userId: 'stu2', academicYear: '2026-27', amount: 15000, baseAmount: 15000, discountAmount: 0, adjustmentAmount: 0, status: 'PENDING', dueDate: due });
mk('fee', { id: 'fee3', userId: 'stf1', academicYear: '2026-27', amount: 12000, baseAmount: 12000, discountAmount: 0, adjustmentAmount: 0, status: 'PENDING', dueDate: due });

// ---------------- fake Razorpay ----------------
let orderSeq = 0; const orders = [];
class FakeRazorpay { constructor(o) { this.key = o.key_id; this.orders = { create: async d => { const o = { id: `order_SIM${++orderSeq}`, ...d, status: 'created' }; orders.push(o); return o; } }; } }
const gatewayPay = orderId => { const pid = `pay_SIM${crypto.randomBytes(4).toString('hex')}`; return { razorpay_order_id: orderId, razorpay_payment_id: pid, razorpay_signature: crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${pid}`).digest('hex') }; };

// ---------------- load real code ----------------
const src = f => fs.readFileSync(new URL(f, import.meta.url), 'utf8').replace(/^import [\s\S]*?;\r?\n/gm, '');
const allowCtx = vm.createContext({}); vm.runInContext('function allow' + fs.readFileSync(new URL('../src/middleware.js', import.meta.url), 'utf8').split('export function allow')[1], allowCtx);
const makeCtx = () => vm.createContext({
  prisma, crypto, Buffer, Intl, console: { ...console, error: () => {}, log: () => {} }, process: { env: ENV }, Date, Math, JSON, Number, String, Promise, Map, Set, URLSearchParams,
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {}, __FakeRazorpay: FakeRazorpay,
  isDemoMode: () => false, blockDemoAction: (q, s, n) => n(), allowDemoPayment: (q, s) => s.status(403).json({ code: 'PAYMENT_VERIFICATION_REQUIRED' }),
  nodemailer: { createTransport: () => ({ sendMail: async () => ({}) }) },
  auth: (q, s, n) => q.user ? n() : s.status(401).json({}), allow: allowCtx.allow,
  express: { Router: () => { const h = new Map(); const r = Object.fromEntries(['get', 'post', 'patch', 'put', 'delete'].map(m => [m, (p, ...f) => h.set(`${m.toUpperCase()} ${p}`, f)])); r._h = h; return r; } },
});
const payCtx = makeCtx(), feeCtx = makeCtx();
for (const c of [payCtx, feeCtx]) vm.runInContext(src('../src/services/parentTransportAccess.js').replace(/export /g, ''), c);
vm.runInContext(src('../src/routes/payments.js').replace("(await import('razorpay')).default", '__FakeRazorpay').replace('const router =', 'var router =').replace('export default router;', ''), payCtx);
vm.runInContext(src('../src/routes/fees.js').replace('const router =', 'var router =').replace('export default router;', ''), feeCtx);
async function call(ctx, method, path, user, body = {}, params = {}) {
  const chain = ctx.router._h.get(`${method} ${path}`); if (!chain) throw new Error('no route ' + path);
  const req = { body, params, query: {}, user, app: { get: () => null } };
  const res = { code: 200, status(n) { this.code = n; return this; }, json(d) { this.data = d; return this; } };
  let i = 0; const next = async e => { if (e) throw e; let f; await chain[i++]?.(req, res, x => (f = next(x))); await f; }; await next();
  return res;
}
const PAY = (...a) => call(payCtx, ...a), FEE = (...a) => call(feeCtx, ...a);
const U = { admin: { id: 'admin', role: 'ADMIN' }, stu1: { id: 'stu1', role: 'STUDENT' }, stu2: { id: 'stu2', role: 'STUDENT' }, stf1: { id: 'stf1', role: 'STAFF' },
  par1: { id: 'par1', role: 'PARENT' }, parU: { id: 'parU', role: 'PARENT' } };
const results = []; let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); ok ? pass++ : fail++; };
const paidFor = feeId => T.payment.filter(p => p.feeId === feeId && p.status === 'PAID');

// 1 viewing fees
let r = await FEE('GET', '/my', U.stu1);
check('1a. Student sees their own fee', r.code === 200 && r.data.fees?.length === 1 && r.data.fees[0].amount === 18000);
r = await FEE('GET', '/my', U.par1);
check("1b. Verified parent sees their child's fee", r.code === 200 && r.data.fees?.[0]?.id === 'fee1');
r = await FEE('GET', '/my', U.parU);
check('1c. Unverified parent sees no fee', r.code === 404 || !r.data?.fees?.length, r.data?.message);

// 2 order creation
r = await PAY('POST', '/create-order', U.stu1, { feeId: 'fee1' }); const ord1 = r.data;
check('2a. Student creates a Razorpay order for the exact fee amount', r.code === 200 && ord1.order?.amount === 1800000 && ord1.payment?.status === 'PENDING', `₹${ord1.order?.amount / 100} → ${ord1.order?.id}`);
r = await PAY('POST', '/create-order', U.stu1, { feeId: 'fee2' });
check("2b. Student cannot pay someone else's fee", r.code === 400);
r = await PAY('POST', '/create-order', U.parU, { feeId: 'fee1' });
check('2c. Unverified parent cannot pay', r.code === 400);
r = await PAY('POST', '/create-order', U.admin, { feeId: 'fee1' });
check('2d. Admin cannot create a payment order for a student', r.code === 403);

// 3 verification
const g1 = gatewayPay(ord1.order.id);
r = await PAY('POST', '/verify', U.stu1, { paymentId: ord1.payment.id, ...g1, razorpay_signature: 'f'.repeat(64) });
check('3a. Forged payment signature is rejected and marked FAILED', r.code === 400 && T.payment.find(p => p.id === ord1.payment.id).status === 'FAILED' && T.fee.find(f => f.id === 'fee1').status === 'PENDING', r.data?.message);
r = await PAY('POST', '/create-order', U.stu1, { feeId: 'fee1' }); const ord2 = r.data;
const g2 = gatewayPay(ord2.order.id);
r = await PAY('POST', '/verify', U.stu1, { paymentId: ord2.payment.id, ...g2, razorpay_order_id: ord1.order.id });
check('3b. Signature for a different order is rejected', r.code === 400, r.data?.message);
r = await PAY('POST', '/create-order', U.stu1, { feeId: 'fee1' }); const ord3 = r.data;
const g3 = gatewayPay(ord3.order.id);
r = await PAY('POST', '/verify', U.stu1, { paymentId: ord3.payment.id, ...g3 });
const fee1 = T.fee.find(f => f.id === 'fee1'), pass1 = T.busPass.find(p => p.userId === 'stu1');
check('3c. Genuine payment → fee PAID', r.code === 200 && fee1.status === 'PAID' && paidFor('fee1').length === 1, r.data?.message);
check('3d. Bus pass is issued automatically for a year', pass1?.status === 'ACTIVE' && (pass1.validUntil - new Date()) > 360 * 864e5, pass1?.passNumber);
r = await PAY('POST', '/verify', U.stu1, { paymentId: ord3.payment.id, ...g3 });
check('3e. Verifying the same payment twice is refused', r.code === 400);
r = await PAY('POST', '/create-order', U.stu1, { feeId: 'fee1' });
check('3f. A paid fee cannot be paid again', r.code === 400, r.data?.message);

// 4 two open orders for one fee (two tabs) — must not charge twice
const [oA, oB] = [(await PAY('POST', '/create-order', U.stf1, { feeId: 'fee3' })).data, (await PAY('POST', '/create-order', U.stf1, { feeId: 'fee3' })).data];
const gA = gatewayPay(oA.order.id), gB = gatewayPay(oB.order.id);
const [vA, vB] = await Promise.all([PAY('POST', '/verify', U.stf1, { paymentId: oA.payment.id, ...gA }), PAY('POST', '/verify', U.stf1, { paymentId: oB.payment.id, ...gB })]);
check('4a. Staff can pay their own fee', [vA.code, vB.code].includes(200) && T.fee.find(f => f.id === 'fee3').status === 'PAID');
const dupe = T.payment.find(p => p.feeId === 'fee3' && /DUPLICATE/.test(p.refundReason || ''));
check('4b. Two tabs paying the same fee: only ONE is recorded as paid', paidFor('fee3').length === 1, `verify results ${vA.code}/${vB.code}`);
check('4c. The second payment is flagged for refund and the admin is notified', !!dupe && T.notification.some(n => n.userId === 'admin' && /Duplicate payment/.test(n.title)),
  [vA, vB].find(v => v.code === 409)?.data?.message);

// 5 parent pays for child, then receipts
mk('fee', { id: 'fee4', userId: 'stu1', academicYear: '2027-28', amount: 18500, baseAmount: 18500, discountAmount: 0, adjustmentAmount: 0, status: 'PENDING', dueDate: due });
const oP = (await PAY('POST', '/create-order', U.par1, { feeId: 'fee4' })).data;
r = await PAY('POST', '/verify', U.par1, { paymentId: oP.payment.id, ...gatewayPay(oP.order.id) });
check("5a. Verified parent can pay their child's fee", r.code === 200 && T.fee.find(f => f.id === 'fee4').status === 'PAID');
const pid = paidFor('fee1')[0].id;
const rcS = await PAY('GET', '/:paymentId/receipt', U.stu1, {}, { paymentId: pid }), rcP = await PAY('GET', '/:paymentId/receipt', U.par1, {}, { paymentId: pid }),
  rcO = await PAY('GET', '/:paymentId/receipt', U.stu2, {}, { paymentId: pid }), rcU = await PAY('GET', '/:paymentId/receipt', U.parU, {}, { paymentId: pid }), rcA = await PAY('GET', '/:paymentId/receipt', U.admin, {}, { paymentId: pid });
check('5b. Receipt available to the student, their verified parent and admin', rcS.code === 200 && rcP.code === 200 && rcA.code === 200 && rcS.data.amount === 18000, rcS.data?.receiptNo);
check('5c. Receipt hidden from other students and unverified parents', rcO.code === 403 && rcU.code === 403);
r = await PAY('GET', '/:paymentId/receipt', U.stu1, {}, { paymentId: ord1.payment.id });
check('5d. No receipt for a failed payment', r.code === 404);

// 6 admin corrections & refunds
r = await FEE('PATCH', '/admin/:feeId/correct', U.admin, { baseAmount: 15000, discountAmount: 2000, adjustmentAmount: 500 }, { feeId: 'fee2' });
check('6a. Admin corrects an unpaid fee: 15,000 − 2,000 + 500 = 13,500', r.code === 200 && T.fee.find(f => f.id === 'fee2').amount === 13500);
r = await FEE('PATCH', '/admin/:feeId/correct', U.admin, { baseAmount: -5 }, { feeId: 'fee2' });
check('6b. Negative amounts are rejected', r.code === 400);
r = await FEE('PATCH', '/admin/:feeId/correct', U.admin, { baseAmount: 1 }, { feeId: 'fee1' });
check('6c. A paid fee cannot be edited', r.code === 400);
r = await FEE('PATCH', '/admin/:feeId/correct', U.stu1, { baseAmount: 1 }, { feeId: 'fee1' });
check('6d. Students cannot change fees', r.code === 403);
r = await FEE('POST', '/admin/:feeId/refund', U.admin, { reason: 'Left college mid-year' }, { feeId: 'fee1' });
const refundNote = T.notification.find(n => n.title === 'Transport payment refunded');
check('6e. Admin refund: payment REFUNDED, fee back to PENDING, bus pass to renewal', r.code === 200 && T.payment.find(p => p.id === pid).status === 'REFUNDED' && T.fee.find(f => f.id === 'fee1').status === 'PENDING' && T.busPass.find(p => p.userId === 'stu1').status === 'PENDING_RENEWAL');
check('6f. Refund message shows the ₹ symbol correctly', !!refundNote && /₹18,000/.test(refundNote.message) && !/Ã/.test(refundNote.message), refundNote?.message);
r = await FEE('POST', '/admin/:feeId/refund', U.admin, { reason: 'x' }, { feeId: 'fee3' });
check('6g. Refund needs a reason', r.code === 400);

// 7 sandbox route outside demo
r = await FEE('POST', '/pay-demo', U.stu2, { feeId: 'fee2' });
check('7. "Sandbox pay" is blocked outside the demo database (no free PAID fees)', r.code === 403 && T.fee.find(f => f.id === 'fee2').status === 'PENDING');

console.log('\nNaviGuard fees & payments — simulated run (fake Razorpay, no real money)\n');
for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.name}${x.detail ? `\n      ${x.detail}` : ''}`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
