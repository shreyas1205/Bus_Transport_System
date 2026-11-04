// Exercises queryOverpass retry behaviour against a local fake Overpass server.
import http from 'node:http';

const modulePath = process.argv[2] || new URL('../src/services/emergencyResponse.js', import.meta.url).href;
let plan = [];      // per-request behaviour: status code, or 'slow'
let hits = 0;

const server = http.createServer((req, res) => {
  req.resume();
  const step = plan[Math.min(hits, plan.length - 1)];
  hits += 1;
  if (step === 'slow') return; // never answer
  res.writeHead(step, { 'content-type': 'application/json' });
  res.end(step === 200 ? JSON.stringify({ elements: [
    { type: 'node', lat: 12.972, lon: 77.595, tags: { amenity: 'police', name: 'Test Police' } },
    { type: 'node', lat: 12.973, lon: 77.596, tags: { amenity: 'hospital', name: 'Test Hospital' } }
  ] }) : '{}');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

process.env.OVERPASS_URL = `http://127.0.0.1:${port}/api/interpreter`;
process.env.EMERGENCY_LOOKUP_TIMEOUT_MS = '5000';
process.env.EMERGENCY_LOOKUP_RETRIES = '3';
const { findNearbyEmergencyResources } = await import(modulePath);

let failed = 0;
async function check(name, steps, expect) {
  plan = steps; hits = 0;
  const t = Date.now();
  const r = await findNearbyEmergencyResources(12.9716, 77.5946);
  const ms = Date.now() - t;
  const ok = r.status === expect.status && hits === expect.hits && (!expect.maxMs || ms <= expect.maxMs) && (!expect.minMs || ms >= expect.minMs);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: status=${r.status} requests=${hits} ${ms}ms${r.error ? ' err=' + r.error : ''}${r.police?.length ? ' police=' + r.police[0].name : ''}`);
}

await check('502, 502 then 200 -> recovers', [502, 502, 200], { status: 'OK', hits: 3, minMs: 2900, maxMs: 4500 });
await check('200 first time -> single request', [200], { status: 'OK', hits: 1, maxMs: 1000 });
await check('429 then 200 -> recovers', [429, 200], { status: 'OK', hits: 2 });
await check('400 -> not retried', [400], { status: 'LOOKUP_FAILED', hits: 1, maxMs: 1000 });
await check('502 forever -> backoff cut off by 5s budget', [502], { status: 'LOOKUP_FAILED', hits: 3, minMs: 4900, maxMs: 6000 });
process.env.EMERGENCY_LOOKUP_TIMEOUT_MS = '5000';
await check('slow server -> stops at 5s budget, no retry', ['slow'], { status: 'LOOKUP_FAILED', hits: 1, minMs: 4900, maxMs: 6000 });
await check('504 then slow -> budget still capped', [504, 'slow'], { status: 'LOOKUP_FAILED', hits: 2, minMs: 4900, maxMs: 6000 });

server.close();
// connection refused = network error (TypeError) -> retried, then fails
plan = []; hits = 0;
const t = Date.now();
const r = await findNearbyEmergencyResources(12.9716, 77.5946);
const ms = Date.now() - t;
const ok = r.status === 'LOOKUP_FAILED' && ms >= 2900 && ms < 6000;
if (!ok) failed += 1;
console.log(`${ok ? 'PASS' : 'FAIL'}  connection refused -> retried until budget: status=${r.status} ${ms}ms err=${r.error}`);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
