import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Synthetic in-memory Prisma replacement: no database, network or notifications.
const stop = { id: 'stop-a', name: 'Test pickup', transportFee: 12000 };
const route = { id: 'route-a', name: 'Test route', code: 'TEST', isActive: true, assignedBusId: 'bus-a', assignedBus: { busNumber: 'TEST-BUS' }, stops: [{ stopId: stop.id, stop, sequence: 1 }] };
const student = { id: 'student-a', role: 'STUDENT', assignedRouteId: null, pickupStopId: null };
let enrollment = null, fee = null, conflict = false;
const db = {
  route: { findMany: async ({where}) => { assert.equal(where.isActive, true); return [route]; }, findFirst: async ({where,include}) => where.id === route.id && route.isActive ? { ...route, stops: route.stops.filter(s => s.stopId === include.stops.where.stopId) } : null },
  user: { findUnique: async ({where}) => where.id === student.id ? { ...student, assignedRoute: student.assignedRouteId ? route : null, pickupStop: student.pickupStopId ? stop : null } : null, update: async ({where,data}) => { assert.equal(where.id, student.id); Object.assign(student,data); } },
  transportEnrollment: { findUnique: async ({where}) => enrollment?.academicYear === where.userId_academicYear.academicYear ? enrollment : null, create: async ({data}) => { if(conflict) throw Object.assign(new Error('unique'),{code:'P2002'}); assert.equal(data.userId,student.id); return enrollment = {...data,route,stop}; } },
  fee: { findFirst: async () => fee, create: async ({data}) => fee = {id:'fee-a',...data}, update: async ({data}) => Object.assign(fee,data) },
  parentProfile: { findUnique: async ({where}) => where.userId === 'parent-a' ? { studentId: student.id } : null },
};
db.$transaction = fn => fn(db);
const env = {};
function contextFor(file, additions={}) {
  const handlers = new Map();
  const context = vm.createContext({console,process:{env},prisma:db,express:{Router:()=>Object.fromEntries(['get','post','patch','delete'].map(method=>[method,(path,...chain)=>handlers.set(`${method} ${path}`,chain)]))},auth:(req,res,next)=>next(),allow:(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({}),...additions});
  const source = fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/export default router;/g,'').replace(/export async function/g,'async function');
  vm.runInContext(source,context);
  async function call(method,path,body={},role='STUDENT',id=student.id) {
    const req={body,user:{id,role},app:{get:()=>null}},res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
    const chain=handlers.get(`${method} ${path}`);let i=0;
    const next=async()=>{let downstream;await chain[i++]?.(req,res,()=>downstream=next());await downstream;};await next();return res;
  }
  return {context,call};
}
const {context,call} = contextFor('../src/routes/transportSelection.js');
assert.equal(context.academicYearFor(new Date(2026,4,31)), '2025-26');
assert.equal(context.academicYearFor(new Date(2026,5,1)), '2026-27');
assert.equal((await call('get','/options')).data[0].stops[0].transportFee,12000);
assert.equal((await call('get','/me')).data.selection,null);
assert.equal((await call('post','/select',{routeId:[],stopId:stop.id})).code,400);
assert.equal((await call('post','/select',{routeId:route.id,stopId:'other-stop'})).code,400);
route.isActive=false;
assert.equal((await call('post','/select',{routeId:route.id,stopId:stop.id})).code,404);
route.isActive=true;
assert.equal((await call('post','/select',{routeId:route.id,stopId:stop.id},'PARENT','parent-a')).code,403);
const saved=await call('post','/select',{routeId:route.id,stopId:stop.id,userId:'other-student'});
assert.equal(saved.code,201);assert.equal(saved.data.selection.fee,12000);
assert.equal(student.assignedRouteId,route.id);assert.equal(student.pickupStopId,stop.id);
assert.equal(fee.baseAmount,12000);assert.equal(fee.pickupStopId,stop.id);
// A fresh request/session reads persisted state rather than the request body.
assert.equal((await call('get','/me')).data.locked,true);
assert.equal((await call('get','/me')).data.selection.stopId,stop.id);
assert.equal((await call('post','/select',{routeId:route.id,stopId:stop.id})).code,409);
enrollment.academicYear='2000-01';
assert.equal((await call('get','/me')).data.locked,false);
fee.discountAmount=1000;fee.adjustmentAmount=200;
assert.equal((await call('post','/select',{routeId:route.id,stopId:stop.id})).code,201);
assert.equal(fee.amount,11200);assert.equal(fee.baseAmount,12000);
enrollment=null;conflict=true;
assert.equal((await call('post','/select',{routeId:route.id,stopId:stop.id})).code,409);

const access=contextFor('../src/services/parentTransportAccess.js').context;
assert.equal(await access.verifiedParentStudent('parent-a'),null);
env.VERIFIED_GUARDIAN_LINKS='invalid';
assert.equal(await access.verifiedParentStudent('parent-a'),null);
env.VERIFIED_GUARDIAN_LINKS=JSON.stringify([{parentId:'parent-a',studentId:student.id}]);
assert.equal(await access.verifiedParentStudent('parent-a'),student.id);
assert.equal(await access.verifiedParentStudent('unrelated-parent'),null);
env.VERIFIED_GUARDIAN_LINKS=JSON.stringify([{parentId:'parent-a',studentId:'other-student'}]);
assert.equal(await access.verifiedParentStudent('parent-a'),null);
env.VERIFIED_GUARDIAN_LINKS=JSON.stringify([{parentId:'parent-a',studentId:student.id}]);
const live=contextFor('../src/routes/liveLocation.js',{requireVerifiedParentTransport:access.requireVerifiedParentTransport});
assert.equal((await live.call('get','/',{},'PARENT','unrelated-parent')).code,403);
assert.deepEqual(Array.from(await live.context.viewerVehicleIds({id:'parent-a',role:'PARENT'})),['bus-a']);
db.boardingEvent={findMany:async()=>[],findFirst:async()=>null};
db.vehicle={findMany:async({where})=>{assert.equal(where.id.in[0],'bus-a');return [{id:'bus-a',busNumber:'TEST-BUS',latitude:12,longitude:77,speedKmph:0,routes:[{...route,stops:[]}],locations:[{recordedAt:new Date()}]}];}};
assert.equal((await live.call('get','/',{},'PARENT','parent-a')).data.vehicles[0].id,'bus-a');
const dashboard=contextFor('../src/routes/boarding.js',{requireVerifiedParentTransport:access.requireVerifiedParentTransport});
const snapshot=await dashboard.call('get','/my-status',{},'PARENT','parent-a');
assert.equal(snapshot.data.student.id,student.id);
assert.equal(snapshot.data.route.id,route.id);
assert.equal(snapshot.data.route.busNumber,'TEST-BUS');
assert.equal(snapshot.data.pickupStop,stop.name);
assert.equal((await dashboard.call('get','/my-status',{},'PARENT','unrelated-parent')).code,403);
student.assignedRouteId=null;
assert.equal((await live.call('get','/',{},'PARENT','parent-a')).data.vehicles.length,0);
assert.equal((await dashboard.call('get','/my-status',{},'PARENT','parent-a')).data.route,null);
student.assignedRouteId=route.id;route.assignedBusId=null;
assert.match((await live.call('get','/',{},'PARENT','parent-a')).data.message,/No bus/);
console.log('PASS: mocked transport selection, fee persistence, ownership, year lock/conflict, guardian verification, assigned bus and missing assignment tests. No live database/browser tests.');
