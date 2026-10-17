import {
  NavLink,
  Outlet,
  useNavigate
} from 'react-router-dom';

import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react';

import { useAuth } from '../auth';
import { api } from '../api';
import { io } from 'socket.io-client';

const nav = [
  [
    '/',
    'Dashboard',
    '\u25C6',
    ['ADMIN']
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
      ].includes(user.role) ||
      !user.assignedRouteId ||
      !user.pickupStopId
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

          if (cancelled) {
            return;
          }

          const route =
            response.data.find(
              item =>
                item.id ===
                user.assignedRouteId
            );

          const eta =
            route?.eta?.find(
              item =>
                item.stopId ===
                user.pickupStopId
            );

          const stop =
            route?.stops?.find(
              item =>
                item.stopId ===
                user.pickupStopId
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
            `campusbus-arrival:${today}:${busId}:${user.pickupStopId}`;

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

  const [
    query,
    setQuery
  ] = useState('');

  const [
    mobileNav,
    setMobileNav
  ] = useState(false);

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

      {/* ============================================== */}
      {/* SIDEBAR */}
      {/* ============================================== */}

      <aside
        className={
          `sidebar ${mobileNav ? 'open' : ''}`
        }
      >
        <div className="brand">
          <div className="brand-mark">
            CB
          </div>

          <div>
            <b>
              CampusBus
            </b>

            <span>
              Transport Control
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

        <nav>
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
              Live
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

        <ArrivalNotificationManager
          user={user}
        />

        <div className="page-content">
          <Outlet />
        </div>

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