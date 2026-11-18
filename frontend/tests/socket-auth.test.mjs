import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticatedSocketOptions } from '../src/socket.js';

test('socket connection attaches the current auth token and preserves options', () => {
  assert.deepEqual(authenticatedSocketOptions({ transports: ['websocket'], auth: { stale: true } }, 'synthetic-token'), {
    transports: ['websocket'], auth: { stale: true, token: 'synthetic-token' }
  });
});
