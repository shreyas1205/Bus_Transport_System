import {useEffect,useMemo,useState} from 'react';
import {api} from '../api';

const money=n=>`₹${Number(n||0).toLocaleString('en-IN',{maximumFractionDigits:0})}`;

function Bars({data=[],valueKey='boarded'}){
  const max=Math.max(1,...data.map(x=>Number(x[valueKey]||0)));
  return <div className="analytics-page-bars">
    {data.map(x=><div className="analytics-page-bar" key={x.key||x.label}>
      <b>{x[valueKey]||0}</b>
      <div><i style={{height:`${Math.max(5,Number(x[valueKey]||0)/max*100)}%`}}/></div>
      <span>{x.label}</span>
    </div>)}
  </div>;
}

function Meter({value,label,detail,tone=''}) {
  const v=Math.max(0,Math.min(100,Number(value||0)));
  return <div className={`analytics-health ${tone}`}>
    <div className="analytics-health-head"><span>{label}</span><b>{v}%</b></div>
    <div className="analytics-health-track"><i style={{width:`${v}%`}}/></div>
    <small>{detail}</small>
  </div>;
}

export default function Analytics(){
  const [data,setData]=useState(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);

  async function load(){
    try{
      setError('');
      const r=await api.get('/dashboard/analytics');
      setData(r.data);
    }catch(e){
      setError(e.response?.data?.message||'Unable to load analytics.');
    }finally{setLoading(false)}
  }

  useEffect(()=>{load();const timer=setInterval(load,60000);return()=>clearInterval(timer)},[]);

  const cards=useMemo(()=>data?[
    ['ACTIVE FLEET',`${data.fleet.active}/${data.fleet.total}`,`${data.fleet.breakdown} breakdown`,'fleet'],
    ['ROUTE READINESS',`${data.network.fullyAssigned}/${data.network.activeRoutes}`,`${data.network.unassigned} need assignment`,'route'],
    ['BOARDED TODAY',data.boarding.todayBoarded,`${data.boarding.todayDropped} dropped off`,'boarding'],
    ['COLLECTION RATE',`${data.finance.collectionRate}%`,`${money(data.finance.outstanding)} outstanding`,'finance'],
    ['OPEN INCIDENTS',data.safety.open,`${data.safety.resolved} resolved · 7 days`,'safety'],
    ['OPEN COMPLAINTS',data.service.openComplaints,`${data.service.resolvedComplaints} resolved · 7 days`,'service']
  ]:[],[data]);

  if(loading)return <div className="loading-card"><span className="loading-pulse"/> Loading transport analytics…</div>;

  return <div className="analytics-page">
    <section className="analytics-page-hero">
      <div><span className="eyebrow">ADMIN · LIVE OPERATIONS</span><h2>Transport analytics</h2><p>One view of fleet readiness, passenger movement, collections, safety and service quality.</p></div>
      <div className="analytics-page-actions"><span className="analytics-live"><i/> LIVE DATA</span><button className="secondary" onClick={load}>↻ Refresh</button></div>
    </section>

    {error&&<div className="error">{error}</div>}

    {data&&<>
      <section className="analytics-kpi-grid">
        {cards.map(([label,value,detail,tone])=><article className={`analytics-kpi ${tone}`} key={label}>
          <span>{label}</span><strong>{value}</strong><small>{detail}</small>
        </article>)}
      </section>

      <section className="analytics-page-grid">
        <article className="panel analytics-main-card">
          <div className="panel-head"><div><span className="panel-kicker">PASSENGER FLOW · LAST 7 DAYS</span><h3>Verified QR boarding</h3><p>Daily boarding activity recorded by NaviGuard.</p></div><div className="analytics-highlight"><b>{data.boarding.uniqueToday}</b><small>unique today</small></div></div>
          <Bars data={data.boarding.daily}/>
        </article>

        <article className="panel analytics-finance-card">
          <div className="panel-head"><div><span className="panel-kicker">FINANCIAL HEALTH</span><h3>Transport fee collection</h3><p>Paid and outstanding fee position.</p></div></div>
          <div className="analytics-money"><div><small>COLLECTED</small><strong>{money(data.finance.collected)}</strong></div><div><small>OUTSTANDING</small><strong>{money(data.finance.outstanding)}</strong></div></div>
          <Meter value={data.finance.collectionRate} label="Collection progress" detail={`${data.finance.paidCount} paid · ${data.finance.pendingCount} pending`} tone="good"/>
          <div className="analytics-methods">{data.finance.methods.length?data.finance.methods.map(x=><div key={x.label}><span>{x.label}</span><b>{money(x.value)}</b></div>):<div className="analytics-empty-inline">No successful payments in this period.</div>}</div>
        </article>
      </section>

      <section className="analytics-page-grid lower">
        <article className="panel analytics-operations-card">
          <div className="panel-head"><div><span className="panel-kicker">OPERATIONS</span><h3>Network readiness</h3><p>Current fleet and route assignment health.</p></div></div>
          <Meter value={data.fleet.total?Math.round(data.fleet.active/data.fleet.total*100):0} label="Fleet availability" detail={`${data.fleet.active} active · ${data.fleet.breakdown} breakdown · ${data.fleet.other} other`}/>
          <Meter value={data.network.activeRoutes?Math.round(data.network.fullyAssigned/data.network.activeRoutes*100):0} label="Route readiness" detail={`${data.network.fullyAssigned} fully assigned · ${data.network.unassigned} incomplete`} tone="good"/>
          <div className="analytics-network-numbers"><div><small>STUDENTS</small><b>{data.network.students}</b></div><div><small>DRIVERS</small><b>{data.network.drivers}</b></div><div><small>ACTIVE ROUTES</small><b>{data.network.activeRoutes}</b></div></div>
        </article>

        <article className="panel analytics-risk-card">
          <div className="panel-head"><div><span className="panel-kicker danger">SAFETY · LAST 7 DAYS</span><h3>Incident overview</h3><p>Operational safety events by type.</p></div><span className={`analytics-status-pill ${data.safety.open?'attention':''}`}>{data.safety.open} open</span></div>
          <div className="analytics-category-list">{data.safety.byType.length?data.safety.byType.map(x=><div key={x.label}><span>{x.label.replaceAll('_',' ')}</span><b>{x.value}</b></div>):<div className="analytics-empty-inline">No incidents recorded in this period.</div>}</div>
        </article>

        <article className="panel analytics-risk-card">
          <div className="panel-head"><div><span className="panel-kicker">SERVICE · LAST 7 DAYS</span><h3>Complaint health</h3><p>Current complaint workload by status.</p></div><span className={`analytics-status-pill ${data.service.openComplaints?'attention':''}`}>{data.service.openComplaints} open</span></div>
          <div className="analytics-category-list">{data.service.byStatus.length?data.service.byStatus.map(x=><div key={x.label}><span>{x.label.replaceAll('_',' ')}</span><b>{x.value}</b></div>):<div className="analytics-empty-inline">No complaints recorded in this period.</div>}</div>
        </article>
      </section>

      <div className="analytics-generated">Last refreshed {new Date(data.generatedAt).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'})} · automatically refreshes every minute</div>
    </>}
  </div>;
}
