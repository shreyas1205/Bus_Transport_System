import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const busIcon = L.divIcon({ className: 'bus-marker', html: '🚌', iconSize: [34, 34], iconAnchor: [17, 17] });

function FitBounds({ vehicles }) {
  const map = useMap();
  useEffect(() => {
    const points = vehicles.filter(v => Number.isFinite(v.latitude) && Number.isFinite(v.longitude)).map(v => [v.latitude, v.longitude]);
    if (points.length === 1) map.setView(points[0], 15);
    if (points.length > 1) map.fitBounds(points, { padding: [30, 30] });
  }, [vehicles, map]);
  return null;
}

export default function LiveLocation() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const response = await api.get('/live-location');
      setVehicles(response.data.vehicles || []);
      setNotice(response.data.message || '');
    } catch (e) {
      setNotice(e.response?.data?.message || 'Could not load live bus location.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000');
    const onLocation = (update) => {
      setVehicles(current => current.map(v => v.id === update.vehicleId ? {
        ...v,
        latitude: update.latitude,
        longitude: update.longitude,
        speedKmph: update.speedKmph,
        updatedAt: new Date().toISOString(),
        lastLocationAt: new Date().toISOString(),
      } : v));
    };
    socket.on('vehicle:location', onLocation);
    return () => {
      socket.off('vehicle:location', onLocation);
      socket.disconnect();
    };
  }, []);

  const locatedVehicles = useMemo(() => vehicles.filter(v => Number.isFinite(v.latitude) && Number.isFinite(v.longitude)), [vehicles]);
  const center = locatedVehicles.length ? [locatedVehicles[0].latitude, locatedVehicles[0].longitude] : [12.9716, 77.5946];
  const title = user?.role === 'ADMIN' ? 'Live bus fleet' : user?.role === 'PARENT' ? 'Your child’s bus' : 'Your bus';

  return <>
    <div className="page-title">
      <div><span className="eyebrow">REAL-TIME TRACKING</span><h2>{title}</h2><p>See the latest available bus position, speed and assigned route.</p></div>
      <div className="button-row"><button className="secondary" onClick={load}>Refresh</button></div>
    </div>
    {notice && <div className="success">{notice}</div>}
    {loading ? <div className="loading-card">Loading live location…</div> : !vehicles.length ? <div className="panel empty">No live bus is currently assigned to this account.</div> : <div className="grid-2">
      <section className="panel">
        <div className="panel-head"><div><h3>Tracked bus</h3><p>Location updates arrive automatically while the driver shares GPS.</p></div></div>
        {vehicles.map(v => <div className="route-row" key={v.id}>
          <div><b>Bus {v.busNumber || '—'} · {v.registrationNo}</b><small>{v.routes?.[0]?.name || 'No active route'} · {v.routes?.[0]?.assignedDriver?.name || 'No driver'}{v.routes?.[0]?.assignedDriver?.phone ? ` · ${v.routes[0].assignedDriver.phone}` : ''}</small></div>
          <span>{v.speedKmph != null ? `${Number(v.speedKmph).toFixed(0)} km/h` : '—'}</span>
        </div>)}
        <div className="location-meta">{locatedVehicles.map(v => <div key={v.id}><b>Last update</b><span>{v.lastLocationAt ? new Date(v.lastLocationAt).toLocaleTimeString() : 'No GPS update yet'}</span></div>)}</div>
      </section>
      <section className="map-panel live-map-panel">
        <MapContainer center={center} zoom={14} scrollWheelZoom>
          <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <FitBounds vehicles={locatedVehicles} />
          {locatedVehicles.map(v => <Marker key={v.id} position={[v.latitude, v.longitude]} icon={busIcon}>
            <Popup><b>🚌 Bus {v.busNumber || '—'}</b><br />{v.registrationNo}<br />Speed: {v.speedKmph != null ? `${Number(v.speedKmph).toFixed(0)} km/h` : '—'}<br />{v.routes?.[0]?.name || 'No active route'}<br />{v.lastLocationAt ? `Updated: ${new Date(v.lastLocationAt).toLocaleTimeString()}` : 'Waiting for GPS'}</Popup>
          </Marker>)}
        </MapContainer>
      </section>
    </div>}
  </>;
}
