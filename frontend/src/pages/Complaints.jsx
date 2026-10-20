import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { io } from 'socket.io-client';
import './Complaints.css';

const categories = [
  ['BUS_DELAY', 'Bus delay'],
  ['PICKUP_POINT', 'Pickup point'],
  ['DRIVER', 'Driver / conduct'],
  ['BUS_CONDITION', 'Bus condition'],
  ['FEE_PAYMENT', 'Fee / payment'],
  ['SAFETY', 'Safety'],
  ['OTHER', 'Other'],
];

const statusLabels = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

function formatDate(value) {
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function StatusChip({ status }) {
  return <span className={`chip complaint-status complaint-status-${status}`}>{statusLabels[status] || status}</span>;
}

export default function Complaints() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [complaints, setComplaints] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [form, setForm] = useState({ subject: '', category: 'BUS_DELAY', description: '' });
  const [savingId, setSavingId] = useState('');

  const load = async () => {
    try {
      setLoadError('');
      const response = await api.get('/complaints');
      setComplaints(response.data || []);
    } catch (e) {
      setLoadError(e.response?.data?.message || 'Could not load complaints.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000');
    const refresh = () => load();
    socket.on('complaint:new', refresh);
    socket.on('complaint:update', refresh);
    return () => {
      socket.off('complaint:new', refresh);
      socket.off('complaint:update', refresh);
      socket.disconnect();
    };
  }, [user?.id]);

  const filtered = useMemo(
    () => complaints.filter(c => {
      const query = search.trim().toLowerCase();
      const category = categories.find(([value]) => value === c.category)?.[1] || c.category;
      return (filter === 'ALL' || c.status === filter) &&
        (!isAdmin || [c.user?.name, c.user?.email, c.user?.institutionId, c.subject, c.description, category, c.category].some(value => String(value || '').toLowerCase().includes(query)));
    }),
    [complaints, filter, search, isAdmin],
  );

  const complaintStats = useMemo(() => ({
    total: complaints.length,
    open: complaints.filter(c => c.status === 'OPEN').length,
    progress: complaints.filter(c => c.status === 'IN_PROGRESS').length,
    resolved: complaints.filter(c => c.status === 'RESOLVED').length,
  }), [complaints]);

  async function submitComplaint(e) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setNotice('');
    if (!form.subject.trim() || !form.description.trim()) {
      setError('Please enter a subject and description.');
      setSubmitting(false);
      return;
    }
    try {
      setError('');
      await api.post('/complaints', form);
      setForm({ subject: '', category: 'BUS_DELAY', description: '' });
      setNotice('Complaint submitted to transport Admin.');

      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not submit the complaint.');
    } finally {
      setSubmitting(false);
    }
  }

  async function updateComplaint(id, status, adminResponse) {
    try {
      setSavingId(id);
      setNotice('');
      setError('');
      const result = await api.patch(`/complaints/${id}/status`, { status, ...(adminResponse !== undefined ? { adminResponse } : {}) });
      setComplaints(current => current.map(item => item.id === id ? result.data : item));
      setNotice('Complaint updated successfully.');

      await load();
      return true;
    } catch (e) {
      setError(e.response?.data?.message || 'Could not update the complaint.');
      return false;
    } finally {
      setSavingId('');
    }
  }

  return (
    <div className={`complaints-page ${isAdmin ? 'complaints-admin-page' : ''}`}>
      <div className="page-title">
        <div>
          <span className="eyebrow">SERVICE DESK</span>
          <h2>Complaints & Support</h2>
          <p>{isAdmin ? 'Review passenger issues, respond and update resolution status.' : 'Describe a transport issue and track its resolution.'}</p>
        </div>
      </div>

      <div className="complaint-notifications">
        {notice && <div className="success" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}>?</button></div>}
        {error && <div className="error" role="alert"><span>{error}</span><button type="button" aria-label="Dismiss error" onClick={() => setError('')}>?</button></div>}
      </div>

      {isAdmin && (
        <div className="complaint-summary-grid">
          <div className="complaint-stat"><span>TOTAL</span><strong>{loading ? '?' : complaintStats.total}</strong><small>All submitted issues</small></div>
          <div className="complaint-stat open"><span>OPEN</span><strong>{loading ? '?' : complaintStats.open}</strong><small>Needs attention</small></div>
          <div className="complaint-stat progress"><span>IN PROGRESS</span><strong>{loading ? '?' : complaintStats.progress}</strong><small>Currently being handled</small></div>
          <div className="complaint-stat good"><span>RESOLVED</span><strong>{loading ? '?' : complaintStats.resolved}</strong><small>Completed cases</small></div>
        </div>
      )}

      {!isAdmin && (
        <section className="panel complaint-form-panel">
          <div className="panel-head">
            <div>
              <h3>Report an issue</h3>
              <p>Give Admin enough detail to investigate the problem.</p>
            </div>
          </div>
          <form className="stack" onSubmit={submitComplaint} aria-busy={submitting}>
            <div className="grid-2">
              <label>Subject<input disabled={submitting} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Bus was late at my pickup point" maxLength={120} required /></label>
              <label>Category<select disabled={submitting} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </div>
            <label>Description<textarea disabled={submitting} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe what happened, when it happened and the pickup point or bus involved." maxLength={2000} rows={4} required /></label>
            <div className="complaint-form-footer"><small className="muted">{form.description.length}/2000 characters</small><button type="submit" className="primary" disabled={submitting}>{submitting ? 'Submitting...' : 'Submit complaint'}</button></div>
          </form>
        </section>
      )}

      <section className="panel complaints-panel">
        <div className="panel-head complaints-panel-head">
          <div>
            <h3>{isAdmin ? 'All complaints' : 'My complaints'}</h3>
            <p>{isAdmin ? `${filtered.length} of ${complaints.length} complaints ? Newest first` : 'Your submitted issues and Admin responses.'}</p>
          </div>
          {isAdmin && (
            <div className="complaint-tools">
              <label>Search complaints<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Student, subject or category" /></label>
              <label>Filter by status<select value={filter} onChange={e => setFilter(e.target.value)}>
                <option value="ALL">All statuses</option>
                {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
            </div>
          )}
        </div>

        {loadError && <div className="error complaint-load-error" role="alert">{loadError} <button type="button" className="secondary" onClick={() => { setLoading(true); load(); }}>Retry</button></div>}
        {loading ? <div className="empty" role="status">Loading complaints...</div> : !filtered.length ? (
          !loadError && <div className="empty">{search.trim() || filter !== 'ALL' ? 'No complaints match your search or status filter.' : isAdmin ? 'No complaints have been submitted yet.' : 'No complaints yet. Submit an issue above to track it here.'}{(search || filter !== 'ALL') && <button type="button" className="secondary" onClick={() => { setSearch(''); setFilter('ALL'); }}>Clear filters</button>}</div>
        ) : (
          <div className="complaint-list">
            {filtered.map(c => (
              <ComplaintCard
                key={c.id}
                complaint={c}
                isAdmin={isAdmin}
                saving={savingId === c.id}
                busy={Boolean(savingId)}
                onSave={updateComplaint}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ComplaintCard({ complaint, isAdmin, saving, busy, onSave }) {
  const [status, setStatus] = useState(complaint.status);
  const [response, setResponse] = useState(complaint.adminResponse || '');
  const [responseDirty, setResponseDirty] = useState(false);
  const [statusDirty, setStatusDirty] = useState(false);
  const studentName = complaint.user?.name || 'Passenger';
  const category = categories.find(([value]) => value === complaint.category)?.[1] || complaint.category;

  useEffect(() => {
    if (!statusDirty) setStatus(complaint.status);
    if (!responseDirty) setResponse(complaint.adminResponse || '');
  }, [complaint.status, complaint.adminResponse, statusDirty, responseDirty]);

  return (
    <article className="complaint-card">
      <div className="complaint-top">
        <div>
          <div className="eyebrow">{category}</div>
          <h3>{complaint.subject}</h3>
          <div className="complaint-meta"><time dateTime={complaint.createdAt}>{formatDate(complaint.createdAt)}</time></div>
        </div>
        <StatusChip status={complaint.status} />
      </div>
      {isAdmin && <div className="complaint-student"><span className="complaint-avatar" aria-hidden="true">{studentName.slice(0, 1).toUpperCase()}</span><div><strong>{studentName}</strong><span>{[complaint.user?.institutionId, complaint.user?.email].filter(Boolean).join(' ? ') || 'Passenger'}</span></div></div>}
      <p className="complaint-description">{complaint.description}</p>

      {complaint.adminResponse && !isAdmin && (
        <div className="complaint-response">
          <b>Admin response</b>
          <p>{complaint.adminResponse}</p>
          {complaint.resolvedAt && <small className="muted">Resolved {formatDate(complaint.resolvedAt)}</small>}
        </div>
      )}

      {isAdmin && (
        <div className="complaint-admin" aria-busy={saving}>
          <div className="complaint-editor-heading"><strong>Response & resolution</strong><span>Visible to the passenger after saving</span></div>
          <label className="complaint-response-field">Admin response<textarea disabled={saving} rows={3} value={response} onChange={e => { setResponse(e.target.value); setResponseDirty(true); }} placeholder="Explain the action taken or next steps?" /></label>
          <div className="complaint-resolution">
            <label>Status<select disabled={saving} value={status} onChange={e => { setStatus(e.target.value); setStatusDirty(true); }}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="REJECTED">Rejected</option></select></label>
            <button type="button" className="primary" disabled={busy || (!responseDirty && !statusDirty)} onClick={async () => {
              const saved = await onSave(complaint.id, statusDirty ? status : complaint.status, responseDirty ? response : undefined);
              if (saved) { setResponseDirty(false); setStatusDirty(false); }
            }}>{saving ? 'Updating...' : 'Update complaint'}</button>
          </div>
          <div className="complaint-save-hint">{saving ? 'Saving your changes?' : responseDirty || statusDirty ? 'Unsaved changes' : 'All changes saved'}{complaint.resolvedAt && <span>Resolved {formatDate(complaint.resolvedAt)}</span>}</div>
        </div>
      )}
    </article>
  );
}
