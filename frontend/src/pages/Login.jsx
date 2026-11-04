import { useEffect, useState } from 'react';
import './Login.css';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Reveal from '../components/Reveal';
import SupportDialog from '../components/SupportDialog';

function BusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="3" width="14" height="16" rx="3" />
      <path d="M7 8h10M8 15h.01M16 15h.01M8 19v2M16 19v2" />
    </svg>
  );
}

function StudentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3.5 9 8.5-4 8.5 4-8.5 4-8.5-4Z" />
      <path d="M7 11.2v4.2c0 1.5 2.2 2.8 5 2.8s5-1.3 5-2.8v-4.2" />
    </svg>
  );
}

function StaffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3.5 19c.5-3.3 2.4-5 5.5-5s5 1.7 5.5 5" />
      <path d="M14.5 16c.8-.8 1.8-1.2 3-1.2 2 0 3.3 1 3.7 3" />
    </svg>
  );
}

function ParentIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="3" />
      <path d="M5 20c.5-4 2.8-6 7-6s6.5 2 7 6" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 20 7v5c0 5-3.2 8.3-8 9-4.8-.7-8-4-8-9V7l8-4Z" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function QrIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
      <path d="M15 15h2v2h-2zM19 15h2M19 19h2v2M15 19v2" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="10" r="2.5" />
      <path d="M3.5 19c.5-3.3 2.4-5 5.5-5s5 1.7 5.5 5" />
      <path d="M14.5 16c.8-.8 1.8-1.2 3-1.2 2 0 3.3 1 3.7 3" />
    </svg>
  );
}

function LeafIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M20 4C12 4 6 7 5 14c4-2 8-3 12-3" />
      <path d="M5 20c1-5 4-8 9-10" />
    </svg>
  );
}

function EyeIcon({ open }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
        <path d="M9.9 4.3A10.6 10.6 0 0 1 12 4c5.5 0 9 6 9 6a16 16 0 0 1-2.3 3.1" />
        <path d="M6.6 6.6C4.3 8.1 3 10 3 10s3.5 6 9 6a9.8 9.8 0 0 0 3-.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

const roles = [
  {
    key: 'STUDENT',
    title: 'Student',
    icon: <StudentIcon />,
  },
  {
    key: 'DRIVER',
    title: 'Driver',
    icon: <BusIcon />,
  },
  {
    key: 'STAFF',
    title: 'Staff',
    icon: <StaffIcon />,
  },
  {
    key: 'PARENT',
    title: 'Parent',
    icon: <ParentIcon />,
  },
  {
    key: 'ADMIN',
    title: 'Admin',
    icon: <ShieldIcon />,
  },
];

const homeByRole = {
  ADMIN: '/',
  DRIVER: '/routes',
  STUDENT: '/live-location',
  PARENT: '/',
  STAFF: '/fees',
};

const features = [
  {
    title: 'Live Tracking',
    text: 'Know where your bus is in real time',
    icon: <LocationIcon />,
    tone: 'blue',
  },
  {
    title: 'Smart Boarding',
    text: 'Quick & secure QR check-in',
    icon: <QrIcon />,
    tone: 'blue',
  },
  {
    title: 'Instant Alerts',
    text: 'Get boarding, delay & route updates',
    icon: <BellIcon />,
    tone: 'orange',
  },
  {
    title: 'Safety & SOS',
    text: 'Emergency assistance at your fingertips',
    icon: <ShieldIcon />,
    tone: 'red',
  },
  {
    title: 'For Everyone',
    text: 'Students, Parents, Staff and Admins',
    icon: <UsersIcon />,
    tone: 'cyan',
  },
  {
    title: 'Greener Campus',
    text: 'Efficient routes for a cleaner tomorrow',
    icon: <LeafIcon />,
    tone: 'green',
  },
];

export default function Login() {
  const [supportOpen, setSupportOpen] = useState(false);
  const [role, setRole] = useState('STUDENT');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const { login, logout } = useAuth();
  const navigate = useNavigate();

  const selected =
    roles.find((item) => item.key === role) || roles[0];

  const chooseRole = (item) => {
    if (busy) return;

    setRole(item.key);
    setEmail('');
    setPassword('');
    setShowPassword(false);
    setError('');
  };

  const submit = async (event) => {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError('');

    try {
      const user = await login(email.trim(), password, remember);

      if (user.role !== role) {
        logout();

        throw new Error(
          `This account does not have ${selected.title} access.`
        );
      }

      if (remember) {
        localStorage.setItem('campusbus_last_role', user.role);
      } else {
        localStorage.removeItem('campusbus_last_role');
      }

      navigate(homeByRole[user.role] || '/profile', {
        replace: true,
      });
    } catch (err) {
      setError(
        err.response?.data?.message ||
          err.message ||
          'Login failed. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ng-login">
      <LoginBackdrop />
      {supportOpen && <SupportDialog onClose={() => setSupportOpen(false)} />}

      <header className="ng-top">
        <div className="ng-logo">
          <div className="ng-logo-icon"><BusIcon /></div>
          <div>
            <strong>Navi<span>Guard</span></strong>
            <small>Smart Campus Transport & Safety System</small>
          </div>
        </div>
        <div className="ng-support">
          <span>Need help?</span>
          <button type="button" className="secondary small" onClick={() => setSupportOpen(true)}>Contact support</button>
        </div>
      </header>

      <main className="ng-layout">
        <section className="ng-hero" id="home">
          <Reveal className="ng-hero-copy" direction="up">
            <div className="ng-kicker">SAFE&nbsp;&nbsp;•&nbsp;&nbsp;SMART&nbsp;&nbsp;•&nbsp;&nbsp;CONNECTED</div>
            <h1>Safe Rides.<br /><span>Brighter Futures.</span></h1>
            <p>Real-time tracking, smart boarding, and a safer journey for every student. One connected campus.</p>
          </Reveal>

          <div className="ng-features" id="features">
            {features.map((feature, index) => (
              <Reveal as="article" className={`ng-feature ${feature.tone}`} key={feature.title} delay={100 + index * 80} direction="up">
                <div className="ng-feature-icon">{feature.icon}</div>
                <strong>{feature.title}</strong>
                <p>{feature.text}</p>
                <span className="ng-feature-arrow">→</span>
              </Reveal>
            ))}
          </div>

          <Reveal as="blockquote" className="ng-quote" delay={220} direction="left">
            <span />
            <div>
              <p>“More than transport,<br />a safer campus community.”</p>
              <small>— NAVIGUARD TRANSPORT</small>
            </div>
          </Reveal>
        </section>

        <section className="ng-auth-wrap">
          <div className="ng-card" data-login-card>
            <div className="ng-auth-heading">
              <h2>Welcome <span>Back</span> 👋</h2>
              <p>Sign in to your NaviGuard account</p>
            </div>

            <div className="ng-role-label">Choose your role</div>
            <div className="ng-role-grid">
              {roles.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={role === item.key ? 'ng-role selected' : 'ng-role'}
                  aria-pressed={role === item.key}
                  onClick={() => chooseRole(item)}
                  disabled={busy}
                >
                  <span>{item.icon}</span>
                  <strong>{item.title}</strong>
                </button>
              ))}
            </div>

            <form className="ng-form" onSubmit={submit}>
              <div className="ng-field">
                <input
                  id="ng-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder=" "
                  autoComplete="username"
                  disabled={busy}
                  required
                />
                <label htmlFor="ng-email">Your college email</label>
              </div>

              <div className="ng-field">
                <input
                  id="ng-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder=" "
                  autoComplete="current-password"
                  disabled={busy}
                  required
                />
                <label htmlFor="ng-password">Enter your password</label>
                <button
                  type="button"
                  className="ng-eye"
                  onClick={() => setShowPassword((value) => !value)}
                  disabled={busy}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>

              <div className="ng-form-row">
                <label className="ng-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) => setRemember(event.target.checked)}
                    disabled={busy}
                  />
                  <span>Remember me</span>
                </label>
                <Link to="/forgot-password" onClick={(event) => { if (busy) event.preventDefault(); }}>
                  Forgot Password?
                </Link>
                <Link to="/signup">Create an account</Link>
              </div>

              {error && <div className="ng-error" role="alert">{error}</div>}

              <button type="submit" className="ng-signin" disabled={busy}>
                {busy ? (<><span className="ng-spinner" />Signing In...</>) : (<>Sign In<span className="ng-arrow">→</span></>)}
              </button>
            </form>

            <div className="ng-security">
              <ShieldIcon />
              <span>Your data is secure and protected</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// Full-page real bus photo. Hovering (or press-and-hold on touch) the bus
// pushes the camera in and lights the headlights. Purely visual.
const PHOTO = { w: 1586, h: 992, bus: [0.255, 0.585, 0.6, 0.897], lights: [[0.482, 0.815], [0.588, 0.815]], oldCard: [0.612, 0.203, 0.968, 0.905] };

function LoginBackdrop() {
  const [driving, setDriving] = useState(false);
  const [geo, setGeo] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const place = () => {
      const W = window.innerWidth, H = window.innerHeight, mobile = W <= 900, px = mobile ? 0.42 : 0.5;
      const sc = Math.max(W / PHOTO.w, H / PHOTO.h), dw = PHOTO.w * sc, dh = PHOTO.h * sc;
      const ox = (W - dw) * px, oy = (H - dh) / 2;
      const X = (f) => ox + f * dw, Y = (f) => oy + f * dh;
      setGeo({ mobile, px, X, Y, dw, dh });
      // Desktop: the sign-in card sits exactly over the area removed from the photo.
      const card = document.querySelector('[data-login-card]');
      if (card) {
        if (mobile) card.removeAttribute('style');
        else {
          // Card fits its content and is centred on the area removed from the photo,
          // kept inside the viewport when the photo is cropped at the sides.
          const width = Math.min(520, (PHOTO.oldCard[2] - PHOTO.oldCard[0]) * dw);
          const left = Math.min(X(PHOTO.oldCard[0]), W - width - 16);
          Object.assign(card.style, { position: 'fixed', left: `${left}px`, width: `${width}px`, minHeight: '' });
          // Line the card's top up with the hero's "SAFE • SMART • CONNECTED" line.
          const kicker = document.querySelector('.ng-kicker');
          const heroTop = kicker ? kicker.getBoundingClientRect().top + window.scrollY : (Y(PHOTO.oldCard[1]) + Y(PHOTO.oldCard[3])) / 2 - card.offsetHeight / 2;
          const top = Math.min(Math.max(96, heroTop), Math.max(96, H - card.offsetHeight - 24));
          card.style.top = `${top}px`;
          // A fixed card cannot be scrolled to, so if it would overlap the hero or run
          // past the bottom edge, fall back to the stacked (mobile) flow layout.
          const heroRight = document.querySelector('.ng-hero')?.getBoundingClientRect().right ?? 0;
          if (left < heroRight + 24 || top + card.offsetHeight > H - 8) card.removeAttribute('style');
        }
      }
    };
    place();
    const settle = window.setTimeout(place, 900);
    window.addEventListener('resize', place);
    const up = () => setDriving(false);
    window.addEventListener('pointerup', up);
    return () => { window.clearTimeout(settle); window.removeEventListener('resize', place); window.removeEventListener('pointerup', up); };
  }, []);

  const [x0, y0, x1, y1] = PHOTO.bus;
  return (
    <>
      <div className={driving ? 'ng-photo driving' : 'ng-photo'} aria-hidden="true">
        <div
          className="ng-photo-img"
          style={geo ? { backgroundPosition: `${geo.px * 100}% 50%`, transformOrigin: `${geo.X(0.535)}px ${geo.Y(0.79)}px` } : undefined}
        />
        {geo && PHOTO.lights.map(([lx, ly]) => (
          <span key={lx} className="ng-headlight" style={{ left: geo.X(lx), top: geo.Y(ly), width: 0.09 * geo.dw, height: 0.05 * geo.dw }} />
        ))}
        <div className="ng-photo-shade" />
      </div>
      {geo && (
        <>
          <div
            className="ng-bus-spot"
            role="button"
            tabIndex={0}
            aria-label="Bus: hover to drive"
            style={{ left: geo.X(x0), top: geo.Y(y0), width: (x1 - x0) * geo.dw, height: (y1 - y0) * geo.dh }}
            onPointerEnter={() => setDriving(true)}
            onPointerLeave={() => setDriving(false)}
            onPointerDown={(e) => { if (e.pointerType !== 'mouse') setDriving(true); }}
            onFocus={() => setDriving(true)}
            onBlur={() => setDriving(false)}
          />
          {!geo.mobile && (
            <span className={driving ? 'ng-bus-hint gone' : 'ng-bus-hint'} style={{ left: geo.X((x0 + x1) / 2), top: Math.min(window.innerHeight - 44, geo.Y(y1) + 8) }}>
              Hover the bus
            </span>
          )}
        </>
      )}
    </>
  );
}
