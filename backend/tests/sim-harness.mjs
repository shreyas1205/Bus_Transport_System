// Shared in-memory database + router runner for NaviGuard simulations.
// ---------------- in-memory database ----------------
export const T = { user: [], vehicle: [], route: [], routeStop: [], stop: [], incident: [], notification: [], boardingEvent: [],
  parentProfile: [], studentProfile: [], driverProfile: [], vehicleLocation: [], busPass: [], fee: [], payment: [] };
let seq = 0;
const REL = { vehicle: ['vehicle', 'vehicleId'], driver: ['user', 'driverId'], assignedBus: ['vehicle', 'assignedBusId'], assignedDriver: ['user', 'assignedDriverId'],
  user: ['user', 'userId'], student: ['user', 'studentId'], route: ['route', 'routeId'], stop: ['stop', 'stopId'], pickupStop: ['stop', 'pickupStopId'], assignedRoute: ['route', 'assignedRouteId'], fee: ['fee', 'feeId'] };
const BACK = { parentProfile: ['parentProfile', 'userId'], studentProfile: ['studentProfile', 'userId'], driverProfile: ['driverProfile', 'userId'],
  routes: ['route', 'assignedBusId', true], locations: ['vehicleLocation', 'vehicleId', true], stops: ['routeStop', 'routeId', true], boardingEvents: ['boardingEvent', 'vehicleId', true],
  driverRoutes: ['route', 'assignedDriverId', true], students: ['user', 'assignedRouteId', true], payments: ['payment', 'feeId', true] };
const rel = (row, k) => {
  if (REL[k]) { const [t, f] = REL[k]; return T[t].find(r => r.id === row[f]) || null; }
  if (BACK[k]) { const [t, f, many] = BACK[k]; const list = T[t].filter(r => r[f] === row.id); return many ? list : list[0] || null; }
  return undefined;
};
function cmp(v, cond) {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date) return v instanceof Date && cond instanceof Date ? +v === +cond : v === cond;
  for (const [op, x] of Object.entries(cond)) {
    if (op === 'in' && !x.includes(v)) return false;
    if (op === 'notIn' && x.includes(v)) return false;
    if (op === 'not' && (x !== null && typeof x === 'object' ? cmp(v, x) : v === x)) return false;
    if (op === 'equals' && v !== x) return false;
    if (op === 'gte' && !(v >= x)) return false; if (op === 'gt' && !(v > x)) return false;
    if (op === 'lte' && !(v <= x)) return false; if (op === 'lt' && !(v < x)) return false;
    if (op === 'contains' && !String(v ?? '').toLowerCase().includes(String(x).toLowerCase())) return false;
    if (op === 'mode') continue;
  }
  return true;
}
function match(row, where = {}) {
  return Object.entries(where || {}).every(([k, c]) => {
    if (c === undefined) return true;
    if (k === 'OR') return c.some(w => match(row, w));
    if (k === 'AND') return (Array.isArray(c) ? c : [c]).every(w => match(row, w));
    if (k === 'NOT') return !(Array.isArray(c) ? c : [c]).some(w => match(row, w));
    const r = rel(row, k);
    if (r !== undefined && c && typeof c === 'object' && !(c instanceof Date)) {
      if (Array.isArray(r)) { if (c.some) return r.some(x => match(x, c.some)); if (c.none) return !r.some(x => match(x, c.none)); if (c.every) return r.every(x => match(x, c.every)); return true; }
      if (c.is !== undefined) return c.is === null ? !r : !!r && match(r, c.is);
      return !!r && match(r, c);
    }
    return cmp(row[k], c);
  });
}
function shape(row, args = {}) {
  if (!row) return row;
  const inc = args.include || args.select || {};
  const out = { ...row };
  for (const [k, v] of Object.entries(inc)) {
    if (!v) continue;
    const r = rel(row, k);
    if (r === undefined) continue;
    const sub = typeof v === 'object' ? v : {};
    out[k] = Array.isArray(r) ? r.filter(x => match(x, sub.where)).map(x => shape(x, sub)) : shape(r, sub);
  }
  return out;
}
const apply = (row, data) => { for (const [k, v] of Object.entries(data)) row[k] = v && typeof v === 'object' && 'increment' in v ? (row[k] || 0) + v.increment : v; row.updatedAt = new Date(); return row; };
// Database-side defaults from schema.prisma (@default(now()) etc.)
const DEFAULTS = { boardingEvent: () => ({ scannedAt: new Date() }), notification: () => ({ read: false }), payment: () => ({ status: 'PENDING' }), fee: () => ({ status: 'PENDING' }) };
function model(name) {
  const rows = T[name];
  const sortFn = ob => (a, b) => { for (const o of [].concat(ob || [])) for (const [k, d] of Object.entries(o)) { if (a[k] < b[k]) return d === 'desc' ? 1 : -1; if (a[k] > b[k]) return d === 'desc' ? -1 : 1; } return 0; };
  return {
    findUnique: async a => shape(rows.find(r => match(r, a.where)) || null, a),
    findFirst: async (a = {}) => shape([...rows].filter(r => match(r, a.where)).sort(sortFn(a.orderBy))[0] || null, a),
    findMany: async (a = {}) => [...rows].filter(r => match(r, a.where)).sort(sortFn(a.orderBy)).slice(0, a.take ?? Infinity).map(r => shape(r, a)),
    count: async (a = {}) => rows.filter(r => match(r, a.where)).length,
    create: async a => { const row = { id: `${name}_${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...(DEFAULTS[name] ? DEFAULTS[name]() : {}), ...a.data }; rows.push(row); return shape(row, a); },
    createMany: async a => { for (const d of a.data) rows.push({ id: `${name}_${++seq}`, createdAt: new Date(), ...(DEFAULTS[name] ? DEFAULTS[name]() : {}), ...d }); return { count: a.data.length }; },
    update: async a => { const row = rows.find(r => match(r, a.where)); if (!row) throw new Error(`${name} not found`); return shape(apply(row, a.data), a); },
    updateMany: async a => { const list = rows.filter(r => match(r, a.where)); list.forEach(r => apply(r, a.data)); return { count: list.length }; },
    deleteMany: async () => ({ count: 0 }),
  };
}
export const prisma = Object.fromEntries(Object.keys(T).map(n => [n, model(n)]));
prisma.$transaction = async fn => typeof fn === 'function' ? fn(prisma) : Promise.all(fn);
prisma.$executeRaw = async () => 0; prisma.$queryRaw = async () => [];


export const mk = (t, d) => { const r = { id: d.id, createdAt: new Date(), ...d }; T[t].push(r); return r; };
