import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync, transformFromAstSync, types as t } from '@babel/core';

// Execute the component's refresh effect with deferred HTTP requests and fake sockets.
const source = readFileSync(new URL('../src/pages/LiveLocation.jsx', import.meta.url), 'utf8');
let refreshEffect;
transformSync(source, {
  parserOpts: { plugins: ['jsx'] },
  plugins: [() => ({ visitor: {
    CallExpression(path) {
      if (path.node.callee.name === 'useEffect' &&
          path.node.arguments[0].body.body.some(node =>
            t.isFunctionDeclaration(node) && node.id.name === 'drainRefreshes')) {
        refreshEffect = t.cloneNode(path.node.arguments[0], true);
      }
    }
  } })]
});
assert.ok(refreshEffect, 'refresh lifecycle effect exists');
const effectCode = transformFromAstSync(t.file(t.program([t.expressionStatement(refreshEffect)])), '', {
  plugins: [() => ({ visitor: {
    MetaProperty(path) { path.replaceWith(t.identifier('environment')); }
  } })]
}).code;

function harness() {
  const state = { loading: true };
  const requests = [];
  const events = {};
  const timers = new Map();
  const refreshRef = { current: null };
  let disconnected = false;
  const setters = ['vehicles', 'journey', 'trip', 'notice', 'loading', 'refreshing'];
  const setup = new Function('api', 'io', 'refreshRef', 'watchRef', 'isDriver',
    'setInterval', 'clearInterval', 'navigator', 'environment',
    ...setters.map(key => `set${key[0].toUpperCase()}${key.slice(1)}`),
    `return (${effectCode.replace(/;\s*$/, '')})();`);
  const cleanup = setup({
    get(path, { signal }) {
      assert.equal(path, '/live-location');
      return new Promise((resolve, reject) => requests.push({ resolve, reject, signal }));
    }
  }, () => ({
    on(name, callback) { events[name] = callback; },
    disconnect() { disconnected = true; }
  }), refreshRef, { current: null }, true,
  (callback, delay) => { timers.set(delay, callback); return delay; },
  id => timers.delete(id), {}, { env: {} },
  ...setters.map(key => value => { state[key] = value; }));
  return { state, requests, events, timers, refreshRef, cleanup,
    get disconnected() { return disconnected; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const result = id => ({ data: {
  vehicles: [{ id, latitude: 12.97, longitude: 77.59 }],
  journey: { status: 'BOARDED' }, trip: { active: true }, message: id
} });

const h = harness();
assert.equal(h.state.loading, true);
assert.equal(h.requests.length, 1);
h.requests[0].resolve(result('initial'));
await tick();
assert.equal(h.state.loading, false);
assert.equal(h.state.trip.active, true);
assert.equal(h.state.journey.status, 'BOARDED');
h.events['vehicle:location']({ vehicleId: 'bus' });
assert.equal(h.state.loading, false, 'GPS refresh must not hide mounted tracking content');
assert.equal(h.state.vehicles[0].id, 'initial');
for (let i = 0; i < 20; i++) h.events['vehicle:location']();
h.timers.get(30000)();
const completion = h.refreshRef.current(); // Manual/action refresh joins the same queue.
assert.equal(h.requests.length, 2, 'socket, polling and manual requests cannot overlap');
h.requests[1].resolve(result('gps'));
await tick();
assert.equal(h.requests.length, 3, 'burst produces one trailing request');
assert.equal(h.state.loading, false);
h.requests[2].resolve(result('latest'));
await completion;
assert.equal(h.state.vehicles[0].id, 'latest');
assert.equal(h.requests.length, 3);
assert.deepEqual(Object.keys(h.events).sort(), [
  'vehicle:location', 'trip:status', 'route:deviation', 'route:deviation:inevitable',
  'vehicle:overspeed', 'gps:stale', 'boarding:missed'
].sort());

h.events['gps:stale']();
h.requests[3].reject({ response: { status: 403, data: { message: 'Access denied' } } });
await tick();
assert.equal(h.state.notice, 'Access denied');
assert.deepEqual(h.state.vehicles, []);
assert.equal(h.state.journey, null);
assert.equal(h.state.loading, false);
h.refreshRef.current();
h.requests[4].resolve(result('recovered'));
await tick();
assert.equal(h.state.vehicles[0].id, 'recovered');
h.refreshRef.current();
h.events['vehicle:location']();
h.cleanup();
assert.equal(h.requests[5].signal.aborted, true);
assert.equal(h.disconnected, true);
assert.equal(h.timers.size, 0);
const before = structuredClone(h.state);
h.requests[5].resolve(result('obsolete'));
await tick();
assert.deepEqual(h.state, before, 'disposed requests cannot overwrite state');
assert.equal(h.requests.length, 6, 'cleanup cancels queued refresh');

const failed = harness();
failed.requests[0].reject(new Error('offline'));
await tick();
assert.equal(failed.state.loading, false);
assert.equal(failed.state.notice, 'Could not load live tracking.');
failed.cleanup();
const transient = harness();
transient.requests[0].resolve(result('last-known'));
await tick();
transient.refreshRef.current();
assert.equal(transient.state.refreshing, true);
transient.requests[1].reject(new Error('network interrupted'));
await tick();
assert.equal(transient.state.vehicles[0].id, 'last-known', 'transient errors preserve the mounted map snapshot');
assert.equal(transient.state.journey.status, 'BOARDED');
assert.equal(transient.state.refreshing, false);
transient.cleanup();
console.log('PASS initial loading, background GPS updates, serialized/coalesced refreshes, polling, socket events, access denial, transient failures, refresh indicator and cleanup');
