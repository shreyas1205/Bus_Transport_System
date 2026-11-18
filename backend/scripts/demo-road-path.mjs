// Demo: road-following deviation check. Usage (backend running on port 4000):
//   node scripts/demo-road-path.mjs NG-R1
// 1) refreshes the route's road path, 2) puts the bus on the road bend farthest from the
// straight line between stops 1 and 2, 3) puts the bus 1.5 km off the road.
import { execSync } from 'node:child_process';

const code = process.argv[2] || 'NG-R1';
const B = 'http://localhost:4000/api';
const J = { 'Content-Type': 'application/json' };
const login = async (email, password = 'Pass123') => (await fetch(`${B}/auth/login`, { method: 'POST', headers: J, body: JSON.stringify({ email, password }) })).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
const psql = sql => execSync(`docker exec campus-bus-postgres psql -U campus -d naviguard_demo -tAc "${sql}"`).toString().trim();

const admin = await login('admin@naviguard.com');
const AH = { ...J, Authorization: `Bearer ${admin.token}` };

const routes = await (await fetch(`${B}/routes`, { headers: AH })).json();
const norm = c => String(c).toUpperCase().replace(/\s+/g, '-');
const route = routes.find(r => norm(r.code) === norm(code));
if (!route) throw new Error(`Route ${code} not found`);
// Tracking follows the logged-in driver's route, so log in as the driver assigned to this route.
const routeDriverEmail = psql(`select u.email from \\"Route\\" r join \\"User\\" u on u.id=r.\\"assignedDriverId\\" where upper(replace(r.code,' ','-'))='${norm(code)}'`) || 'driver@naviguard.com';
const driver = await login(routeDriverEmail, routeDriverEmail === 'driver1@gmail.com' ? 'Pass12345678' : 'Pass123');
const DH = { ...J, Authorization: `Bearer ${driver.token}` };

const refresh = await fetch(`${B}/routes/${route.id}/road-path`, { method: 'POST', headers: AH });
const refreshBody = await refresh.json();
if (refresh.status !== 200) throw new Error(refreshBody.message);
console.log(`Road path saved for ${code}: ${refreshBody.points} points`);

const road = JSON.parse(psql(`select \\"roadPath\\" from \\"Route\\" where upper(replace(code,' ','-'))='${norm(code)}'`));
const stops = JSON.parse(psql(`select json_agg(json_build_object('lat',s.latitude,'lng',s.longitude) order by rs.sequence) from \\"RouteStop\\" rs join \\"Stop\\" s on s.id=rs.\\"stopId\\" join \\"Route\\" r on r.id=rs.\\"routeId\\" where upper(replace(r.code,' ','-'))='${norm(code)}'`));

const M = 111320;
function chordDistM(p, a, b) {
  const k = Math.cos(a[0] * Math.PI / 180) * M;
  const px = p[1] * k, py = p[0] * 110540, ax = a[1] * k, ay = a[0] * 110540, bx = b[1] * k, by = b[0] * 110540;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const a = [stops[0].lat, stops[0].lng], b = [stops[1].lat, stops[1].lng];
let bend = null, bestD = -1;
for (const p of road) {
  const onLeg = p[0] >= Math.min(a[0], b[0]) - 0.002 && p[0] <= Math.max(a[0], b[0]) + 0.002;
  const d = chordDistM(p, a, b);
  if (onLeg && d > bestD) { bestD = d; bend = p; }
}
const offRoad = [bend[0] + 0.0135, bend[1]];
console.log(`Road bend is ${Math.round(bestD)} m from the straight line between stops 1 and 2`);
console.log(`Old straight-line check would flag it: ${bestD > 355 ? 'YES' : 'no'}`);

const sample = (lat, lng) => ({ latitude: lat, longitude: lng, speedKmph: 35, accuracy: 5, recordedAt: new Date().toISOString() });
const post = async (p, body) => (await fetch(`${B}${p}`, { method: 'POST', headers: DH, body: JSON.stringify(body) })).json();
await post('/live-location/trip/end', {}); // clear any earlier trip so this one binds to the route
await post('/live-location/trip/start', {});
await wait(1200);
const r1 = await post('/live-location/update', sample(bend[0], bend[1]));
console.log(`1) Bus on the road bend:  ${r1.tracking?.offRoute ? 'DEVIATION' : 'on route'} (${r1.tracking?.distanceFromRouteM} m from road)`);
await wait(1200);
const r2 = await post('/live-location/update', sample(offRoad[0], offRoad[1]));
console.log(`2) Bus 1.5 km off road:   ${r2.tracking?.offRoute ? 'DEVIATION' : 'on route'} (${r2.tracking?.distanceFromRouteM} m from road)`);
