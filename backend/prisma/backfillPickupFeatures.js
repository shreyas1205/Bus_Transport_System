import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function academicYearFor(date = new Date()) {
  const y = date.getFullYear();
  const start = date.getMonth() >= 5 ? y : y - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

async function main() {
  const stops = [
    ['Main Gate', 'SJBIT Main Gate, Bengaluru', 12000],
    ['Metro Station', 'Yeshwanthpur Metro Station, Bengaluru', 14000],
    ['Hostel Block A', 'SJBIT Hostel Block A, Bengaluru', 16000],
    ['Tech Park', 'SJBIT Tech Park, Bengaluru', 18000],
    ['City Mall', 'City Mall, Bengaluru', 20000],
  ];
  for (const [name, locationText, fee] of stops) {
    await prisma.stop.updateMany({ where: { name }, data: { locationText, transportFee: fee } });
  }

  await prisma.vehicle.updateMany({ where: { registrationNo: 'KA-01-CB-101' }, data: { busNumber: '1' } });
  await prisma.vehicle.updateMany({ where: { registrationNo: 'KA-01-CB-102' }, data: { busNumber: '2' } });

  const year = academicYearFor();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 10);
  const users = await prisma.user.findMany({ where: { pickupStopId: { not: null } }, select: { id: true, pickupStopId: true } });
  for (const user of users) {
    const stop = await prisma.stop.findUnique({ where: { id: user.pickupStopId }, select: { transportFee: true } });
    if (!stop) continue;
    const existing = await prisma.fee.findFirst({ where: { userId: user.id, academicYear: year } });
    if (existing?.status === 'PAID') continue;
    if (existing) await prisma.fee.update({ where: { id: existing.id }, data: { amount: stop.transportFee } });
    else await prisma.fee.create({ data: { userId: user.id, academicYear: year, amount: stop.transportFee, dueDate } });
  }
  console.log('Pickup-point feature backfill complete.');
}

main().catch(error=>{console.error(error);process.exit(1)}).finally(()=>prisma.$disconnect());
