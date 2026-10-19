import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const records = [], notifications = [], events = [];
const vehicle = { id: 'bus', busNumber: 'B1' };
const student = { id: 'student', institutionId: 'S1', name: 'Student', studentProfile: null };
const parent = { id: 'parent', name: 'Guardian', phone: 'test-phone', parentProfile: { studentId: 'S1' } };
const prisma = {
 incident: {
  findFirst: async ({where}) => records.find(x => x.vehicleId === where.vehicleId && where.verificationStatus.in.includes(x.verificationStatus)),
  create: async ({data}) => { const row = {...data, id: String(records.length), vehicle, driver: {name:'Driver'}}; records.push(row); return row; },
  findUnique: async ({where}) => records.find(x => x.id === where.id),
  update: async ({where,data}) => Object.assign(records.find(x => x.id === where.id),data)
 },
 vehicle: { findUnique: async () => vehicle },
 user: { findMany: async ({where}) => where.role === 'ADMIN' ? [{id:'admin'}] : where.role === 'PARENT' ? [parent] : [student] },
 boardingEvent: { findMany: async () => [{userId:'student',status:'BOARDED'}] },
 route: { findMany: async () => [{id:'route',code:'R1'}] },
 notification: {createMany: async ({data}) => notifications.push(...data)}
};
const context = vm.createContext({ prisma, process:{env:{}}, console, URLSearchParams, AbortController,
 setTimeout: () => 1, clearTimeout: () => {},
 fetch: async () => ({ok:true,json:async()=>({elements:[
 {type:'node',id:1,lat:12.001,lon:77,tags:{amenity:'hospital',name:'Nearest'}},
 {type:'node',id:2,lat:12.1,lon:77,tags:{amenity:'hospital',name:'Far trauma',emergency:'yes',beds:'300'}},
 {type:'node',id:3,lat:12.002,lon:77,tags:{amenity:'police',name:'Police'}}
 ]})}) });
vm.runInContext(fs.readFileSync(new URL('../src/services/emergencyResponse.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/,'').replace(/export /g,''),context);
const io={emit:(...args)=>events.push(args)};
const detect=(before,after,id='bus')=>context.detectGpsSuddenStop({vehicleId:id,driverId:'driver',latitude:12,longitude:77,currentSpeed:after,previousLocation:{speedKmph:before},io});
for (const [before,after] of [[34,0],[35,8],[50,9],[70,65],[40,null]]) assert.equal((await detect(before,after)).possibleAccident,false);
const results=await Promise.all(Array.from({length:8},()=>detect(35,5)));
assert.equal(records.length,1); assert.equal(results.filter(x=>x.possibleAccident).length,1);
assert.equal(events.filter(x=>x[0]==='accident:possible').length,1);
records[0].verificationStatus='FALSE_ALARM';
assert.equal((await detect(35,5)).possibleAccident,false);
records[0].verificationStatus='CONFIRMED';
const result=await context.activateAutonomousEmergencyResponse({incidentId:'0',io,force:true});
assert.equal(result.dispatch.mode,'DEMO'); assert.equal(result.dispatch.realEmergencyServiceContacted,false);
assert.equal(result.resources.hospitals[0].name,'Nearest'); assert.equal(result.resources.police[0].phone,null);
const packet=result.incident.detectionSignals.autonomousEmergencyResponse.distressPacket;
assert.equal(packet.location.latitude,12); assert.match(packet.location.mapUrl,/12,77/);
assert.equal(packet.route.code,'R1'); assert.equal(packet.driver.name,'Driver');
assert.equal(packet.passengers.onboardStudents,1); assert.equal(packet.passengers.students[0].parent.phone,'test-phone');
assert(notifications.some(x=>x.userId==='parent')); assert(notifications.some(x=>x.userId==='admin'));
assert.equal((await context.findNearbyEmergencyResources(null,null)).status,'INVALID_LOCATION');
assert.equal(context.isAutonomousDispatchEligible({aiConfidence:.85}),true);
const count=notifications.length;
assert.equal((await context.activateAutonomousEmergencyResponse({incidentId:'0',io,force:true})).alreadyActivated,true);
assert.equal(notifications.length,count);
console.log('PASS: boundaries, missing speed, concurrent/repeated GPS, false-alarm cooldown, incident confirmation, admin/parent notifications, location, passenger contacts, nearest resources, missing phones, demo dispatch, repeat dispatch');
// Optional passenger/contact data must remain safe when absent.
prisma.boardingEvent.findMany = async () => [];
prisma.route.findMany = async () => [];
const empty = await context.currentPassengerSnapshot('empty-bus');
assert.equal(empty.students.length,0);
const minimal = context.buildDistressPacket({incident:{id:'empty'},passengerSnapshot:empty,resources:{}});
assert.equal(minimal.location.mapUrl,null);
assert.equal(minimal.selectedEmergencyResources.police,null);
assert.equal(minimal.passengers.students.length,0);
console.log('PASS: missing optional passengers, parents, location and emergency resources');
