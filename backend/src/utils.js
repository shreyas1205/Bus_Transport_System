export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function withinGeofence(lat, lon, stop) {
  return haversineKm(lat, lon, stop.latitude, stop.longitude) * 1000 <= stop.geofenceM;
}

export function nearestNeighbor(stops) {
  if (!stops.length) return [];
  const remaining = [...stops];
  const ordered = [remaining.shift()];
  while (remaining.length) {
    const current = ordered.at(-1);
    let bestIndex = 0;
    let bestDist = Infinity;
    remaining.forEach((candidate, i) => {
      const d = haversineKm(current.latitude, current.longitude, candidate.latitude, candidate.longitude);
      if (d < bestDist) { bestDist = d; bestIndex = i; }
    });
    ordered.push(remaining.splice(bestIndex, 1)[0]);
  }
  return ordered;
}

export function calculateEtaMinutes(bus, stop) {
  if (bus.latitude == null || bus.longitude == null) return null;
  const speed = Math.max(Number(bus.speedKmph || 20), 8);
  const km = haversineKm(bus.latitude, bus.longitude, stop.latitude, stop.longitude);
  return Math.max(1, Math.round((km / speed) * 60));
}
