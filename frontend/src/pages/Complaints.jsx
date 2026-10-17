import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { io } from 'socket.io-client';

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
  const tone = status === 'RESOLVED' ? 'good' : status === 'OPEN' ? 'danger' : 'warn';
  return <span className={`chip ${tone}`}>{statusLabels[status] || status}</span>;
}

export default function Complaints() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const isParent = user?.role === 'PARENT';
  const [complaints, setComplaints] = useState([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [form, setForm] = useState({ subject: '', category: 'BUS_DELAY', description: '' });
  const [savingId, setSavingId] = useState('');

  const load = async () => {
    try {
      setError('');
      const response = await api.get('/complaints');
      setComplaints(response.data || []);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load complaints.');
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
    () => (filter === 'ALL' ? complaints : complaints.filter(c => c.status === filter)),
    [complaints, filter],
  );

  const complaintStats = useMemo(() => ({
    total: complaints.length,
    open: complaints.filter(c => c.status === 'OPEN').length,
    progress: complaints.filter(c => c.status === 'IN_PROGRESS').length,
    resolved: complaints.filter(c => c.status === 'RESOLVED').length,
  }), [complaints]);

  async function submitComplaint(e) {
    e.preventDefault();
    try {
      setError('');
      await api.post('/complaints', form);
      setForm({ subject: '', category: 'BUS_DELAY', description: '' });
      setNotice('Complaint submitted to transport Admin.');
      setTimeout(() => setNotice(''), 3500);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not submit the complaint.');
    }
  }

  async function updateComplaint(id, status, adminResponse) {
    try {
      setSavingId(id);
      setError('');
      await api.patch(`/complaints/${id}/status`, { status, adminResponse });
      setNotice('Complaint updated successfully.');
      setTimeout(() => setNotice(''), 2500);
      load();
    } catch (e) {
      setError(e.response?.data?.message || 'Could not update the complaint.');
    } finally {
      setSavingId('');
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">SERVICE DESK</span>
          <h2>Complaints & Support</h2>
          <p>{isAdmin ? 'Review passenger issues, respond and update resolution status.' : 'Describe a transport issue and track its resolution.'}</p>
        </div>
      </div>

      {notice && <div className="success">{notice}</div>}
      {error && <div className="error">{error}</div>}

      {isAdmin && (
        <div className="complaint-summary-grid">
          <div className="complaint-stat"><span>TOTAL</span><strong>{complaintStats.total}</strong><small>All submitted issues</small></div>
          <div className="complaint-stat danger"><span>OPEN</span><strong>{complaintStats.open}</strong><small>Needs attention</small></div>
          <div className="complaint-stat warn"><span>IN PROGRESS</span><strong>{complaintStats.progress}</strong><small>Currently being handled</small></div>
          <div className="complaint-stat good"><span>RESOLVED</span><strong>{complaintStats.resolved}</strong><small>Completed cases</small></div>
        </div>
      )}

      {!isAdmin && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <h3>Report an issue</h3>
              <p>Give Admin enough detail to investigate the problem.</p>
            </div>
          </div>
          <form className="stack" onSubmit={submitComplaint}>
            <div className="grid-2">
              <label>Subject<input value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="Bus was late at my pickup point" maxLength={120} required /></label>
              <label>Category<select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </div>
            <label>Description<textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Describe what happened, when it happened and the pickup point or bus involved." maxLength={2000} rows={6} required /></label>
            <div><button className="primary">Submit complaint</button></div>
          </form>
        </section>
      )}

      <section className="panel complaints-panel">
        <div className="panel-head complaints-panel-head">
          <div>
            <h3>{isAdmin ? 'All complaints' : 'My complaints'}</h3>
            <p>{isAdmin ? `${complaints.length} complaint${complaints.length === 1 ? '' : 's'} recorded.` : 'Your submitted issues and Admin responses.'}</p>
          </div>
          {isAdmin && (
            <select value={filter} onChange={e => setFilter(e.target.value)}>
              <option value="ALL">All statuses</option>
              <option value="OPEN">Open</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="RESOLVED">Resolved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          )}
        </div>

        {!filtered.length ? (
          <div className="empty">No complaints to show.</div>
        ) : (
          <div className="complaint-list">
            {filtered.map(c => (
              <ComplaintCard
                key={c.id}
                complaint={c}
                isAdmin={isAdmin}
                saving={savingId === c.id}
                onSave={updateComplaint}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ComplaintCard({ complaint, isAdmin, saving, onSave }) {
  const [status, setStatus] = useState(complaint.status);
  const [response, setResponse] = useState(complaint.adminResponse || '');
  const studentName = complaint.user?.name || 'Passenger';
  const category = categories.find(([value]) => value === complaint.category)?.[1] || complaint.category;

  useEffect(() => {
    setStatus(complaint.status);
    setResponse(complaint.adminResponse || '');
  }, [complaint.status, complaint.adminResponse]);

  return (
    <article className="complaint-card">
      <div className="complaint-top">
        <div>
          <div className="eyebrow">{category}</div>
          <h3>{complaint.subject}</h3>
          <small className="muted">{isAdmin ? `${studentName} · ` : ''}{formatDate(complaint.createdAt)}</small>
        </div>
        <StatusChip status={complaint.status} />
      </div>
      <p className="complaint-description">{complaint.description}</p>

      {complaint.adminResponse && !isAdmin && (
        <div className="complaint-response">
          <b>Admin response</b>
          <p>{complaint.adminResponse}</p>
          {complaint.resolvedAt && <small className="muted">Resolved {formatDate(complaint.resolvedAt)}</small>}
        </div>
      )}

      {isAdmin && (
        <div className="complaint-admin">
          <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="REJECTED">Rejected</option></select></label>
          <label>Admin response<textarea rows={3} value={response} onChange={e => setResponse(e.target.value)} placeholder="Add the action taken or response for the student." /></label>
          <div><button className="secondary" disabled={saving} onClick={() => onSave(complaint.id, status, response)}>{saving ? 'Saving…' : 'Update complaint'}</button></div>
        </div>
      )}
    </article>
  );
}
