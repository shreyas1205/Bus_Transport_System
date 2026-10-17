import { useEffect, useState } from 'react';
import { api } from '../api';

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toISOString().split('T')[0];
}

function formatDisplayDate(value) {
  if (!value) return '—';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleDateString('en-IN');
}

function formatDisplayDateTime(value) {
  if (!value) return '';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('en-IN');
}

function getVerificationStyle(status) {
  if (status === 'VERIFIED') {
    return {
      background: '#dcfce7',
      color: '#166534'
    };
  }

  if (status === 'REJECTED') {
    return {
      background: '#fee2e2',
      color: '#991b1b'
    };
  }

  return {
    background: '#fef3c7',
    color: '#92400e'
  };
}

export default function Profile() {
  const [user, setUser] = useState(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiry, setLicenseExpiry] = useState('');
  const [licensePhoto, setLicensePhoto] = useState(null);

  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // ==========================
  // LOAD PROFILE
  // ==========================

  async function loadProfile() {
    try {
      setLoading(true);
      setError('');

      const response = await api.get('/auth/me');

      const data = response.data;

      setUser(data);

      setName(data?.name || '');
      setPhone(data?.phone || '');

      setLicenseNumber(
        data?.driverProfile?.licenseNumber || ''
      );

      setLicenseExpiry(
        formatDate(
          data?.driverProfile?.licenseExpiry
        )
      );

      setLicensePhoto(
        data?.driverProfile?.licensePhoto || null
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Could not load your profile.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProfile();
  }, []);

  // ==========================
  // LICENSE PHOTO
  // ==========================

  function handleLicensePhoto(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setError(
        'Please select an image file.'
      );

      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      setError(
        'License photo must be smaller than 4 MB.'
      );

      event.target.value = '';

      return;
    }

    setError('');

    const reader = new FileReader();

    reader.onload = () => {
      setLicensePhoto(reader.result);
    };

    reader.readAsDataURL(file);
  }

  // ==========================
  // SAVE PROFILE
  // ==========================

  async function save(event) {
    event.preventDefault();

    try {
      setSaving(true);

      setMsg('');
      setError('');

      const payload = {
        name,
        phone
      };

      if (user.role === 'DRIVER') {
        payload.licenseNumber =
          licenseNumber;

        payload.licenseExpiry =
          licenseExpiry;

        payload.licensePhoto =
          licensePhoto;
      }

      const response = await api.patch(
        '/auth/profile',
        payload
      );

      const data = response.data;

      setUser(data);

      setName(data?.name || '');
      setPhone(data?.phone || '');

      if (data?.driverProfile) {
        setLicenseNumber(
          data.driverProfile.licenseNumber || ''
        );

        setLicenseExpiry(
          formatDate(
            data.driverProfile.licenseExpiry
          )
        );

        setLicensePhoto(
          data.driverProfile.licensePhoto ||
            null
        );
      }

      setMsg(
        'Profile updated successfully.'
      );
    } catch (err) {
      setError(
        err?.response?.data?.message ||
          'Could not update your profile.'
      );
    } finally {
      setSaving(false);
    }
  }

  // ==========================
  // LOADING
  // ==========================

  if (loading) {
    return (
      <div className="loading-card">
        Loading profile…
      </div>
    );
  }

  // ==========================
  // PROFILE ERROR
  // ==========================

  if (!user) {
    return (
      <section className="panel">

        <div className="error">
          {error || 'Profile unavailable.'}
        </div>

        <button
          className="secondary"
          onClick={loadProfile}
        >
          Retry
        </button>

      </section>
    );
  }

  const isDriver =
    user.role === 'DRIVER';

  const showTransportAssignment =
    ['STUDENT', 'DRIVER', 'STAFF'].includes(user.role);

  const driverRoutes =
    Array.isArray(user.driverRoutes)
      ? user.driverRoutes
      : [];

  const driverProfile =
    user.driverProfile || {};

  const licenseStatus =
    driverProfile.licenseStatus ||
    'PENDING';

  // ==========================
  // UI
  // ==========================

  return (
    <>
      <div className="page-title"><div><span className="eyebrow">ACCOUNT</span><h2>Profile</h2><p>Manage your identity, contact details and transport assignment.</p></div></div>
      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <section className="profile-hero panel">
        <div className="profile-identity">
          <div className="profile-avatar-large">{user.name?.[0]?.toUpperCase() || '?'}</div>
          <div className="profile-identity-copy">
            <span className="section-kicker">CAMPUSBUS ACCOUNT</span>
            <h3>{user.name || 'CampusBus user'}</h3>
            <p>{user.email}</p>
            <div className="profile-badges">
              <span className="status-pill info">{user.role}</span>
              <span className="profile-id">ID · {user.institutionId || 'Not assigned'}</span>
            </div>
          </div>
        </div>
        <div className="profile-account-summary">
          <div><small>ACCOUNT TYPE</small><b>{user.role}</b></div>
          <div><small>INSTITUTION ID</small><b>{user.institutionId || 'Not assigned'}</b></div>
          {showTransportAssignment && <div><small>ASSIGNED ROUTE</small><b>{user.assignedRoute?.code || driverRoutes[0]?.code || 'Not assigned'}</b></div>}
          {showTransportAssignment && <div><small>PICKUP STOP</small><b>{user.pickupStop?.name || 'Not assigned'}</b></div>}
        </div>
      </section>

      <section className="panel premium-section">
        <div className="panel-head"><div><span className="section-kicker">PERSONAL INFORMATION</span><h3>Contact details</h3><p>Keep these details current for transport notifications and emergencies.</p></div></div>
        <form className="premium-profile-form" onSubmit={save}>
          <label><span>Full name</span><input value={name} onChange={e=>setName(e.target.value)} required /></label>
          <label><span>Phone number</span><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Enter contact number" /></label>
          <label><span>Email address</span><input value={user.email || ''} disabled /></label>
          <label><span>Institution ID</span><input value={user.institutionId || 'Not assigned'} disabled /></label>
          {isDriver && <>
            <label><span>Licence number</span><input value={licenseNumber} onChange={e=>setLicenseNumber(e.target.value)} placeholder="KA-DL-99881" required /></label>
            <label><span>Licence expiry</span><input type="date" value={licenseExpiry} onChange={e=>setLicenseExpiry(e.target.value)} /></label>
            <label className="profile-file-field"><span>Licence photo</span><input type="file" accept="image/*" onChange={handleLicensePhoto}/></label>
          </>}
          <div className="profile-save-row"><button className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div>
        </form>
      </section>

      {isDriver && <section className="panel premium-section driver-document-panel">
        <div className="panel-head"><div><span className="section-kicker">DRIVER DOCUMENT</span><h3>Licence verification</h3><p>Admin verification is required before the document is treated as valid.</p></div><span className={`status-pill ${licenseStatus==='VERIFIED'?'success':licenseStatus==='REJECTED'?'danger':'warning'}`}>{licenseStatus}</span></div>
        <div className="driver-document-grid"><div className="document-facts"><div><small>LICENCE NUMBER</small><b>{driverProfile.licenseNumber || 'Not provided'}</b></div><div><small>EXPIRY DATE</small><b>{formatDisplayDate(driverProfile.licenseExpiry)}</b></div>{driverProfile.licenseReviewedAt&&<div><small>LAST REVIEWED</small><b>{formatDisplayDateTime(driverProfile.licenseReviewedAt)}</b></div>}</div>{licensePhoto?<div className="license-preview"><img src={licensePhoto} alt="Driver licence"/></div>:<div className="premium-empty"><b>No licence image</b><span>Upload an image using the form above.</span></div>}</div>
      </section>}
    </>
  );
}
