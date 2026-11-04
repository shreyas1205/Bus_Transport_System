import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const bus = { id: 'bus', status: 'ACTIVE', latitude: null, longitude: null, speedKmph: 0 };
const route = { id: 'route', code: 'TEST', isActive: true, assignedDriverId: 'driver', assignedBusId: 'bus', assignedBus: bus, stops: [
 { id: 'rs1', sequence: 1, stop: { id: 's1', name: 'One', latitude: 12, longitude: 77 } },
 { id: 'rs2', sequence: 2, stop: { id: 's2', name: 'Two', latitude: 12.02, longitude: 77 } }
] };
let history = [], writes = 0;
const events = [];
const db = {
 parentProfile: { findUnique: async ({where}) => ({ studentId: where.userId === 'parent' ? 'student' : 'unrelated' }) },
 user: { findUnique: async ({where}) => ({ id: where.id, role: 'STUDENT', assignedRouteId: 'route', assignedRoute: route }), findMany: async () => [] },
 route: { findFirst: async ({where}) => where.assignedDriverId === 'driver' && bus.status === 'ACTIVE' ? route : null },
 vehicle: { findMany: async ({include}) => [{ ...bus, routes: include.routes.where.id === 'route' ? [route] : [], locations: history }], update: async ({data}) => { writes++; Object.assign(bus,data); return {...bus}; } },
 vehicleLocation: { findFirst: async () => history[0] || null, create: async ({data}) => { history.unshift(data); return data; } },
 notification: { findFirst: async () => ({}), createMany: async () => {} },
 boardingEvent: { findMany: async () => [] }, incident: { findMany: async () => [] },
 $transaction: async ops => Promise.all(ops)
};
const handlers = new Map();
const c = vm.createContext({ console, Date, Math, process: {env: {NAVIGUARD_DEMO_MODE: process.env.NAVIGUARD_DEMO_MODE, VERIFIED_GUARDIAN_LINKS: JSON.stringify([{ parentId:'parent', studentId:'student' }])}}, prisma:db,
 express:{Router:()=>Object.fromEntries(['get','post'].map(m=>[m,(p,...h)=>handlers.set(m+' '+p,h)]))},
 auth:(q,s,n)=>n(), detectGpsSuddenStop:async()=>({possibleAccident:false}) });
vm.runInContext(fs.readFileSync('src/middleware.js','utf8').split('export function allow')[1].replace(/^/,'function allow'),c);
vm.runInContext(fs.readFileSync('src/services/parentTransportAccess.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),c);
vm.runInContext(fs.readFileSync('src/routes/liveLocation.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export default router;',''),c);
async function call(method,path,{role='DRIVER',id='driver',body={}}={}) {
 const req={body,user:{role,id},query:{studentId:'unrelated'},app:{get:()=>({emit:(...args)=>events.push(args)})}};
 const res={code:200,status(n){this.code=n;return this},json(data){this.data=data;return this}};
 const chain=handlers.get(method+' '+path);let i=0;
 async function next(){let pending;await chain[i++]?.(req,res,()=>pending=next());await pending;}
 await next();return res;
}
const gps = (extra={}) => ({latitude:12.01,longitude:77,speedKmph:20,accuracy:10,recordedAt:new Date().toISOString(),...extra});
assert.equal((await call('post','/update',{body:gps()})).code,409);
assert.equal((await call('post','/trip/start',{id:'intruder'})).code,404);
assert.equal((await call('post','/trip/start')).data.trip.active,true);
assert.equal((await call('post','/update',{role:'PARENT',id:'parent',body:gps()})).code,403);
assert.equal((await call('post','/update',{id:'intruder',body:gps()})).code,409);
for(const extra of [{latitude:null},{latitude:91},{recordedAt:'bad'},{recordedAt:new Date(Date.now()-100000).toISOString()},{accuracy:101}]) assert.equal((await call('post','/update',{body:gps(extra)})).code,400);
const fix=gps();const update=await call('post','/update',{body:fix});assert.equal(update.code,200);assert.equal(update.data.recordedAt,fix.recordedAt);assert.equal(writes,1);
assert.equal((await call('post','/update',{body:fix})).code,400);
let parent=await call('get','/',{role:'PARENT',id:'parent'});
assert.equal(parent.data.vehicles[0].routes[0].id,'route');assert.equal(parent.data.journey.student.id,'student');assert.equal(parent.data.vehicles[0].tracking.stale,false);assert.ok(parent.data.vehicles[0].tracking.etaMinutes>0);
assert.equal((await call('get','/',{role:'PARENT',id:'other'})).code,403);
assert.ok(events.some(([name,data])=>name==='vehicle:location' && Object.keys(data).length===0));
c.testRoute=route;c.testVehicle={...bus,latitude:13};
vm.runInContext("tripSessions.get('driver').lastGps.latitude = 13",c);
assert.equal(vm.runInContext('tracking(testRoute,testVehicle).offRoute',c),true);
vm.runInContext("tripSessions.get('driver').lastGps.accuracy = 80",c);
assert.equal(vm.runInContext('tracking(testRoute,testVehicle).offRoute',c),false);
vm.runInContext("tripSessions.get('driver').lastGps.recordedAt = new Date(Date.now()-100000).toISOString()",c);
const stale=vm.runInContext('tracking(testRoute,testVehicle)',c);assert.equal(stale.stale,true);assert.equal(stale.offRoute,false);assert.equal(stale.etaMinutes,null);
parent=await call('get','/',{role:'PARENT',id:'parent'});assert.equal(parent.data.vehicles[0].latitude,null);
assert.equal((await call('post','/trip/end')).data.trip.active,false);
assert.equal((await call('post','/update',{body:gps()})).code,409);
parent=await call('get','/',{role:'PARENT',id:'parent'});assert.equal(parent.data.vehicles[0].tracking.active,false);assert.equal(parent.data.vehicles[0].tracking.etaMinutes,null);
assert.ok(events.some(([name,data])=>name==='trip:status' && data.active===false));
const legacyHandlers = new Map();
const legacy = vm.createContext({ prisma: db, console, auth: (q,s,n)=>n(), allow: c.allow, requireVerifiedParentTransport: c.requireVerifiedParentTransport,
 express: { Router: () => Object.fromEntries(['get','post','patch','delete'].map(m => [m,(p,...h)=>legacyHandlers.set(m+' '+p,h)])) } });
vm.runInContext(fs.readFileSync('src/routes/vehicles.js','utf8').replace(/^import .*;\r?\n/gm,'').replace('export default router;',''),legacy);
const legacyResponse = {code:200,status(n){this.code=n;return this},json(data){this.data=data;return this}};
await legacyHandlers.get('post /:id/location').at(-1)({user:{role:'DRIVER',id:'driver'},params:{id:'bus'},body:gps()},legacyResponse);
assert.equal(legacyResponse.code,403);
assert.equal(writes,1);
assert.ok(events.filter(([name])=>name==='trip:status').every(([,data])=>!data.lastGps));
const ui=fs.readFileSync('../frontend/src/pages/LiveLocation.jsx','utf8');assert.match(ui,/nvg-route-caution/);assert.doesNotMatch(ui,/className="route-deviation-emergency/);assert.match(ui,/position.timestamp/);assert.match(ui,/clearWatch/);assert.match(ui,/ETA unavailable/);assert.match(ui,/Location permission denied/);
console.log('PASS: mocked GPS start/stop, timestamps, invalid/stale/inaccurate fixes, driver authorization, verified/unrelated parent access, scoped route, ETA/unavailable, deviation guards, realtime invalidations; static UI caution and GPS checks. No database or real GPS used.');
