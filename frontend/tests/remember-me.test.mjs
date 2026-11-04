import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearAuthSession,
  readAuthToken,
  readAuthUser,
  saveAuthSession
} from '../src/authStorage.js';

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    clear() { values.clear(); }
  };
}

test.beforeEach(() => {
  globalThis.localStorage = fakeStorage();
  globalThis.sessionStorage = fakeStorage();
});

test('remembered login survives a simulated browser close', () => {
  saveAuthSession({ token: 'remembered', user: { id: 'u1' }, remember: true });
  assert.equal(localStorage.getItem('campus_token'), 'remembered');
  assert.equal(sessionStorage.getItem('campus_token'), null);
  sessionStorage.clear();
  assert.equal(readAuthToken(), 'remembered');
  assert.equal(readAuthUser().id, 'u1');
});

test('unchecked login is session-only', () => {
  saveAuthSession({ token: 'tab', user: { id: 'u2' }, remember: false });
  assert.equal(sessionStorage.getItem('campus_token'), 'tab');
  assert.equal(localStorage.getItem('campus_token'), null);
  sessionStorage.clear();
  assert.equal(readAuthToken(), null);
  assert.equal(readAuthUser(), null);
});

test('switching remembered to unchecked removes older long-lived token', () => {
  saveAuthSession({ token: 'old', user: { id: 'u1' }, remember: true });
  saveAuthSession({ token: 'new', user: { id: 'u1' }, remember: false });
  assert.equal(localStorage.getItem('campus_token'), null);
  assert.equal(readAuthToken(), 'new');
});

test('logout removes both kinds of token', () => {
  localStorage.setItem('campus_token', 'local');
  sessionStorage.setItem('campus_token', 'session');
  clearAuthSession();
  assert.equal(readAuthToken(), null);
});

test('invalid cached user does not crash application initialization', () => {
  localStorage.setItem('campus_token', 'old');
  localStorage.setItem('campus_user', '{broken');
  assert.equal(readAuthUser(), null);
});
