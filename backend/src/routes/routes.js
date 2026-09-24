import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';
import { calculateEtaMinutes, nearestNeighbor, withinGeofence } from '../utils.js';

const router = express.Router();

function extractGoogleMapsCoordinates(url) {
  if (!url) return null;
  try {
    const value = decodeURIComponent(String(url));
    const patterns = [
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/,
      /[?&](?:q|ll)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) {
        const latitude = Number(match[1]);
        const longitude = Number(match[2]);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
          return { latitude, longitude };
        }
      }
    }
  } catch {}
  return null;
}

async function geocodeLocation(query) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '1', q: `${query}, Bengaluru, India` });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { 'User-Agent': 'CampusBus/1.0 (local demo)' },
  });
  if (!response.ok) throw new Error(`Geocoding service returned ${response.status}`);
  const data = await response.json();
  if (!data.length) throw new Error(`Location not found: ${query}`);
  return { latitude: Number(data[0].lat), longitude: Number(data[0].lon) };
}

router.get('/', auth, async (req, res) => {
  const routes = await prisma.route.findMany({
    include: {
      stops: { include: { stop: true }, orderBy: { sequence: 'asc' } },
      assignedBus: true,
      assignedDriver: { select: { id: true, name: true, phone: true } },
    },
  });
  const enriched = routes.map(r => ({
    ...r,
    eta: r.assignedBus
      ? r.stops.map(rs => ({
          stopId: rs.stopId,
          plannedEta: rs.plannedEta,
          etaMinutes: calculateEtaMinutes(r.assignedBus, rs.stop),
        }))
      : [],
  }));
  res.json(enriched);
});

// Admin-only route creation: pickup point name + human-readable location + time.
router.post('/', auth, allow('ADMIN'), async (req, res) => {
  const { code, name, description, assignedBusId, assignedDriverId, busNumber, stops = [] } = req.body;
  if (!code || !name || !Array.isArray(stops) || !stops.length) {
    return res.status(400).json({ message: 'code, name and at least one pickup point are required' });
  }

  try {
    const preparedStops = await Promise.all(stops.map(async (s, index) => {
      if (!s.name || !s.googleMapsUrl || !s.plannedEta) {
        throw new Error(`Pickup point ${index + 1} needs a name, Google Maps location and arrival time.`);
      }
      let coords = extractGoogleMapsCoordinates(s.googleMapsUrl);
      if (!coords) {
        coords = await geocodeLocation(s.name);
      }
      return {
        name: s.name,
        locationText: s.name,
        googleMapsUrl: s.googleMapsUrl,
        latitude: coords.latitude,
        longitude: coords.longitude,
        geofenceM: Number(s.geofenceM || 150),
        transportFee: Number(s.transportFee || 0),
        plannedEta: s.plannedEta,
        sequence: index + 1,
      };
    }));

    const route = await prisma.$transaction(async tx => {
      if (assignedBusId && busNumber) {
        await tx.vehicle.update({ where: { id: assignedBusId }, data: { busNumber: String(busNumber).trim() } });
      }
      const created = await tx.route.create({
        data: {
          code,
          name,
          description,
          assignedBusId: assignedBusId || null,
          assignedDriverId: assignedDriverId || null,
          stops: { create: preparedStops.map(s => ({
            sequence: s.sequence,
            plannedEta: s.plannedEta,
            stop: { create: {
              name: s.name,
              locationText: s.locationText,
              googleMapsUrl: s.googleMapsUrl,
              latitude: s.latitude,
              longitude: s.longitude,
              geofenceM: s.geofenceM,
              transportFee: s.transportFee,
            } },
          })) },
        },
        include: { stops: { include: { stop: true }, orderBy: { sequence: 'asc' } }, assignedBus: true },
      });
      return created;
    });

    res.status(201).json(route);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Could not create route' });
  }
});

router.post('/geocode', auth, allow('ADMIN'), async (req, res) => {
  try {
    if (!req.body.locationText) return res.status(400).json({ message: 'locationText is required' });
    const coords = await geocodeLocation(req.body.locationText);
    res.json(coords);
  } catch (error) {
    res.status(400).json({ message: error.message || 'Location could not be found' });
  }
});

router.post('/geofence-check', auth, allow('ADMIN','FLEET_MANAGER','DRIVER'), async (req,res) => {
  const { stopId, latitude, longitude } = req.body;
  const stop = await prisma.stop.findUnique({ where: { id: stopId } });
  if (!stop) return res.status(404).json({ message: 'Stop not found' });
  res.json({ inside: withinGeofence(Number(latitude), Number(longitude), stop), stop, checkedAt: new Date().toISOString() });
});

router.post('/optimize', auth, allow('ADMIN','FLEET_MANAGER'), async (req, res) => {
  const { routeId } = req.body;
  const route = await prisma.route.findUnique({ where: { id: routeId }, include: { stops: { include: { stop: true } } } });
  if (!route) return res.status(404).json({ message: 'Route not found' });
  const ordered = nearestNeighbor(route.stops.map(s => s.stop));
  await prisma.$transaction(ordered.map((stop, index) => prisma.routeStop.update({ where: { id: route.stops.find(rs => rs.stopId === stop.id).id }, data: { sequence: index + 1 } })));
  res.json({ message: 'Route optimized with nearest-neighbour heuristic', ordered: ordered.map(s => s.name) });
});

router.post('/:id/reassign', auth, allow('ADMIN','FLEET_MANAGER'), async (req, res) => {
  const { busId, driverId, reason = 'Operational reassignment', busNumber } = req.body;
  const route = await prisma.route.findUnique({ where: { id: req.params.id } });
  if (!route) return res.status(404).json({ message: 'Route not found' });
  if (busId && busNumber) await prisma.vehicle.update({ where: { id: busId }, data: { busNumber: String(busNumber).trim() } });
  await prisma.$transaction([
    prisma.route.update({ where: { id: route.id }, data: { assignedBusId: busId || null, assignedDriverId: driverId || null } }),
    prisma.routeChange.create({ data: { routeId: route.id, reason, fromBusId: route.assignedBusId, toBusId: busId || null, fromDriverId: route.assignedDriverId, toDriverId: driverId || null } })
  ]);
  res.json({ message: 'Route dynamically reassigned' });
});

export default router;
