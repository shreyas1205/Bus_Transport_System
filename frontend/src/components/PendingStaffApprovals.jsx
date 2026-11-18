import { useEffect, useState } from 'react';
import { api } from '../api';

export default function PendingStaffApprovals() {
  const [rows, setRows] = useState([]);
  const [message, setMessage] = useState('');

  async function load() {
    try { const r = await api.get('/signup/pending'); setRows(r.data); }
    catch { setRows([]); }
  }

  useEffect(() => { load(); }, []);

  async function decide(id, decision) {
    setMessage('');
    try {
      const r = await api.post(`/signup/${id}/decision`, { decision });
      setMessage(r.data.message);
      await load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Could not update this sign-up.');
    }
  }

  if (!rows.length && !message) return null;

  return (
    <section className="panel" style={{ padding: 20, marginBottom: 16 }}>
      <span className="panel-kicker">PENDING STAFF SIGN-UPS</span>
      {rows.length === 0 && <p>No staff sign-ups are waiting.</p>}
      {rows.map((row) => (
        <div key={row.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }}>
          <strong>{row.name}</strong>
          <span>{row.email}</span>
          <span>{row.staffProfile?.department || 'No department'}</span>
          <button type="button" className="primary" onClick={() => decide(row.id, 'APPROVE')}>Approve</button>
          <button type="button" className="secondary" onClick={() => decide(row.id, 'REJECT')}>Reject</button>
        </div>
      ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
