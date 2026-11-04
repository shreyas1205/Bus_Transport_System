import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Isolated audit probes: cached source snapshots, synthetic memory only.
function load(name, prisma, additions={}) {
  const handlers = new Map();
  const source = fs.readFileSync(`.audit-cache-${name}.txt`, 'utf8')
    .replace(/^L\d+: /gm, '').replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace('export default router;', '');
  const c = vm.createContext({console, Date, Math, process:{env:{}}, prisma,
    express:{Router:()=>Object.fromEntries(['get','post','patch'].map(m=>[m,(p,...chain)=>handlers.set(`${m} ${p}`,chain)]))},
    auth:(q,s,n)=>q.user?n():s.status(401).json({}),
    allow:(...roles)=>(q,s,n)=>roles.includes(q.user?.role)?n():s.status(403).json({}),
    requireVerifiedParentTransport:(q,s,n)=>n(), ...additions});
  vm.runInContext(source,c);
  async function call(method,path,body={},role='DRIVER') {
    const req={user:{id:'driver-a',role},body,params:{id:'incident-a'},query:{},app:{get:()=>null}};
    const res={code:200,status(code){this.code=code;return this},json(data){this.data=data;return this}};
    const chain=handlers.get(`${method} ${path}`); let i=0;
    const next=async()=>{let p;await chain[i++]?.(req,res,()=>p=next());await p;};
    await next(); return res;
  }
  return {c,call};
}

const incidents=[], activations=[];
const incidentDb={
  incident:{create:async({data})=>{const result={id:`incident-${incidents.length}`,...data};incidents.push(result);return result;}},
  vehicle:{findUnique:async({where})=>({id:where.id,status:'ACTIVE'})},
  user:{findMany:async()=>[]},notification:{createMany:async()=>{}}
};
const incidentApi=load('incidents',incidentDb,{
  activateAutonomousEmergencyResponse:async input=>activations.push(input),
  isAutonomousDispatchEligible:()=>true,scheduleDriverNonResponseEscalation:()=>{}
});
const sos=await incidentApi.call('post','/sos',{vehicleId:'unassigned-bus',latitude:999,longitude:999});
assert.equal(sos.code,201); assert.equal(sos.data.vehicleId,'unassigned-bus'); assert.equal(sos.data.latitude,999);
const accident=await incidentApi.call('post','/accident-detection',{vehicleId:'unassigned-bus',speedBefore:70,speedAfter:0,impactGForce:6,tiltDegrees:90});
assert.equal(accident.code,201); assert.equal(activations.length,1);
console.log('FAIL reproduced: unassigned driver SOS=201 with invalid latitude/longitude 999; cross-bus accident=201 with autonomous activation requested (stub).');
for(const role of ['ADMIN','STUDENT','STAFF','PARENT']) assert.equal((await incidentApi.call('post','/sos',{},role)).code,403);
console.log('PASS: SOS rejects non-driver roles in real route chain with synthetic auth/allow middleware.');

const bus={id:'bus-a',status:'ACTIVE'}, route={id:'route-a',assignedBusId:bus.id,assignedDriverId:'driver-a',isActive:true,stops:[],assignedBus:bus};
let writes=0, transactions=0, release;
const gate=new Promise(resolve=>release=resolve);
const gpsDb={route:{findFirst:async()=>route},vehicleLocation:{findFirst:async()=>null,create:async({data})=>{writes++;return data;}},
  vehicle:{update:async({data})=>Object.assign(bus,data)},
  $transaction:async ops=>{if(++transactions===2)release();await gate;return Promise.all(ops);}};
const gps=load('liveLocation',gpsDb,{detectGpsSuddenStop:async()=>({possibleAccident:false})});
assert.equal((await gps.call('post','/trip/start')).code,200);
const fix={latitude:12,longitude:77,speedKmph:0,accuracy:10,recordedAt:new Date().toISOString()};
const concurrent=await Promise.all([gps.call('post','/update',fix),gps.call('post','/update',fix)]);
assert.equal(concurrent.filter(r=>r.code===200).length,2); assert.equal(writes,2);
console.log('FAIL reproduced: concurrent identical GPS timestamps accepted twice (200,200; two in-memory history writes).');
assert.equal((await gps.call('post','/update',fix)).code,400);
console.log('PASS: sequential duplicate GPS sample rejected with 400.');
