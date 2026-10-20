import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = f => fs.readFileSync(new URL('../src/'+f,import.meta.url),'utf8');
const forbidden = () => { throw new Error('Unexpected database, network, transport or timer access'); };
function load(file, demo=true, additions={}) {
 const handlers=new Map();
 const c=vm.createContext({process:{env:{NAVIGUARD_DEMO_MODE:String(demo),EMERGENCY_DISPATCH_MODE:'webhook',EMERGENCY_DISPATCH_WEBHOOK_URL:'https://example.invalid',COLLEGE_DIRECTORY_API_URL:'https://example.invalid',SMTP_HOST:'example.invalid',REPORT_EMAIL:'test@example.invalid'}},URL,URLSearchParams,AbortController,console,
 prisma:new Proxy({},{get:forbidden}),fetch:forbidden,setTimeout:forbidden,setInterval:forbidden,clearTimeout:forbidden,nodemailer:{createTransport:forbidden},
 auth:(q,s,n)=>q.user?n():s.status(401).json({}),allow:(...roles)=>(q,s,n)=>roles.includes(q.user.role)?n():s.status(403).json({}),requireVerifiedParentTransport:(q,s,n)=>n(),
 express:{Router:()=>Object.fromEntries(['get','post','patch','delete'].map(m=>[m,(p,...chain)=>handlers.set(m+' '+p,chain)]))},...additions});
 vm.runInContext(read('demoMode.js').replaceAll('export ',''),c);
 vm.runInContext(read(file).replace(/^import .*;\r?\n/gm,'').replace('export default router;','').replaceAll('export ',''),c);
 return {c,handlers};
}
async function call(handlers,path,body={},user={id:'test',role:'ADMIN'}) {
 const req={user,body,app:{get:()=>null}},res={code:200,status(n){this.code=n;return this},json(data){this.data=data;return this}};
 const chain=handlers.get('post '+path);assert.ok(chain,path);let i=0;
 async function next(){let p;await chain[i++]?.(req,res,()=>p=next());await p;}await next();return res;
}
const {c:p}=load('services/temporaryDriverAssignments.js');
assert.equal(p.demoListenerHost(),'127.0.0.1');
assert.equal(p.parseDemoMode(undefined),false);assert.equal(p.parseDemoMode(' false '),false);assert.equal(p.parseDemoMode(' TRUE '),true);
for(const value of ['','yes','1','tru'])assert.throws(()=>p.parseDemoMode(value));
p.assertDemoDatabase('postgresql://localhost/naviguard_hod_demo_20261020');
for(const url of [undefined,'bad','postgresql://localhost/production','postgresql://example.invalid/naviguard_hod_demo_20261020','postgresql://localhost/naviguard_hod_demo_20261020?host=remote'])assert.throws(()=>p.assertDemoDatabase(url));
await p.syncTemporaryDriverAssignments();p.startTemporaryDriverAssignmentJob();
const {c:normal}=load('services/temporaryDriverAssignments.js',false);
assert.equal(normal.demoListenerHost(),undefined);normal.assertDemoDatabase('unused');
let passed=false;normal.blockDemoAction({},{},()=>passed=true);assert.equal(passed,true);
const {c:e}=load('services/emergencyResponse.js');
await e.recoverPendingAccidentCountdowns();assert.equal((await e.queryOverpass(12,77,12000)).length,0);
assert.equal((await e.findNearbyEmergencyResources(12,77)).status,'DEMO_MODE_BLOCKED');
assert.equal((await e.dispatchPacket({},{})).realEmergencyServiceContacted,false);
assert.equal((await e.dispatchPacket({},{})).status,'MOCK_DISPATCHED');
const {c:daily}=load('jobs/dailyReport.js',true,{prisma:{boardingEvent:{findMany:async()=>[]}}});
daily.startDailyReportJob();assert.equal((await daily.generateAndSendDailyReport('2026-10-20')).emailSent,false);
const {c:otp}=load('services/otpDelivery.js');
assert.equal(otp.deliveryChannels().email,false);assert.equal(otp.deliveryChannels().sms,false);
for(const channel of ['sms','email'])await assert.rejects(otp.sendOtp({channel,destination:'synthetic',code:'synthetic'}),/DEMO_MODE_BLOCKED/);
const {c:directory}=load('services/collegeDirectory.js');
await assert.rejects(directory.findApiRecord('test'),/DEMO_MODE_BLOCKED/);
const {c:fees,handlers:fh}=load('routes/fees.js');await fees.sendAutomaticFeeReminders();
for(const path of ['/pay-demo','/admin/run-reminders','/:feeId/remind'])assert.equal((await call(fh,path,{}, {role:path==='/pay-demo'?'STUDENT':'ADMIN'})).data.code,'DEMO_MODE_BLOCKED');
const {handlers:ph}=load('routes/payments.js');
for(const path of ['/create-order','/verify']){
 assert.equal((await call(ph,path,{},null)).code,401);assert.equal((await call(ph,path,{}, {role:'DRIVER'})).code,403);
 assert.equal((await call(ph,path,{}, {role:'STUDENT'})).data.code,'DEMO_MODE_BLOCKED');
}
const {c:r,handlers:rh}=load('routes/routes.js');await assert.rejects(r.geocodeLocation('test'),/DEMO_MODE_BLOCKED/);
assert.match((await call(rh,'/geocode',{locationText:'test'})).data.message,/DEMO_MODE_BLOCKED/);
for(const value of [undefined,null,'']){
 const result=await call(rh,'/',{code:'TEST',name:'Test',stops:[{name:'Test',plannedEta:'08:00',latitude:value,longitude:value}]});
 assert.equal(result.code,400);assert.match(result.data.message,/Supply explicit latitude/);
}
assert.equal(r.extractGoogleMapsCoordinates('https://maps.google.com/?q=12,77').latitude,12);
assert.match(read('server.js'),/new Server\(server,/);assert.match(read('server.js'),/server.listen\(port,demoListenerHost\(\),/);
assert.match(read('prisma.js'),/assertDemoDatabase\(process.env.DATABASE_URL\);[\s\S]*new PrismaClient/);
console.log('PASS: demo configuration, DB isolation, shared loopback listener, jobs, emergency HTTP, SMTP/SMS, payments, directory, geocoding. No server/database/network used.');

// Explicit coordinates and coordinates embedded in URLs still create local routes.
const {handlers: localRoutes}=load('routes/routes.js',true,{prisma:{$transaction:async fn=>fn({route:{create:async({data})=>data}})}});
for(const stop of [{latitude:12,longitude:77},{googleMapsUrl:'https://maps.google.com/?q=12,77'}]) {
 const result=await call(localRoutes,'/',{code:'TEST',name:'Test',stops:[{name:'Stop',plannedEta:'08:00',...stop}]});
 assert.equal(result.code,201);assert.equal(result.data.stops.create[0].stop.create.latitude,12);
}
let lookups=0;
const {c: normalRoutes}=load('routes/routes.js',false,{fetch:async()=>{lookups++;return {ok:true,json:async()=>[{lat:'12',lon:'77'}]};}});
assert.equal((await normalRoutes.geocodeLocation('Test')).latitude,12);assert.equal(lookups,1);
const schema=fs.readFileSync(new URL('../prisma/schema.prisma',import.meta.url),'utf8');
const dispatchStatus=(await e.dispatchPacket({},{})).status;
assert.ok(schema.match(/enum EmergencyDispatchStatus \{([^}]+)\}/)[1].includes(dispatchStatus));
console.log('PASS: local coordinate route creation, normal-mode geocoding, schema-compatible demo dispatch.');
