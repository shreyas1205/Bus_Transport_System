import {useEffect,useState} from 'react';
import {api} from '../api';

export default function FeeSettings(){
  const [stops,setStops]=useState([]); const [loading,setLoading]=useState(true); const [msg,setMsg]=useState(''); const [error,setError]=useState(''); const [saving,setSaving]=useState('');
  async function load(){setLoading(true);setError('');try{const r=await api.get('/fees/settings');setStops(r.data.map(s=>({...s,amount:String(s.amount)})));}catch(e){setError(e.response?.data?.message||'Could not load pickup-point fees.');}finally{setLoading(false)}}
  useEffect(()=>{load()},[]);
  async function save(stop){setSaving(stop.id);setMsg('');setError('');try{const r=await api.patch(`/fees/settings/${stop.id}`,{amount:Number(stop.amount)});setMsg(r.data.message);await load();}catch(e){setError(e.response?.data?.message||'Fee update failed.')}finally{setSaving('')}}
  if(loading)return <div className="loading-card">Loading pickup-point fees…</div>;
  return <><div className="page-title"><div><span className="eyebrow">ADMIN ONLY</span><h2>Pickup-point fee settings</h2><p>Set a different transport fee for each pickup point.</p></div></div>{msg&&<div className="success">{msg}</div>}{error&&<div className="error">{error}</div>}<section className="panel"><div className="table-wrap"><table><thead><tr><th>Pickup point</th><th>Location</th><th>Routes</th><th>Students / staff</th><th>Fee</th><th></th></tr></thead><tbody>{stops.map(stop=><tr key={stop.id}><td><b>{stop.name}</b></td><td>{stop.googleMapsUrl?<a href={stop.googleMapsUrl} target="_blank" rel="noreferrer">📍 View on Google Maps</a>:stop.locationText||'—'}</td><td>{stop.routes.length?stop.routes.map(r=>r.code).join(', '):'—'}</td><td>{stop.users}</td><td><input type="number" min="0" step="100" value={stop.amount} onChange={e=>setStops(items=>items.map(x=>x.id===stop.id?{...x,amount:e.target.value}:x))} style={{maxWidth:140}}/></td><td><button className="primary" disabled={saving===stop.id} onClick={()=>save(stop)}>{saving===stop.id?'Saving…':'Save'}</button></td></tr>)}</tbody></table></div></section></>;
}
