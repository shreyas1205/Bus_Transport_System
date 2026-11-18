// Road-following route shape. Asks the OSRM routing service for the driving path through
// the route's stops in order and stores it as [[lat, lng], ...] on Route.roadPath.
// Deviation checks use this path when present, so a bus following real roads is not
// flagged for being away from the straight line between two stops.
const OSRM_URL = process.env.ROUTING_SERVICE_URL || 'https://router.project-osrm.org';

export async function fetchRoadPath(stops) {
  const valid = stops.filter(s => Number.isFinite(s.latitude) && Number.isFinite(s.longitude));
  if (valid.length < 2) return null;
  const coords = valid.map(s => `${s.longitude},${s.latitude}`).join(';');
  const url = `${OSRM_URL}/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`Routing service returned ${res.status}`);
    const body = await res.json();
    const line = body?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) throw new Error('No road path returned');
    return line.map(([lng, lat]) => [Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
  } finally {
    clearTimeout(timer);
  }
}

export async function refreshRoadPath(prisma, routeId) {
  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } } },
  });
  if (!route) throw new Error('Route not found');
  const path = await fetchRoadPath(route.stops.map(rs => rs.stop));
  await prisma.route.update({ where: { id: routeId }, data: { roadPath: path } });
  return path;
}
