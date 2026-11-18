import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Signup() {
  const [tab, setTab] = useState('parent');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState('form');
  const [parentEmail, setParentEmail] = useState('');
  const [code, setCode] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', usn: '', studentEmail: '', department: '' });

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function run(action) {
    setBusy(true); setError(''); setMessage('');
    try { await action(); }
    catch (err) { setError(err.response?.data?.message || 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  }

  function submitParent(e) {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/signup/parent', form);
      setParentEmail(r.data.email);
      setMessage(r.data.message);
      setStep('code');
    });
  }

  function verifyParent(e) {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/signup/parent/verify', { email: parentEmail, code });
      setMessage(r.data.message);
      setStep('done');
    });
  }

  function resend() {
    run(async () => {
      const r = await api.post('/signup/parent/resend', { email: parentEmail });
      setMessage(r.data.message);
    });
  }

  function submitStaff(e) {
    e.preventDefault();
    run(async () => {
      const r = await api.post('/signup/staff', form);
      setMessage(r.data.message);
      setStep('done');
    });
  }

  return (
    <main className="signup-page">
      <section className="panel">
        <span className="panel-kicker">CREATE ACCOUNT</span>
        <h2>Sign up for NaviGuard</h2>

        {step === 'form' && (
          <div className="button-row" style={{ marginBottom: 16 }}>
            <button type="button" className={tab === 'parent' ? 'primary' : 'secondary'} onClick={() => { setTab('parent'); setError(''); }}>Parent</button>
            <button type="button" className={tab === 'staff' ? 'primary' : 'secondary'} onClick={() => { setTab('staff'); setError(''); }}>Staff</button>
          </div>
        )}

        {step === 'form' && tab === 'parent' && (
          <form onSubmit={submitParent} style={{ display: 'grid', gap: 12 }}>
            <label>Your name<input required value={form.name} onChange={set('name')} /></label>
            <label>Your email<input required type="email" value={form.email} onChange={set('email')} /></label>
            <label>Password (12+ characters)<input required type="password" minLength={12} value={form.password} onChange={set('password')} /></label>
            <label>Student USN<input required value={form.usn} onChange={set('usn')} /></label>
            <label>Student email<input required type="email" value={form.studentEmail} onChange={set('studentEmail')} /></label>
            <small>A 6-digit code will be emailed to the student. Ask your child for it.</small>
            <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Send code to student email'}</button>
          </form>
        )}

        {step === 'form' && tab === 'staff' && (
          <form onSubmit={submitStaff} style={{ display: 'grid', gap: 12 }}>
            <label>Your name<input required value={form.name} onChange={set('name')} /></label>
            <label>Your email<input required type="email" value={form.email} onChange={set('email')} /></label>
            <label>Password (12+ characters)<input required type="password" minLength={12} value={form.password} onChange={set('password')} /></label>
            <label>Department (optional)<input value={form.department} onChange={set('department')} /></label>
            <small>An admin must approve staff accounts before you can log in.</small>
            <button className="primary" disabled={busy}>{busy ? 'Please wait…' : 'Request staff account'}</button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verifyParent} style={{ display: 'grid', gap: 12 }}>
            <p>Enter the 6-digit code the student received by email. It expires in 10 minutes.</p>
            <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" aria-label="Student code" />
            <button className="primary" disabled={busy || code.length !== 6}>Activate account</button>
            <button type="button" className="secondary" disabled={busy} onClick={resend}>Send a new code</button>
          </form>
        )}

        {step === 'done' && <p>{message}</p>}
        {step !== 'done' && message && <p role="status">{message}</p>}
        {error && <p role="alert" className="error">{error}</p>}

        <p style={{ marginTop: 16 }}>Already have an account? <Link to="/login">Log in</Link></p>
      </section>
    </main>
  );
}
