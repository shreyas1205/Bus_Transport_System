// Read once at startup: malformed values stop startup instead of enabling integrations.
export function parseDemoMode(value) {
  if (value === undefined) return false;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new Error('NAVIGUARD_DEMO_MODE must be true or false.');
}
const enabled = parseDemoMode(process.env.NAVIGUARD_DEMO_MODE);
export function isDemoMode() { return enabled; }
export function demoListenerHost() { return enabled ? '127.0.0.1' : undefined; }
export function assertDemoDatabase(databaseUrl) {
  if (!enabled) return;
  let url;
  try { url = new URL(databaseUrl); } catch {}
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/naviguard_hod_demo_20261020' || url.search || url.hash) {
    throw new Error('Demo mode requires the local naviguard_hod_demo_20261020 database with no URL overrides.');
  }
}
export function blockDemoAction(req, res, next) {
  if (enabled) return res.status(403).json({code: 'DEMO_MODE_BLOCKED', message: 'This action is disabled in NaviGuard demo mode.'});
  return next();
}
