import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

function money(v){return `₹${Number(v||0).toLocaleString('en-IN')}`}
function date(v){return v?new Date(v).toLocaleDateString('en-IN'):'—'}

export default function Fees() {
  const { user } = useAuth();
  const [data,setData]=useState({owner:null,fees:[]});
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState('');
  const [method,setMethod]=useState('UPI');
  const [msg,setMsg]=useState('');
  const [error,setError]=useState('');
  const [receipt,setReceipt]=useState(null);

  async function load(){
    setLoading(true);setError('');
    try{
      const r=await api.get('/fees/my');
      setData(r.data?.fees ? r.data : {owner:user,fees:Array.isArray(r.data)?r.data:[]});
    }catch(e){setError(e.response?.data?.message||'Could not load transport fees.')}
    finally{setLoading(false)}
  }
  useEffect(()=>{load()},[]);

  const totals=useMemo(()=>{
    const fees=data.fees||[];
    return {
      total:fees.reduce((s,f)=>s+Number(f.amount||0),0),
      pending:fees.filter(f=>f.status!=='PAID').reduce((s,f)=>s+Number(f.amount||0),0),
      paid:fees.filter(f=>f.status==='PAID').reduce((s,f)=>s+Number(f.amount||0),0),
    };
  },[data.fees]);

  async function sandboxPay(fee){
    try{
      setBusy(fee.id);setError('');setMsg('');
      const r=await api.post('/fees/pay-demo',{feeId:fee.id,method});
      setMsg(r.data?.message||'Payment successful.');await load();
    }catch(e){setError(e.response?.data?.message||'Payment failed.')}
    finally{setBusy('')}
  }

  async function ensureRazorpay(){
    if(window.Razorpay)return true;
    return new Promise(resolve=>{
      const s=document.createElement('script');
      s.src='https://checkout.razorpay.com/v1/checkout.js';
      s.onload=()=>resolve(true);s.onerror=()=>resolve(false);
      document.body.appendChild(s);
    });
  }

  async function payOnline(fee){
    try{
      setBusy(fee.id);setError('');setMsg('');
      const r=await api.post('/payments/create-order',{feeId:fee.id,method});
      if(r.data?.demo){setMsg(r.data.message);setBusy('');return}
      if(!(await ensureRazorpay())){setError('Could not load secure payment checkout.');setBusy('');return}
      const options={
        key:r.data.keyId,amount:r.data.order.amount,currency:r.data.order.currency,
        name:'NaviGuard',description:`Transport fee ${fee.academicYear}`,order_id:r.data.order.id,
        method:{upi:method==='UPI',card:method==='CARD',netbanking:method==='NETBANKING'},
        handler:async(response)=>{
          try{
            await api.post('/payments/verify',{paymentId:r.data.payment.id,...response});
            setMsg('Payment verified successfully.');await load();
          }catch(e){setError(e.response?.data?.message||'Payment verification failed.')}
          finally{setBusy('')}
        },
        modal:{ondismiss:()=>setBusy('')},
        prefill:{name:data.owner?.name||user?.name||'NaviGuard User',email:data.owner?.email||''},
        theme:{color:'#2563EB'},
      };
      new window.Razorpay(options).open();
    }catch(e){setError(e.response?.data?.message||'Could not start payment.');setBusy('')}
  }

  async function showReceipt(paymentId){
    try{const r=await api.get(`/payments/${paymentId}/receipt`);setReceipt(r.data)}
    catch(e){setError(e.response?.data?.message||'Could not load receipt.')}
  }

  return <>
    <div className="page-title"><div>
      <span className="eyebrow">TRANSPORT BILLING</span>
      <h2>Fees & payments</h2>
      <p>{user?.role==='PARENT' ? `Pay and track transport fees for ${data.owner?.name||'your linked student'}.` : 'Review transport charges, pay securely and access receipts.'}</p>
    </div></div>
    {msg&&<div className="success">{msg}</div>}{error&&<div className="error">{error}</div>}

    <div className="fee-summary-grid">
      <div className="fee-stat"><small>TOTAL FEES</small><strong>{money(totals.total)}</strong></div>
      <div className="fee-stat good"><small>PAID</small><strong>{money(totals.paid)}</strong></div>
      <div className="fee-stat warn"><small>OUTSTANDING</small><strong>{money(totals.pending)}</strong></div>
      <div className="fee-stat"><small>PAYMENT FOR</small><strong className="fee-person">{data.owner?.name||user?.name||'—'}</strong></div>
    </div>

    <section className="panel fee-pay-panel">
      <div className="panel-head"><div><span className="eyebrow">PAYMENT METHOD</span><h3>Choose how you want to pay</h3></div><span className="chip good">SECURE CHECKOUT</span></div>
      <div className="payment-methods">
        {[['UPI','UPI / QR'],['CARD','Credit / Debit Card'],['NETBANKING','Net Banking']].map(([k,label])=>
          <button key={k} type="button" className={method===k?'payment-method active':'payment-method'} onClick={()=>{setMethod(k);setError('');setMsg(totals.pending>0?`${label} selected. Use Pay securely on the pending fee below.`:`${label} selected. There is currently no outstanding fee to pay.`)}}><b>{k==='UPI'?'⌁':k==='CARD'?'▣':'⌂'}</b><span>{label}</span><em>{method===k?'SELECTED':'SELECT'}</em></button>
        )}
      </div>
      <div className="payment-selection-status"><b>{method==='UPI'?'UPI / QR':method==='CARD'?'Credit / Debit Card':'Net Banking'}</b><span>{totals.pending>0?`Selected for your next payment · ${money(totals.pending)} outstanding`:'No payment required · your transport fee is fully paid'}</span></div>
      <small className="payment-note">The method buttons select the checkout type. When a fee is pending, use Pay securely in the fee record below. Development without gateway keys uses NaviGuard sandbox payment.</small>
    </section>

    <section className="panel fee-records">
      <div className="panel-head"><div><span className="eyebrow">FEE LEDGER</span><h3>Transport fee records</h3></div><button className="secondary" onClick={load}>Refresh</button></div>
      {loading?<div className="loading-card">Loading fees…</div>:!data.fees?.length?<div className="empty-state"><h3>No transport fee record</h3><p>Your fee will appear after a pickup point and transport fee are assigned.</p></div>:
      <div className="table-wrap"><table><thead><tr><th>Academic year</th><th>Pickup point</th><th>Fee breakdown</th><th>Payable</th><th>Due</th><th>Status</th><th>Payment</th></tr></thead><tbody>
        {data.fees.map(f=>{
          const lastPaid=f.payments?.find(p=>p.status==='PAID');
          return <tr key={f.id}><td><b>{f.academicYear}</b></td><td>{f.pickupStop?.name||'—'}</td>
          <td><div className="fee-breakdown"><span>Base <b>{money(f.baseAmount || f.amount)}</b></span><span>Discount <b>-{money(f.discountAmount || 0)}</b></span><span>Adjustment <b>{Number(f.adjustmentAmount||0)>=0?'+':''}{money(f.adjustmentAmount||0)}</b></span></div></td>
          <td><b>{money(f.amount)}</b></td><td>{date(f.dueDate)}</td>
          <td><span className={f.status==='PAID'?'chip good':'chip warn'}>{f.status}</span></td>
          <td>{f.status==='PAID'?<button className="secondary small" onClick={()=>showReceipt(lastPaid?.id)} disabled={!lastPaid}>View receipt</button>:
          <div className="button-row"><button className="secondary small" disabled={busy===f.id} onClick={()=>sandboxPay(f)}>Sandbox Pay</button><button className="primary small" disabled={busy===f.id} onClick={()=>payOnline(f)}>{busy===f.id?'Processing…':'Pay securely'}</button></div>}</td></tr>
        })}</tbody></table></div>}
    </section>

    <section className="panel payment-history">
      <div className="panel-head"><div><span className="eyebrow">PAYMENT HISTORY</span><h3>Transactions & receipts</h3></div></div>
      <div className="table-wrap"><table><thead><tr><th>Date</th><th>Academic year</th><th>Method</th><th>Amount</th><th>Status</th><th>Receipt</th></tr></thead><tbody>
      {data.fees.flatMap(f=>(f.payments||[]).map(p=>({...p,academicYear:f.academicYear}))).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).map(p=>
        <tr key={p.id}><td>{date(p.paidAt||p.createdAt)}</td><td>{p.academicYear}</td><td>{p.gateway}</td><td>{money(p.amount)}</td><td><span className={p.status==='PAID'?'chip good':p.status==='FAILED'?'chip bad':'chip warn'}>{p.status}</span></td><td>{p.status==='PAID'?<button className="secondary small" onClick={()=>showReceipt(p.id)}>Receipt</button>:p.status==='FAILED'?<button className="primary small" onClick={()=>payOnline(data.fees.find(f=>f.id===p.feeId))}>Retry payment</button>:'—'}</td></tr>
      )}
      {!data.fees.some(f=>f.payments?.length)&&<tr><td colSpan="6"><div className="empty">No payment transactions yet.</div></td></tr>}
      </tbody></table></div>
    </section>

    {receipt&&<div className="receipt-overlay" onClick={()=>setReceipt(null)}><div className="receipt-card" onClick={e=>e.stopPropagation()}>
      <div className="receipt-mark">CB</div><span className="eyebrow">PAYMENT RECEIPT</span><h2>{money(receipt.amount)}</h2>
      <div className="receipt-lines"><div><span>Receipt</span><b>{receipt.receiptNo}</b></div><div><span>Student</span><b>{receipt.student?.name}</b></div><div><span>Academic year</span><b>{receipt.academicYear}</b></div><div><span>Pickup point</span><b>{receipt.pickupPoint||'—'}</b></div><div><span>Paid on</span><b>{date(receipt.paidAt)}</b></div><div><span>Method</span><b>{receipt.gateway}</b></div></div>
      <button className="primary" onClick={()=>window.print()}>Print receipt</button><button className="secondary" onClick={()=>setReceipt(null)}>Close</button>
    </div></div>}
  </>;
}
