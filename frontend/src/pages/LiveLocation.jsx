import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { io } from 'socket.io-client';
import {
  queueOfflineRequest,
  flushOfflineQueue
} from '../offlineQueue';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  CircleMarker,
  useMap
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const busIcon = L.divIcon({
  className: 'bus-marker',
  html: '🚌',
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

const fmtAge = seconds =>
  seconds == null
    ? 'No GPS yet'
    : seconds < 60
      ? `${seconds}s ago`
      : `${Math.floor(seconds / 60)}m ago`;

const fmtTime = value =>
  value
    ? new Date(value).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit'
      })
    : '—';

function Fit({ vehicles }) {
  const map = useMap();

  useEffect(() => {
    const resize = () => map.invalidateSize({ pan: false });
    resize();
    const timer = setTimeout(resize, 180);
    const points = vehicles
      .filter(
        vehicle =>
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude)
      )
      .map(vehicle => [vehicle.latitude, vehicle.longitude]);

    if (points.length === 1) map.setView(points[0], 15);
    else if (points.length > 1) map.fitBounds(points, { padding: [30, 30] });

    return () => clearTimeout(timer);
  }, [vehicles, map]);

  return null;
}

export default function LiveLocation() {
  const { user } = useAuth();
  const isDriver = user?.role === 'DRIVER';
  const canSeeTimeline = ['ADMIN', 'DRIVER'].includes(user?.role);

  const [vehicles, setVehicles] = useState([]);
  const [journey, setJourney] = useState(null);
  const [trip, setTrip] = useState({ active: false });
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [gpsError, setGpsError] = useState('');
  const [reportedDeviationVehicleId, setReportedDeviationVehicleId] = useState(null);
  const [reportingDeviation, setReportingDeviation] = useState(false);
  const watchRef = useRef(null);

  async function load() {
    try {
      setLoading(true);
      const response = await api.get('/live-location');
      setVehicles(response.data.vehicles || []);
      setJourney(response.data.journey || null);
      if (isDriver && response.data.trip) setTrip(response.data.trip);
      setNotice(response.data.message || '');
    } catch (error) {
      setVehicles([]);
      setJourney(null);
      setNotice(
        error.response?.data?.message || 'Could not load live tracking.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    const socket = io(
      import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000'
    );

    socket.on('vehicle:location', load);

    socket.on('trip:status', load);
    socket.on('route:deviation', load);
    socket.on('route:deviation:inevitable', load);
    socket.on('vehicle:overspeed', load);
    socket.on('gps:stale', load);
    socket.on('boarding:missed', load);

    return () => {
      clearInterval(timer);
      socket.disconnect();
      if (watchRef.current != null) {
        navigator.geolocation?.clearWatch(watchRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDriver || !trip.active || !navigator.geolocation) return undefined;

    setGpsError('');

    watchRef.current = navigator.geolocation.watchPosition(
      async position => {
        const payload = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          speedKmph:
            position.coords.speed == null
              ? null
              : Math.max(0, position.coords.speed * 3.6)
        };

        if (!navigator.onLine) {
          queueOfflineRequest({
            method: 'post',
            url: '/live-location/update',
            data: payload,
            kind: 'GPS',
            description: 'Driver GPS update',
            dedupeKey: `gps:${user.id}`,
            ownerUserId: user.id
          });
          setGpsError('Offline: latest GPS position queued for automatic sync.');
          return;
        }

        try {
          await api.post('/live-location/update', payload);
          setGpsError('');
        } catch (error) {
          if (!error.response) {
            queueOfflineRequest({
              method: 'post',
              url: '/live-location/update',
              data: payload,
              kind: 'GPS',
              description: 'Driver GPS update',
              dedupeKey: `gps:${user.id}`
            });
            setGpsError('Network unavailable: GPS queued for automatic sync.');
          } else {
            setGpsError(error.response?.data?.message || 'GPS update failed.');
          }
        }
      },
      error => setGpsError(error.message),
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000
      }
    );

    return () => {
      if (watchRef.current != null) {
        navigator.geolocation.clearWatch(watchRef.current);
        watchRef.current = null;
      }
    };
  }, [isDriver, trip.active, user?.id]);

  async function startTrip() {
    try {
      if (!navigator.onLine) {
        queueOfflineRequest({
          method: 'post',
          url: '/live-location/trip/start',
          data: {},
          kind: 'TRIP',
          description: 'Start driver trip',
          ownerUserId: user.id
        });
        setTrip({ active: true, startedAt: new Date().toISOString(), offline: true });
        setNotice('Offline: trip start queued. GPS updates will sync when connectivity returns.');
        return;
      }

      const response = await api.post('/live-location/trip/start');
      setTrip(response.data.trip);
      setNotice(response.data.message);
      await load();
    } catch (error) {
      if (!error.response) {
        queueOfflineRequest({
          method: 'post',
          url: '/live-location/trip/start',
          data: {},
          kind: 'TRIP',
          description: 'Start driver trip',
          ownerUserId: user.id
        });
        setTrip({ active: true, startedAt: new Date().toISOString(), offline: true });
        setNotice('Network unavailable: trip start queued for sync.');
      } else {
        setNotice(error.response?.data?.message || 'Could not start trip.');
      }
    }
  }

  async function endTrip() {
    try {
      if (!navigator.onLine) {
        queueOfflineRequest({
          method: 'post',
          url: '/live-location/trip/end',
          data: {},
          kind: 'TRIP',
          description: 'End driver trip',
          ownerUserId: user.id
        });
        setTrip(current => ({
          ...current,
          active: false,
          endedAt: new Date().toISOString(),
          offline: true
        }));
        setNotice('Offline: trip end queued for automatic sync.');
        return;
      }

      await flushOfflineQueue(api, user.id);
      const response = await api.post('/live-location/trip/end');
      setTrip(response.data.trip);
      setNotice(response.data.message);
      await load();
    } catch (error) {
      if (!error.response) {
        queueOfflineRequest({
          method: 'post',
          url: '/live-location/trip/end',
          data: {},
          kind: 'TRIP',
          description: 'End driver trip',
          ownerUserId: user.id
        });
        setTrip(current => ({ ...current, active: false, offline: true }));
        setNotice('Network unavailable: trip end queued for sync.');
      } else {
        setNotice(error.response?.data?.message || 'Could not end trip.');
      }
    }
  }

  // NAVG_ROUTE_CAUTION_FIX_V2: dismiss a warning only for this route and unchanged position.
  const [nvgDismissedDeviationKey, setNvgDismissedDeviationKey] = useState(() => {
    try { return sessionStorage.getItem('nvg:route-warning-dismissed:' + user?.id) || ''; }
    catch { return ''; }
  });

  const located = useMemo(
    () =>
      vehicles.filter(
        vehicle =>
          Number.isFinite(vehicle.latitude) &&
          Number.isFinite(vehicle.longitude)
      ),
    [vehicles]
  );

  const deviatedVehicles = useMemo(
    () => vehicles.filter(vehicle => {
      const track = vehicle.tracking || {};
      if (!track.offRoute || track.stale || (isDriver && !trip.active)) return false;
      const lat = Number(vehicle.latitude);
      const lon = Number(vehicle.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
          Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) return false;
      const last = Date.parse(vehicle.lastLocationAt || '');
      const ageMs = Date.now() - last;
      const maxAgeMs = Math.min(90, Number(track.staleThresholdSeconds) || 90) * 1000;
      return Number.isFinite(last) && ageMs >= -10000 && ageMs <= maxAgeMs;
    }),
    [vehicles, isDriver, trip.active]
  );

  const showRouteDeviationAlert =
    user?.role === 'ADMIN' && deviatedVehicles.length > 0;

  const driverDeviationVehicle =
    isDriver && deviatedVehicles.length > 0 ? deviatedVehicles[0] : null;

  useEffect(() => {
    if (!driverDeviationVehicle) {
      setReportedDeviationVehicleId(null);
    }
  }, [driverDeviationVehicle?.id]);

  async function reportInevitableDeviation() {
    if (!driverDeviationVehicle || reportingDeviation) return;

    try {
      setReportingDeviation(true);
      const response = await api.post('/live-location/deviation/inevitable');
      setReportedDeviationVehicleId(driverDeviationVehicle.id);
      setNotice(
        response.data?.message ||
          'Admin notified that the route deviation is unavoidable.'
      );
      await load();
    } catch (error) {
      setVehicles([]);
      setJourney(null);
      setNotice(
        error.response?.data?.message ||
          'Could not notify Admin about the unavoidable deviation.'
      );
    } finally {
      setReportingDeviation(false);
    }
  }

  // NAVG_ROUTE_CAUTION_FIX_V2: unchanged route and coordinates do not reopen a dismissed warning.
  const nvgDeviationKeyFor = vehicle => [
    vehicle?.id, vehicle?.routes?.[0]?.id,
    Math.round(Number(vehicle?.latitude) * 1000),
    Math.round(Number(vehicle?.longitude) * 1000)
  ].join(':');
  const nvgDismissDeviation = vehicle => {
    const key = nvgDeviationKeyFor(vehicle);
    setNvgDismissedDeviationKey(key);
    try { sessionStorage.setItem('nvg:route-warning-dismissed:' + user?.id, key); }
    catch { /* Session storage may be disabled. */ }
  };

  const center = located.length
    ? [located[0].latitude, located[0].longitude]
    : [12.9716, 77.5946];

  const title = isDriver
    ? 'Driver trip control'
    : user?.role === 'ADMIN'
      ? 'Live fleet control'
      : user?.role === 'PARENT'
        ? 'Your child’s bus'
        : 'Your bus';

  return (
    <>
      {isDriver && driverDeviationVehicle &&
        reportedDeviationVehicleId !== driverDeviationVehicle.id &&
        nvgDismissedDeviationKey !== nvgDeviationKeyFor(driverDeviationVehicle) && (
          <section className="nvg-route-caution" role="status" aria-live="polite">
            <div className="nvg-route-caution-content">
              <strong>⚠ Route deviation · Caution</strong>
              <p>Bus {driverDeviationVehicle.busNumber || driverDeviationVehicle.registrationNo || '—'} is{' '}
                {Math.round(Number(driverDeviationVehicle.tracking?.distanceFromRouteM || 0))} m away from its planned route.
                Continue safely and return when practical.
              </p>
            </div>
            <div className="nvg-route-caution-actions">
              <button type="button" className="secondary" onClick={() => nvgDismissDeviation(driverDeviationVehicle)}>Dismiss</button>
              <button type="button" className="secondary" disabled={reportingDeviation} onClick={reportInevitableDeviation}>
                {reportingDeviation ? 'Notifying…' : 'Notify Admin if unavoidable'}
              </button>
            </div>
          </section>
        )}
      <div className="page-title">
        <div>
          <span className="eyebrow">LIVE GPS · ETA · TRIP CONTROL</span>
          <h2>{title}</h2>
          <p>
            Live position, upcoming-stop ETA, journey status and route safety in
            one view.
          </p>
        </div>

        <button className="secondary live-refresh-btn" onClick={load} title="Refresh live tracking">
          <span className="live-refresh-icon" aria-hidden="true">↻</span>
          <span>Refresh</span>
        </button>
      </div>

      {notice && <div className="success">{notice}</div>}
      {gpsError && <div className="error">{gpsError}</div>}

      {showRouteDeviationAlert && (
        <section className="route-deviation-critical nvg-route-caution" role="status" aria-live="polite">
          <div className="route-deviation-critical-icon" aria-hidden="true">⚠</div>
          <div className="route-deviation-critical-copy">
            <span>ROUTE CAUTION</span>
            <strong>ROUTE DEVIATION</strong>
            <p>
              {deviatedVehicles.map(vehicle => {
                const distance = Number(vehicle.tracking?.distanceFromRouteM || 0);
                const distanceLabel = distance >= 1000
                  ? `${(distance / 1000).toFixed(1)} km`
                  : `${Math.round(distance)} m`;
                return `Bus ${vehicle.busNumber || vehicle.registrationNo || '—'} · ${distanceLabel} off assigned route`;
              }).join('  •  ')}
            </p>
          </div>
          <div className="route-deviation-critical-badge">
            {isDriver && reportedDeviationVehicleId
              ? 'INEVITABLE REPORTED'
              : 'CAUTION'}
          </div>
        </section>
      )}

      {isDriver && (
        <section className="panel trip-control-card">
          <div>
            <span className="eyebrow">DRIVER TRIP</span>
            <h3>{trip.active ? 'Trip in progress' : 'Ready to start'}</h3>
            <p>
              {trip.active
                ? `Started ${fmtTime(trip.startedAt)} · GPS sharing active${trip.offline ? ' · OFFLINE QUEUE' : ''}`
                : 'Start the trip to begin secure browser GPS sharing.'}
            </p>
          </div>

          <div className="trip-actions">
            <span className={trip.active ? 'chip good' : 'chip warn'}>
              {trip.active ? '● LIVE TRIP' : '○ NOT STARTED'}
            </span>
            {trip.active ? (
              <button className="danger-button" onClick={endTrip}>End Trip</button>
            ) : (
              <button className="primary" onClick={startTrip}>Start Trip</button>
            )}
          </div>
        </section>
      )}

      {journey && (
        <section className="panel passenger-journey-card">
          <div>
            <span className="eyebrow">
              {user?.role === 'PARENT' ? 'LINKED STUDENT' : 'TODAY’S JOURNEY'}
            </span>
            <h3>{journey.student?.name || 'Student'}</h3>
            <p>
              {journey.student?.institutionId || ''} · Pickup:{' '}
              {journey.pickupStop?.name || 'Not assigned'}
            </p>
          </div>

          <div className="journey-status-row">
            <span className={`journey-state ${journey.status.toLowerCase()}`}>
              {journey.status.replaceAll('_', ' ')}
            </span>
            <div><small>BOARDED</small><b>{fmtTime(journey.boardedAt)}</b></div>
            <div><small>DROPPED OFF</small><b>{fmtTime(journey.droppedOffAt)}</b></div>
          </div>
        </section>
      )}

      {loading ? (
        <div className="loading-card">Loading live tracking…</div>
      ) : !vehicles.length ? (
        <div className="panel empty">No active bus is assigned.</div>
      ) : (
        <div className="live-control-layout">
          <section className="live-fleet-column">
            {vehicles.map(vehicle => {
              const route = vehicle.routes?.[0];
              const track = vehicle.tracking || {};

              return (
                <article className="panel live-bus-card" key={vehicle.id}>
                  <div className="live-bus-head">
                    <div>
                      <span className="eyebrow">{route?.code || 'NO ROUTE'}</span>
                      <h3>
                        Bus {vehicle.busNumber || '—'} <small>{vehicle.registrationNo}</small>
                      </h3>
                    </div>
                    <span className={track.stale ? 'chip warn' : 'chip good'}>
                      {track.stale ? 'GPS STALE' : 'LIVE'}
                    </span>
                  </div>

                  {track.stale && (
                    <div className="error">
                      ⚠ Bus location unavailable or stale — last update {fmtAge(track.ageSeconds)}.
                    </div>
                  )}

                  {track.overspeed && (
                    <div className="alert-banner">
                      ⚠ OVERSPEED: {Math.round(vehicle.speedKmph || 0)} km/h · route limit {track.speedLimitKmph} km/h.
                    </div>
                  )}

                  <div className="live-metrics">
                    <div><small>SPEED</small><b>{vehicle.speedKmph == null ? '—' : `${Math.round(vehicle.speedKmph)} km/h`}</b></div>
                    <div><small>LIMIT</small><b>{track.speedLimitKmph ? `${track.speedLimitKmph} km/h` : '—'}</b></div>
                    <div><small>NEXT STOP</small><b>{track.nextStop?.name || '—'}</b></div>
                    <div><small>ETA</small><b>{track.etaMinutes ? `${track.etaMinutes} min` : '—'}</b></div>
                    <div><small>LAST GPS</small><b>{fmtAge(track.ageSeconds)}</b></div>
                  </div>

                  <div className={track.stale ? 'route-health caution' : track.offRoute ? 'route-health caution' : 'route-health safe'}>
                    <b>{track.stale ? 'GPS stale — route status unknown' : track.offRoute ? '⚠ Route deviation (caution)' : '✓ On assigned route'}</b>
                    <span>
                      {track.distanceFromRouteM != null
                        ? `${track.distanceFromRouteM} m from route`
                        : 'Waiting for route/GPS data'}
                    </span>
                  </div>

                  <div className="live-detail-grid">
                    <div><small>ROUTE</small><b>{route?.name || 'Not assigned'}</b></div>
                    <div><small>DRIVER</small><b>{route?.assignedDriver?.name || user?.name || '—'}</b><span>{route?.assignedDriver?.phone || ''}</span></div>
                    <div><small>UPCOMING</small><b>{track.nextStop?.name || '—'}</b><span>{track.nextStop?.distanceM != null ? `${(track.nextStop.distanceM / 1000).toFixed(1)} km away` : ''}</span></div>
                  </div>

                  {canSeeTimeline && vehicle.timeline?.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <span className="eyebrow">LIVE JOURNEY TIMELINE</span>
                      <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                        {vehicle.timeline.slice(-10).map(item => (
                          <div key={item.id} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                            <small style={{ minWidth: 74 }}>{fmtTime(item.at)}</small>
                            <span>{item.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </section>

          <section className="map-panel live-map-panel premium-live-map">
            <MapContainer center={center} zoom={14} scrollWheelZoom>
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <Fit vehicles={located} />

              {vehicles.map(vehicle => {
                const stops = vehicle.routes?.[0]?.stops || [];
                const line = stops.map(item => [
                  item.stop.latitude,
                  item.stop.longitude
                ]);

                return (
                  <span key={`route-${vehicle.id}`}>
                    {line.length > 1 && <Polyline positions={line} />}
                    {stops.map(item => (
                      <CircleMarker
                        key={item.id}
                        center={[item.stop.latitude, item.stop.longitude]}
                        radius={5}
                      >
                        <Popup>
                          {item.sequence}. {item.stop.name}<br />
                          Planned: {item.plannedEta || '—'}
                        </Popup>
                      </CircleMarker>
                    ))}
                  </span>
                );
              })}

              {located.map(vehicle => (
                <Marker
                  key={vehicle.id}
                  position={[vehicle.latitude, vehicle.longitude]}
                  icon={busIcon}
                >
                  <Popup>
                    <b>Bus {vehicle.busNumber || '—'}</b><br />
                    {vehicle.routes?.[0]?.name || 'No route'}<br />
                    Next: {vehicle.tracking?.nextStop?.name || '—'}<br />
                    ETA: {vehicle.tracking?.etaMinutes ? `${vehicle.tracking.etaMinutes} min` : '—'}<br />
                    {vehicle.tracking?.stale ? 'GPS stale' : vehicle.tracking?.offRoute ? '⚠ Route caution' : '✓ On route'}<br />
                    {vehicle.tracking?.overspeed ? `⚠ Overspeed (${Math.round(vehicle.speedKmph || 0)} km/h)` : ''}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </section>
        </div>
      )}
    </>
  );
}
