import {
  useEffect,
  useState
} from 'react';

import { api } from '../api';
import { useAuth } from '../auth';
import { io } from 'socket.io-client';

function formatTime(value) {
  if (!value) {
    return '—';
  }

  return new Date(
    value
  ).toLocaleTimeString(
    'en-IN',
    {
      hour:
        '2-digit',
      minute:
        '2-digit',
      second:
        '2-digit'
    }
  );
}

function statusDetails(status) {
  if (
    status ===
    'DROPPED_OFF'
  ) {
    return {
      title:
        'Safely dropped off',
      text:
        'The journey has been completed and drop-off has been recorded.',
      icon:
        '✓'
    };
  }

  if (
    status ===
    'BOARDED'
  ) {
    return {
      title:
        'Currently boarded',
      text:
        'The student has boarded the assigned bus.',
      icon:
        '🚌'
    };
  }

  return {
    title:
      'Not boarded yet',
    text:
      'No boarding has been recorded today.',
    icon:
      '○'
  };
}

export default function BoardingStatus() {
  const { user } =
    useAuth();

  const [
    data,
    setData
  ] = useState(null);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    error,
    setError
  ] = useState('');

  async function load() {
    try {
      setError('');

      const response =
        await api.get(
          '/boarding/my-status'
        );

      setData(
        response.data
      );
    } catch (err) {
      setError(
        err.response?.data
          ?.message ||
          'Could not load boarding status.'
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  useEffect(() => {
    load();

    const socket = io(
      import.meta.env
        .VITE_SOCKET_URL ||
        'http://localhost:4000'
    );

    socket.on(
      'boarding:update',
      load
    );

    return () => {
      socket.off(
        'boarding:update',
        load
      );

      socket.disconnect();
    };
  }, []);

  if (loading) {
    return (
      <div className="loading-card">
        Loading journey status…
      </div>
    );
  }

  const details =
    statusDetails(
      data?.status
    );

  const isBoarded = data?.status === 'BOARDED' || data?.status === 'DROPPED_OFF';
  const isDropped = data?.status === 'DROPPED_OFF';

  return (
    <>
      <div className="page-title boarding-page-title">
        <div>
          <span className="eyebrow">BUS JOURNEY</span>
          <h2>{user?.role === 'PARENT' ? "Your child's journey" : 'My journey'}</h2>
          <p>
            {user?.role === 'PARENT'
              ? "Live boarding and drop-off status for your linked student."
              : 'Track your boarding and drop-off status in real time.'}
          </p>
        </div>
        <button className="secondary journey-refresh" onClick={load}>
          <span>↻</span> Refresh status
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {!data?.student ? (
        <section className="panel journey-empty">
          {user?.role === 'PARENT'
            ? 'No student is linked to this parent account.'
            : 'Student information is unavailable.'}
        </section>
      ) : (
        <div className="journey-dashboard">
          <section className={`panel journey-hero journey-${String(data.status || 'NOT_BOARDED').toLowerCase()}`}>
            <div className="journey-hero-main">
              <div className="journey-avatar">
                {data.student.name?.charAt(0)?.toUpperCase() || 'S'}
              </div>
              <div>
                <span className="eyebrow">TODAY · LIVE STATUS</span>
                <h2>{data.student.name}</h2>
                <p>
                  {data.student.institutionId || 'Student'} · Pickup: {data.pickupStop || '—'}
                </p>
              </div>
            </div>

            <div className="journey-status-block">
              <span className={`journey-status-pill status-${String(data.status || 'NOT_BOARDED').toLowerCase()}`}>
                {details.icon} {String(data.status || 'NOT_BOARDED').replaceAll('_', ' ')}
              </span>
              <strong>{details.title}</strong>
              <small>{details.text}</small>
            </div>
          </section>

          <section className="panel journey-progress-card">
            <div className="journey-section-head">
              <div>
                <span className="eyebrow">JOURNEY PROGRESS</span>
                <h3>Pickup → Boarding → Drop-off</h3>
              </div>
              <span className="journey-live-dot">● LIVE</span>
            </div>

            <div className="journey-progress">
              <div className="journey-step complete">
                <div className="journey-step-dot">✓</div>
                <div>
                  <small>PICKUP POINT</small>
                  <b>{data.pickupStop || 'Assigned pickup'}</b>
                  <span>Ready for today's trip</span>
                </div>
              </div>
              <div className={`journey-line ${isBoarded ? 'complete' : ''}`} />
              <div className={`journey-step ${isBoarded ? 'complete' : 'pending'}`}>
                <div className="journey-step-dot">{isBoarded ? '✓' : '2'}</div>
                <div>
                  <small>BOARDED</small>
                  <b>{isBoarded ? formatTime(data.boardedAt) : 'Waiting for QR scan'}</b>
                  <span>{isBoarded ? 'Boarding confirmed' : 'Driver will scan the daily QR'}</span>
                </div>
              </div>
              <div className={`journey-line ${isDropped ? 'complete' : ''}`} />
              <div className={`journey-step ${isDropped ? 'complete' : 'pending'}`}>
                <div className="journey-step-dot">{isDropped ? '✓' : '3'}</div>
                <div>
                  <small>DROPPED OFF</small>
                  <b>{isDropped ? formatTime(data.droppedOffAt) : isBoarded ? 'Journey in progress' : 'Pending'}</b>
                  <span>{isDropped ? 'Drop-off confirmed' : 'Updates automatically'}</span>
                </div>
              </div>
            </div>
          </section>

          <div className="journey-info-grid">
            <section className="panel journey-info-card">
              <div className="journey-card-icon">◉</div>
              <div className="journey-info-content">
                <span className="eyebrow">STUDENT & PICKUP</span>
                <h3>{data.student.name}</h3>
                <div className="journey-facts">
                  <div><small>Institution ID</small><b>{data.student.institutionId || '—'}</b></div>
                  <div><small>Pickup point</small><b>{data.pickupStop || '—'}</b></div>
                </div>
              </div>
            </section>

            <section className="panel journey-info-card">
              <div className="journey-card-icon">↝</div>
              <div className="journey-info-content">
                <span className="eyebrow">ROUTE & BUS</span>
                <h3>{data.route ? `${data.route.code} · ${data.route.name}` : 'No route assigned'}</h3>
                <div className="journey-facts">
                  <div><small>Bus</small><b>{data.route?.busNumber || data.route?.registrationNo || '—'}</b></div>
                  <div><small>Driver</small><b>{data.route?.driver?.name || '—'}</b></div>
                  <div><small>Driver phone</small><b>{data.route?.driver?.phone || '—'}</b></div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
