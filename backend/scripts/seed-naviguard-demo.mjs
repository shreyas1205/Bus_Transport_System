// Seeds the NEW naviguard_demo database: 1 admin, 1 staff, 1 demo driver,
// 1 temporary driver (kept unassigned), 1 student, 1 linked parent, 1 bus,
// 1 route with 5 stops (different fees). Refuses to run on a populated DB.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/security/passwords.js';

const prisma = new PrismaClient();
const PASSWORD = 'Pass123';
const ACADEMIC_YEAR = '2026-27';

const existing = await prisma.user.count();
if (existing > 0) {
  console.error(`Refusing to seed: ${existing} users already exist.`);
  process.exit(1);
}

const hash = await hashPassword(PASSWORD);
const mkUser = (data) => prisma.user.create({ data: { ...data, passwordHash: hash } });

const admin = await mkUser({ name: 'Transport Admin', email: 'admin@naviguard.com', role: 'ADMIN', phone: '9000000001' });
const staff = await mkUser({ name: 'Transport Staff', email: 'staff@naviguard.com', role: 'STAFF', phone: '9000000002',
  staffProfile: { create: { department: 'Transport Office' } } });
const driver = await mkUser({ name: 'Demo Driver', email: 'driver@naviguard.com', role: 'DRIVER', phone: '9000000003',
  driverProfile: { create: { licenseNumber: 'KA0120260001', licenseExpiry: new Date('2030-12-31'), licenseStatus: 'VERIFIED' } } });
await mkUser({ name: 'Temporary Driver', email: 'tempdriver@naviguard.com', role: 'DRIVER', phone: '9000000004',
  driverProfile: { create: { licenseNumber: 'KA0120260002', licenseExpiry: new Date('2030-12-31'), licenseStatus: 'VERIFIED' } } });

const stopDefs = [
  ['Main Gate', 12.9700, 77.5900, 500],
  ['Metro Station', 12.9750, 77.5950, 700],
  ['Library Circle', 12.9780, 77.5980, 900],
  ['Hostel Block A', 12.9800, 77.6000, 1100],
  ['Engineering Block', 12.9830, 77.6030, 1300],
];
const stops = [];
for (const [name, latitude, longitude, fee] of stopDefs) {
  stops.push(await prisma.stop.create({
    data: { name, latitude, longitude, geofenceM: 150, feeAmount: fee, transportFee: fee,
      locationText: name, googleMapsUrl: `https://maps.google.com/?q=${latitude},${longitude}` },
  }));
}

const bus = await prisma.vehicle.create({
  data: { busNumber: 'NG-01', registrationNo: 'KA-01-NG-0001', model: 'Demo Coach', capacity: 40,
    status: 'ACTIVE', latitude: stopDefs[0][1], longitude: stopDefs[0][2], speedKmph: 0 },
});

const route = await prisma.route.create({
  data: { code: 'NG-R1', name: 'Campus Express', description: 'Demo route with 5 stops',
    isActive: true, speedLimitKmph: 40, assignedBusId: bus.id, assignedDriverId: driver.id,
    stops: { create: stops.map((s, i) => ({ stopId: s.id, sequence: i + 1, plannedEta: `08:${String(i * 5).padStart(2, '0')}` })) } },
});
await prisma.user.update({ where: { id: driver.id }, data: { assignedRouteId: route.id } });

const pickup = stops[1]; // Metro Station
const student = await mkUser({ name: 'Demo Student', email: 'shreeepadgudadinni555@gmail.com', role: 'STUDENT',
  phone: '9000000005', institutionId: 'STU-2026-001', assignedRouteId: route.id, pickupStopId: pickup.id,
  studentProfile: { create: { course: 'B.E.', semester: '5', guardianName: 'Demo Parent', guardianPhone: '9000000006' } } });

const parent = await mkUser({ name: 'Demo Parent', email: 'shreyass1269@gmail.com', role: 'PARENT', phone: '9000000006',
  parentProfile: { create: { studentId: student.id, verifiedStudentId: student.id, verifiedAt: new Date(), verifiedBy: 'seed' } } });

await prisma.transportEnrollment.create({
  data: { userId: student.id, routeId: route.id, stopId: pickup.id, academicYear: ACADEMIC_YEAR },
});
await prisma.fee.create({
  data: { userId: student.id, pickupStopId: pickup.id, academicYear: ACADEMIC_YEAR,
    amount: pickup.transportFee, baseAmount: pickup.transportFee, dueDate: new Date('2026-12-31') },
});

console.log(JSON.stringify({
  admin: admin.id, staff: staff.id, driver: driver.id, student: student.id, parent: parent.id, route: route.id, bus: bus.id,
  stops: stops.map(s => ({ id: s.id, name: s.name, fee: s.transportFee })),
  VERIFIED_GUARDIAN_LINKS: JSON.stringify([{ parentId: parent.id, studentId: student.id }]),
}, null, 2));
await prisma.$disconnect();
