// Adds (or resets the password of) five demo accounts WITHOUT deleting anything.
// Safe to run on a database that already has real data. Run from backend/:
//   node scripts/add-demo-accounts.mjs
import 'dotenv/config';
import { prisma } from '../src/prisma.js';
import { hashPassword } from '../src/security/passwords.js';

const PASSWORD = 'NaviGuard@2026';

const ACCOUNTS = [
  { role: 'ADMIN',   name: 'Demo Admin',   email: 'admin@naviguard.demo',   institutionId: 'DEMO-ADM-001' },
  { role: 'DRIVER',  name: 'Demo Driver',  email: 'driver@naviguard.demo',  institutionId: 'DEMO-DRV-001', phone: '9999900001' },
  { role: 'STUDENT', name: 'Demo Student', email: 'student@naviguard.demo', institutionId: 'DEMO-STU-001', phone: '9999900002' },
  { role: 'STAFF',   name: 'Demo Staff',   email: 'staff@naviguard.demo',   institutionId: 'DEMO-STF-001', phone: '9999900004' },
  { role: 'PARENT',  name: 'Demo Parent',  email: 'parent@naviguard.demo',  institutionId: 'DEMO-PAR-001', phone: '9999900003' },
];

async function main() {
  const passwordHash = await hashPassword(PASSWORD);
  const users = {};

  for (const a of ACCOUNTS) {
    const existing = await prisma.user.findUnique({ where: { email: a.email } });
    const idTaken = !existing && await prisma.user.findUnique({ where: { institutionId: a.institutionId } });
    const data = { name: a.name, role: a.role, phone: a.phone ?? null, passwordHash, ...(idTaken ? {} : { institutionId: a.institutionId }) };
    users[a.role] = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { passwordHash, passwordVersion: { increment: 1 } } })
      : await prisma.user.create({ data: { ...data, email: a.email } });
    console.log(`${existing ? 'Reset ' : 'Added '} ${a.role.padEnd(7)} ${a.email}`);
  }

  // Role profiles (created only if missing). Guardian phone matches the parent
  // so the automatic guardian-link check keeps the parent linked to the student.
  await prisma.studentProfile.upsert({
    where: { userId: users.STUDENT.id },
    update: {},
    create: { userId: users.STUDENT.id, course: 'B.Tech CSE', semester: '5', guardianName: 'Demo Parent', guardianPhone: '9999900003' },
  });
  await prisma.staffProfile.upsert({ where: { userId: users.STAFF.id }, update: {}, create: { userId: users.STAFF.id, department: 'Computer Science' } });
  await prisma.driverProfile.upsert({
    where: { userId: users.DRIVER.id },
    update: {},
    create: { userId: users.DRIVER.id, licenseNumber: 'DEMO-DL-0001', licenseExpiry: new Date('2030-12-31') },
  });
  await prisma.parentProfile.upsert({
    where: { userId: users.PARENT.id },
    update: { studentId: users.STUDENT.id },
    create: { userId: users.PARENT.id, studentId: users.STUDENT.id },
  });

  console.log(`\nDone. Password for all five: ${PASSWORD}`);
  console.log('Nothing was deleted. Pick the matching role on the login page.');
}

main()
  .catch((error) => { console.error('Could not add demo accounts:', error.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
