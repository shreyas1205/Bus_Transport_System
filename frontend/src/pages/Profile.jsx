import { useEffect, useState } from 'react';
import { api } from '../api';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export default function Profile() {
  const [user, setUser] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadProfile() {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/auth/me');
      setUser(response.data);
      setName(response.data?.name || '');
      setPhone(response.data?.phone || '');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  async function save(event) {
    event.preventDefault();
    try {
      setSaving(true);
      setMsg('');
      setError('');
      const response = await api.patch('/auth/profile', { name, phone });
      setUser(response.data);
      setName(response.data?.name || name);
      setPhone(response.data?.phone || '');
      setMsg('Profile updated successfully.');
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not update your profile.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading-card">Loading profile…</div>;

  if (!user) {
    return (
      <section className="panel">
        <div className="error">{error || 'Profile unavailable.'}</div>
        <button className="secondary" onClick={loadProfile}>Retry</button>
      </section>
    );
  }

  const isDriver = user.role === 'DRIVER';
  const driverRoutes = Array.isArray(user.driverRoutes) ? user.driverRoutes : [];

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">ACCOUNT</span>
          <h2>Profile</h2>
          <p>Identity, assignment and contact information.</p>
        </div>
      </div>

      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <section className="panel profile-card">
        <div className="profile-avatar">{user.name?.[0] || '?'}</div>

        <div className="profile-fields">
          <div>
            <small>Role</small>
            <b>{user.role || '—'}</b>
          </div>

          <div>
            <small>Institution ID</small>
            <b>{user.institutionId || '—'}</b>
          </div>

          <form className="edit-profile" onSubmit={save}>
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label>
              Phone
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter contact number" />
            </label>

            <label>
              Email
              <input value={user.email || ''} disabled />
            </label>

            <button className="primary" type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </form>

          {isDriver ? (
            <>
              <div>
                <small>License number</small>
                <b>{user.driverProfile?.licenseNumber || '—'}</b>
              </div>

              <div>
                <small>License expiry</small>
                <b>{formatDate(user.driverProfile?.licenseExpiry)}</b>
              </div>

              <div style={{ gridColumn: '1 / -1' }}>
                <small>Assigned routes</small>
                {driverRoutes.length === 0 ? (
                  <b>—</b>
                ) : (
                  <div className="route-row" style={{ marginTop: 8 }}>
                    <div>
                      {driverRoutes.map((route) => (
                        <div key={route.id} style={{ padding: '8px 0' }}>
                          <b>{route.code} — {route.name}</b>
                          <small>
                            Bus {route.assignedBus?.busNumber || route.assignedBus?.registrationNo || '—'}
                          </small>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <small>Assigned route</small>
                <b>{user.assignedRoute?.name || '—'}</b>
              </div>

              <div>
                <small>Pickup stop</small>
                <b>{user.pickupStop?.name || '—'}</b>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
