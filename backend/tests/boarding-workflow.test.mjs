import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const events=[], notifications=[], emitted=[], handlers=new Map();
const route={id:'r1',code:'R1',name:'Route',isActive:true,assignedDriverId:'driver',assignedBusId:'bus',assignedBus:{busNumber:'B1',status:'ACTIVE'},stops:[],temporaryDriverAssignments:[]};
const student={id:'s1',name:'Student One',role:'STUDENT',institutionId:'S1',assignedRouteId:'r1',assignedRoute:route,pickupStop:null};
const other={...student,id:'s2',assignedRouteId:'r2'};
const pass={id:'p1',userId:'s1',status:'ACTIVE',validFrom:new Date(0),validUntil:new Date('2099-01-01')};
function matches(row,where={}) {return Object.entries(where).every(([key,value])=>{
 if(key==='OR')return value.some(w=>matches(row,w));
 if(value && typeof value==='object' && !(value instanceof Date)) {
  if('in' in value)return value.in.includes(row[key]);
  if('gte' in value && !(row[key]>=value.gte))return false;
  if('lt' in value && !(row[key]<value.lt))return false;
  if(key==='assignedBus')return matches(row[key],value);
  return true;
 }
 return row[key]===value;
});}
const prisma={
 vehicle:{findUnique:async()=>route.assignedBus},
 route:{findMany:async({where}={})=>matches(route,where)?[route]:[],findUnique:async({where})=>where.id===route.id?route:null},
 user:{findUnique:async({where})=>[student,other].find(x=>x.id===where.id),findMany:async({where})=>[student,other].filter(x=>matches(x,where))},
 busPass:{findUnique:async({where})=>where.id===pass.id?pass:null,findFirst:async({where})=>matches(pass,where)?pass:null},
 parentProfile:{findMany:async({where})=>where.studentId==='s1'?[{userId:'parent'}]:[],findUnique:async({where})=>where.userId==='parent'?{studentId:'s1'}:null},
 notification:{createMany:async({data})=>notifications.push(...data),deleteMany:async()=>{}},
 boardingEvent:{findMany:async({where})=>events.filter(x=>matches(x,where)),findFirst:async({where})=>events.find(x=>matches(x,where)),create:async({data})=>{const row={...data,id:String(events.length),scannedAt:new Date()};events.push(row);return row;},delete:async({where})=>events.splice(events.findIndex(x=>x.id===where.id),1)},
 $executeRaw:async()=>{}
};
let queue=Promise.resolve();
prisma.$transaction=fn=>{const result=queue.then(()=>fn(prisma));queue=result.catch(()=>{});return result;};
const context=vm.createContext({requireVerifiedParentTransport:(req,res,next)=>{req.verifiedStudentId='s1';return next();},prisma,crypto,Buffer,console,process:{env:{JWT_SECRET:'test-secret-'.repeat(4)}},express:{Router:()=>({get:(path,...f)=>handlers.set('GET '+path,f),post:(path,...f)=>handlers.set('POST '+path,f)})},auth:(req,res,next)=>next(),allow:(...roles)=>(req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({})});
function load(file){vm.runInContext(fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('const router =','var router =').replace('export default router;',''),context);}
load('../src/routes/passes.js');
load('../src/routes/boarding.js');
async function call(method,path,body={},role='DRIVER',id='driver',query={}){
 const req={body,user:{role,id},query,app:{get:()=>({emit:(...args)=>emitted.push(args)})}};
 const res={code:200,status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
 const chain=handlers.get(method+' '+path);assert(chain, path);let i=0;async function next(){let following;await chain[i++]?.(req,res,()=>following=next());await following;}await next();return res;
}
const qr=await call('GET','/daily-qr',{},'STUDENT','s1');assert.equal(qr.code,200);
assert.equal(context.verifyDailyQrToken(qr.data.token).ok,true);
assert.equal(context.verifyDailyQrToken(qr.data.token+'x').ok,false);
const payload=Buffer.from(JSON.stringify({v:1,uid:'s1',pid:'p1',d:'2000-01-01'})).toString('base64url');
const expired=`CBQR1.${payload}.${crypto.createHmac('sha256','test-secret-'.repeat(4)).update(payload).digest('base64url')}`;
assert.equal((await call('POST','/scan',{identifier:expired})).code,403);
assert.equal(context.getDayRange('2026-10-19').start.toISOString(),'2026-10-18T18:30:00.000Z');
assert.equal(context.getDayRange('2026-02-30'),null);
assert.equal((await call('GET','/driver-roster')).data.students.length,1);
assert.equal((await call('GET','/driver-roster',{},'DRIVER','outsider')).data.students.length,0);
assert.equal((await call('POST','/drop-off',{studentId:'s1'})).code,400);
pass.status='INACTIVE';assert.equal((await call('POST','/scan',{identifier:qr.data.token})).code,403);pass.status='ACTIVE';
pass.userId='s2';assert.equal((await call('POST','/scan',{identifier:qr.data.token})).code,403);pass.userId='s1';
student.assignedRouteId='r2';assert.equal((await call('POST','/scan',{identifier:qr.data.token})).code,403);student.assignedRouteId='r1';
assert.equal((await call('POST', '/drop-off',{studentId:'s2'})).code,404);
route.assignedBus.status='INACTIVE';assert.equal((await call('POST','/scan',{identifier:qr.data.token})).code,400);assert.equal(events.length,0);route.assignedBus.status='ACTIVE';
const scans=await Promise.all(Array.from({length:5},()=>call('POST','/scan',{identifier:qr.data.token})));
assert.equal(scans.filter(r=>r.code===200).length,1);assert.equal(events.length,1);assert.equal(notifications.length,1);
assert.equal(notifications[0].userId,'parent');assert.equal(notifications[0].type,'BOARDING');assert.match(notifications[0].message,/Student One boarded Bus B1/);
for(const [role,id] of [['STUDENT','s1'],['PARENT','parent']])assert.equal((await call('GET','/my-status',{},role,id)).data.status,'BOARDED');
const togglePath=[...handlers.keys()].find(x=>x.startsWith('POST')&&x.includes('toggle'))?.slice(5);assert(togglePath);
assert.equal((await call('POST',togglePath,{studentId:'s1',boarded:true})).code,200);assert.equal(events.length,1);
assert.equal((await call('POST','/drop-off',{studentId:'s1'},'DRIVER','outsider')).code,403);
const drops=await Promise.all(Array.from({length:4},()=>call('POST','/drop-off',{studentId:'s1'})));
assert.equal(drops.filter(r=>r.code===200).length,1);assert.equal(events.length,2);assert.equal(notifications.length,2);
assert.equal(notifications[1].type,'DROPOFF');assert.equal(notifications[1].userId,'parent');assert.match(notifications[1].message,/Student One was safely dropped off from Bus B1/);
assert.equal((await call('POST','/drop-off',{studentId:'s1'})).code,200);assert.equal(notifications.length,2);
assert.equal((await call('POST','/scan',{identifier:qr.data.token})).code,409);
assert.equal((await call('POST',togglePath,{studentId:'s1',boarded:false})).code,409);
for(const [role,id] of [['STUDENT','s1'],['PARENT','parent']])assert.equal((await call('GET','/my-status',{},role,id)).data.status,'DROPPED_OFF');
const history=await call('GET','/history',{},'ADMIN','admin');assert.equal(history.code,200);const record=history.data.records.find(x=>x.student.id==='s1');assert(record.boardedAt);assert(record.droppedOffAt);
route.isActive=false;assert.equal((await call('POST',togglePath,{studentId:'s1',boarded:true})).code,403);assert.equal((await call('POST','/drop-off',{studentId:'s1'})).code,403);route.isActive=true;
const now=Date.now();const assignment={status:'SCHEDULED',temporaryDriverId:'temp',originalDriverId:'driver',startsAt:new Date(now-10000),endsAt:new Date(now+10000)};route.temporaryDriverAssignments=[assignment];
assert.equal((await call('GET','/driver-roster')).data.students.length,0);assert.equal((await call('GET','/driver-roster',{},'DRIVER','temp')).data.students.length,1);
assert.equal((await call('POST','/drop-off',{studentId:'s1'})).code,403);assert.equal((await call('POST','/drop-off',{studentId:'s1'},'DRIVER','temp')).code,200);
assignment.status='ACTIVE';route.assignedDriverId='temp';assignment.endsAt=new Date(now-1);
assert.equal((await call('GET','/driver-roster',{},'DRIVER','temp')).data.students.length,0);assert.equal((await call('GET','/driver-roster')).data.students.length,1);
assert.equal((await call('POST','/drop-off',{studentId:'s1'},'DRIVER','temp')).code,403);
events.length=0;notifications.length=0;route.temporaryDriverAssignments=[];route.assignedDriverId='driver';
assert.equal((await call('POST',togglePath,{studentId:'s1',boarded:true})).code,200);
assert.equal(events[0].status,'BOARDED');assert.equal(notifications[0].type,'BOARDING');
assert.equal((await call('POST','/drop-off',{studentId:'s1'})).code,200);
assert.equal(events[1].status,'DROPPED_OFF');assert.equal(notifications[1].type,'DROPOFF');
console.log('PASS: QR validity/expiry/tampering, scoped roster, boarding, concurrent duplicates, drop-off prerequisites/duplicates, parent notification recipient/content, student/parent status, admin history, inactive routes, temporary start/expiry permissions. All persistence and socket notifications mocked; no database or network access.');
