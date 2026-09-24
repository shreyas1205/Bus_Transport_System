import {useEffect,useMemo,useState} from 'react';
import {api} from '../api';

const initial={name:'',email:'',password:'Pass@123',role:'DRIVER',phone:'',institutionId:'',licenseNumber:'',licenseExpiry:'',course:'',semester:'',department:'',studentId:''};
const roleAliases={student:'STUDENT',students:'STUDENT',stud:'STUDENT',s:'STUDENT',driver:'DRIVER',drivers:'DRIVER',drv:'DRIVER',d:'DRIVER',parent:'PARENT',parents:'PARENT',mom:'PARENT',dad:'PARENT'};

function parseRoster(text){
  return text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((line)=>{
    const parts=line.split(/\s*[|;,]\s*/).map(x=>x.trim()).filter(Boolean);
    const roleIndex=parts.findIndex(x=>!!roleAliases[x.toLowerCase()] || ['DRIVER','STUDENT','PARENT'].includes(x.toUpperCase()));
    const role=roleIndex>=0 ? (roleAliases[parts[roleIndex].toLowerCase()]||parts[roleIndex].toUpperCase()) : '';
    const name=parts[0]||'';
    const institutionId=parts[roleIndex>=0?roleIndex+1:1]||'';
    return {name,role,institutionId};
  });
}

export default function Users(){
  const [users,setUsers]=useState([]); const [role,setRole]=useState(''); const [draftPhones,setDraftPhones]=useState({}); const [savingId,setSavingId]=useState(''); const [notice,setNotice]=useState(''); const [error,setError]=useState(''); const [showCreate,setShowCreate]=useState(false); const [form,setForm]=useState(initial); const [busy,setBusy]=useState(false); const [created,setCreated]=useState(null);
  const [showAi,setShowAi]=useState(false); const [roster,setRoster]=useState('Rahul Kumar | Student | 23CSE001\nRamesh Kumar | Driver | DRV001\nSita Sharma | Parent'); const [aiBusy,setAiBusy]=useState(false); const [aiResults,setAiResults]=useState([]);
  const parsedRoster=useMemo(()=>parseRoster(roster),[roster]);

  const load=()=>api.get('/users',{params:role?{role}:undefined}).then(r=>{setUsers(r.data);const p={};r.data.forEach(u=>{if(u.role==='DRIVER')p[u.id]=u.phone||''});setDraftPhones(p)}).catch(e=>setError(e.response?.data?.message||'Could not load users'));
  useEffect(() => {
  load();
}, [role]);
  function change(k,v){setForm(f=>({...f,[k]:v}));setCreated(null)}
  function resetForm(){setForm(initial);setCreated(null)}
  async function create(e){e.preventDefault();setBusy(true);setNotice('');setError('');try{const r=await api.post('/users',form);setCreated({email:r.data.email,password:form.password,role:r.data.role,name:r.data.name});setNotice(`${r.data.role} account created successfully.`);resetForm();load();}catch(e){setError(e.response?.data?.message||'Could not create account')}finally{setBusy(false)}}
  async function savePhone(id){try{setSavingId(id);setNotice('');setError('');const r=await api.patch(`/users/${id}/phone`,{phone:draftPhones[id]||''});setUsers(us=>us.map(u=>u.id===id?{...u,phone:r.data.phone}:u));setDraftPhones(p=>({...p,[id]:r.data.phone||''}));setNotice('Driver phone updated successfully.')}catch(e){setError(e.response?.data?.message||'Could not update driver phone')}finally{setSavingId('')}}

  async function aiCreate(){
    setAiBusy(true);setNotice('');setError('');setAiResults([]);
    const valid=parsedRoster.filter(r=>r.name && r.role);
    if(!valid.length){setError('Add roster lines with a name and Driver, Student or Parent role.');setAiBusy(false);return;}
    const missing=parsedRoster.find(r=>!r.name || !r.role);
    if(missing){setError('Every roster line needs a name and role. Use: Name | Student | ID');setAiBusy(false);return;}
    try{
      const r=await api.post('/users/ai-bulk-create',{records:valid});
      setAiResults(r.data.created||[]);setNotice(r.data.message||'Accounts created automatically.');load();
    }catch(e){setError(e.response?.data?.message||'AI account generation failed')}
    finally{setAiBusy(false)}
  }

  function downloadCredentials(){
    if(!aiResults.length)return;
    const rows=[['Name','Role','Login ID','Temporary Password','Institution ID','Phone'],...aiResults.map(x=>[x.name,x.role,x.email,x.password,x.institutionId,x.phone||''])];
    const csv=rows.map(row=>row.map(v=>`"${String(v??'').replaceAll('"','""')}"`).join(',')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='campusbus-generated-credentials.csv'; a.click(); URL.revokeObjectURL(url);
  }

  return <>
    <div className="page-title"><div><span className="eyebrow">ADMINISTRATION</span><h2>Users & accounts</h2><p>Create driver and student login IDs, manage contact details and keep access organized.</p></div><div className="button-row"><select className="select" value={role} onChange={e=>setRole(e.target.value)}><option value="">All roles</option><option>FLEET_MANAGER</option><option>DRIVER</option><option>STUDENT</option><option>STAFF</option><option>PARENT</option><option>ADMIN</option></select><button className="secondary" onClick={()=>{setShowAi(v=>!v);setError('');setNotice('')}}>✨ AI credential assistant</button><button className="primary" onClick={()=>{setShowCreate(v=>!v);setError('');setNotice('')}}>{showCreate?'Close':'＋ Create account'}</button></div></div>
    {notice&&<div className="success">{notice}</div>}{error&&<div className="error">{error}</div>}

    {showAi&&<section className="panel ai-assistant-panel">
      <div className="panel-head"><div><span className="eyebrow">AI-ASSISTED AUTOMATION</span><h3>Generate credentials from a roster</h3><p>Paste names and roles. The assistant creates unique login IDs, temporary passwords and institution IDs automatically. No external AI API key is required.</p></div></div>
      <div className="ai-grid">
        <div>
          <label className="ai-label">Roster <span>One person per line</span></label>
          <textarea className="ai-roster" value={roster} onChange={e=>setRoster(e.target.value)} placeholder="Rahul Kumar | Student | 23CSE001\nRamesh Kumar | Driver | DRV001\nSita Sharma | Parent" />
          <div className="hint">Format: <b>Name | Role | optional ID</b>. Role can be Student, Driver or Parent.</div>
        </div>
        <div>
          <label className="ai-label">Preview <span>{parsedRoster.filter(x=>x.name&&x.role).length} ready</span></label>
          <div className="ai-preview">{parsedRoster.length?<table><thead><tr><th>Name</th><th>Role</th><th>ID</th></tr></thead><tbody>{parsedRoster.map((x,i)=><tr key={i}><td>{x.name||'—'}</td><td>{x.role||'Invalid'}</td><td>{x.institutionId||'Auto-generate'}</td></tr>)}</tbody></table>:<div className="empty">Paste a roster to preview.</div>}</div>
          <div className="button-row ai-actions"><button className="primary" onClick={aiCreate} disabled={aiBusy}>{aiBusy?'Creating…':'✨ Generate & create accounts'}</button>{aiResults.length>0&&<button className="secondary" onClick={downloadCredentials}>Download credentials CSV</button>}</div>
        </div>
      </div>
      {aiResults.length>0&&<div className="ai-results"><div className="panel-head"><div><h3>Generated credentials</h3><p>Save or share these credentials securely with the intended users. They are shown here so the Admin does not need to create them manually.</p></div></div><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>Login ID</th><th>Temporary password</th><th>Institution ID</th></tr></thead><tbody>{aiResults.map(x=><tr key={x.id}><td><b>{x.name}</b></td><td><span className="chip good">{x.role}</span></td><td>{x.email}</td><td><code>{x.password}</code></td><td>{x.institutionId}</td></tr>)}</tbody></table></div></div>}
    </section>}

    {created&&<section className="credential-banner"><div className="credential-icon">✓</div><div><b>Login created</b><small>{created.name} · {created.role}</small></div><div className="credential-values"><span><small>Email</small><b>{created.email}</b></span><span><small>Password</small><b>{created.password}</b></span></div></section>}
    {showCreate&&<section className="panel"><div className="panel-head"><div><h3>Create a new login</h3><p>Repeat this form to create as many driver or student accounts as your college needs.</p></div></div>
      <form className="account-form" onSubmit={create}>
        <label>Full name<input value={form.name} onChange={e=>change('name',e.target.value)} placeholder="Rahul Kumar" required/></label>
        <label>Role<select value={form.role} onChange={e=>change('role',e.target.value)}><option>DRIVER</option><option>STUDENT</option><option>PARENT</option><option>STAFF</option><option>FLEET_MANAGER</option></select></label>
        <label>Email / login ID<input type="email" value={form.email} onChange={e=>change('email',e.target.value)} placeholder="rahul@campusbus.local" required/></label>
        <label>Password<input value={form.password} onChange={e=>change('password',e.target.value)} minLength="6" required/></label>
        <label>Phone<input value={form.phone} onChange={e=>change('phone',e.target.value)} placeholder="9000000010" inputMode="tel"/></label>
        <label>Institution / student ID<input value={form.institutionId} onChange={e=>change('institutionId',e.target.value)} placeholder="23CSE010"/></label>
        {form.role==='DRIVER'&&<><label>License number<input value={form.licenseNumber} onChange={e=>change('licenseNumber',e.target.value)} placeholder="KA-DL-12345"/></label><label>License expiry<input type="date" value={form.licenseExpiry} onChange={e=>change('licenseExpiry',e.target.value)}/></label></>}
        {form.role==='STUDENT'&&<><label>Course<input value={form.course} onChange={e=>change('course',e.target.value)} placeholder="B.Tech CSE"/></label><label>Semester<input value={form.semester} onChange={e=>change('semester',e.target.value)} placeholder="5"/></label></>}
        {form.role==='STAFF'&&<label>Department<input value={form.department} onChange={e=>change('department',e.target.value)} placeholder="Computer Science"/></label>}
        {form.role==='PARENT'&&<label>Student ID<input value={form.studentId} onChange={e=>change('studentId',e.target.value)} placeholder="Student user ID"/></label>}
        <div className="full-row"><button className="primary" disabled={busy}>{busy?'Creating…':'Create login'}</button><button type="button" className="secondary" onClick={resetForm}>Clear</button></div>
      </form>
    </section>}
    <section className="panel"><div className="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>ID</th><th>Route</th><th>Pickup</th><th>Phone</th><th>Action</th></tr></thead><tbody>{users.map(u=><tr key={u.id}><td><b>{u.name}</b><small className="block">{u.email}</small></td><td><span className="chip good">{u.role}</span></td><td>{u.institutionId||'—'}</td><td>{u.assignedRoute?.code||'—'}</td><td>{u.pickupStop?.name||'—'}</td><td>{u.role==='DRIVER'?<input value={draftPhones[u.id]??u.phone??''} onChange={e=>setDraftPhones(p=>({...p,[u.id]:e.target.value}))} placeholder="Driver phone" inputMode="tel"/>:(u.phone||'—')}</td><td>{u.role==='DRIVER'&&<button className="secondary small" onClick={()=>savePhone(u.id)} disabled={savingId===u.id}>{savingId===u.id?'Saving…':'Save'}</button>}</td></tr>)}</tbody></table></div></section>
  </>
}
