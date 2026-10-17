import {
  useCallback,
  useEffect,
  useState
} from 'react';

import { api } from '../api';

export default function Notifications() {
  const [notifications, setNotifications] =
    useState([]);

  const [unreadCount, setUnreadCount] =
    useState(0);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState('');

  const [updating, setUpdating] =
    useState(false);

  const loadNotifications =
    useCallback(async (showLoader = false) => {
      try {
        if (showLoader) {
          setLoading(true);
        }

        const response =
          await api.get('/notifications');

        setNotifications(
          response.data?.notifications || []
        );

        setUnreadCount(
          response.data?.unreadCount || 0
        );

        setError('');
      } catch (err) {
        console.error(
          'LOAD NOTIFICATIONS ERROR:',
          err
        );

        setError(
          err.response?.data?.message ||
            'Could not load notifications.'
        );
      } finally {
        if (showLoader) {
          setLoading(false);
        }
      }
    }, []);

  useEffect(() => {
    loadNotifications(true);

    /*
      Refresh automatically every 4 seconds.

      This keeps the Parent page updated when the
      driver boards or drops off the student.
    */
    const interval =
      setInterval(() => {
        loadNotifications(false);
      }, 4000);

    return () => {
      clearInterval(interval);
    };
  }, [loadNotifications]);

  async function markAsRead(id) {
    try {
      setUpdating(true);

      await api.patch(
        `/notifications/${id}/read`
      );

      setNotifications(current =>
        current.map(notification =>
          notification.id === id
            ? {
                ...notification,
                isRead: true
              }
            : notification
        )
      );

      setUnreadCount(current =>
        Math.max(
          0,
          current - 1
        )
      );
    } catch (err) {
      console.error(
        'MARK READ ERROR:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Could not mark notification as read.'
      );
    } finally {
      setUpdating(false);
    }
  }

  async function markAllAsRead() {
    if (unreadCount === 0) {
      return;
    }

    try {
      setUpdating(true);

      await api.patch(
        '/notifications/read-all'
      );

      setNotifications(current =>
        current.map(notification => ({
          ...notification,
          isRead: true
        }))
      );

      setUnreadCount(0);
      setError('');
    } catch (err) {
      console.error(
        'MARK ALL READ ERROR:',
        err
      );

      setError(
        err.response?.data?.message ||
          'Could not mark notifications as read.'
      );
    } finally {
      setUpdating(false);
    }
  }

  function formatDate(dateValue) {
    if (!dateValue) {
      return '';
    }

    const date =
      new Date(dateValue);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      return '';
    }

    return date.toLocaleString(
      'en-IN',
      {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    );
  }

  function notificationIcon(type) {
    if (type === 'BOARDING') {
      return '🚌';
    }

    if (type === 'DROPOFF') {
      return '✅';
    }

    return '🔔';
  }

  function notificationLabel(type) {
    if (type === 'BOARDING') {
      return 'Boarding';
    }

    if (type === 'DROPOFF') {
      return 'Drop-off';
    }

    return 'General';
  }

  const styles = {
    page: {
      padding: '24px',
      maxWidth: '1000px',
      margin: '0 auto'
    },

    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '16px',
      flexWrap: 'wrap',
      marginBottom: '24px'
    },

    title: {
      margin: 0,
      fontSize: '28px',
      fontWeight: 800
    },

    subtitle: {
      marginTop: '6px',
      marginBottom: 0,
      color: '#64748b'
    },

    count: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: '28px',
      height: '28px',
      padding: '0 8px',
      borderRadius: '999px',
      background: '#dc2626',
      color: '#ffffff',
      fontWeight: 700,
      fontSize: '13px',
      marginLeft: '8px'
    },

    button: {
      border: 'none',
      borderRadius: '10px',
      padding: '10px 16px',
      cursor: 'pointer',
      fontWeight: 700,
      background: '#2563eb',
      color: '#ffffff'
    },

    disabledButton: {
      opacity: 0.55,
      cursor: 'not-allowed'
    },

    error: {
      padding: '12px 14px',
      borderRadius: '10px',
      background: '#fee2e2',
      color: '#991b1b',
      marginBottom: '18px'
    },

    empty: {
      background: '#ffffff',
      borderRadius: '16px',
      padding: '48px 24px',
      textAlign: 'center',
      border: '1px solid #e2e8f0'
    },

    emptyIcon: {
      fontSize: '46px',
      marginBottom: '12px'
    },

    list: {
      display: 'grid',
      gap: '14px'
    },

    card: {
      display: 'flex',
      gap: '16px',
      padding: '18px',
      background: '#ffffff',
      borderRadius: '16px',
      border: '1px solid #e2e8f0',
      boxShadow:
        '0 4px 14px rgba(15, 23, 42, 0.05)'
    },

    unreadCard: {
      border: '1px solid #93c5fd',
      background: '#eff6ff'
    },

    icon: {
      width: '46px',
      height: '46px',
      minWidth: '46px',
      borderRadius: '14px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '23px',
      background: '#f1f5f9'
    },

    content: {
      flex: 1
    },

    cardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '12px',
      flexWrap: 'wrap'
    },

    cardTitle: {
      margin: 0,
      fontSize: '16px',
      fontWeight: 800,
      color: '#0f172a'
    },

    badge: {
      display: 'inline-block',
      marginTop: '7px',
      padding: '4px 8px',
      borderRadius: '999px',
      background: '#e2e8f0',
      color: '#475569',
      fontSize: '11px',
      fontWeight: 700
    },

    unreadBadge: {
      background: '#2563eb',
      color: '#ffffff'
    },

    message: {
      marginTop: '12px',
      marginBottom: '10px',
      color: '#334155',
      lineHeight: 1.6
    },

    time: {
      color: '#64748b',
      fontSize: '13px'
    },

    readButton: {
      border: '1px solid #cbd5e1',
      background: '#ffffff',
      borderRadius: '8px',
      padding: '7px 11px',
      fontWeight: 600,
      cursor: 'pointer'
    }
  };

  if (loading) {
    return (
      <div style={styles.page}>
        <h1 style={styles.title}>
          Notifications
        </h1>

        <p>
          Loading notifications...
        </p>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>
            🔔 Notifications

            {unreadCount > 0 && (
              <span style={styles.count}>
                {unreadCount}
              </span>
            )}
          </h1>

          <p style={styles.subtitle}>
            Boarding and drop-off updates
            for your child.
          </p>
        </div>

        <button
          type="button"
          style={{
            ...styles.button,
            ...(unreadCount === 0 ||
            updating
              ? styles.disabledButton
              : {})
          }}
          disabled={
            unreadCount === 0 ||
            updating
          }
          onClick={
            markAllAsRead
          }
        >
          Mark All as Read
        </button>
      </div>

      {error && (
        <div style={styles.error}>
          {error}
        </div>
      )}

      {notifications.length === 0 ? (
        <div style={styles.empty}>
          <div
            style={
              styles.emptyIcon
            }
          >
            🔔
          </div>

          <h3>
            No notifications yet
          </h3>

          <p>
            Boarding and drop-off
            updates will appear here.
          </p>
        </div>
      ) : (
        <div style={styles.list}>
          {notifications.map(
            notification => (
              <div
                key={
                  notification.id
                }
                style={{
                  ...styles.card,

                  ...(!notification.isRead
                    ? styles.unreadCard
                    : {})
                }}
              >
                <div style={styles.icon}>
                  {notificationIcon(
                    notification.type
                  )}
                </div>

                <div
                  style={
                    styles.content
                  }
                >
                  <div
                    style={
                      styles.cardHeader
                    }
                  >
                    <div>
                      <h3
                        style={
                          styles.cardTitle
                        }
                      >
                        {
                          notification.title
                        }
                      </h3>

                      <span
                        style={{
                          ...styles.badge,

                          ...(!notification.isRead
                            ? styles.unreadBadge
                            : {})
                        }}
                      >
                        {notificationLabel(
                          notification.type
                        )}

                        {!notification.isRead
                          ? ' • New'
                          : ''}
                      </span>
                    </div>

                    {!notification.isRead && (
                      <button
                        type="button"
                        style={{
                          ...styles.readButton,

                          ...(updating
                            ? styles.disabledButton
                            : {})
                        }}
                        disabled={
                          updating
                        }
                        onClick={() =>
                          markAsRead(
                            notification.id
                          )
                        }
                      >
                        Mark as Read
                      </button>
                    )}
                  </div>

                  <p
                    style={
                      styles.message
                    }
                  >
                    {
                      notification.message
                    }
                  </p>

                  <div
                    style={
                      styles.time
                    }
                  >
                    {formatDate(
                      notification.createdAt
                    )}
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}