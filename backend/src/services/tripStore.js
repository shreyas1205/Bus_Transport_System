import { prisma } from '../prisma.js';

const FLUSH_INTERVAL_MS = 5000;

function startOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start;
}

// Save every in-memory trip so a backend restart does not lose active trips.
export async function saveTripSessions(sessions) {
  for (const [driverId, session] of sessions) {
    const data = JSON.parse(JSON.stringify(session));
    await prisma.tripSession.upsert({
      where: { driverId },
      update: { data },
      create: { driverId, data }
    });
  }
}

// Reload trips that are still active and started today.
export async function restoreTripSessions(sessions) {
  const rows = await prisma.tripSession.findMany();
  const today = startOfToday().getTime();
  let restored = 0;

  for (const row of rows) {
    const session = row.data;
    const started = session?.startedAt ? new Date(session.startedAt).getTime() : 0;
    if (session?.active && started >= today) {
      sessions.set(row.driverId, session);
      restored += 1;
    }
  }
  return restored;
}

export function startTripPersistence(sessions) {
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await saveTripSessions(sessions);
    } catch (error) {
      console.error('Trip persistence failed:', error.message);
    } finally {
      busy = false;
    }
  }, FLUSH_INTERVAL_MS);
  timer.unref();
  return () => saveTripSessions(sessions);
}
