import { io as createSocket } from 'socket.io-client';
import { readAuthToken } from './authStorage.js';

export function authenticatedSocketOptions(options = {}, token = readAuthToken()) {
  return { ...options, auth: { ...options.auth, token } };
}

// One place decides the realtime endpoint. With no VITE_SOCKET_URL, use the
// page's own origin (Vite proxies /socket.io in dev; serve both together in prod).
export const SOCKET_URL =
  import.meta.env?.VITE_SOCKET_URL ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000');

export function io(url = SOCKET_URL, options = {}) {
  return createSocket(url, authenticatedSocketOptions(options));
}
