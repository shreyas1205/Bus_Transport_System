import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import Reveal from '../components/Reveal';

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
    email: 'student1@campusbus.local',
    icon: <StudentIcon />,
  },
  {
    key: 'DRIVER',
    title: 'Driver',
    email: 'driver1@campusbus.local',
    icon: <BusIcon />,
  },
  {
    key: 'STAFF',
    title: 'Staff',
    email: '',
    icon: <StaffIcon />,
  },
  {
    key: 'PARENT',
    title: 'Parent',
    email: 'parent1@campusbus.local',
    icon: <ParentIcon />,
  },
  {
    key: 'ADMIN',
    title: 'Admin',
    email: 'admin@campusbus.local',
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
  const [role, setRole] = useState('STUDENT');
  const [email, setEmail] = useState('student1@campusbus.local');
  const [password, setPassword] = useState('Pass@123');
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
    setEmail(item.email);
    setPassword(item.email ? 'Pass@123' : '');
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
    <div className="ref-login-page">

      <div className="ref-login-overlay" />

      <header className="ref-topbar">
        <div className="ref-logo">
          <div className="ref-logo-icon">
            <BusIcon />
          </div>

          <div>
            <strong>
              Navi<span>Guard</span>
            </strong>
            <small>Smart Campus Transport & Safety System</small>
          </div>
        </div>

        <div className="ref-support">
          <span>Need help?</span>
          <span className="ref-support-text">Contact Support</span>
        </div>
      </header>

      <main className="ref-login-layout">

        {/* LEFT */}
        <section className="ref-hero" id="home">
          <Reveal className="ref-hero-copy" direction="up">
            <div className="ref-kicker">
              SAFE&nbsp;&nbsp;•&nbsp;&nbsp;SMART&nbsp;&nbsp;•&nbsp;&nbsp;CONNECTED
            </div>

            <h1>
              Safe Rides.
              <br />
              <span>Brighter Futures.</span>
            </h1>

            <p>
              Real-time tracking, smart boarding, and a safer
              journey for every student. One connected campus.
            </p>
          </Reveal>

          <div className="ref-features" id="features">
            {features.map((feature, index) => (
              <Reveal
                as="article"
                className={`ref-feature ${feature.tone}`}
                key={feature.title}
                delay={100 + index * 80}
                direction="up"
              >
                <div className="ref-feature-icon">
                  {feature.icon}
                </div>

                <strong>{feature.title}</strong>
                <p>{feature.text}</p>

                <span className="ref-feature-arrow">→</span>
              </Reveal>
            ))}
          </div>

          <Reveal as="blockquote" className="ref-quote" delay={220} direction="left">
            <span />
            <div>
              <p>
                “More than transport,
                <br />
                a safer campus community.”
              </p>

              <small>— NAVIGUARD TRANSPORT</small>
            </div>
          </Reveal>
        </section>

        {/* RIGHT */}
        <section className="ref-auth-wrap">
          <Reveal className="ref-auth-card" delay={120} direction="right">

            <div className="ref-auth-heading">
              <h2>
                Welcome <span>Back</span> 👋
              </h2>

              <p>Sign in to your NaviGuard account</p>
            </div>

            <div className="ref-role-label">
              Choose your role
            </div>

            <div className="ref-role-grid">
              {roles.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={
                    role === item.key
                      ? 'ref-role selected'
                      : 'ref-role'
                  }
                  onClick={() => chooseRole(item)}
                  disabled={busy}
                >
                  <span>{item.icon}</span>
                  <strong>{item.title}</strong>
                </button>
              ))}
            </div>

            <form
              className="ref-auth-form"
              onSubmit={submit}
            >
              <label>
                Email Address

                <div className="ref-input">
                  <span className="ref-input-symbol">@</span>

                  <input
                    type="email"
                    value={email}
                    onChange={(event) =>
                      setEmail(event.target.value)
                    }
                    placeholder="yourname@campusbus.local"
                    autoComplete="username"
                    disabled={busy}
                    required
                  />
                </div>
              </label>

              <label>
                Password

                <div className="ref-input">
                  <span className="ref-input-symbol">▣</span>

                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) =>
                      setPassword(event.target.value)
                    }
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    disabled={busy}
                    required
                  />

                  <button
                    type="button"
                    className="ref-show-password"
                    onClick={() =>
                      setShowPassword((value) => !value)
                    }
                    disabled={busy}
                    aria-label={
                      showPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                    title={
                      showPassword
                        ? 'Hide password'
                        : 'Show password'
                    }
                    aria-pressed={showPassword}
                  >
                    <EyeIcon open={showPassword} />
                  </button>
                </div>
              </label>

              <div className="ref-form-row">
                <label className="ref-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(event) =>
                      setRemember(event.target.checked)
                    }
                    disabled={busy}
                  />

                  <span>Remember me</span>
                </label>

                <Link
                  to="/forgot-password"
                  onClick={(event) => {
                    if (busy) event.preventDefault();
                  }}
                >
                  Forgot Password?
                </Link>
              </div>

              {error && (
                <div className="ref-error" role="alert">
                  {error}
                </div>
              )}

              <button
                type="submit"
                className="ref-signin"
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="ref-spinner" />
                    Signing In...
                  </>
                ) : (
                  <>
                    Sign In
                    <span>→</span>
                  </>
                )}
              </button>
            </form>

            <div className="ref-security">
              <ShieldIcon />
              <span>Your data is secure and protected</span>
            </div>
          </Reveal>
        </section>

      </main>
    </div>
  );
}