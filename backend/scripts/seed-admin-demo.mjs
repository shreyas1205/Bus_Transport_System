// Seeds a small admin demo database: 5 accounts (one per role), 1 bus, 1 route
// with 2 stops, and the student assigned to that route.
// Target is hard-coded to naviguard_admin_demo on localhost. The main campus_bus
// database and backend/.env are never read or changed.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security/passwords.js';

const DB_URL = 'postgresql://campus:campus_dev@localhost:5432/naviguard_admin_demo?schema=public';
const prisma = new PrismaClient({ datasourceUrl: DB_URL });

const existing = await prisma.user.count();
if (existing > 0) {
  console.error(`Refusing to seed: naviguard_admin_demo already has ${existing} users.`);
  process.exit(1);
}

const pw = () => randomBytes(12).toString('base64url');
const accounts = [
  { role: 'ADMIN',   email: 'admin@demo.local',   name: 'Demo Admin' },
  { role: 'DRIVER',  email: 'driver@demo.local',  name: 'Demo Driver' },
  { role: 'STUDENT', email: 'student@demo.local', name: 'Demo Student' },
  { role: 'STAFF',   email: 'staff@demo.local',   name: 'Demo Staff' },
  { role: 'PARENT',  email: 'parent@demo.local',  name: 'Demo Parent' }
];
const creds = accounts.map(a => ({ ...a, password: pw() }));

const users = {};
for (const a of creds) {
  users[a.role] = await prisma.user.create({ data: {
    role: a.role, email: a.email, name: a.name,
    passwordHash: await hashPassword(a.password),
    institutionId: `ADMIN-DEMO-${a.role}`,
    ...(a.role === 'PARENT' ? { phone: '9000000003' } : {})
  } });
}

await prisma.studentProfile.create({ data: { userId: users.STUDENT.id, course: 'Demo CSE',
  semester: '5', guardianName: users.PARENT.name, guardianPhone: users.PARENT.phone } });
await prisma.staffProfile.create({ data: { userId: users.STAFF.id, department: 'Demo Transport' } });
await prisma.driverProfile.create({ data: { userId: users.DRIVER.id,
  licenseNumber: 'DEMO-LIC-0001', licenseStatus: 'PENDING' } });
await prisma.parentProfile.create({ data: { userId: users.PARENT.id } });

const bus = await prisma.vehicle.create({ data: { busNumber: 'DEMO-BUS-1',
  registrationNo: 'DEMO-REG-001', model: 'Demo Bus', capacity: 40,
  status: 'ACTIVE', latitude: 12.9754, longitude: 77.5992, speedKmph: 0 } });

const route = await prisma.route.create({ data: { code: 'DEMO-R1', name: 'Demo Campus Route',
  isActive: true, assignedBusId: bus.id, assignedDriverId: users.DRIVER.id,
  stops: { create: [
    { sequence: 1, plannedEta: '08:00', stop: { create: { name: 'Demo Pickup', latitude: 12.9754, longitude: 77.5992 } } },
    { sequence: 2, plannedEta: '08:15', stop: { create: { name: 'Demo Campus Gate', latitude: 12.9719, longitude: 77.5937 } } }
  ] } }, include: { stops: { orderBy: { sequence: 'asc' } } } });

await prisma.user.update({ where: { id: users.STUDENT.id },
  data: { assignedRouteId: route.id, pickupStopId: route.stops[0].stopId } });

// Save passwords privately, outside the project folder.
const dir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'NaviGuard', 'AdminDemo');
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, 'credentials.txt');
fs.writeFileSync(file, creds.map(a => `${a.role.padEnd(8)} ${a.email.padEnd(20)} ${a.password}`).join('\n') + '\n', { mode: 0o600 });

const counts = {
  users: await prisma.user.count(), vehicles: await prisma.vehicle.count(),
  routes: await prisma.route.count(), stops: await prisma.stop.count(), routeStops: await prisma.routeStop.count()
};
console.log('Seeded naviguard_admin_demo:', JSON.stringify(counts));
console.log('Credentials saved to:', file);
await prisma.$disconnect();
