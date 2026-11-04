// NaviGuard accident simulation (demo dispatch mode: no real services contacted)
const API = 'http://localhost:4000/api';
const PW = 'Pass@123';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return data;
}
const login = async email => (await call('POST', '/auth/login', null, { email, password: PW }));
const notifs = async (tok, since) => {
  const d = await call('GET', '/notifications', tok);
  const list = Array.isArray(d) ? d : d.notifications || d.items || [];
  return list.filter(n => new Date(n.createdAt) >= since).map(n => `  • ${n.title}: ${n.message}`);
};
const h = t => console.log(`\n${'='.repeat(70)}\n${t}\n${'='.repeat(70)}`);

const driver = await login('driver1@campusbus.local');
const admin = await login('admin@campusbus.local');
const parent = await login('parent1@campusbus.local');
const student = await login('student1@campusbus.local');
const me = await call('GET', '/auth/me', driver.token);
const vehicleId = me.driverRoutes[0].assignedBus.id;
const LOC = { latitude: 12.9716, longitude: 77.5946 };

h('SETUP: driver boards student Ananya onto the bus');
try {
  const b = await call('POST', '/boarding/toggle', driver.token, { studentId: student.user.id, boarded: true });
  console.log(' ', b.message || 'Boarded');
} catch (e) { console.log('  (boarding)', e.message.slice(0, 160)); }

const report = async (label, since) => {
  console.log(`\n  Notifications after "${label}":`);
  for (const [who, tok] of [['ADMIN', admin.token], ['PARENT', parent.token], ['DRIVER', driver.token]]) {
    const n = await notifs(tok, since);
    console.log(`  [${who}] ${n.length ? '\n' + n.join('\n') : 'none'}`);
  }
};

// ---------------------------------------------------------------- 1
h('CASE 1: hard braking only (40 -> 25 km/h, 1.2g) - below threshold');
let t = new Date();
let r = await call('POST', '/incidents/accident-detection', driver.token, { vehicleId, speedBefore: 40, speedAfter: 25, impactGForce: 1.2, tiltDegrees: 3, ...LOC });
console.log(`  possibleAccident=${r.possibleAccident} confidence=${r.confidence} threshold=${r.threshold}`);
console.log('  -> Filtered out, no incident created.');
await report('hard braking', t);

// ---------------------------------------------------------------- 2
h('CASE 2: FALSE ALARM - pothole jolt (35 -> 3 km/h, 3.2g), driver says SAFE');
t = new Date();
r = await call('POST', '/incidents/accident-detection', driver.token, { vehicleId, speedBefore: 35, speedAfter: 3, impactGForce: 3.2, tiltDegrees: 8, ...LOC });
let inc = r.incident;
console.log(`  Incident ${inc.id}: confidence=${inc.aiConfidence} status=${inc.verificationStatus} requiresVerification=${r.requiresVerification}`);
console.log('  -> Driver sees red popup with 30s countdown. Waiting 4s, then driver taps "I\'m safe"...');
await sleep(4000);
let x = await call('PATCH', `/incidents/${inc.id}/driver-response`, driver.token, { response: 'SAFE' });
console.log(`  ${x.message}`);
console.log(`  Final: verification=${x.incident.verificationStatus} source=${x.incident.confirmationSource} dispatch=${x.incident.emergencyDispatchStatus} status=${x.incident.status}`);
await report('false alarm', t);

// ---------------------------------------------------------------- 3
h('CASE 3: REAL ACCIDENT - collision (35 -> 3 km/h, 3.2g), admin verifies & CONFIRMS');
await sleep(1500);
t = new Date();
r = await call('POST', '/incidents/accident-detection', driver.token, { vehicleId, speedBefore: 35, speedAfter: 3, impactGForce: 3.4, tiltDegrees: 12, ...LOC });
inc = r.incident;
console.log(`  Incident ${inc.id}: confidence=${inc.aiConfidence} status=${inc.verificationStatus}`);
console.log('  -> Admin reviews it in the SOS & Accident Center and clicks CONFIRM...');
await sleep(3000);
x = await call('PATCH', `/incidents/${inc.id}/verify`, admin.token, { action: 'CONFIRM' });
console.log(`  ${x.message || 'Confirmed'}`);
console.log('  -> Looking up nearby police/hospitals via OpenStreetMap (can take ~10s)...');
let latest;
for (let i = 0; i < 30; i++) {
  await sleep(2500);
  const all = await call('GET', '/incidents', admin.token);
  latest = (Array.isArray(all) ? all : all.incidents).find(i2 => i2.id === inc.id);
  if (latest && !['PENDING', 'IN_PROGRESS', 'NOT_STARTED', null].includes(latest.emergencyDispatchStatus)) break;
}
console.log(`  Final: verification=${latest.verificationStatus} source=${latest.confirmationSource} dispatch=${latest.emergencyDispatchStatus}`);
const aer = latest.detectionSignals?.autonomousEmergencyResponse || {};
const lk = aer.resourceLookup || {};
const fmt = a => (a || []).slice(0, 3).map(p => `    - ${p.name} (${p.distanceMeters != null ? Math.round(p.distanceMeters) + ' m' : '?'})${p.phone ? ' ' + p.phone : ''}`).join('\n') || '    (none found)';
console.log('  Nearest police:\n' + fmt(lk.police));
console.log('  Nearest hospitals:\n' + fmt(lk.hospitals));
if (aer.dispatch) console.log(`  Dispatch: mode=${aer.dispatch.mode} realServiceContacted=${aer.dispatch.realEmergencyServiceContacted}`);
await report('real accident', t);

console.log('\nDone. Incident ids:', inc.id);
