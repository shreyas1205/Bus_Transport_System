// Run ONLY through run-hod-demo-seed.ps1. Never loads dotenv or the server.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

const TARGET = 'naviguard_hod_demo_20261020';
let db, sharedDb, phase = 'preflight', operation = 'validate execution arguments';
const failures = new WeakMap();
// Never print raw messages, stacks, metadata, query arguments or arbitrary codes.
// Prisma messages can contain the entire invocation (including password hashes).
function safeError(error) {
  const candidate = error?.code || error?.errorCode;
  const code = typeof candidate === 'string' && /^P\d{4}$/.test(candidate) ? candidate : 'none';
  const messages = {
    P1000: 'Database authentication failed.',
    P1001: 'Database server is unreachable.',
    P1002: 'Database connection timed out.',
    P1003: 'Database does not exist.',
    P1010: 'Database access denied.',
    P1011: 'Database TLS connection failed.',
    P1017: 'Database connection closed.',
    P2002: 'Unique constraint failed.',
    P2003: 'Foreign key constraint failed.',
    P2010: 'Raw SQL operation failed.',
    P2021: 'Required table does not exist.',
    P2022: 'Required column does not exist.',
    P2024: 'Connection pool acquisition timed out.',
    P2025: 'Required record was not found.',
    P2028: 'Transaction API failed or transaction expired.',
    P2034: 'Transaction write conflict or deadlock.'
  };
  let message = messages[code] || 'Error details withheld because they may contain private data.';
  if (/Failed to deserialize column|Unsupported type.*name/s.test(String(error?.message || ''))) {
    message = 'Raw query result contains a type Prisma cannot deserialize; cast unsupported columns to text.';
  } else if (error?.name === 'PrismaClientValidationError') {
    message = 'Prisma query validation failed; query arguments withheld.';
  } else if (error?.code === 'ERR_ASSERTION') {
    message = 'Demo safety or fixture verification check failed.';
  }
  // SQLSTATE is useful for raw-query failures, but arbitrary metadata is unsafe.
  const sqlState = error?.meta?.code;
  const knownSqlStates = new Set(['42601', '42703', '42P01', '42501', '55P03', '57014',
    '40001', '40P01', '23502', '23503', '23505', '25006']);
  return `Prisma code=${code}; message=${message}` +
    (knownSqlStates.has(sqlState) ? ` SQLSTATE=${sqlState}.` : '');
}

// Preserve the innermost failed operation, including calls inside guardian helpers.
function tracedClient(client) {
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof key !== 'string') return value;
      if (typeof value === 'function') {
        return async (...args) => {
          const label = `${operation} / ${key}`;
          try { return await value.apply(target, args); }
          catch (error) {
            if (error && typeof error === 'object' && !failures.has(error)) failures.set(error, label);
            throw error;
          }
        };
      }
      return value && typeof value === 'object' && !key.startsWith('$') ?
        tracedDelegate(value, key) : value;
    }
  });
}
function tracedDelegate(delegate, model) {
  return new Proxy(delegate, {
    get(target, key) {
      const value = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return async (...args) => {
        const label = `${operation} / ${model}.${String(key)}`;
        try { return await value.apply(target, args); }
        catch (error) {
          if (error && typeof error === 'object' && !failures.has(error)) failures.set(error, label);
          throw error;
        }
      };
    }
  });
}
const requireSafe = (ok) => assert.ok(ok, 'Demo safety check failed');
const quote = (s) => `"${s.replaceAll('"', '""')}"`;

async function main() {
  requireSafe(process.platform === 'win32' && process.argv.slice(2).join(' ') === '--execute');
  operation = 'load password and guardian reconciliation helpers';
  const { hashPassword, passwordProblem, verifyPassword } = await import('../src/security/passwords.js');
  const { reconcileGuardianLinks } = await import('../src/services/autoLinkGuardians.js');
  operation = 'validate database target';
  // Only local TCP and the already-pinned schema/pool options are allowed.
  // Never accept socket overrides, alternate schemas or driver adapters.
  const url = new URL(process.env.NAVIGUARD_DEMO_DATABASE_URL);
  requireSafe(url.protocol === 'postgresql:' && ['localhost', '127.0.0.1'].includes(url.hostname) &&
    url.pathname === `/${TARGET}` && !url.hash &&
    url.username && url.password && (!url.port || url.port === '5432'));
  const allowedOptions = { schema: 'public', connection_limit: '1' };
  const seenOptions = new Set();
  for (const [name, value] of url.searchParams) {
    requireSafe(Object.hasOwn(allowedOptions, name) && allowedOptions[name] === value &&
      !seenOptions.has(name));
    seenOptions.add(name);
  }
  url.hostname = '127.0.0.1';
  url.search = '?schema=public&connection_limit=1';
  process.env.DATABASE_URL = url.toString();
  delete process.env.DIRECT_URL;
  for (const key of Object.keys(process.env)) {
    if (/^(SMTP_|TWILIO_|RAZORPAY_|EMERGENCY_DISPATCH_WEBHOOK)/.test(key)) delete process.env[key];
  }
  process.env.AUTONOMOUS_DISPATCH_ENABLED = 'false';
  process.env.EMERGENCY_DISPATCH_MODE = 'demo';
  const blocked = () => { throw new Error('External I/O disabled'); };
  globalThis.fetch = blocked;
  http.request = http.get = https.request = https.get = blocked;
  // No notification, payment, geocoding, dispatch, scheduler or HTTP route imports.
  const storage = process.env.NAVIGUARD_DEMO_CREDENTIAL_FILE;
  operation = 'validate private credential storage';
  requireSafe(storage && fs.statSync(storage).size === 0);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    fileURLToPath(new URL('./run-hod-demo-seed.ps1', import.meta.url)), '-ValidateStorage'],
  { stdio: 'ignore', windowsHide: true });
  operation = 'load Prisma and verify generated schema';
  const { PrismaClient, Prisma } = await import('@prisma/client');
  const schemaText = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\s/g, '');
  requireSafe(schemaText('../prisma/schema.prisma') === schemaText('../node_modules/.prisma/client/schema.prisma'));
  operation = 'initialize pinned Prisma client and guardian verification helper';
  db = new PrismaClient({ datasources: { db: { url: url.toString() } }, log: [], errorFormat: 'minimal' });
  // Import only after pinning DATABASE_URL; the helper's default client is never queried.
  const { verifiedParentStudent } = await import('../src/services/parentTransportAccess.js');
  sharedDb = (await import('../src/prisma.js')).prisma;
  const models = Prisma.dmmf.datamodel.models;
  const expected = { User: 5, StudentProfile: 1, StaffProfile: 1, DriverProfile: 1,
    ParentProfile: 1, Vehicle: 1, Route: 1, Stop: 2, RouteStop: 2 };
  const counts = async (tx) => {
    for (const model of models) {
      operation = `verify row count for ${model.name}`;
      requireSafe(await tx[model.name[0].toLowerCase() + model.name.slice(1)].count() ===
        (expected[model.name] || 0));
    }
  };
  const passwords = new Set();
  const accounts = [];
  for (const role of ['ADMIN', 'DRIVER', 'STUDENT', 'PARENT', 'STAFF']) {
    operation = `generate and hash ${role} password`;
    let password;
    do { password = randomBytes(24).toString('base64url'); } while (passwords.has(password));
    passwords.add(password);
    requireSafe(!passwordProblem(password));
    accounts.push({ role, email: `hod.${role.toLowerCase()}@naviguard.example`,
      password, passwordHash: await hashPassword(password) });
  }
  let fixture;
  const save = (status) => {
    operation = `persist private credentials (${status})`;
    const fd = fs.openSync(storage, 'r+');
    try {
      const content = JSON.stringify({ database: TARGET, status,
        createdAt: new Date().toISOString(),
        guardianVerification: 'Operator-provisioned synthetic fixture; not a real identity or OTP verification.',
        VERIFIED_GUARDIAN_LINKS: JSON.stringify(fixture.approvals),
        accounts: accounts.map(({ role, email, password }) => ({ role, email, password })) }, null, 2);
      fs.writeFileSync(fd, content, 'utf8');
      fs.ftruncateSync(fd, Buffer.byteLength(content));
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  };
  const verify = async (tx) => {
    await counts(tx);
    operation = 'verify route, bus, driver and ordered stops';
    const route = await tx.route.findUnique({ where: { id: fixture.routeId },
      include: { assignedBus: true, assignedDriver: true,
        stops: { orderBy: { sequence: 'asc' }, include: { stop: true } } } });
    requireSafe(route.isActive && route.assignedBus.status === 'ACTIVE' &&
      route.assignedDriver.id === fixture.driverId && route.assignedDriver.role === 'DRIVER');
    requireSafe(route.stops.length === 2);
    route.stops.forEach((s, i) => requireSafe(s.sequence === i + 1 &&
      /^\d{2}:\d{2}$/.test(s.plannedEta) && Math.abs(s.stop.latitude) <= 90 &&
      Math.abs(s.stop.longitude) <= 180));
    operation = 'verify student and parent relationships';
    const student = await tx.user.findUnique({ where: { id: fixture.studentId }, include: { studentProfile: true } });
    const parent = await tx.user.findUnique({ where: { id: fixture.parentId }, include: { parentProfile: true } });
    requireSafe(student.role === 'STUDENT' && student.assignedRouteId === route.id &&
      student.pickupStopId === route.stops[0].stopId && parent.role === 'PARENT' &&
      parent.phone === student.studentProfile.guardianPhone &&
      parent.parentProfile.studentId === student.id);
    for (const account of accounts) {
      operation = `verify ${account.role} password and role`;
      const user = await tx.user.findUnique({ where: { email: account.email } });
      requireSafe(user.role === account.role && await verifyPassword(account.password, user.passwordHash));
    }
    operation = 'verify guardian access denied without approval';
    process.env.VERIFIED_GUARDIAN_LINKS = '[]';
    requireSafe(await verifiedParentStudent(parent.id, tx) === null);
    operation = 'verify guardian access denied for mismatched approval';
    process.env.VERIFIED_GUARDIAN_LINKS = JSON.stringify([{ parentId: parent.id, studentId: fixture.driverId }]);
    requireSafe(await verifiedParentStudent(parent.id, tx) === null);
    operation = 'verify explicitly approved synthetic guardian access';
    process.env.VERIFIED_GUARDIAN_LINKS = JSON.stringify(fixture.approvals);
    requireSafe(await verifiedParentStudent(parent.id, tx) === student.id);
    operation = 'verify driver has no guardian access';
    requireSafe(await verifiedParentStudent(fixture.driverId, tx) === null);
  };
  phase = 'transaction (failure rolls back; retained credentials are not proof of commit)';
  operation = 'begin serializable seed transaction';
  fixture = await db.$transaction(async (rawTx) => {
    const tx = tracedClient(rawTx);
    operation = 'set transaction lock timeout';
    await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '5s'");
    operation = 'verify connected database identity';
    // The URL is pinned to local TCP above. Docker port forwarding can make
    // inet_server_addr() report a changing container IP instead of loopback.
    const [identity] = await tx.$queryRawUnsafe(
      'SELECT current_database()::text AS name, current_schema()::text AS schema, inet_server_port() AS port');
    requireSafe(identity.name === TARGET && identity.schema === 'public' && identity.port === 5432);
    operation = 'verify application table inventory';
    const tables = await tx.$queryRawUnsafe(`SELECT n.nspname::text AS schema, c.relname::text AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relkind IN ('r','p','f') AND n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%'`);
    const names = models.map(m => m.dbName || m.name);
    requireSafe(tables.length === names.length && tables.every(t => t.schema === 'public' && names.includes(t.name)));
    // Hold every application table against concurrent writes from emptiness check through commit.
    operation = 'lock application tables against concurrent writes';
    await tx.$executeRawUnsafe(`LOCK TABLE ${names.sort().map(n => `public.${quote(n)}`).join(', ')} IN EXCLUSIVE MODE`);
    operation = 'verify absence of custom triggers';
    const triggers = await tx.$queryRawUnsafe(`SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND NOT t.tgisinternal`);
    requireSafe(triggers.length === 0);
    for (const name of names) {
      operation = `verify empty table ${name}`;
      const [row] = await tx.$queryRawUnsafe(`SELECT EXISTS(SELECT 1 FROM public.${quote(name)}) AS populated`);
      requireSafe(!row.populated);
    }
    const users = {};
    for (const { role, email, passwordHash } of accounts) {
      operation = `create ${role} demo user`;
      users[role] = await tx.user.create({ data: { role, email, passwordHash,
        name: `HOD Demo ${role}`, institutionId: `HOD-DEMO-${role}`,
        ...(role === 'PARENT' ? { phone: '9000000003' } : {}) } });
    }
    operation = 'create student profile';
    await tx.studentProfile.create({ data: { userId: users.STUDENT.id, course: 'Demo CSE',
      semester: '5', guardianName: users.PARENT.name, guardianPhone: users.PARENT.phone } });
    operation = 'create staff profile';
    await tx.staffProfile.create({ data: { userId: users.STAFF.id, department: 'Demo Transport' } });
    operation = 'create driver profile';
    await tx.driverProfile.create({ data: { userId: users.DRIVER.id,
      licenseNumber: 'SYNTHETIC-HOD-DEMO', licenseStatus: 'PENDING' } });
    operation = 'create parent profile';
    await tx.parentProfile.create({ data: { userId: users.PARENT.id } });
    operation = 'reconcile synthetic guardian contact links';
    const linked = await reconcileGuardianLinks(tx);
    requireSafe(linked.linked === 1 && linked.ambiguous === 0);
    operation = 'create demo bus';
    const bus = await tx.vehicle.create({ data: { busNumber: 'HOD-DEMO-1',
      registrationNo: 'SYNTHETIC-HOD-001', model: 'HOD Demo Bus', capacity: 40,
      status: 'ACTIVE', latitude: 12.9754, longitude: 77.5992, speedKmph: 0 } });
    operation = 'create route and nested stops';
    const route = await tx.route.create({ data: { code: 'HOD-DEMO-R1', name: 'HOD Demo Campus Route',
      isActive: true, assignedBusId: bus.id, assignedDriverId: users.DRIVER.id,
      stops: { create: [
        { sequence: 1, plannedEta: '08:00', stop: { create: {
          name: 'Demo Metro Pickup', latitude: 12.9754, longitude: 77.5992 } } },
        { sequence: 2, plannedEta: '08:15', stop: { create: {
          name: 'Demo Campus Gate', latitude: 12.9719, longitude: 77.5937 } } }
      ] } }, include: { stops: { orderBy: { sequence: 'asc' } } } });
    operation = 'assign student route and pickup stop';
    await tx.user.update({ where: { id: users.STUDENT.id },
      data: { assignedRouteId: route.id, pickupStopId: route.stops[0].stopId } });
    fixture = { routeId: route.id, driverId: users.DRIVER.id, studentId: users.STUDENT.id,
      parentId: users.PARENT.id, approvals: [{ parentId: users.PARENT.id, studentId: users.STUDENT.id }] };
    await verify(tx);
    // Persist credentials durably BEFORE committing. Never delete on uncertain commit outcome.
    save('PREPARED_NOT_CONFIRMED');
    operation = 'commit seed transaction (outcome may be uncertain on failure)';
    return fixture;
  }, { isolationLevel: 'Serializable', timeout: 60000, maxWait: 5000 });
  phase = 'post-commit verification (do not rerun or delete credentials on failure)';
  operation = 'begin read-only verification transaction';
  await db.$transaction(async (rawTx) => {
    const tx = tracedClient(rawTx);
    operation = 'set verification transaction read-only';
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    await verify(tx);
    operation = 'complete read-only verification transaction';
  }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
  save('COMMITTED_AND_READ_ONLY_VERIFIED');
  console.log('Demo seed committed; counts, passwords, relationships and guardian authorization verified.');
}

function reportFailure(error, label = failures.get(error) || operation) {
  console.error(`Demo seed stopped during ${phase}; operation=${label}. ${safeError(error)} No automatic cleanup or retry was performed.`);
  process.exitCode = 1;
}

main().catch(error => reportFailure(error)).finally(async () => {
  for (const [label, client] of [['disconnect seed client', db], ['disconnect shared client', sharedDb]]) {
    try { await client?.$disconnect(); }
    catch (error) { reportFailure(error, label); }
  }
});
