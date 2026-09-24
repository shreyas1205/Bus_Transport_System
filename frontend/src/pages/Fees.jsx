import { useEffect, useState } from 'react';
import { api } from '../api';

export default function Fees() {
  const [fees, setFees] = useState([]);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');

  async function load() {
    try {
      setLoading(true);
      setError('');
      const response = await api.get('/fees/my');
      setFees(Array.isArray(response.data) ? response.data : []);
    } catch (err) {
      setFees([]);
      setError(err?.response?.data?.message || 'Could not load your transport fees.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function payDemo(fee) {
    try {
      setBusyId(fee.id);
      setMsg('');
      setError('');
      const response = await api.post('/fees/pay-demo', { feeId: fee.id });
      setMsg(response.data?.message || 'Demo payment successful.');
      await load();
    } catch (err) {
      setError(err?.response?.data?.message || 'Payment failed.');
    } finally {
      setBusyId('');
    }
  }

  async function payOnline(fee) {
    try {
      setBusyId(fee.id);
      setMsg('');
      setError('');

      const response = await api.post('/payments/create-order', { feeId: fee.id });

      if (response.data?.demo) {
        setMsg(response.data?.message || 'Online gateway is not configured. Use Demo pay.');
        return;
      }

      if (!window.Razorpay) {
        setError('Razorpay checkout script is not loaded. Use Demo pay for local testing.');
        return;
      }

      const options = {
        key: response.data.keyId,
        amount: response.data.order.amount,
        currency: response.data.order.currency,
        name: 'CampusBus',
        description: `Transport fee ${fee.academicYear}`,
        order_id: response.data.order.id,
        handler: async () => {
          try {
            await api.post('/payments/confirm-demo', {
              paymentId: response.data.payment.id,
            });
            setMsg('Payment confirmed.');
            await load();
          } catch (err) {
            setError(err?.response?.data?.message || 'Payment confirmation failed.');
          } finally {
            setBusyId('');
          }
        },
        modal: {
          ondismiss: () => setBusyId(''),
        },
        prefill: { name: 'CampusBus User' },
      };

      new window.Razorpay(options).open();
    } catch (err) {
      setError(err?.response?.data?.message || 'Could not start online payment.');
      setBusyId('');
    }
  }

  return (
    <>
      <div className="page-title">
        <div>
          <span className="eyebrow">TRANSPORT FEES</span>
          <h2>Fees & due payments</h2>
          <p>View your academic-year transport fee and payment status.</p>
        </div>
      </div>

      {msg && <div className="success">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <div className="panel">
        {loading ? (
          <div className="loading-card">Loading your transport fees…</div>
        ) : fees.length === 0 ? (
          <div className="empty-state">
            <h3>No transport fee record found</h3>
            <p>
              Select and lock a pickup point under <b>My Route</b>. A fee record is created automatically for the selected pickup point.
            </p>
            <button className="primary" onClick={load}>Refresh</button>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Academic year</th>
                  <th>Amount</th>
                  <th>Due date</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fees.map((fee) => {
                  const amount = Number(fee.amount || 0);
                  const busy = busyId === fee.id;
                  return (
                    <tr key={fee.id}>
                      <td>{fee.academicYear}</td>
                      <td>₹{amount.toLocaleString('en-IN')}</td>
                      <td>{new Date(fee.dueDate).toLocaleDateString()}</td>
                      <td>
                        <span className={fee.status === 'PAID' ? 'chip good' : 'chip warn'}>
                          {fee.status}
                        </span>
                      </td>
                      <td>
                        {fee.status !== 'PAID' && (
                          <div className="button-row">
                            <button className="secondary small" onClick={() => payDemo(fee)} disabled={busy}>
                              {busy ? 'Processing…' : 'Demo pay'}
                            </button>
                            <button className="primary small" onClick={() => payOnline(fee)} disabled={busy}>
                              Pay online
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
