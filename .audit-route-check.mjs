// Isolated route probes: synthetic Prisma, no server, database, network or timers.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const names=['vehicles','transportSelection','routes','passes','notifications','maintenance','fees','dashboard','complaints'];
const roles=['ADMIN','DRIVER','STUDENT','STAFF','PARENT'];
const modules={};
const results=[];
function result(label,pass,detail){results.push({label,status:pass?'PASS':'FAIL',detail});}
for(const name of names){
  const routes=[];const calls=[];
  const defaults={findMany:[],findFirst:null,findUnique:null,count:0,aggregate:{_sum:{amount:0}},groupBy:[],createMany:{count:1},updateMany:{count:1}};
  const handlers={};
  const db=new Proxy({}, {get(_,model){if(model==='$transaction')return async fn=>typeof fn==='function'?fn(db):Promise.all(fn);return new Proxy({}, {get(_,method){return async args=>{calls.push({model,method,args});const f=handlers[`${model}.${method}`];if(f)return f(args);if(method==='create'||method==='update'||method==='upsert')return {id:'synthetic',...args?.data};return defaults[method];};}});}});
  const auth=(req,res,next)=>req.user?next():res.status(401).json({});
  const allow=(...allowed)=>{const guard=(req,res,next)=>allowed.includes(req.user?.role)?next():res.status(403).json({});guard.roles=allowed;return guard;};
  const router=Object.fromEntries(['get','post','patch','delete','put','use'].map(method=>[method,(path,...stack)=>routes.push({method,path,stack})]));
  const context={console:{log(){},error(){}},process:{env:{}},Date,Math,Number,String,Array,Object,Set,Map,JSON,Promise,URL,URLSearchParams,Buffer,crypto,fetch:()=>{throw Error('network forbidden');},setTimeout:()=>0,setInterval:()=>0,clearTimeout(){},clearInterval(){},express:{Router:()=>router},prisma:db,auth,allow,isDemoMode:()=>false,blockDemoAction:(req,res,next)=>next(),requireVerifiedParentTransport:(req,res,next)=>next(),syncTemporaryDriverAssignments:async()=>{},calculateEtaMinutes:()=>5,nearestNeighbor:x=>x,withinGeofence:()=>true,detectGpsSuddenStop:async()=>null,recordBoardingNotification:async()=>null};
  let source=fs.readFileSync(`backend/src/routes/${name}.js`,'utf8');
  source=source.replace(/^import[\s\S]*?;\r?\n/gm,'').replace(/export default router;?/g,'').replace(/export (?=(?:async )?function|const|let)/g,'');
  vm.createContext(context);vm.runInContext(source,context,{filename:`${name}.js`});
  modules[name]={context,routes,calls,handlers};
}
const invoke=async(name,method,path,role,body={},params={})=>{
  const m=modules[name],route=m.routes.find(x=>x.method===method&&x.path===path);if(!route)throw Error(`Missing ${name} ${method} ${path}`);
  const req={user:role?{id:'audit-'+role.toLowerCase(),role,name:'Synthetic user'}:null,body,params,query:{},app:{get:()=>({emit(){}})}};
  const res={statusCode:200,body:null,status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;},send(b){this.body=b;return this;}};
  for(const fn of route.stack){let next=false;await fn(req,res,()=>{next=true;});if(!next)break;}
  return res;
};
let total=0,protectedCount=0,declaredRoles=0;
for(const m of Object.values(modules)){for(const route of m.routes){total++;const res={statusCode:0,status(n){this.statusCode=n;return this;},json(){}};let next=false;await route.stack[0]({user:null},res,()=>{next=true;});if(res.statusCode===401&&!next)protectedCount++;if(route.stack.some(fn=>fn.roles))declaredRoles++;}}
result('Nine router registrations/auth declarations',total===protectedCount,`${protectedCount}/${total} reject anonymous using injected auth; ${declaredRoles} declare role lists. Auth itself tested separately.`);
modules.vehicles.handlers['vehicle.findMany']=args=>[{id:'other-bus',latitude:12.34,longitude:77.56}];
const v=await invoke('vehicles','get','/','STUDENT');
const q=modules.vehicles.calls.find(x=>x.model==='vehicle'&&x.method==='findMany');
result('Student fleet response scopes GPS to assignment',!(v.body?.[0]?.latitude!==undefined&&Object.keys(q.args.where).length===0),'Authenticated STUDENT gets full synthetic unassigned bus coordinates with where={}.');
const bad=await invoke('vehicles','post','/','ADMIN',{busNumber:'SYNTHETIC',registrationNo:'SYNTHETIC',model:'Synthetic',capacity:-1});
result('Reject negative bus capacity',bad.statusCode===400,`capacity=-1 -> HTTP ${bad.statusCode}; synthetic create only.`);
modules.fees.handlers['fee.findUnique']=()=>({id:'fee-synthetic',userId:'audit-student',amount:500,status:'PENDING'});
vm.runInContext('ensureBusPass = async () => null',modules.fees.context);
const paid=await invoke('fees','post','/pay-demo','STUDENT',{feeId:'fee-synthetic'});
result('Ordinary mode rejects unverified sandbox payment',paid.statusCode>=400,`HTTP ${paid.statusCode}; payment.status=${paid.body?.payment?.status}; no gateway verification; bus-pass collaborator stubbed.`);
const amount=vm.runInContext('finalAmount({baseAmount:0,amount:100,discountAmount:0,adjustmentAmount:100})',modules.dashboard.context);
result('Analytics handles zero base without double adjustment',amount===100,`expected=100 actual=${amount}`);
const solo=await invoke('complaints','get','/','STUDENT');
const own=modules.complaints.calls.find(x=>x.model==='complaint'&&x.method==='findMany');
result('Complaint list scoped to own account',solo.statusCode===200&&own.args.where.userId==='audit-student','Synthetic STUDENT query restricted by userId.');
const noStaff=await invoke('complaints','get','/','STAFF');
result('Complaint role guard rejects Staff',noStaff.statusCode===403,`HTTP ${noStaff.statusCode}; declared policy, not live authentication.`);
for(const name of ['passes','notifications','maintenance'])console.log('ENDPOINTS '+name+' '+modules[name].routes.map(r=>`${r.method.toUpperCase()} ${r.path} [${r.stack.find(f=>f.roles)?.roles.join(',')||'authenticated'}]`).join('; '));
console.log(JSON.stringify(results,null,2));
console.log(`ROUTE_CHECK_SUMMARY pass=${results.filter(x=>x.status==='PASS').length} fail=${results.filter(x=>x.status==='FAIL').length}`);
