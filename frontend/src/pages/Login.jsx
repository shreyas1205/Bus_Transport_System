import {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useAuth} from '../auth';

const roles = [
  {
    key:'ADMIN',
    title:'Admin',
    subtitle:'Operations & system control',
    email:'admin@campusbus.local',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7v5c0 5-3.2 8.3-8 9-4.8-.7-8-4-8-9V7l8-4Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/></svg>
    )
  },
  {
    key:'DRIVER',
    title:'Driver',
    subtitle:'Trips, boarding & live GPS',
    email:'driver1@campusbus.local',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16V8.8c0-.5.3-.9.7-1.1l1.8-.9h9l1.8.9c.4.2.7.6.7 1.1V16"/><path d="M4 16h16v2.2c0 .4-.3.8-.8.8H4.8c-.5 0-.8-.4-.8-.8V16Z"/><path d="M7.5 12h.01M16.5 12h.01"/><path d="M7 6.8 8 4h8l1 2.8"/></svg>
    )
  },
  {
    key:'STUDENT',
    title:'Student',
    subtitle:'Route, pass, fees & ETA',
    email:'student1@campusbus.local',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3.5 9 8.5-4 8.5 4-8.5 4-8.5-4Z"/><path d="M7 11.2v4.2c0 1.5 2.2 2.8 5 2.8s5-1.3 5-2.8v-4.2"/><path d="M20.5 10v5"/></svg>
    )
  },
  {
    key:'PARENT',
    title:'Parent',
    subtitle:'Student travel & safety updates',
    email:'parent1@campusbus.local',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3.8 18.5c.5-3 2.3-4.5 5.2-4.5s4.7 1.5 5.2 4.5"/><path d="M14.6 16.2c.8-.9 1.8-1.4 3.2-1.4 1.8 0 3.1.9 3.4 2.9"/></svg>
    )
  },
];

function ShieldIcon(){
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7v5c0 5-3.2 8.3-8 9-4.8-.7-8-4-8-9V7l8-4Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/></svg>;
}

export default function Login(){
  const [role,setRole]=useState('STUDENT');
  const [email,setEmail]=useState('student1@campusbus.local');
  const [password,setPassword]=useState('Pass@123');
  const [showPassword,setShowPassword]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const {login,logout}=useAuth();
  const navigate=useNavigate();
  const selected=roles.find(x=>x.key===role) || roles[2];

  const chooseRole=(r)=>{
    setRole(r.key);
    setEmail(r.email);
    setPassword('Pass@123');
    setError('');
  };

  const submit=async e=>{
    e.preventDefault();
    setBusy(true); setError('');
    try{
      const user=await login(email,password);
      if(user.role!==role){
        logout();
        throw new Error(`This account does not have ${selected.title} access.`);
      }
      navigate('/');
    }catch(err){
      setError(err.response?.data?.message || err.message || 'Login failed');
    }finally{setBusy(false)}
  };

  return <div className="premium-login-page animated-login-page">
    <div className="premium-login-orb orb-one" />
    <div className="premium-login-orb orb-two" />
    <div className="login-grid-glow" />
    <div className="login-route-lines" aria-hidden="true">
      <span className="route-line line-a" />
      <span className="route-line line-b" />
      <span className="route-node node-a" />
      <span className="route-node node-b" />
      <span className="route-node node-c" />
      <span className="route-bus">🚌</span>
    </div>

    <div className="premium-login-shell">
      <section className="premium-login-brand-panel animated-brand-panel">
        <div>
          <div className="premium-brand-row">
            <div className="premium-brand-mark">CB</div>
            <div>
              <div className="premium-brand-name">CampusBus</div>
              <div className="premium-brand-tag">Smart campus mobility</div>
            </div>
          </div>

          <div className="premium-brand-copy animated-brand-copy">
            <span className="premium-eyebrow">CONNECTED TRANSPORT OPERATIONS</span>
            <h1>Every trip.<br/><em>One trusted platform.</em></h1>
            <p>Manage routes, buses, boarding, live location, safety, fees and student transport from one secure workspace.</p>
          </div>
        </div>

        <div className="premium-feature-stack animated-feature-stack">
          <div className="premium-feature-row"><span className="feature-dot"/><div><strong>Live visibility</strong><span>Bus location and arrival status</span></div></div>
          <div className="premium-feature-row"><span className="feature-dot"/><div><strong>Role-based access</strong><span>Only the right tools for each user</span></div></div>
          <div className="premium-feature-row"><span className="feature-dot"/><div><strong>Built for campus scale</strong><span>Students, drivers, parents and admins</span></div></div>
        </div>
      </section>

      <section className="premium-login-card animated-login-card">
        <div className="premium-login-heading">
          <div className="premium-security-line"><ShieldIcon/><span>SECURE CAMPUS ACCESS</span></div>
          <h2>Sign in to CampusBus</h2>
          <p>Select your account type to continue.</p>
        </div>

        <div className="premium-role-grid animated-role-grid">
          {roles.map(r=><button key={r.key} type="button" className={`premium-role-card animated-role-card ${role===r.key?'selected':''}`} onClick={()=>chooseRole(r)} aria-pressed={role===r.key}>
            <span className="premium-role-icon">{r.icon}</span>
            <span className="premium-role-copy"><strong>{r.title}</strong><small>{r.subtitle}</small></span>
            {role===r.key&&<span className="premium-role-check">✓</span>}
          </button>)}
        </div>

        <div className="premium-selected-access animated-selected-access">
          <div className="premium-selected-icon">{selected.icon}</div>
          <div><span>Signing in as</span><strong>{selected.title}</strong></div>
          <small>Access verified</small>
        </div>

        <form className="premium-login-form animated-form" onSubmit={submit}>
          <label>Email address<input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" placeholder="you@campus.edu" required/></label>
          <label>Password
            <span className="premium-password-wrap">
              <input value={password} onChange={e=>setPassword(e.target.value)} type={showPassword?'text':'password'} autoComplete="current-password" placeholder="Enter your password" required/>
              <button type="button" className="premium-password-toggle" onClick={()=>setShowPassword(v=>!v)}>{showPassword?'Hide':'Show'}</button>
            </span>
          </label>
          {error&&<div className="premium-login-error" role="alert">{error}</div>}
          <button className="premium-login-submit" disabled={busy}><span>{busy?'Signing in…':`Continue as ${selected.title}`}</span><span className="premium-arrow">→</span></button>
        </form>

        <div className="premium-demo-box animated-demo-box">
          <div className="demo-lock"><ShieldIcon/></div>
          <div><strong>Demo environment</strong><span>{selected.email} · Pass@123</span></div>
        </div>

        <div className="premium-footer-note animated-footer-note">CampusBus • Secure transport management</div>
      </section>
    </div>
  </div>;
}
