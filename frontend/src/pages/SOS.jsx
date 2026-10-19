import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { io } from 'socket.io-client';

export default function SOS() {
  const { user } = useAuth();

  const [incidents, setIncidents] = useState([]);
  const [pendingAccidents, setPendingAccidents] = useState([]);
  const [flash, setFlash] = useState(false);
  const [message, setMessage] = useState('');
  const [processingId, setProcessingId] = useState(null);

  const loadIncidents = async () => {
    try {
      const response = await api.get('/incidents');
      setIncidents(response.data);
    } catch (error) {
      console.error('Unable to load incidents:', error);
    }
  };

  const loadPendingAccidents = async () => {
    if (!['ADMIN', 'DRIVER'].includes(user.role)) {
      return;
    }

    try {
      const response = await api.get('/incidents/pending-verification');
      setPendingAccidents(response.data);
    } catch (error) {
      console.error('Unable to load pending accident verifications:', error);
    }
  };

  const refresh = async () => {
    await Promise.all([
      loadIncidents(),
      loadPendingAccidents()
    ]);
  };

  useEffect(() => {
    refresh();

    const socket = io(
      import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000'
    );

    const showFlash = () => {
      setFlash(true);

      setTimeout(() => {
        setFlash(false);
      }, 5000);
    };

    socket.on('sos:alert', () => {
      showFlash();
      refresh();
    });

    socket.on('accident:possible', () => {
      showFlash();
      refresh();
    });

    socket.on('accident:confirmed', () => {
      showFlash();
      refresh();
    });

    socket.on('accident:false-alarm', () => {
      refresh();
    });

    socket.on('incident:update', () => {
      refresh();
    });

    return () => {
      socket.disconnect();
    };
  }, [user.role]);

  async function triggerSOS() {
    try {
      setMessage('');

      await api.post('/incidents/sos', {
        type: 'SOS',
        message: 'Driver triggered SOS from in-cab console'
      });

      setFlash(true);
      setMessage('Emergency SOS has been created successfully.');

      await refresh();
    } catch (error) {
      console.error('SOS error:', error);

      setMessage(
        error.response?.data?.message ||
          'Unable to create emergency SOS.'
      );
    }
  }

  async function resolveIncident(id) {
    try {
      setProcessingId(id);
      setMessage('');

      await api.patch(`/incidents/${id}/status`, {
        status: 'RESOLVED'
      });

      setMessage('Incident resolved successfully.');

      await refresh();
    } catch (error) {
      console.error('Resolve incident error:', error);

      setMessage(
        error.response?.data?.message ||
          'Unable to resolve incident.'
      );
    } finally {
      setProcessingId(null);
    }
  }

  async function driverResponse(id, response) {
    try {
      setProcessingId(id);
      setMessage('');

      const result = await api.patch(
        `/incidents/${id}/driver-response`,
        {
          response
        }
      );

      setMessage(result.data.message);

      await refresh();
    } catch (error) {
      console.error('Driver accident response error:', error);

      setMessage(
        error.response?.data?.message ||
          'Unable to submit accident response.'
      );
    } finally {
      setProcessingId(null);
    }
  }

  async function adminVerification(id, action) {
    try {
      setProcessingId(id);
      setMessage('');

      const result = await api.patch(
        `/incidents/${id}/verify`,
        {
          action
        }
      );

      setMessage(result.data.message);

      await refresh();
    } catch (error) {
      console.error('Admin verification error:', error);

      setMessage(
        error.response?.data?.message ||
          'Unable to verify accident.'
      );
    } finally {
      setProcessingId(null);
    }
  }

  function confidencePercent(value) {
    if (value === null || value === undefined) {
      return 'N/A';
    }

    return `${Math.round(Number(value) * 100)}%`;
  }

  function formatDate(value) {
    if (!value) {
      return 'N/A';
    }

    return new Date(value).toLocaleString();
  }

  function busName(incident) {
    return (
      incident.vehicle?.busNumber ||
      incident.vehicle?.registrationNo ||
      'Unknown bus'
    );
  }

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">SAFETY & RESPONSE</span>

          <h2>SOS & Accident Center</h2>

          <p>
            Monitor emergency incidents. High-confidence accidents can trigger
            autonomous emergency escalation, while lower-confidence events remain
            available for Driver/Admin verification.
          </p>
        </div>
      </div>

      {flash && (
        <div className="alert-banner">
          Emergency alert received. Check the incident details
          immediately.
        </div>
      )}

      {message && (
        <div className="alert-banner">
          {message}
        </div>
      )}

      {user.role === 'DRIVER' && (
        <section className="sos-card">
          <div>
            <span className="eyebrow">DRIVER CONSOLE</span>

            <h3>Emergency SOS</h3>

            <p>
              Use SOS for a crash, breakdown, fire, medical emergency,
              or another immediate transport emergency.
            </p>
          </div>

          <button
            className="sos-button"
            onClick={triggerSOS}
          >
            SOS
          </button>
        </section>
      )}

      {user.role === 'ADMIN' &&
        incidents
          .filter(incident =>
            incident.type === 'CRASH' &&
            incident.verificationStatus === 'CONFIRMED'
          )
          .map(incident => {
            const response = incident.detectionSignals?.autonomousEmergencyResponse;
            const packet = response?.distressPacket;
            const police = packet?.selectedEmergencyResources?.police;
            const hospital = packet?.selectedEmergencyResources?.hospitals?.[0];
            const affectedStudents = Array.isArray(packet?.passengers?.students)
              ? packet.passengers.students.filter(Boolean) : [];
            const mapUrl = packet?.location?.mapUrl || (
              incident.latitude != null && incident.longitude != null
                ? `https://maps.google.com/?q=${incident.latitude},${incident.longitude}` : null
            );
            const fallbackEmergencyPhone =
              packet?.emergencyContacts?.fallbackEmergencyPhone || '112';

            return (
              <section className="panel" key={`emergency-${incident.id}`}>
                <div className="panel-head">
                  <div>
                    <span className="eyebrow">EMERGENCY INFORMATION CARD</span>
                    <h3>Confirmed accident · {busName(incident)}</h3>
                    <p>Single-screen response information for the transport administrator.</p>
                  </div>
                  <span className="chip danger">PRIORITY P{incident.priority}</span>
                </div>

                <div className="table-wrap">
                  <table>
                    <tbody>
                      <tr>
                        <th>Bus</th>
                        <td>{packet?.bus?.busNumber || incident.vehicle?.busNumber || 'N/A'} · {packet?.bus?.registrationNo || incident.vehicle?.registrationNo || 'N/A'}</td>
                        <th>Route</th>
                        <td>{packet?.route?.code || packet?.route?.name || 'N/A'}</td>
                      </tr>
                      <tr>
                        <th>Driver</th>
                        <td>{packet?.driver?.name || incident.driver?.name || 'N/A'}{(packet?.driver?.phone || incident.driver?.phone) ? ` · ${packet?.driver?.phone || incident.driver?.phone}` : ''}</td>
                        <th>Detected</th>
                        <td>{formatDate(incident.createdAt)}</td>
                      </tr>
                      <tr>
                        <th>Current / final speed</th>
                        <td>{incident.speedAfter ?? 'N/A'} km/h</td>
                        <th>Students onboard</th>
                        <td>{packet?.passengers?.onboardStudents ?? 'N/A'}</td>
                      </tr>
                      <tr>
                        <th>GPS</th>
                        <td>{incident.latitude ?? 'N/A'}, {incident.longitude ?? 'N/A'}</td>
                        <th>Dispatch</th>
                        <td>{response?.dispatch?.mode === 'DEMO' ? 'DEMO / SIMULATED ? ' : ''}{incident.emergencyDispatchStatus}{!response?.dispatch ? ' ? dispatch not completed' : ''}</td>
                      </tr>
                      <tr>
                        <th>Police target</th>
                        <td>{police?.name || 'Not selected'}{police?.phone ? ` · ${police.phone}` : ''}</td>
                        <th>Hospital target</th>
                        <td>{hospital?.name || 'Not selected'}{hospital?.phone ? ` · ${hospital.phone}` : ''}</td>
                      </tr>
                      <tr>
                        <th>Campus security</th>
                        <td>{packet?.campusContacts?.securityPhone || 'Not configured'}</td>
                        <th>Transport emergency</th>
                        <td>{packet?.campusContacts?.transportEmergencyPhone || 'Not configured'}</td>
                      </tr>
                      <tr>
                        <th>Fallback emergency</th>
                        <td>{fallbackEmergencyPhone}</td>
                        <th>Affected students</th>
                        <td>{packet?.passengers?.affectedStudents ?? affectedStudents.length}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {affectedStudents.length > 0 && (
                  <div style={{ marginTop: 16 }}>
                    <div className="panel-head" style={{ marginBottom: 10 }}>
                      <div>
                        <span className="eyebrow">STUDENT & PARENT CONTACTS</span>
                        <h3 style={{ marginTop: 4 }}>Affected passenger contact list</h3>
                      </div>
                    </div>

                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Student</th>
                            <th>Status</th>
                            <th>Pickup stop</th>
                            <th>Parent / guardian</th>
                            <th>Parent phone</th>
                          </tr>
                        </thead>
                        <tbody>
                          {affectedStudents.map(student => (
                            <tr key={student.id}>
                              <td>
                                <strong>{student.name || 'Unknown student'}</strong>
                                {student.institutionId ? (
                                  <div className="muted">{student.institutionId}</div>
                                ) : null}
                              </td>
                              <td>{student.status === 'ONBOARD' ? 'Onboard' : 'Assigned to route'}</td>
                              <td>{student.pickupStop?.name || 'Not available'}</td>
                              <td>{student.parent?.name || 'Not available'}</td>
                              <td>
                                {student.parent?.phone ? (
                                  <a href={`tel:${student.parent.phone}`}>{student.parent.phone}</a>
                                ) : (
                                  'Not available'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {mapUrl && (
                  <div style={{ marginTop: 12 }}>
                    <a className="secondary" href={mapUrl} target="_blank" rel="noreferrer">
                      VIEW LIVE / LAST KNOWN LOCATION
                    </a>
                  </div>
                )}
              </section>
            );
          })}

      {pendingAccidents.length > 0 && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Possible Accident Verification</h3>

              <p>
               GPS/sensor data indicates a possible sudden stop. Lower-confidence events
remain here for manual verification; high-confidence events can escalate automatically.
              </p>
            </div>
          </div>

          {pendingAccidents.map((incident) => (
            <div
              key={incident.id}
              style={{
                border: '1px solid #f1d497',
                borderRadius: '14px',
                padding: '18px',
                marginBottom: '14px'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '20px',
                  flexWrap: 'wrap'
                }}
              >
                <div>
                  <span className="eyebrow">
                    POSSIBLE ACCIDENT
                  </span>

                  <h3>
                    {busName(incident)}
                  </h3>

                  <p>
                    {incident.message}
                  </p>
                </div>

                <div>
                  <span className="chip danger">
                    Confidence:{' '}
                    {confidencePercent(
                      incident.aiConfidence
                    )}
                  </span>
                </div>
              </div>

              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <th>Driver</th>
                      <td>
                        {incident.driver?.name || 'N/A'}
                      </td>

                      <th>Detected</th>
                      <td>
                        {formatDate(incident.createdAt)}
                      </td>
                    </tr>

                    <tr>
                      <th>Speed Before</th>
                      <td>
                        {incident.speedBefore ?? 'N/A'} km/h
                      </td>

                      <th>Speed After</th>
                      <td>
                        {incident.speedAfter ?? 'N/A'} km/h
                      </td>
                    </tr>

                    <tr>
  <th>Speed Drop</th>
  <td>
    {incident.speedBefore != null &&
    incident.speedAfter != null
      ? `${Math.max(
          0,
          Number(incident.speedBefore) -
            Number(incident.speedAfter)
        )} km/h`
      : 'N/A'}
  </td>

  <th>Detection Source</th>
  <td>
    {incident.detectionSignals?.source === 'PHONE_GPS'
      ? 'Phone GPS'
      : 'GPS'}
  </td>
</tr>

<tr>
  <th>Sudden Stop</th>
  <td>
    {incident.suddenStopDetected
      ? 'Detected'
      : 'Not detected'}
  </td>

  <th>Verification</th>
  <td>
    {incident.verificationStatus}
  </td>
</tr>

                    <tr>
                      <th>Location</th>

                      <td colSpan="3">
                        {incident.latitude !== null &&
                        incident.latitude !== undefined &&
                        incident.longitude !== null &&
                        incident.longitude !== undefined ? (
                          <a
                            href={`https://maps.google.com/?q=${incident.latitude},${incident.longitude}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View detected location
                          </a>
                        ) : (
                          'Location unavailable'
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {user.role === 'DRIVER' && (
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    marginTop: '16px',
                    flexWrap: 'wrap'
                  }}
                >
                  <button
                    className="secondary"
                    disabled={processingId === incident.id}
                    onClick={() =>
                      driverResponse(
                        incident.id,
                        'SAFE'
                      )
                    }
                  >
                    I'M SAFE - FALSE ALARM
                  </button>

                  <button
                    className="primary"
                    disabled={processingId === incident.id}
                    onClick={() =>
                      driverResponse(
                        incident.id,
                        'EMERGENCY'
                      )
                    }
                  >
                    CONFIRM EMERGENCY
                  </button>
                </div>
              )}

              {user.role === 'ADMIN' && (
                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    marginTop: '16px',
                    flexWrap: 'wrap'
                  }}
                >
                  <button
                    className="secondary"
                    disabled={processingId === incident.id}
                    onClick={() =>
                      adminVerification(
                        incident.id,
                        'FALSE_ALARM'
                      )
                    }
                  >
                    MARK FALSE ALARM
                  </button>

                  <button
                    className="primary"
                    disabled={processingId === incident.id}
                    onClick={() =>
                      adminVerification(
                        incident.id,
                        'CONFIRM'
                      )
                    }
                  >
                    CONFIRM ACCIDENT
                  </button>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>Open Incidents</h3>

            <p>
              Current operational and emergency incident queue.
            </p>
          </div>
        </div>

        {incidents.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Vehicle</th>
                  <th>Driver</th>
                  <th>Status</th>
                  <th>Verification</th>
                  <th>Dispatch</th>
                  <th>Action</th>
                </tr>
              </thead>

              <tbody>
                {incidents.map((incident) => (
                  <tr key={incident.id}>
                    <td>
                      <b>P{incident.priority}</b>
                    </td>

                    <td>
                      {incident.type}
                    </td>

                    <td>
                      {incident.message}
                    </td>

                    <td>
                      {busName(incident)}
                    </td>

                    <td>
                      {incident.driver?.name || 'N/A'}
                    </td>

                    <td>
                      <span className="chip danger">
                        {incident.status}
                      </span>
                    </td>

                    <td>
                      {incident.type === 'CRASH'
                        ? incident.verificationStatus
                        : 'N/A'}
                    </td>

                    <td>
                      {incident.type === 'CRASH'
                        ? incident.emergencyDispatchStatus
                        : 'N/A'}
                    </td>

                    <td>
                      {user.role === 'ADMIN' &&
                        incident.verificationStatus !==
                          'PENDING' && (
                          <button
                            className="secondary small"
                            disabled={
                              processingId === incident.id
                            }
                            onClick={() =>
                              resolveIncident(
                                incident.id
                              )
                            }
                          >
                            Resolve
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            No open incidents.
          </div>
        )}
      </section>
    </>
  );
}