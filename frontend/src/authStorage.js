// Shared NaviGuard authentication storage.
// 'Remember me' keeps login across browser restarts; unchecked keeps it per tab/session.
const TOKEN_KEY = 'campus_token';
const USER_KEY = 'campus_user';

export function readAuthToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function readAuthUser() {
  const storage = sessionStorage.getItem(TOKEN_KEY) ? sessionStorage : localStorage;
  if (!storage.getItem(TOKEN_KEY)) return null;
  try {
    return JSON.parse(storage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearAuthSession() {
  for (const storage of [sessionStorage, localStorage]) {
    storage.removeItem(TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
}

export function saveAuthSession({ token, user, remember }) {
  if (!token || !user) throw new Error('Missing login credentials returned by server');
  clearAuthSession();
  // Always keep this login in this tab's sessionStorage so a refresh keeps the
  // same account in this tab, even if another tab logs in with a different one.
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  // "Remember me" additionally persists the login across browser restarts.
  if (remember === true) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}
