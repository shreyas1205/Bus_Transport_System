import PageBoundary from './PageBoundary';
import {
  NavLink,
  Outlet,
  useNavigate,
  useLocation
} from 'react-router-dom';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import { useAuth } from '../auth';
import { api } from '../api';
import { io } from 'socket.io-client';
import { flushOfflineQueue, getOfflineQueueCount } from '../offlineQueue';

const nav = [
  [
    '/',
    'Dashboard',
    '\u25C6',
    ['ADMIN', 'PARENT']
  ],

  [
    '/analytics',
    'Analytics',
    '\u25A6',
    ['ADMIN']
  ],

  [
    '/routes',
    'Routes & ETA',
    '\u2197',
    [
      'ADMIN',
      'DRIVER',
      'STUDENT',
      'PARENT'
    ]
  ],

  [
    '/live-location',
    'Live Tracking',
    '\u2316',
    [
      'ADMIN',
      'DRIVER',
      'STUDENT',
      'PARENT'
    ]
  ],

  [
    '/complaints',
    'Complaints',
    '\u26A0',
    [
      'ADMIN',
      'STUDENT',
      'PARENT'
    ]
  ],

  [
    '/transport-selection',
    'My Route',
    '\u25B7',
    ['STUDENT']
  ],

  [
    '/boarding',
    'Boarding',
    '\u2713',
    [
      'ADMIN',
      'DRIVER'
    ]
  ],

  [
    '/boarding-status',
    'Boarding Status',
    '\u2713',
    [
      'STUDENT',
      'PARENT'
    ]
  ],

  [
    '/notifications',
    'Notifications',
    '\uD83D\uDD14',
    ['PARENT']
  ],

  [
    '/fees',
    'Fees',
    '\u20B9',
    [
      'STUDENT',
      'STAFF',
      'PARENT'
    ]
  ],

  [
    '/passes',
    'Bus Pass',
    '\u25A3',
    [
      'STUDENT',
      'STAFF'
    ]
  ],

  [
    '/maintenance',
    'Maintenance',
    '\u2699',
    [
      'ADMIN',
      'DRIVER'
    ]
  ],

  [
    '/sos',
    'Incidents / SOS',
    '!',
    [
      'ADMIN',
      'DRIVER'
    ]
  ],

  [
    '/profile',
    'Profile',
    '\u25CE',
    [
      'ADMIN',
      'DRIVER',
      'STUDENT',
      'STAFF',
      'PARENT'
    ]
  ],

  [
    '/users',
    'Users & Accounts',
    '\u25C9',
    ['ADMIN']
  ],

  [
    '/fleet',
    'Buses & Fleet',
    '\u25A4',
    ['ADMIN']
  ],

  [
    '/fees/settings',
    'Fee Settings',
    '\u20B9',
    ['ADMIN']
  ]
];

// ======================================================
// BUS ARRIVAL NOTIFICATION
// ======================================================

function ArrivalNotificationManager({
  user
}) {
  const [
    notice,
    setNotice
  ] = useState('');

  useEffect(() => {
    if (
      !user ||
      ![
        'STUDENT',
        'STAFF',
        'PARENT'
      ].includes(user.role)
    ) {
      return undefined;
    }

    if (
      user.role !== 'PARENT' &&
      (!user.assignedRouteId ||
        !user.pickupStopId)
    ) {
      return undefined;
    }

    let cancelled =
      false;

    const check =
      async () => {
        try {
          const response =
            await api.get(
              '/routes'
            );

          let routeId =
            user.assignedRouteId;

          let pickupStopId =
            user.pickupStopId;

          // Parent accounts store the assignment on the
          // linked student, not on the parent user itself.
          if (user.role === 'PARENT') {
            const liveResponse =
              await api.get(
                '/live-location'
              );

            routeId =
              response.data?.[0]?.id ||
              null;

            pickupStopId =
              liveResponse.data
                ?.journey
                ?.pickupStop
                ?.id ||
              null;
          }

          if (
            cancelled ||
            !routeId ||
            !pickupStopId
          ) {
            return;
          }

          const route =
            response.data.find(
              item =>
                item.id ===
                routeId
            );

          const eta =
            route?.eta?.find(
              item =>
                item.stopId ===
                pickupStopId
            );

          const stop =
            route?.stops?.find(
              item =>
                item.stopId ===
                pickupStopId
            )?.stop;

          const mins =
            eta?.etaMinutes;

          if (
            mins == null ||
            mins > 10 ||
            mins < 1
          ) {
            return;
          }

          const busId =
            route.assignedBusId ||
            'unknown-bus';

          const today =
            new Date()
              .toISOString()
              .slice(
                0,
                10
              );

          const key =
            `campusbus-arrival:${today}:${busId}:${pickupStopId}`;

          if (
            localStorage.getItem(
              key
            )
          ) {
            return;
          }

          const busLabel =
            route
              .assignedBus
              ?.busNumber
              ? `Bus ${route.assignedBus.busNumber}`
              : route
                  ?.assignedBus
                  ?.registrationNo ||
                'Your bus';

          const message =
            `${busLabel} is expected at ${stop?.name || 'your pickup point'} in about ${mins} minute${mins === 1 ? '' : 's'}.`;

          localStorage.setItem(
            key,
            '1'
          );

          setNotice(
            message
          );

          if (
            'Notification' in
              window &&
            Notification.permission ===
              'granted'
          ) {
            new Notification(
              'Bus arriving soon',
              {
                body:
                  message,

                tag:
                  key
              }
            );
          }

          setTimeout(
            () =>
              setNotice(''),
            12000
          );
        } catch {
          // Do not interrupt the app
          // when ETA data is unavailable.
        }
      };

    check();

    const interval =
      setInterval(
        check,
        30000
      );

    const socket =
      io(
        import.meta.env
          .VITE_SOCKET_URL ||
          'http://localhost:4000'
      );

    socket.on(
      'vehicle:location',
      check
    );

    return () => {
      cancelled =
        true;

      clearInterval(
        interval
      );

      socket.off(
        'vehicle:location',
        check
      );

      socket.disconnect();
    };
  }, [
    user?.assignedRouteId,
    user?.pickupStopId,
    user?.role
  ]);

  if (!notice) {
    return null;
  }

  return (
    <div className="alert-banner">
      {'\uD83D\uDD14'} {notice}
    </div>
  );
}

// ======================================================
// LAYOUT
// ======================================================

export default function Layout() {
  const {
    user,
    logout
  } = useAuth();

  const navigate =
    useNavigate();
  const location = useLocation();

  const [
    query,
    setQuery
  ] = useState('');

  const [
    mobileNav,
    setMobileNav
  ] = useState(false);
  const [compactNav, setCompactNav] = useState(() => window.matchMedia('(max-width: 980px)').matches);
  const sidebarRef = useRef(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 980px)');
    const update = () => setCompactNav(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!mobileNav || !compactNav) return;
    const previous = document.activeElement;
    sidebarRef.current?.querySelector('a')?.focus();
    const onKey = event => {
      if (event.key === 'Escape') setMobileNav(false);
      if (event.key !== 'Tab') return;
      const items = sidebarRef.current?.querySelectorAll('a, button:not(:disabled)');
      if (!items?.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus?.(); };
  }, [mobileNav, compactNav]);

  const [
    notificationOpen,
    setNotificationOpen
  ] = useState(false);

  const [
    notifications,
    setNotifications
  ] = useState([]);

  const [
    unread,
    setUnread
  ] = useState(0);

  const [
    announceOpen,
    setAnnounceOpen
  ] = useState(false);

  const [
    announcement,
    setAnnouncement
  ] = useState({
    title: '',
    message: '',
    roles: [
      'STUDENT',
      'PARENT'
    ]
  });

  const [
    announceNotice,
    setAnnounceNotice
  ] = useState('');

  const [
    accidentAlert,
    setAccidentAlert
  ] = useState(null);

  const [
    accidentMuted,
    setAccidentMuted
  ] = useState(false);

  const [
    accidentBusy,
    setAccidentBusy
  ] = useState(false);

  const [
    accidentCountdown,
    setAccidentCountdown
  ] = useState(null);

  const [
    offlineQueueCount,
    setOfflineQueueCount
  ] = useState(() => getOfflineQueueCount(user?.id));

  const [
    online,
    setOnline
  ] = useState(() => navigator.onLine);

  const confirmedAccidentIds = useRef(new Set());
  const audioContextRef = useRef(null);
  const alarmTimerRef = useRef(null);

  useEffect(() => {
    const refreshQueueCount = event => {
      setOfflineQueueCount(getOfflineQueueCount(user?.id));
    };

    const onOffline = () => setOnline(false);
    const onOnline = async () => {
      setOnline(true);
      await flushOfflineQueue(api, user?.id);
      setOfflineQueueCount(getOfflineQueueCount(user?.id));
    };

    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('campusbus:offline-queue', refreshQueueCount);

    if (navigator.onLine) {
      flushOfflineQueue(api, user?.id).finally(() =>
        setOfflineQueueCount(getOfflineQueueCount())
      );
    }

    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('campusbus:offline-queue', refreshQueueCount);
    };
  }, [user?.id]);

  const stopAccidentAlarm = useCallback(() => {
    if (alarmTimerRef.current) {
      clearInterval(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
  }, []);

  const playAlarmBurst = useCallback(() => {
    if (accidentMuted) {
      return;
    }

    const AudioContextClass =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    const context = audioContextRef.current;

    if (context.state === 'suspended') {
      context.resume().catch(() => {});
    }

    const beep = delay => {
      const start = context.currentTime + delay;
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(880, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.22, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.19);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.21);
    };

    beep(0);
    beep(0.28);
    beep(0.56);
  }, [accidentMuted]);

  const startAccidentAlarm = useCallback(() => {
    stopAccidentAlarm();

    if (accidentMuted) {
      return;
    }

    playAlarmBurst();
    alarmTimerRef.current = setInterval(
      playAlarmBurst,
      1700
    );
  }, [
    accidentMuted,
    playAlarmBurst,
    stopAccidentAlarm
  ]);

  useEffect(() => {
    if (user?.role !== 'DRIVER') {
      return undefined;
    }

    const unlockAudio = () => {
      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      audioContextRef.current.resume().catch(() => {});
    };

    window.addEventListener('pointerdown', unlockAudio, { once: true });
    window.addEventListener('keydown', unlockAudio, { once: true });

    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== 'DRIVER') {
      return undefined;
    }

    const socket = io(
      import.meta.env.VITE_SOCKET_URL || 'http://localhost:4000'
    );

    const belongsToDriver = incident =>
      !incident?.driverId || incident.driverId === user.id;

    const onPossible = incident => {
      if (!belongsToDriver(incident)) {
        return;
      }

      setAccidentMuted(false);
      setAccidentAlert({
        phase: 'POSSIBLE',
        incident
      });
    };

    const onConfirmed = incident => {
      if (!belongsToDriver(incident)) {
        return;
      }

      if (confirmedAccidentIds.current.has(incident.id)) return;
      confirmedAccidentIds.current.add(incident.id);
      setAccidentMuted(false);
      setAccidentAlert({
        phase: 'CONFIRMED',
        incident
      });
    };

    const onFalseAlarm = incident => {
      setAccidentAlert(current =>
        current?.incident?.id === incident?.id
          ? null
          : current
      );
    };

    const onDriverUnresponsive = incident => {
      if (!belongsToDriver(incident)) return;
      setAccidentAlert({ phase: 'POSSIBLE', incident });
    };

    socket.on('accident:possible', onPossible);
    socket.on('accident:confirmed', onConfirmed);
    socket.on('accident:false-alarm', onFalseAlarm);
    socket.on('accident:driver-unresponsive', onDriverUnresponsive);

    return () => {
      socket.off('accident:possible', onPossible);
      socket.off('accident:confirmed', onConfirmed);
      socket.off('accident:false-alarm', onFalseAlarm);
      socket.off('accident:driver-unresponsive', onDriverUnresponsive);
      socket.disconnect();
      stopAccidentAlarm();
    };
  }, [
    user?.id,
    user?.role,
    stopAccidentAlarm
  ]);

  useEffect(() => {
    if (accidentAlert && !accidentMuted) {
      startAccidentAlarm();
    } else {
      stopAccidentAlarm();
    }

    return stopAccidentAlarm;
  }, [
    accidentAlert,
    accidentMuted,
    startAccidentAlarm,
    stopAccidentAlarm
  ]);

  useEffect(() => {
    if (
      accidentAlert?.phase !== 'POSSIBLE' ||
      !accidentAlert?.incident?.verificationDeadline
    ) {
      setAccidentCountdown(null);
      return undefined;
    }

    const updateCountdown = () => {
      const seconds = Math.max(
        0,
        Math.ceil(
          (new Date(accidentAlert.incident.verificationDeadline).getTime() - Date.now()) / 1000
        )
      );
      setAccidentCountdown(seconds);
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 250);
    return () => clearInterval(timer);
  }, [
    accidentAlert?.phase,
    accidentAlert?.incident?.verificationDeadline
  ]);

  async function respondToAccident(response) {
    const incidentId = accidentAlert?.incident?.id;

    if (!incidentId || user?.role !== 'DRIVER') {
      return;
    }

    try {
      setAccidentBusy(true);

      const result = await api.patch(
        `/incidents/${incidentId}/driver-response`,
        { response }
      );

      if (response === 'SAFE') {
        setAccidentAlert(null);
        stopAccidentAlarm();
      } else if (result.data?.incident) {
        setAccidentAlert({
          phase: 'CONFIRMED',
          incident: result.data.incident
        });
      }
    } catch (error) {
      console.error('ACCIDENT RESPONSE ERROR:', error);
    } finally {
      setAccidentBusy(false);
    }
  }

  function acknowledgeAccidentAlert() {
    setAccidentAlert(null);
    stopAccidentAlarm();
  }

  // ====================================================
  // NOTIFICATIONS
  // ====================================================

  const loadNotifications =
    useCallback(
      async () => {
        if (!user?.id) {
          setNotifications(
            []
          );

          setUnread(0);

          return;
        }

        try {
          const response =
            await api.get(
              '/notifications'
            );

          setNotifications(
            response.data
              ?.notifications ||
              []
          );

          setUnread(
            response.data
              ?.unreadCount ??
              response.data
                ?.unread ??
              0
          );
        } catch (error) {
          console.error(
            'NOTIFICATION LOAD ERROR:',
            error
          );
        }
      },
      [user?.id]
    );

  useEffect(() => {
    if (!user?.id) {
      return undefined;
    }

    loadNotifications();

    const timer =
      setInterval(
        loadNotifications,
        30000
      );

    const socket =
      io(
        import.meta.env
          .VITE_SOCKET_URL ||
          'http://localhost:4000'
      );

    const handleNotification =
      payload => {
        if (!payload) {
          loadNotifications();
          return;
        }

        if (
          payload.userId &&
          payload.userId !==
            user.id
        ) {
          return;
        }

        if (
          Array.isArray(
            payload.userIds
          ) &&
          !payload.userIds.includes(
            user.id
          )
        ) {
          return;
        }

        loadNotifications();
      };

    socket.on(
      'notification:update',
      handleNotification
    );

    socket.on(
      'notification:new',
      handleNotification
    );

    socket.on(
      'complaint:update',
      loadNotifications
    );

    socket.on(
      'fleet:breakdown',
      loadNotifications
    );

    return () => {
      clearInterval(
        timer
      );

      socket.off(
        'notification:update',
        handleNotification
      );

      socket.off(
        'notification:new',
        handleNotification
      );

      socket.off(
        'complaint:update',
        loadNotifications
      );

      socket.off(
        'fleet:breakdown',
        loadNotifications
      );

      socket.disconnect();
    };
  }, [
    user?.id,
    loadNotifications
  ]);

  async function markRead(
    id
  ) {
    try {
      await api.patch(
        `/notifications/${id}/read`
      );

      await loadNotifications();
    } catch (error) {
      console.error(
        'MARK NOTIFICATION READ ERROR:',
        error
      );
    }
  }

  async function markAll() {
    try {
      await api.patch(
        '/notifications/read-all'
      );

      await loadNotifications();
    } catch (error) {
      console.error(
        'MARK ALL READ ERROR:',
        error
      );
    }
  }

  // ====================================================
  // ADMIN ANNOUNCEMENT
  // ====================================================

  function toggleRole(
    role
  ) {
    setAnnouncement(
      current => ({
        ...current,

        roles:
          current.roles.includes(
            role
          )
            ? current.roles.filter(
                item =>
                  item !==
                  role
              )
            : [
                ...current.roles,
                role
              ]
      })
    );
  }

  async function sendAnnouncement(
    event
  ) {
    event.preventDefault();

    try {
      const response =
        await api.post(
          '/notifications/announcements',
          announcement
        );

      setAnnounceNotice(
        response.data
          ?.message ||
          'Announcement sent.'
      );

      setAnnouncement({
        title: '',
        message: '',
        roles: [
          'STUDENT',
          'PARENT'
        ]
      });

      setTimeout(
        () =>
          setAnnounceNotice(
            ''
          ),
        3000
      );
    } catch (error) {
      setAnnounceNotice(
        error.response?.data
          ?.message ||
          'Could not send announcement.'
      );
    }
  }

  // ====================================================
  // NAVIGATION
  // ====================================================

  const allowedNav =
    useMemo(
      () =>
        Array.from(
          new Map(
            nav
              .filter(item =>
                item[3].includes(
                  user?.role
                )
              )
              .map(item => [
                item[0],
                item
              ])
          ).values()
        ),
      [user?.role]
    );

  const matches =
    query.trim()
      ? allowedNav
          .filter(item =>
            item[1]
              .toLowerCase()
              .includes(
                query
                  .trim()
                  .toLowerCase()
              )
          )
          .slice(
            0,
            6
          )
      : [];

  function goTo(
    path
  ) {
    setQuery('');
    setMobileNav(false);
    setNotificationOpen(
      false
    );

    navigate(
      path
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>

      {/* ============================================== */}
      {/* SIDEBAR */}
      {/* ============================================== */}

      <aside
        ref={sidebarRef}
        inert={compactNav && !mobileNav}
        aria-hidden={compactNav && !mobileNav ? true : undefined}
        className={
          `sidebar ${mobileNav ? 'open' : ''}`
        }
      >
        <div className="brand">
          <div className="brand-mark">
            NG
          </div>

          <div>
            <b>
              NaviGuard
            </b>

            <span>
              Smart Transport & Safety
            </span>
          </div>
        </div>

        <div className="role-pill">
          <span className="role-dot" />

          {user?.role?.replaceAll(
            '_',
            ' '
          )}
        </div>

        <div className="sidebar-label">
          MAIN MENU
        </div>

        <nav id="primary-navigation" aria-label="Main navigation">
          {allowedNav.map(
            item => {
              const isNotification =
                item[0] ===
                '/notifications';

              return (
                <NavLink
                  key={
                    item[0]
                  }
                  to={
                    item[0]
                  }
                  end={
                    item[0] ===
                    '/'
                  }
                  onClick={() =>
                    setMobileNav(
                      false
                    )
                  }
                  className={({
                    isActive
                  }) =>
                    isActive
                      ? 'nav-item active'
                      : 'nav-item'
                  }
                >
                  <span className="nav-icon">
                    {item[2]}
                  </span>

                  <span>
                    {item[1]}
                  </span>

                  {isNotification &&
                    unread > 0 && (
                      <span
                        style={{
                          marginLeft:
                            'auto',

                          minWidth:
                            '22px',

                          height:
                            '22px',

                          padding:
                            '0 6px',

                          display:
                            'inline-flex',

                          alignItems:
                            'center',

                          justifyContent:
                            'center',

                          borderRadius:
                            '999px',

                          background:
                            '#dc2626',

                          color:
                            '#fff',

                          fontSize:
                            '11px',

                          fontWeight:
                            800
                        }}
                      >
                        {unread > 9
                          ? '9+'
                          : unread}
                      </span>
                    )}
                </NavLink>
              );
            }
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-user-mini">
            <span className="avatar">
              {user?.name?.[0] ||
                'U'}
            </span>

            <div>
              <b>
                {user?.name ||
                  'User'}
              </b>

              <small>
                {user?.email}
              </small>
            </div>
          </div>

          <button
            className="logout"
            onClick={() => {
              logout();

              navigate(
                '/login'
              );
            }}
          >
            {'\u21AA'}

            <span>
              Sign out
            </span>
          </button>
        </div>
      </aside>

      {mobileNav && (
        <button
          className="sidebar-scrim"
          aria-label="Close menu"
          onClick={() =>
            setMobileNav(
              false
            )
          }
        />
      )}

      {/* ============================================== */}
      {/* MAIN */}
      {/* ============================================== */}

      <main className="main">

        {accidentAlert && (
          <div className="driver-accident-strip">
            <span className="driver-accident-strip-pulse" />
            <b>EMERGENCY ALERT</b>
            <span>
              {accidentAlert.phase === 'CONFIRMED'
                ? 'Autonomous emergency response is active.'
                : 'Possible accident detected. Immediate attention required.'}
            </span>
          </div>
        )}

        {/* HEADER */}

        <header className="app-header">
          <button
            className="menu-toggle"
            onClick={() =>
              setMobileNav(
                value =>
                  !value
              )
            }
            aria-label="Toggle navigation"
            aria-expanded={mobileNav}
            aria-controls="primary-navigation"
          >
            {'\u2630'}
          </button>

          <div className="header-copy">
            <div className="eyebrow">
              CAMPUS TRANSPORT
              CONTROL CENTER
            </div>

            <h1>
              Good to see you,{' '}
              {user?.name
                ?.split(' ')[0] ||
                'there'}
            </h1>
          </div>

          {/* SEARCH */}

          <div className="global-search-wrap">
            <span className="search-icon">
              {'\u2315'}
            </span>

            <input
              value={
                query
              }
              onChange={
                event =>
                  setQuery(
                    event
                      .target
                      .value
                  )
              }
              onKeyDown={
                event => {
                  if (
                    event.key ===
                      'Enter' &&
                    matches[0]
                  ) {
                    goTo(
                      matches[0][0]
                    );
                  }
                }
              }
              placeholder="Search pages..."
              aria-label="Search pages"
            />

            {matches.length >
              0 && (
              <div className="search-results">
                {matches.map(
                  item => (
                    <button
                      key={
                        item[0]
                      }
                      onClick={() =>
                        goTo(
                          item[0]
                        )
                      }
                    >
                      <span>
                        {item[2]}
                      </span>

                      <div>
                        <b>
                          {
                            item[1]
                          }
                        </b>

                        <small>
                          Open page
                        </small>
                      </div>

                      <i>
                        {'\u2192'}
                      </i>
                    </button>
                  )
                )}
              </div>
            )}
          </div>

          {/* HEADER ACTIONS */}

          <div className="header-actions">
            <div className="live-chip">
              <span />
              {online ? 'Online' : 'Offline'}
            </div>

            {user?.role ===
              'ADMIN' && (
              <button
                className="announcement-button"
                onClick={() =>
                  setAnnounceOpen(
                    true
                  )
                }
              >
                + Announcement
              </button>
            )}

            {/* NOTIFICATION BELL */}

            <div className="notification-wrap">
              <button
                className="notification-bell"
                aria-label="Notifications"
                onClick={() =>
                  setNotificationOpen(
                    value =>
                      !value
                  )
                }
              >
                {
                  '\uD83D\uDD14'
                }

                {unread >
                  0 && (
                  <span>
                    {unread > 9
                      ? '9+'
                      : unread}
                  </span>
                )}
              </button>

              {notificationOpen && (
                <div className="notification-panel">

                  <div className="notification-panel-head">
                    <div>
                      <b>
                        Notifications
                      </b>

                      <small>
                        {unread}{' '}
                        unread
                      </small>
                    </div>

                    {unread >
                      0 && (
                      <button
                        onClick={
                          markAll
                        }
                      >
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="notification-list">
                    {notifications.length ? (
                      notifications
                        .slice(
                          0,
                          12
                        )
                        .map(
                          notification => (
                            <button
                              key={
                                notification.id
                              }
                              className={
                                `notification-item ${
                                  notification.isRead
                                    ? ''
                                    : 'unread'
                                }`
                              }
                              onClick={() =>
                                !notification.isRead &&
                                markRead(
                                  notification.id
                                )
                              }
                            >
                              <i />

                              <div>
                                <b>
                                  {
                                    notification.title
                                  }
                                </b>

                                <p>
                                  {
                                    notification.message
                                  }
                                </p>

                                <small>
                                  {new Date(
                                    notification.createdAt
                                  ).toLocaleString(
                                    'en-IN',
                                    {
                                      dateStyle:
                                        'medium',

                                      timeStyle:
                                        'short'
                                    }
                                  )}
                                </small>
                              </div>
                            </button>
                          )
                        )
                    ) : (
                      <div className="notification-empty">
                        <b>
                          You're all
                          caught up
                        </b>

                        <span>
                          No notifications
                          yet.
                        </span>
                      </div>
                    )}

                    {user?.role ===
                      'PARENT' &&
                      notifications.length >
                        0 && (
                        <button
                          type="button"
                          onClick={() =>
                            goTo(
                              '/notifications'
                            )
                          }
                          style={{
                            width:
                              '100%',

                            padding:
                              '12px',

                            border:
                              'none',

                            background:
                              'transparent',

                            cursor:
                              'pointer',

                            fontWeight:
                              700
                          }}
                        >
                          View all
                          notifications
                        </button>
                      )}
                  </div>
                </div>
              )}
            </div>

            <div className="header-user">
              <span className="avatar">
                {user?.name?.[0] ||
                  'U'}
              </span>

              <div>
                <b>
                  {user?.name}
                </b>

                <small>
                  {user?.institutionId ||
                    user?.email}
                </small>
              </div>
            </div>
          </div>
        </header>

        {!online && (
          <div className="alert-banner">
            OFFLINE MODE — Driver actions and GPS updates will be queued and synced when connectivity returns.
          </div>
        )}

        {online && offlineQueueCount > 0 && (
          <div className="alert-banner">
            Syncing {offlineQueueCount} queued NaviGuard action{offlineQueueCount === 1 ? '' : 's'}...
          </div>
        )}

        {accidentAlert && user?.role === 'DRIVER' && (
          <div className={`accident-top-warning ${accidentAlert.phase === 'CONFIRMED' ? 'confirmed' : ''}`}>
            <span className="accident-top-siren">🚨</span>
            <span>
              {accidentAlert.phase === 'CONFIRMED'
                ? 'CRITICAL ACCIDENT — DISTRESS ACTIVE'
                : 'POSSIBLE IMPACT — RESPOND NOW'}
            </span>
            {accidentAlert.phase === 'POSSIBLE' && accidentCountdown != null && (
              <b>{accidentCountdown}s</b>
            )}
          </div>
        )}

        <ArrivalNotificationManager
          user={user}
        />

        <div className="page-content" id="main-content" tabIndex={-1}>
          <PageBoundary key={location.pathname}><Outlet /></PageBoundary>
        </div>

        {accidentAlert && (
          <div className="accident-alarm-backdrop" role="alertdialog" aria-modal="true">
            <section className={`accident-alarm-card ${accidentAlert.phase === 'CONFIRMED' ? 'confirmed' : 'possible'}`}>
              <div className="accident-hazard-band" aria-hidden="true" />

              <div className="accident-alarm-icon">!</div>

              <span className="accident-alarm-kicker">
                {accidentAlert.phase === 'CONFIRMED'
                  ? 'CRITICAL CRASH ALERT'
                  : 'IMPACT ALERT'}
              </span>

              <h2>
                {accidentAlert.phase === 'CONFIRMED'
                  ? 'ACCIDENT DETECTED'
                  : 'POSSIBLE ACCIDENT'}
              </h2>

              <div className="accident-bus-chip">
                BUS {accidentAlert.incident?.vehicle?.busNumber || accidentAlert.incident?.vehicle?.registrationNo || 'UNKNOWN'}
              </div>

              {accidentAlert.phase === 'POSSIBLE' && accidentCountdown != null && (
                <div className="accident-countdown danger">
                  <b>{accidentCountdown}</b>
                  <span>RESPOND NOW</span>
                </div>
              )}

              <div className="accident-alarm-metrics">
                <div>
                  <small>BEFORE</small>
                  <b>{accidentAlert.incident?.speedBefore ?? 'N/A'} km/h</b>
                </div>
                <div>
                  <small>AFTER</small>
                  <b>{accidentAlert.incident?.speedAfter ?? 'N/A'} km/h</b>
                </div>
                <div>
                  <small>CONFIDENCE</small>
                  <b>
                    {accidentAlert.incident?.aiConfidence == null
                      ? 'N/A'
                      : `${Math.round(Number(accidentAlert.incident.aiConfidence) * 100)}%`}
                  </b>
                </div>
              </div>

              {accidentAlert.phase === 'CONFIRMED' && (
                <div className="accident-dispatch-grid">
                  <div className="active">
                    <span>🚨</span>
                    <b>DISTRESS</b>
                    <small>{accidentAlert.incident?.detectionSignals?.autonomousEmergencyResponse?.dispatch?.mode === 'WEBHOOK' ? 'INTEGRATION: SEE ADMIN' : 'DEMO / SIMULATED'}</small>
                  </div>
                  <div>
                    <span>🚓</span>
                    <b>POLICE</b>
                    <small>SEE ADMIN DETAILS</small>
                  </div>
                  <div>
                    <span>🏥</span>
                    <b>HOSPITAL</b>
                    <small>SEE ADMIN DETAILS</small>
                  </div>
                </div>
              )}

              <div className="accident-sound-row">
                <button
                  type="button"
                  className="accident-control-button"
                  onClick={() => setAccidentMuted(value => !value)}
                >
                  {accidentMuted ? 'UNMUTE SIREN' : 'MUTE SIREN'}
                </button>

                {accidentAlert.incident?.latitude != null &&
                  accidentAlert.incident?.longitude != null && (
                    <a
                      className="accident-control-button accident-map-link"
                      href={`https://maps.google.com/?q=${accidentAlert.incident.latitude},${accidentAlert.incident.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      OPEN GPS
                    </a>
                  )}
              </div>

              {accidentAlert.phase === 'POSSIBLE' && user?.role === 'DRIVER' ? (
                <div className="accident-alarm-actions">
                  <button
                    type="button"
                    className="accident-safe-button"
                    disabled={accidentBusy}
                    onClick={() => respondToAccident('SAFE')}
                  >
                    I'M SAFE
                  </button>

                  <button
                    type="button"
                    className="accident-emergency-button"
                    disabled={accidentBusy}
                    onClick={() => respondToAccident('EMERGENCY')}
                  >
                    CONFIRM EMERGENCY
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="accident-emergency-button accident-ack-button"
                  onClick={acknowledgeAccidentAlert}
                >
                  ACKNOWLEDGE
                </button>
              )}
            </section>
          </div>
        )}

        {/* ============================================== */}
        {/* ADMIN ANNOUNCEMENT MODAL */}
        {/* ============================================== */}

        {announceOpen && (
          <div
            className="modal-backdrop"
            onMouseDown={() =>
              setAnnounceOpen(
                false
              )
            }
          >
            <form
              className="modal-card announcement-modal"
              onMouseDown={
                event =>
                  event.stopPropagation()
              }
              onSubmit={
                sendAnnouncement
              }
            >
              <div className="panel-head">
                <div>
                  <span className="eyebrow">
                    ROLE-TARGETED
                    MESSAGE
                  </span>

                  <h3>
                    New announcement
                  </h3>
                </div>

                <button
                  type="button"
                  className="modal-close"
                  onClick={() =>
                    setAnnounceOpen(
                      false
                    )
                  }
                >
                  x
                </button>
              </div>

              {announceNotice && (
                <div className="success">
                  {
                    announceNotice
                  }
                </div>
              )}

              <label>
                Title

                <input
                  required
                  maxLength={
                    120
                  }
                  value={
                    announcement.title
                  }
                  onChange={
                    event =>
                      setAnnouncement(
                        current => ({
                          ...current,

                          title:
                            event
                              .target
                              .value
                        })
                      )
                  }
                  placeholder="Route timing update"
                />
              </label>

              <label>
                Message

                <textarea
                  required
                  rows={
                    5
                  }
                  maxLength={
                    1000
                  }
                  value={
                    announcement.message
                  }
                  onChange={
                    event =>
                      setAnnouncement(
                        current => ({
                          ...current,

                          message:
                            event
                              .target
                              .value
                        })
                      )
                  }
                  placeholder="Write the transport announcement..."
                />
              </label>

              <div className="announcement-audience">
                <small>
                  SEND TO
                </small>

                {[
                  'DRIVER',
                  'STUDENT',
                  'STAFF',
                  'PARENT'
                ].map(
                  role => (
                    <button
                      type="button"
                      key={
                        role
                      }
                      className={
                        announcement.roles.includes(
                          role
                        )
                          ? 'selected'
                          : ''
                      }
                      onClick={() =>
                        toggleRole(
                          role
                        )
                      }
                    >
                      {role}
                    </button>
                  )
                )}
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    setAnnounceOpen(
                      false
                    )
                  }
                >
                  Cancel
                </button>

                <button className="primary">
                  Send announcement
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
