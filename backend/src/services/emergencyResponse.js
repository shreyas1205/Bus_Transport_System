import { prisma } from '../prisma.js';

const DEFAULT_RADIUS_METERS = Number(
  process.env.EMERGENCY_RESOURCE_RADIUS_METERS || 12000
);

const AUTONOMOUS_DISPATCH_CONFIDENCE = Number(
  process.env.AUTONOMOUS_DISPATCH_CONFIDENCE || 0.8
);

const AUTONOMOUS_DISPATCH_ENABLED =
  String(process.env.AUTONOMOUS_DISPATCH_ENABLED ?? 'true')
    .trim()
    .toLowerCase() !== 'false';

const OVERPASS_URL =
  process.env.OVERPASS_URL ||
  'https://overpass-api.de/api/interpreter';

const LOOKUP_TIMEOUT_MS = Number(
  process.env.EMERGENCY_LOOKUP_TIMEOUT_MS || 7000
);

const DISPATCH_MODE = String(
  process.env.EMERGENCY_DISPATCH_MODE || 'demo'
)
  .trim()
  .toLowerCase();

function toNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = value => (value * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return 2 * R * Math.asin(Math.sqrt(a));
}

function elementCoordinates(element) {
  const lat =
    toNumber(element.lat) ??
    toNumber(element.center?.lat);

  const lon =
    toNumber(element.lon) ??
    toNumber(element.center?.lon);

  if (lat === null || lon === null) {
    return null;
  }

  return { lat, lon };
}

function cleanResource(element, originLat, originLng) {
  const coordinates = elementCoordinates(element);

  if (!coordinates) {
    return null;
  }

  const tags = toPlainObject(element.tags);

  return {
    osmType: element.type,
    osmId: element.id,
    name:
      tags.name ||
      tags['name:en'] ||
      tags.operator ||
      'Unnamed emergency facility',
    amenity: tags.amenity || null,
    healthcare: tags.healthcare || null,
    emergency: tags.emergency || null,
    beds: toNumber(tags.beds),
    phone:
      tags.phone ||
      tags['contact:phone'] ||
      null,
    website:
      tags.website ||
      tags['contact:website'] ||
      null,
    address: [
      tags['addr:housenumber'],
      tags['addr:street'],
      tags['addr:suburb'],
      tags['addr:city']
    ]
      .filter(Boolean)
      .join(', ') || null,
    latitude: coordinates.lat,
    longitude: coordinates.lon,
    distanceMeters: Math.round(
      haversineMeters(
        originLat,
        originLng,
        coordinates.lat,
        coordinates.lon
      )
    ),
    tags
  };
}

function hospitalPriority(resource) {
  let score = 0;

  if (resource.emergency === 'yes') {
    score += 40;
  }

  if (resource.healthcare === 'hospital') {
    score += 20;
  }

  if (resource.amenity === 'hospital') {
    score += 15;
  }

  if (resource.beds !== null) {
    if (resource.beds >= 200) score += 30;
    else if (resource.beds >= 100) score += 20;
    else if (resource.beds >= 50) score += 10;
  }

  const specialties = String(
    resource.tags?.['healthcare:speciality'] || ''
  ).toLowerCase();

  if (
    specialties.includes('emergency') ||
    specialties.includes('trauma')
  ) {
    score += 25;
  }

  // Prefer closer hospitals when capability metadata is similar.
  score -= Math.min(resource.distanceMeters / 1000, 20);

  return score;
}

async function queryOverpass(latitude, longitude, radiusMeters) {
  const query = `
[out:json][timeout:8];
(
  nwr(around:${radiusMeters},${latitude},${longitude})["amenity"="police"];
  nwr(around:${radiusMeters},${latitude},${longitude})["amenity"="hospital"];
  nwr(around:${radiusMeters},${latitude},${longitude})["healthcare"="hospital"];
);
out center tags;
`;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    LOOKUP_TIMEOUT_MS
  );

  try {
    const body = new URLSearchParams({ data: query });

    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': 'NaviGuard-College-Demo/1.0'
      },
      body,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Emergency resource lookup returned ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data?.elements) ? data.elements : [];
  } finally {
    clearTimeout(timeout);
  }
}

export async function findNearbyEmergencyResources(
  latitude,
  longitude,
  {
    radiusMeters = DEFAULT_RADIUS_METERS
  } = {}
) {
  const lat = toNumber(latitude);
  const lng = toNumber(longitude);

  if (lat === null || lng === null) {
    return {
      status: 'INVALID_LOCATION',
      radiusMeters,
      police: [],
      hospitals: []
    };
  }

  try {
    const elements = await queryOverpass(
      lat,
      lng,
      radiusMeters
    );

    const resources = elements
      .map(element => cleanResource(element, lat, lng))
      .filter(Boolean);

    const police = resources
      .filter(item => item.amenity === 'police')
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 3);

    const hospitals = resources
      .filter(
        item =>
          item.amenity === 'hospital' ||
          item.healthcare === 'hospital'
      )
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, 3)
      .map(item => ({
        ...item,
        capabilityScore: Number(
          hospitalPriority(item).toFixed(2)
        )
      }));

    return {
      status: 'OK',
      provider: 'OpenStreetMap / Overpass',
      radiusMeters,
      police,
      hospitals
    };
  } catch (error) {
    console.error('Emergency resource lookup failed:', error);

    return {
      status: 'LOOKUP_FAILED',
      provider: 'OpenStreetMap / Overpass',
      radiusMeters,
      police: [],
      hospitals: [],
      error: error.message
    };
  }
}

async function currentPassengerSnapshot(vehicleId) {
  if (!vehicleId) {
    return {
      onboardStudents: 0,
      affectedStudentIds: [],
      students: [],
      parentContacts: [],
      routes: []
    };
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const events = await prisma.boardingEvent.findMany({
    where: {
      vehicleId,
      scannedAt: {
        gte: startOfToday
      },
      user: {
        role: 'STUDENT'
      }
    },
    include: {
      user: {
        select: {
          id: true,
          institutionId: true
        }
      }
    },
    orderBy: {
      scannedAt: 'asc'
    }
  });

  const latestByStudent = new Map();

  for (const event of events) {
    latestByStudent.set(event.userId, event);
  }

  const onboardEvents = [...latestByStudent.values()].filter(
    event => event.status === 'BOARDED'
  );

  const onboardStudentIds = new Set(
    onboardEvents.map(event => event.userId)
  );

  const routes = await prisma.route.findMany({
    where: {
      assignedBusId: vehicleId,
      isActive: true
    },
    select: {
      id: true,
      code: true,
      name: true
    }
  });

  const routeIds = routes.map(route => route.id);

  const routeStudents = routeIds.length
    ? await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          assignedRouteId: {
            in: routeIds
          }
        },
        select: {
          id: true,
          institutionId: true
        }
      })
    : [];

  const studentUserIds = new Set([
    ...routeStudents.map(student => student.id),
    ...onboardEvents.map(event => event.userId)
  ]);

  const studentUsers = studentUserIds.size
    ? await prisma.user.findMany({
        where: {
          role: 'STUDENT',
          id: {
            in: [...studentUserIds]
          }
        },
        select: {
          id: true,
          institutionId: true,
          name: true,
          phone: true,
          pickupStop: {
            select: {
              id: true,
              name: true
            }
          },
          studentProfile: {
            select: {
              guardianName: true,
              guardianPhone: true
            }
          }
        }
      })
    : [];

  const affectedStudentIds = new Set();

  for (const student of studentUsers) {
    affectedStudentIds.add(student.id);
    if (student.institutionId) {
      affectedStudentIds.add(student.institutionId);
    }
  }

  const parents = affectedStudentIds.size
    ? await prisma.user.findMany({
        where: {
          role: 'PARENT'
        },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          parentProfile: {
            select: {
              studentId: true
            }
          }
        }
      })
    : [];

  const students = studentUsers.map(student => {
    const linkedParent = parents.find(parent => {
      const linkedStudent = parent.parentProfile?.studentId;
      return (
        linkedStudent === student.id ||
        (student.institutionId && linkedStudent === student.institutionId)
      );
    });

    const fallbackGuardian = student.studentProfile?.guardianName || null;
    const fallbackGuardianPhone = student.studentProfile?.guardianPhone || null;

    return {
      id: student.id,
      institutionId: student.institutionId || null,
      name: student.name,
      phone: student.phone || null,
      pickupStop: student.pickupStop || null,
      status: onboardStudentIds.has(student.id)
        ? 'ONBOARD'
        : 'ASSIGNED_TO_ROUTE',
      parent: linkedParent
        ? {
            id: linkedParent.id,
            name: linkedParent.name,
            phone: linkedParent.phone || fallbackGuardianPhone,
            email: linkedParent.email
          }
        : (fallbackGuardian || fallbackGuardianPhone)
          ? {
              id: null,
              name: fallbackGuardian,
              phone: fallbackGuardianPhone,
              email: null
            }
          : null
    };
  });

  const parentContacts = students
    .filter(student => student.parent)
    .map(student => ({
      studentId: student.id,
      studentName: student.name,
      parentName: student.parent.name,
      phone: student.parent.phone,
      email: student.parent.email
    }));

  return {
    onboardStudents: onboardEvents.length,
    affectedStudentIds: [...affectedStudentIds],
    students,
    parentContacts,
    routes
  };
}

async function notifyParents({
  affectedStudentIds,
  incident,
  resources
}) {
  if (!affectedStudentIds.length) {
    return 0;
  }

  const parents = await prisma.user.findMany({
    where: {
      role: 'PARENT'
    },
    include: {
      parentProfile: true
    }
  });

  const studentIds = new Set(affectedStudentIds);

  const relevantParents = parents.filter(parent => {
    const linkedStudent = parent.parentProfile?.studentId;
    return linkedStudent && studentIds.has(linkedStudent);
  });

  if (!relevantParents.length) {
    return 0;
  }

  const busLabel =
    incident.vehicle?.busNumber ||
    incident.vehicle?.registrationNo ||
    'Campus bus';

  const policeName = resources.police?.[0]?.name;
  const hospitalName = resources.hospitals?.[0]?.name;

  const responseSummary = [
    policeName ? `Police target: ${policeName}.` : null,
    hospitalName ? `Hospital target: ${hospitalName}.` : null
  ]
    .filter(Boolean)
    .join(' ');

  const mapLink =
    incident.latitude != null && incident.longitude != null
      ? ` https://maps.google.com/?q=${incident.latitude},${incident.longitude}`
      : '';

  await prisma.notification.createMany({
    data: relevantParents.map(parent => ({
      userId: parent.id,
      type: 'GENERAL',
      title: 'Critical NaviGuard Emergency',
      message:
        `${busLabel} triggered an autonomous emergency response. ` +
        `${responseSummary || 'Campus transport administration has been alerted.'}` +
        mapLink
    }))
  });

  return relevantParents.length;
}

async function notifyAdmins({
  incident,
  resources,
  dispatchStatus,
  passengerSnapshot,
  packet
}) {
  const admins = await prisma.user.findMany({
    where: {
      role: 'ADMIN'
    },
    select: {
      id: true
    }
  });

  if (!admins.length) {
    return 0;
  }

  const busLabel =
    incident.vehicle?.busNumber ||
    incident.vehicle?.registrationNo ||
    'Campus bus';

  const formatResource = (label, resource) => {
    if (!resource) {
      return `${label}: not found`;
    }

    const distance = Number.isFinite(Number(resource.distanceMeters))
      ? ` · ${(Number(resource.distanceMeters) / 1000).toFixed(1)} km`
      : '';

    return (
      `${label}: ${resource.name || 'Unnamed facility'}` +
      ` · ${resource.phone || 'phone unavailable'}` +
      distance
    );
  };

  const studentLines = (passengerSnapshot.students || [])
    .slice(0, 12)
    .map(student => {
      const parent = student.parent;
      const parentContact = parent
        ? `${parent.name || 'Parent'} · ${parent.phone || 'phone unavailable'}`
        : 'parent contact unavailable';

      return `${student.name} (${student.status}) → ${parentContact}`;
    });

  if ((passengerSnapshot.students || []).length > studentLines.length) {
    studentLines.push(
      `+${passengerSnapshot.students.length - studentLines.length} more affected student(s)`
    );
  }

  const locationLine =
    incident.latitude != null && incident.longitude != null
      ? `Location: ${incident.latitude}, ${incident.longitude}`
      : 'Location: unavailable';

  const mapLine = packet?.location?.mapUrl
    ? `Map: ${packet.location.mapUrl}`
    : null;

  const fallbackNumber =
    packet?.emergencyContacts?.fallbackEmergencyPhone ||
    process.env.EMERGENCY_FALLBACK_PHONE ||
    '112';

  const dispatchNote =
    dispatchStatus === 'MOCK_DISPATCHED'
      ? 'Dispatch: DEMO ONLY — no real emergency service was contacted.'
      : `Dispatch: ${dispatchStatus}.`;

  const message = [
    `${busLabel}: critical accident response activated.`,
    locationLine,
    mapLine,
    studentLines.length
      ? `Affected students / parent contacts:\n${studentLines.join('\n')}`
      : 'Affected students / parent contacts: none available.',
    formatResource('Nearest police', resources.police?.[0]),
    formatResource('Nearest hospital', resources.hospitals?.[0]),
    `Fallback emergency number: ${fallbackNumber}`,
    dispatchNote
  ]
    .filter(Boolean)
    .join('\n');

  await prisma.notification.createMany({
    data: admins.map(admin => ({
      userId: admin.id,
      type: 'GENERAL',
      title: `CRITICAL ACCIDENT · ${busLabel}`,
      message
    }))
  });

  return admins.length;
}

const driverNonResponseTimers = new Map();

export function scheduleDriverNonResponseEscalation({
  incidentId,
  verificationDeadline,
  io
}) {
  if (!incidentId || !verificationDeadline) return;

  const existingTimer = driverNonResponseTimers.get(incidentId);
  if (existingTimer) clearTimeout(existingTimer);

  const delay = Math.max(0, new Date(verificationDeadline).getTime() - Date.now());

  const timer = setTimeout(async () => {
    driverNonResponseTimers.delete(incidentId);

    try {
      const incident = await prisma.incident.findUnique({
        where: { id: incidentId },
        include: {
          vehicle: true,
          driver: { select: { id: true, name: true, phone: true } }
        }
      });

      if (!incident || incident.verificationStatus !== 'PENDING') return;

      const updated = await prisma.incident.update({
        where: { id: incident.id },
        data: {
          priority: Math.max(incident.priority || 0, 9),
          message: 'Possible accident detected. Driver did not respond before the verification countdown expired.'
        },
        include: {
          vehicle: true,
          driver: { select: { id: true, name: true, phone: true } }
        }
      });

      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true }
      });

      const busLabel =
        updated.vehicle?.busNumber ||
        updated.vehicle?.registrationNo ||
        'Campus bus';

      if (admins.length) {
        await prisma.notification.createMany({
          data: admins.map(admin => ({
            userId: admin.id,
            type: 'GENERAL',
            title: 'Driver Not Responding',
            message:
              `${busLabel}: possible accident detected and the driver did not respond within 30 seconds. ` +
              'Immediate transport-admin review is required. No automatic external dispatch was triggered by this timeout alone.'
          }))
        });
      }

      io?.emit('accident:driver-unresponsive', updated);
      io?.emit('notification:update', { userIds: admins.map(admin => admin.id) });
    } catch (error) {
      console.error('Driver non-response escalation failed:', error);
    }
  }, delay + 150);

  driverNonResponseTimers.set(incidentId, timer);
}

export async function recoverPendingAccidentCountdowns(io) {
  try {
    const pending = await prisma.incident.findMany({
      where: {
        type: 'CRASH',
        verificationStatus: 'PENDING',
        verificationDeadline: { not: null }
      },
      select: { id: true, verificationDeadline: true }
    });

    for (const incident of pending) {
      scheduleDriverNonResponseEscalation({
        incidentId: incident.id,
        verificationDeadline: incident.verificationDeadline,
        io
      });
    }
  } catch (error) {
    console.error('Pending accident countdown recovery failed:', error);
  }
}

function buildDistressPacket({
  incident,
  passengerSnapshot,
  resources
}) {
  const vehicle = incident.vehicle || {};
  const driver = incident.driver || {};
  const route = passengerSnapshot.routes?.[0] || null;

  const busLabel =
    vehicle.busNumber ||
    vehicle.registrationNo ||
    'Unknown bus';

  const message =
    `NAVIGUARD CRITICAL EMERGENCY. ${busLabel}. ` +
    `${route ? `Route ${route.code || route.name}. ` : ''}` +
    `Accident confidence ${Math.round(Number(incident.aiConfidence || 0) * 100)}%. ` +
    `Speed ${incident.speedBefore ?? 'N/A'} km/h to ${incident.speedAfter ?? 'N/A'} km/h. ` +
    `${passengerSnapshot.onboardStudents} student(s) currently recorded onboard. ` +
    `Location ${incident.latitude}, ${incident.longitude}. ` +
    `Immediate emergency assistance requested.`;

  return {
    source: 'NaviGuard',
    severity: 'CRITICAL',
    incidentId: incident.id,
    generatedAt: new Date().toISOString(),
    bus: {
      id: vehicle.id || null,
      busNumber: vehicle.busNumber || null,
      registrationNo: vehicle.registrationNo || null,
      model: vehicle.model || null
    },
    route,
    driver: {
      id: driver.id || null,
      name: driver.name || null,
      phone: driver.phone || null
    },
    location: {
      latitude: incident.latitude,
      longitude: incident.longitude,
      mapUrl:
        incident.latitude != null && incident.longitude != null
          ? `https://maps.google.com/?q=${incident.latitude},${incident.longitude}`
          : null
    },
    accident: {
      confidence: incident.aiConfidence,
      speedBefore: incident.speedBefore,
      speedAfter: incident.speedAfter,
      suddenStopDetected: incident.suddenStopDetected,
      impactDetected: incident.impactDetected,
      rolloverDetected: incident.rolloverDetected
    },
    passengers: {
      onboardStudents: passengerSnapshot.onboardStudents,
      affectedStudents: passengerSnapshot.students?.length || 0,
      students: passengerSnapshot.students || [],
      parentContacts: passengerSnapshot.parentContacts || []
    },
    emergencyContacts: {
      fallbackEmergencyPhone:
        process.env.EMERGENCY_FALLBACK_PHONE || '112'
    },
    selectedEmergencyResources: {
      police: resources.police?.[0] || null,
      hospitals: resources.hospitals || []
    },
    campusContacts: {
      securityPhone: process.env.CAMPUS_SECURITY_PHONE || null,
      transportEmergencyPhone: process.env.TRANSPORT_EMERGENCY_PHONE || null
    },
    message
  };
}

async function dispatchPacket(packet, resources) {
  if (DISPATCH_MODE !== 'webhook') {
    const hasTargets =
      Boolean(resources.police?.[0]) ||
      Boolean(resources.hospitals?.length);

    if (!hasTargets) {
      return {
        mode: 'DEMO',
        status: 'FAILED',
        realEmergencyServiceContacted: false,
        note:
          'Demo dispatch could not select a nearby police station or hospital. Admin/Parent alerts still continue.'
      };
    }

    return {
      mode: 'DEMO',
      status: 'MOCK_DISPATCHED',
      realEmergencyServiceContacted: false,
      note:
        'Demo mode only. Nearby resources were selected, but no real police/hospital dispatch was attempted.',
      police: resources.police?.[0]
        ? {
            name: resources.police[0].name,
            status: 'DEMO_SENT'
          }
        : null,
      hospitals: (resources.hospitals || []).slice(0, 2).map(item => ({
        name: item.name,
        status: 'DEMO_SENT'
      }))
    };
  }

  const webhookUrl = process.env.EMERGENCY_DISPATCH_WEBHOOK_URL;

  if (!webhookUrl) {
    return {
      mode: 'WEBHOOK',
      status: 'FAILED',
      realEmergencyServiceContacted: false,
      note:
        'Webhook dispatch mode is enabled, but EMERGENCY_DISPATCH_WEBHOOK_URL is not configured.'
    };
  }

  try {
    const headers = {
      'content-type': 'application/json'
    };

    if (process.env.EMERGENCY_DISPATCH_WEBHOOK_TOKEN) {
      headers.authorization =
        `Bearer ${process.env.EMERGENCY_DISPATCH_WEBHOOK_TOKEN}`;
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(packet)
    });

    if (!response.ok) {
      throw new Error(`Dispatch webhook returned ${response.status}`);
    }

    return {
      mode: 'WEBHOOK',
      status: 'DISPATCHED',
      realEmergencyServiceContacted: true,
      note:
        'Distress packet was delivered to the configured authorized emergency-dispatch webhook.'
    };
  } catch (error) {
    console.error('Emergency dispatch webhook failed:', error);

    return {
      mode: 'WEBHOOK',
      status: 'FAILED',
      realEmergencyServiceContacted: false,
      note: error.message
    };
  }
}

export function isAutonomousDispatchEligible(incident) {
  if (!AUTONOMOUS_DISPATCH_ENABLED) {
    return false;
  }

  const confidence = Number(incident?.aiConfidence || 0);

  if (confidence >= AUTONOMOUS_DISPATCH_CONFIDENCE) {
    return true;
  }

  // Dedicated phone/vehicle sensors can independently make an event
  // critical even when the numeric score is just below the threshold.
  if (incident?.impactDetected && incident?.rolloverDetected) {
    return true;
  }

  return false;
}

export async function activateAutonomousEmergencyResponse({
  incidentId,
  io,
  force = false,
  activationReason = 'HIGH_CONFIDENCE_ACCIDENT'
}) {
  const incident = await prisma.incident.findUnique({
    where: {
      id: incidentId
    },
    include: {
      vehicle: true,
      driver: {
        select: {
          id: true,
          name: true,
          phone: true
        }
      }
    }
  });

  if (!incident) {
    return {
      activated: false,
      reason: 'INCIDENT_NOT_FOUND'
    };
  }

  if (
    incident.verificationStatus === 'FALSE_ALARM' ||
    incident.status === 'RESOLVED'
  ) {
    return {
      activated: false,
      reason: 'INCIDENT_ALREADY_CLOSED',
      incident
    };
  }

  if (
    ['MOCK_DISPATCHED', 'DISPATCHED'].includes(
      incident.emergencyDispatchStatus
    )
  ) {
    return {
      activated: true,
      alreadyActivated: true,
      incident
    };
  }

  if (!force && !isAutonomousDispatchEligible(incident)) {
    return {
      activated: false,
      reason: 'CONFIDENCE_BELOW_AUTONOMOUS_THRESHOLD',
      threshold: AUTONOMOUS_DISPATCH_CONFIDENCE,
      confidence: incident.aiConfidence
    };
  }

  const now = new Date();

  let activeIncident = incident;

  // High-confidence automatic detection becomes CONFIRMED immediately,
  // before the external resource lookup begins. This prevents a race where
  // the incident could be dismissed while autonomous escalation is running.
  if (!force && incident.verificationStatus !== 'CONFIRMED') {
    activeIncident = await prisma.incident.update({
      where: {
        id: incident.id
      },
      data: {
        verificationStatus: 'CONFIRMED',
        confirmationSource: 'AUTONOMOUS_ENGINE',
        confirmedAt: now,
        priority: 10,
        message:
          'High-confidence bus accident detected. Autonomous emergency response activated.',
        emergencyDispatchStatus: 'PENDING'
      },
      include: {
        vehicle: true,
        driver: {
          select: {
            id: true,
            name: true,
            phone: true
          }
        }
      }
    });

    io?.emit('accident:confirmed', activeIncident);
  }

  const resources = await findNearbyEmergencyResources(
    activeIncident.latitude,
    activeIncident.longitude
  );

  const passengerSnapshot = await currentPassengerSnapshot(
    activeIncident.vehicleId
  );

  const packet = buildDistressPacket({
    incident: activeIncident,
    passengerSnapshot,
    resources
  });

  const dispatch = await dispatchPacket(packet, resources);

  const existingSignals = toPlainObject(
    activeIncident.detectionSignals
  );

  const emergencyResponse = {
    activatedAt: now.toISOString(),
    activationReason,
    autonomous: !force,
    engine: 'AUTONOMOUS_RESOURCE_SCORING_V1',
    confidenceThreshold: AUTONOMOUS_DISPATCH_CONFIDENCE,
    resourceLookup: resources,
    distressPacket: packet,
    dispatch
  };

  const updated = await prisma.incident.update({
    where: {
      id: incident.id
    },
    data: {
      verificationStatus: 'CONFIRMED',
      confirmationSource:
        activeIncident.confirmationSource ||
        (force ? 'VERIFIED_RESPONSE' : 'AUTONOMOUS_ENGINE'),
      confirmedAt: activeIncident.confirmedAt || now,
      priority: 10,
      message:
        force && activeIncident.message
          ? activeIncident.message
          : 'High-confidence bus accident automatically escalated by NaviGuard.',
      emergencyDispatchStatus: dispatch.status,
      emergencyDispatchAt: now,
      detectionSignals: {
        ...existingSignals,
        autonomousEmergencyResponse: emergencyResponse
      }
    },
    include: {
      vehicle: true,
      driver: {
        select: {
          id: true,
          name: true,
          phone: true
        }
      }
    }
  });

  const parentsNotified = await notifyParents({
    affectedStudentIds: passengerSnapshot.affectedStudentIds,
    incident: updated,
    resources
  });

  const adminsNotified = await notifyAdmins({
    incident: updated,
    resources,
    dispatchStatus: dispatch.status,
    passengerSnapshot,
    packet
  });

  io?.emit('accident:confirmed', updated);
  io?.emit('emergency:autonomous-dispatch', {
    incident: updated,
    resources,
    dispatch,
    parentsNotified,
    adminsNotified
  });

  return {
    activated: true,
    incident: updated,
    resources,
    dispatch,
    parentsNotified,
    adminsNotified,
    onboardStudents: passengerSnapshot.onboardStudents
  };
}

const gpsDetectionQueues = new Map();

export async function detectGpsSuddenStop(options) {
  const previous = gpsDetectionQueues.get(options.vehicleId) || Promise.resolve();
  const pending = previous.catch(() => {}).then(() => detectGpsSuddenStopOnce(options));
  gpsDetectionQueues.set(options.vehicleId, pending);
  try {
    return await pending;
  } finally {
    if (gpsDetectionQueues.get(options.vehicleId) === pending) {
      gpsDetectionQueues.delete(options.vehicleId);
    }
  }
}

async function detectGpsSuddenStopOnce({
  vehicleId,
  driverId,
  latitude,
  longitude,
  currentSpeed,
  previousLocation,
  io
}) {
  const MIN_SPEED_FOR_ACCIDENT_CHECK = 35;
  const MIN_SPEED_DROP = 30;
  const LOW_SPEED_AFTER_DROP = 8;
  const VERIFICATION_WINDOW_MS = 30 * 1000;
  const ACCIDENT_COOLDOWN_MS = 2 * 60 * 1000;

  if (!previousLocation || currentSpeed == null || !Number.isFinite(Number(currentSpeed))) {
    return {
      possibleAccident: false,
      previousSpeed: null,
      currentSpeed,
      speedDrop: 0,
      requiresVerification: false,
      verificationWindowSeconds: null,
      incident: null,
      autonomousDispatchTriggered: false
    };
  }

  const previousSpeed = Math.max(
    0,
    Number(previousLocation.speedKmph) || 0
  );

  const speedDrop = Math.max(
    0,
    previousSpeed - currentSpeed
  );

  const suspiciousStop =
    previousSpeed >= MIN_SPEED_FOR_ACCIDENT_CHECK &&
    speedDrop >= MIN_SPEED_DROP &&
    currentSpeed <= LOW_SPEED_AFTER_DROP;

  if (!suspiciousStop) {
    return {
      possibleAccident: false,
      previousSpeed,
      currentSpeed,
      speedDrop,
      requiresVerification: false,
      verificationWindowSeconds: null,
      incident: null,
      autonomousDispatchTriggered: false
    };
  }

  const cooldownStart = new Date(
    Date.now() - ACCIDENT_COOLDOWN_MS
  );

  const recentIncident = await prisma.incident.findFirst({
    where: {
      vehicleId,
      type: 'CRASH',
      createdAt: {
        gte: cooldownStart
      },
      verificationStatus: {
        in: ['PENDING', 'CONFIRMED', 'FALSE_ALARM']
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (recentIncident) {
    return {
      possibleAccident: false,
      previousSpeed,
      currentSpeed,
      speedDrop,
      requiresVerification:
        recentIncident.verificationStatus === 'PENDING',
      verificationWindowSeconds: null,
      incident: recentIncident,
      autonomousDispatchTriggered:
        recentIncident.verificationStatus === 'CONFIRMED'
    };
  }

  let confidence = 0.6;

  if (speedDrop >= 40) {
    confidence += 0.15;
  }

  if (currentSpeed <= 3) {
    confidence += 0.1;
  }

  confidence = Math.min(0.95, confidence);

  const verificationDeadline = new Date(
    Date.now() + VERIFICATION_WINDOW_MS
  );

  const incident = await prisma.incident.create({
    data: {
      driverId: driverId || null,
      vehicleId,
      type: 'CRASH',
      status: 'OPEN',
      priority: confidence >= 0.8 ? 10 : 8,
      message:
        'Possible accident detected from an unusual GPS speed drop.',
      latitude,
      longitude,
      aiConfidence: Number(confidence.toFixed(2)),
      speedBefore: previousSpeed,
      speedAfter: currentSpeed,
      suddenStopDetected: true,
      impactDetected: false,
      rolloverDetected: false,
      detectionSignals: {
        source: 'PHONE_GPS',
        speedDrop,
        previousSpeed,
        currentSpeed,
        algorithm: 'GPS_SUDDEN_STOP_V2'
      },
      verificationStatus: 'PENDING',
      verificationDeadline,
      emergencyDispatchStatus: 'PENDING'
    },
    include: {
      vehicle: true,
      driver: {
        select: {
          id: true,
          name: true,
          phone: true
        }
      }
    }
  });

  const eligible = isAutonomousDispatchEligible(incident);

  if (eligible) {
    // Keep the GPS endpoint responsive. The autonomous response immediately
    // confirms the event, then performs resource lookup/dispatch asynchronously.
    void activateAutonomousEmergencyResponse({
      incidentId: incident.id,
      io,
      activationReason: 'HIGH_CONFIDENCE_GPS_ACCIDENT'
    }).catch(error => {
      console.error(
        'Autonomous emergency response failed:',
        error
      );
    });
  } else {
    io?.emit('accident:possible', incident);

    try {
      const admins = await prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true }
      });

      if (admins.length) {
        const bus = await prisma.vehicle.findUnique({
          where: { id: vehicleId },
          select: { busNumber: true, registrationNo: true }
        });

        const busLabel =
          bus?.busNumber || bus?.registrationNo || 'Campus bus';

        await prisma.notification.createMany({
          data: admins.map(admin => ({
            userId: admin.id,
            type: 'GENERAL',
            title: 'Possible Bus Accident',
            message:
              `${busLabel} showed an unusual speed drop from ` +
              `${previousSpeed} km/h to ${currentSpeed} km/h. ` +
              'Driver/Admin verification is required.'
          }))
        });
      }
    } catch (error) {
      console.error('Possible accident admin notification failed:', error);
    }

    scheduleDriverNonResponseEscalation({
      incidentId: incident.id,
      verificationDeadline,
      io
    });
  }

  return {
    possibleAccident: true,
    previousSpeed,
    currentSpeed,
    speedDrop,
    requiresVerification: !eligible,
    verificationWindowSeconds: eligible
      ? 0
      : VERIFICATION_WINDOW_MS / 1000,
    incident,
    autonomousDispatchTriggered: eligible
  };
}
