import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const bus={id:'bus',registrationNo:'TEST',model:'Test',capacity:40,status:'ACTIVE'};
const route={id:'route',isActive:true,assignedBusId:'bus',assignedDriverId:'driver',assignedBus:bus};
let dependency='',deleted=false;
const db={vehicle:{findUnique:async()=>({...bus}),findFirst:async({where})=>bus.status===where.status?bus:null,update:async({data})=>Object.assign(bus,data),delete:async()=>{deleted=true;}},route:{count:async()=>dependency==='route'?1:0,findUnique:async()=>route,update:async({data})=>Object.assign(route,data),findMany:async({where})=>{assert.equal(where.isActive,true);assert.equal(where.assignedBus.status,'ACTIVE');return route.isActive&&bus.status==='ACTIVE'?[route]:[]},findFirst:async({where})=>route.isActive&&bus.status===where.assignedBus.status?route:null},$executeRawUnsafe:async()=>{}};
for(const model of ['vehicleLocation','vehicleService','incident','boardingEvent','routeChange'])db[model]={count:async()=>dependency===model?1:0};
db.$transaction=fn=>fn(db);
const allowContext=vm.createContext({});vm.runInContext(fs.readFileSync('src/middleware.js','utf8').split('export function allow')[1].replace(/^/, 'function allow'),allowContext);
function load(file){
 const handlers=new Map();const c=vm.createContext({console,process:{env:{}},prisma:db,express:{Router:()=>Object.fromEntries(['get','post','patch','delete'].map(m=>[m,(p,...h)=>handlers.set(m+' '+p,h)]))},auth:(q,s,n)=>q.user?n():s.status(401).json({}),allow:allowContext.allow,requireVerifiedParentTransport:(q,s,n)=>n(),syncTemporaryDriverAssignments:async()=>{},calculateEtaMinutes:()=>0});
 vm.runInContext(fs.readFileSync(file,'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default router;',''),c);
 return async(method,path,body={},role='ADMIN')=>{const req={body,params:{id:'bus'},user:role?{role,id:'driver'}:null,app:{get:()=>null}};const res={code:200,status(n){this.code=n;return this},json(data){this.data=data;return this}};let i=0;const chain=handlers.get(method+' '+path);async function next(){let following;await chain[i++]?.(req,res,()=>following=next());await following;}await next();return res;};
}
const vehicles=load('src/routes/vehicles.js');
for(const role of ['DRIVER','STUDENT','PARENT','STAFF',null])for(const method of ['patch','delete'])assert.equal((await vehicles(method,'/:id',{status:'INACTIVE'},role)).code,role?403:401);
assert.equal((await vehicles('patch','/:id',{status:'INACTIVE'})).data.status,'INACTIVE');
assert.equal((await vehicles('post','/:id/location',{latitude:1,longitude:2})).code,409);
assert.equal((await vehicles('patch','/:id',{status:'ACTIVE'})).data.status,'ACTIVE');
assert.equal((await vehicles('patch','/:id',{status:'INVALID'})).code,400);
bus.capacity=0;assert.equal((await vehicles('patch','/:id',{status:'ACTIVE'})).code,409);bus.capacity=40;
for(const model of ['route','vehicleLocation','vehicleService','incident','boardingEvent','routeChange']){dependency=model;const r=await vehicles('delete','/:id');assert.equal(r.code,409);assert.match(r.data.message,/Deactivate/);assert.equal(deleted,false);}
dependency='';assert.equal((await vehicles('delete','/:id')).code,200);assert.equal(deleted,true);
const routes=load('src/routes/routes.js');
for(const role of ['DRIVER','STUDENT','PARENT','STAFF',null])assert.equal((await routes('patch','/:id/status',{isActive:false},role)).code,role?403:401);
assert.equal((await routes('patch','/:id/status',{isActive:false})).data.isActive,false);
assert.equal((await routes('get','/',{},'DRIVER')).data.length,0);
assert.equal((await routes('patch','/:id/status',{isActive:'false'})).code,400);
bus.status='INACTIVE';assert.equal((await routes('patch','/:id/status',{isActive:true})).code,409);
assert.equal((await routes('post','/',{code:'TEST',name:'Test',assignedBusId:'bus',stops:[{}]})).code,409);
const live=load('src/routes/liveLocation.js');route.isActive=true;
assert.equal((await live('post','/trip/start',{},'DRIVER')).code,404);
bus.status='ACTIVE';assert.equal((await live('post','/trip/start',{},'DRIVER')).code,200);
bus.status='INACTIVE';assert.equal((await live('post','/update',{latitude:1,longitude:2},'DRIVER')).code,404);
assert.equal((await live('get','/trip',{},'DRIVER')).data.trip.active,false);
console.log('PASS: mocked bus deactivate/reactivate, invalid reactivation, six history dependency deletion blocks, safe empty deletion, real allow middleware role checks, inactive routes, assignment and trip/GPS guards. No live bus writes.');
