import assert from 'node:assert/strict';
import { test } from 'node:test';

const values = new Map();
globalThis.localStorage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: key => values.delete(key)
};
globalThis.window = { dispatchEvent() {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, options) { this.type = type; this.detail = options?.detail; } };
const { queueOfflineRequest, flushOfflineQueue, getOfflineQueueCount } = await import('../src/offlineQueue.js');

function reset() { values.clear(); }
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('enqueue during a flush remains in storage', async () => {
  reset();
  queueOfflineRequest({ url: '/boarding/a', data: { event: 'A' } });
  const request = deferred();
  const flush = flushOfflineQueue({ request: () => request.promise }, 'driver-1');
  await Promise.resolve();
  queueOfflineRequest({ url: '/boarding/b', data: { event: 'B' } });
  request.resolve({ status: 200 });
  await flush;
  assert.equal(getOfflineQueueCount('driver-1'), 1);
});

test('concurrent flushes serialize and do not send the same action twice', async () => {
  reset();
  queueOfflineRequest({ url: '/boarding/a', data: { event: 'A' } });
  const request = deferred();
  let sends = 0;
  const api = { request: () => { sends++; return request.promise; } };
  const first = flushOfflineQueue(api, 'driver-1');
  const second = flushOfflineQueue(api, 'driver-1');
  await Promise.resolve();
  request.resolve({ status: 200 });
  await Promise.all([first, second]);
  assert.equal(sends, 1);
  assert.equal(getOfflineQueueCount('driver-1'), 0);
});

test('a GPS replacement queued in flight is retained after the older sample succeeds', async () => {
  reset();
  queueOfflineRequest({ url: '/gps', data: { latitude: 1 }, dedupeKey: 'active-trip', ownerUserId: 'driver-1' });
  const request = deferred();
  const flush = flushOfflineQueue({ request: () => request.promise }, 'driver-1');
  await Promise.resolve();
  queueOfflineRequest({ url: '/gps', data: { latitude: 2 }, dedupeKey: 'active-trip', ownerUserId: 'driver-1' });
  request.resolve({ status: 200 });
  await flush;
  assert.equal(getOfflineQueueCount('driver-1'), 1);
  const stored = JSON.parse(values.get('campusbus_offline_queue_v1'));
  assert.equal(stored[0].data.latitude, 2);
});

test('a retryable server failure remains queued for another attempt', async () => {
  reset();
  queueOfflineRequest({ url: '/gps', data: { latitude: 1 }, ownerUserId: 'driver-1' });
  const result = await flushOfflineQueue({ request: async () => { throw { response: { status: 503 } }; } }, 'driver-1');
  assert.equal(result.failed, 1);
  assert.equal(result.remaining, 1);
  assert.equal(getOfflineQueueCount('driver-1'), 1);
});
