import { useEffect, useState } from 'react';
import { api } from '../api';
import { QRCodeSVG } from 'qrcode.react';
import { useAuth } from '../auth';

export default function Passes() {
  const { user } = useAuth();
  const [passes, setPasses] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dailyQr, setDailyQr] = useState(null);
  const [dailyBusy, setDailyBusy] = useState(false);

  async function load() {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/passes/my');
      setPasses(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to load bus passes.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function request() {
    try {
      setBusy(true);
      setError('');
      setMsg('');
      const response = await api.post('/passes/request');
      setMsg(response.status === 200
        ? 'You already have an active bus pass.'
        : 'New 30-day digital pass generated.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to generate pass.');
    } finally {
      setBusy(false);
    }
  }

  async function renew(id) {
    try {
      setBusy(true);
      setError('');
      setMsg('');
      await api.post(`/passes/${id}/renew`);
      setMsg('Pass renewed for another month.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to renew pass.');
    } finally {
      setBusy(false);
    }
  }


  async function generateTodayQr() {
    try {
      setDailyBusy(true);
      setError('');
      setMsg('');
      const response = await api.get('/passes/daily-qr');
      setDailyQr(response.data);
      setMsg('Today’s boarding QR is ready.');
    } catch (err) {
      setError(err?.response?.data?.message || 'Unable to generate today’s QR.');
    } finally {
      setDailyBusy(false);
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">DIGITAL IDENTITY</span>
          <h2>Bus Pass</h2>
          <p>Generate, display and renew your QR-enabled campus transport pass.</p>
        </div>
        <button className="primary" onClick={request} disabled={busy}>
          {busy ? 'Please wait…' : passes.length ? 'Refresh pass' : 'Generate pass'}
        </button>
      </div>

      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      {user?.role === 'STUDENT' && (
        <section className="panel daily-qr-card">
          <div>
            <span className="eyebrow">TODAY'S BOARDING QR</span>
            <h3>Daily ride check-in</h3>
            <p>Generate this QR before boarding. It is valid only for today and can be scanned only by your assigned driver.</p>
            <button className="primary" onClick={generateTodayQr} disabled={dailyBusy}>
              {dailyBusy ? 'Generating…' : dailyQr ? 'Refresh today’s QR' : 'Generate today’s QR'}
            </button>
          </div>
          <div className="daily-qr-visual">
            {dailyQr ? (
              <>
                <div className="daily-qr-code"><QRCodeSVG value={dailyQr.token} size={180} /></div>
                <strong>{dailyQr.date}</strong>
                <small>{dailyQr.passNumber} · Valid today only</small>
              </>
            ) : (
              <div className="daily-qr-placeholder">QR</div>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <div className="loading-card">Loading bus pass…</div>
      ) : passes.length === 0 ? (
        <section className="panel empty-state">
          <h3>No bus pass yet</h3>
          <p>Generate your digital pass. It will be linked to your current transport route when one is selected.</p>
          <button className="primary" onClick={request} disabled={busy}>
            {busy ? 'Generating…' : 'Generate my pass'}
          </button>
        </section>
      ) : (
        <div className="pass-grid">
          {passes.map((pass) => (
            <section className="panel pass-card" key={pass.id}>
              <div>
                <span className="eyebrow">CAMPUSBUS PASS</span>
                <h3>{pass.passNumber}</h3>
                <span className={pass.status === 'ACTIVE' ? 'chip good' : 'chip warn'}>
                  {pass.status}
                </span>
              </div>

              <QRCodeSVG value={pass.qrPayload} size={132} />

              <div className="pass-meta">
                <span>Valid from <b>{new Date(pass.validFrom).toLocaleDateString()}</b></span>
                <span>Valid until <b>{new Date(pass.validUntil).toLocaleDateString()}</b></span>
              </div>

              <button className="secondary" onClick={() => renew(pass.id)} disabled={busy}>
                {busy ? 'Please wait…' : 'Renew'}
              </button>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
