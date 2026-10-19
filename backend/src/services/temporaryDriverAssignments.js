import { prisma } from '../prisma.js';

function nowDate() {
  return new Date();
}

async function notifyUsers(userIds, title, message) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;

  await prisma.notification.createMany({
    data: ids.map(userId => ({
      userId,
      type: 'GENERAL',
      title,
      message,
    })),
  });
}

export async function syncTemporaryDriverAssignments(io = null) {
  const now = nowDate();

  const due = await prisma.temporaryDriverAssignment.findMany({
    where: {
      status: 'SCHEDULED',
      startsAt: { lte: now },
      endsAt: { gt: now },
    },
    include: {
      route: true,
      temporaryDriver: { select: { id: true, name: true } },
      originalDriver: { select: { id: true, name: true } },
    },
    orderBy: { startsAt: 'asc' },
  });

  for (const assignment of due) {
    await prisma.$transaction(async tx => {
      const current = await tx.temporaryDriverAssignment.findUnique({
        where: { id: assignment.id },
      });
      if (!current || current.status !== 'SCHEDULED') return;

      const route = await tx.route.findUnique({ where: { id: assignment.routeId } });
      if (!route) return;

      await tx.route.update({
        where: { id: route.id },
        data: { assignedDriverId: assignment.temporaryDriverId },
      });

      await tx.temporaryDriverAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'ACTIVE',
          activatedAt: new Date(),
        },
      });

      await tx.routeChange.create({
        data: {
          routeId: route.id,
          reason: `Temporary driver activated: ${assignment.reason}`,
          fromBusId: route.assignedBusId,
          toBusId: route.assignedBusId,
          fromDriverId: assignment.originalDriverId,
          toDriverId: assignment.temporaryDriverId,
        },
      });
    });

    await notifyUsers(
      [assignment.temporaryDriverId, assignment.originalDriverId],
      'Temporary driver assignment active',
      `${assignment.temporaryDriver.name} is now operating ${assignment.route.code} · ${assignment.route.name} until ${assignment.endsAt.toLocaleString('en-IN')}. Reason: ${assignment.reason}`,
    );

    io?.emit('route:temporary-driver', {
      routeId: assignment.routeId,
      assignmentId: assignment.id,
      status: 'ACTIVE',
    });
  }

  const expiredScheduled = await prisma.temporaryDriverAssignment.findMany({
    where: {
      status: 'SCHEDULED',
      endsAt: { lte: now },
    },
    select: { id: true },
  });

  if (expiredScheduled.length) {
    await prisma.temporaryDriverAssignment.updateMany({
      where: { id: { in: expiredScheduled.map(x => x.id) } },
      data: { status: 'COMPLETED', restoredAt: now },
    });
  }

  const expired = await prisma.temporaryDriverAssignment.findMany({
    where: {
      status: 'ACTIVE',
      endsAt: { lte: now },
    },
    include: {
      route: true,
      temporaryDriver: { select: { id: true, name: true } },
      originalDriver: { select: { id: true, name: true } },
    },
    orderBy: { endsAt: 'asc' },
  });

  for (const assignment of expired) {
    await prisma.$transaction(async tx => {
      await tx.route.updateMany({
        where: {
          id: assignment.routeId,
          assignedDriverId: assignment.temporaryDriverId,
        },
        data: { assignedDriverId: assignment.originalDriverId || null },
      });

      await tx.temporaryDriverAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'COMPLETED',
          restoredAt: new Date(),
        },
      });

      await tx.routeChange.create({
        data: {
          routeId: assignment.routeId,
          reason: `Temporary driver assignment ended: ${assignment.reason}`,
          fromBusId: assignment.route.assignedBusId,
          toBusId: assignment.route.assignedBusId,
          fromDriverId: assignment.temporaryDriverId,
          toDriverId: assignment.originalDriverId || null,
        },
      });
    });

    await notifyUsers(
      [assignment.temporaryDriverId, assignment.originalDriverId],
      'Temporary driver assignment ended',
      `${assignment.route.code} · ${assignment.route.name} has returned to ${assignment.originalDriver?.name || 'the regular assignment'}.`,
    );

    io?.emit('route:temporary-driver', {
      routeId: assignment.routeId,
      assignmentId: assignment.id,
      status: 'COMPLETED',
    });
  }
}

export function startTemporaryDriverAssignmentJob(io = null) {
  const run = async () => {
    try {
      await syncTemporaryDriverAssignments(io);
    } catch (error) {
      console.error('Temporary driver assignment sync failed:', error);
    }
  };

  run();
  const timer = setInterval(run, 30_000);
  timer.unref?.();
  return timer;
}
