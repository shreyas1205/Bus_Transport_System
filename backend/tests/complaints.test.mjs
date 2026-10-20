import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
// Exercise real route handlers against an in-memory database; no live data writes.
let record={id:'c1',userId:'student',subject:'Delay',status:'OPEN',adminResponse:'Existing response'};
const handlers=new Map(); const emitted=[];
const prisma={complaint:{findUnique:async()=>({...record}),update:async({data})=>(record={...record,...data}),findMany:async({where})=>!where.userId||where.userId===record.userId?[{...record}]:[]},notification:{create:async()=>({})}};
const context=vm.createContext({prisma,express:{Router:()=>Object.fromEntries(['get','post','patch'].map(method=>[method,(path,...chain)=>handlers.set(method+path,chain)]))},auth:(req,res,next)=>next(),allow:()=> (req,res,next)=>next()});
vm.runInContext(readFileSync(new URL('../src/routes/complaints.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export default router;',''),context);
async function call(method,path,body={},role='ADMIN') {
 const req={body,params:{id:'c1'},user:{id:'student',role},app:{get:()=>({emit:(...args)=>emitted.push(args)})}};
 const res={code:200,status(code){this.code=code;return this;},json(data){this.data=data;return this;}};
 await handlers.get(method+path).at(-1)(req,res);return res;
}
await call('patch','/:id/status',{status:'IN_PROGRESS'});
assert.equal(record.adminResponse,'Existing response');
await call('patch','/:id/status',{status:'RESOLVED',adminResponse:'Timing corrected'});
assert.equal((await call('get','/')).data[0].adminResponse,'Timing corrected');
assert.equal((await call('get','/',{},'STUDENT')).data[0].adminResponse,'Timing corrected');
assert.ok(record.resolvedAt);
assert.equal(emitted.at(-1)[0],'complaint:update');
await call('patch','/:id/status',{status:'OPEN'});
assert.equal(record.adminResponse,'Timing corrected'); assert.equal(record.resolvedAt,null);
assert.equal((await call('patch','/:id/status',{status:'INVALID',adminResponse:'Must not save'})).code,400);
assert.equal(record.adminResponse,'Timing corrected');
console.log('PASS real complaint handlers with mocked database: response persistence/readback, status-only preservation, resolution timestamps, invalid status rejection and socket emission');
