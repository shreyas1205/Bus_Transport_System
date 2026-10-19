import assert from 'node:assert/strict';
import { normalizeGuardianPhone, reconcileGuardianLinks } from '../src/services/autoLinkGuardians.js';

function mockDb(students, parents) {
  const state = {
    students: students.map(s => ({ id: s.id, institutionId: s.usn || null, studentProfile: { guardianPhone: s.phone || null } })),
    parents: parents.map(p => ({ id: p.id, phone: p.phone || null, parentProfile: { studentId: p.studentId || null } })),
    updated: []
  };
  return {
    state,
    user: {
      findMany: async ({ where }) => where.role === 'STUDENT' ? state.students : state.parents
    },
    parentProfile: {
      update: async ({where,data}) => {
        const parent = state.parents.find(p => p.id === where.userId);
        parent.parentProfile.studentId = data.studentId;
        state.updated.push([where.userId,data.studentId]);
      }
    }
  };
}

assert.equal(normalizeGuardianPhone('+91 98765 43210'),'9876543210');
assert.equal(normalizeGuardianPhone('98765-43210'),'9876543210');
assert.equal(normalizeGuardianPhone('123'),null);
assert.equal(normalizeGuardianPhone('1111111111'),null);

// Student first and Parent first resolve identically, including across a bulk batch.
for (const order of ['parent-first','student-first']) {
  const db = mockDb([{id:'s1',usn:'1SJ24CS001',phone:'9876543210'}],[{id:'p1',phone:'+91 9876543210'}]);
  if (order==='student-first') db.state.parents = [];
  else db.state.students = [];
  assert.equal((await reconcileGuardianLinks(db)).linked,0);
  if (order==='student-first') db.state.parents.push({id:'p1',phone:'9876543210',parentProfile:{studentId:null}});
  else db.state.students.push({id:'s1',institutionId:'1SJ24CS001',studentProfile:{guardianPhone:'9876543210'}});
  assert.equal((await reconcileGuardianLinks(db)).linked,1);
  assert.equal(db.state.parents[0].parentProfile.studentId,'s1');
  assert.equal((await reconcileGuardianLinks(db)).linked,0);
}
// Existing legacy USN links are converted to the canonical student user ID.
const legacy=mockDb([{id:'s1',usn:'1SJ24CS001',phone:'9876543210'}],[{id:'p1',phone:'9876543210',studentId:'1SJ24CS001'}]);
assert.equal((await reconcileGuardianLinks(legacy)).linked,1);
assert.equal(legacy.state.parents[0].parentProfile.studentId,'s1');
// Never pair on name alone or with mismatched guardian numbers.
const mismatch=mockDb([{id:'s1',phone:'9876543210'}],[{id:'p1',phone:'9876543211'}]);
assert.equal((await reconcileGuardianLinks(mismatch)).linked,0);
// Never guess among siblings who share a guardian phone.
const siblings=mockDb([{id:'s1',phone:'9876543210'},{id:'s2',phone:'9876543210'}],[{id:'p1',phone:'9876543210'}]);
assert.equal((await reconcileGuardianLinks(siblings)).ambiguous,1);
assert.equal(siblings.state.updated.length,0);
// Never overwrite a different existing student link.
const existing=mockDb([{id:'s1',phone:'9876543210'}],[{id:'p1',phone:'9876543210',studentId:'s2'}]);
assert.equal((await reconcileGuardianLinks(existing)).linked,0);
assert.equal(existing.state.parents[0].parentProfile.studentId,null);
// Never link duplicate parent profiles on a single shared phone.
const shared=mockDb([{id:'s1',phone:'9876543210'}],[{id:'p1',phone:'9876543210'},{id:'p2',phone:'9876543210'}]);
assert.equal((await reconcileGuardianLinks(shared)).ambiguous,1);
assert.equal(shared.state.updated.length,0);
console.log('PASS: phone normalization, both account creation orders, idempotency, legacy USN, mismatch, siblings, existing links, shared numbers');

for (const invalid of ['abc9876543210', '9876543210 ext', '98765/43210', '', null, {}, '123']) {
  assert.equal(normalizeGuardianPhone(invalid), null);
  const db = mockDb([{id:'s1',phone:invalid}],[{id:'p1',phone:'9876543210'}]);
  assert.equal((await reconcileGuardianLinks(db)).linked,0);
}
// Updating existing contacts links accounts without touching login credentials.
const updated = mockDb([{id:'s1',phone:'9876543210'}],[{id:'p1',phone:'9876543211'}]);
await reconcileGuardianLinks(updated);
updated.state.parents[0].phone = '9876543210';
assert.equal((await reconcileGuardianLinks(updated)).linked,1);
for (const change of ['student-contact','parent-contact','duplicate-student','duplicate-parent']) {
  const db = mockDb([{id:'s1',phone:'9876543210'}],[{id:'p1',phone:'9876543210'}]);
  await reconcileGuardianLinks(db);
  if (change === 'student-contact') db.state.students[0].studentProfile.guardianPhone = null;
  if (change === 'parent-contact') db.state.parents[0].phone = '9876543211';
  if (change === 'duplicate-student') db.state.students.push({id:'s2',studentProfile:{guardianPhone:'9876543210'}});
  if (change === 'duplicate-parent') db.state.parents.push({id:'p2',phone:'9876543210',parentProfile:{studentId:null}});
  await reconcileGuardianLinks(db);
  assert.equal(db.state.parents[0].parentProfile.studentId,null,change);
}
console.log('PASS: malformed/missing numbers, existing contact update, stale and ambiguous link revocation');

// Real route handlers with mocked Prisma; no server or database is contacted.
const { prisma } = await import('../src/prisma.js');
const { default: boardingRouter } = await import('../src/routes/boarding.js');
const statusRoute = boardingRouter.stack.find(layer => layer.route?.path === '/my-status').route;
const statusHandler = statusRoute.stack.at(-1).handle;
const originals = [prisma.parentProfile.findUnique, prisma.user.findUnique, prisma.boardingEvent.findFirst];
try {
  prisma.parentProfile.findUnique = async ({where}) => ({studentId: where.userId === 'p1' ? 's1' : null});
  prisma.user.findUnique = async ({where}) => {
    assert.equal(where.id,'s1');
    return {id:'s1',name:'Linked Student',institutionId:'USN1',assignedRoute:{id:'r1',name:'Route 1',code:'R1'},pickupStop:{name:'Stop 1'}};
  };
  prisma.boardingEvent.findFirst = async ({where}) => {
    assert.equal(where.userId,'s1');
    assert.equal(where.routeId,'r1');
    return where.status === 'BOARDED' ? {scannedAt:new Date(),method:'QR'} : null;
  };
  const response = () => ({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  const linkedResponse = response();
  await statusHandler({user:{id:'p1',role:'PARENT'},query:{studentId:'unrelated'}},linkedResponse);
  assert.equal(linkedResponse.body.student.id,'s1');
  assert.equal(linkedResponse.body.route.id,'r1');
  assert.equal(linkedResponse.body.boarded,true);
  const unrelatedResponse = response();
  await statusHandler({user:{id:'p2',role:'PARENT'},query:{studentId:'s1'}},unrelatedResponse);
  assert.equal(unrelatedResponse.body.student,null);
  assert.equal(unrelatedResponse.body.route,null);
  const forbidden = response();
  statusRoute.stack[1].handle({user:{id:'d1',role:'DRIVER'}},forbidden,()=>assert.fail('Unexpected authorization'));
  assert.equal(forbidden.statusCode,403);
  console.log('PASS (mocked Prisma): linked boarding/transport access, unrelated parent isolation, query tampering, role restriction');
} finally {
  [prisma.parentProfile.findUnique, prisma.user.findUnique, prisma.boardingEvent.findFirst] = originals;
  await prisma.$disconnect();
}
