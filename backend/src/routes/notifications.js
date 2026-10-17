import express from 'express';
import { prisma } from '../prisma.js';
import { auth, allow } from '../middleware.js';

const router = express.Router();

const ANNOUNCEMENT_ROLES = [
  'DRIVER',
  'STUDENT',
  'STAFF',
  'PARENT'
];

// ======================================================
// GET MY NOTIFICATIONS
// ======================================================

router.get(
  '/',
  auth,
  async (req, res) => {
    try {
      const notifications =
        await prisma.notification.findMany({
          where: {
            userId: req.user.id
          },

          orderBy: {
            createdAt: 'desc'
          },

          take: 100
        });

      const unreadCount =
        await prisma.notification.count({
          where: {
            userId: req.user.id,
            isRead: false
          }
        });

      return res.json({
        notifications,

        // Keep both names so old and new frontend
        // code remain compatible.
        unread: unreadCount,
        unreadCount
      });
    } catch (error) {
      console.error(
        'GET NOTIFICATIONS ERROR:',
        error
      );

      return res.status(500).json({
        message:
          'Could not load notifications.'
      });
    }
  }
);

// ======================================================
// GET UNREAD COUNT
// ======================================================

router.get(
  '/unread-count',
  auth,
  async (req, res) => {
    try {
      const unreadCount =
        await prisma.notification.count({
          where: {
            userId: req.user.id,
            isRead: false
          }
        });

      return res.json({
        unread: unreadCount,
        unreadCount
      });
    } catch (error) {
      console.error(
        'NOTIFICATION COUNT ERROR:',
        error
      );

      return res.status(500).json({
        message:
          'Could not load notification count.'
      });
    }
  }
);

// ======================================================
// ADMIN SEND ANNOUNCEMENT
// ======================================================

router.post(
  '/announcements',
  auth,
  allow('ADMIN'),
  async (req, res) => {
    try {
      const {
        title,
        message,
        roles
      } = req.body || {};

      const cleanTitle =
        String(title || '').trim();

      const cleanMessage =
        String(message || '').trim();

      const selectedRoles =
        Array.isArray(roles)
          ? [
              ...new Set(
                roles.filter(role =>
                  ANNOUNCEMENT_ROLES.includes(
                    role
                  )
                )
              )
            ]
          : [];

      if (!cleanTitle) {
        return res.status(400).json({
          message:
            'Announcement title is required.'
        });
      }

      if (!cleanMessage) {
        return res.status(400).json({
          message:
            'Announcement message is required.'
        });
      }

      if (!selectedRoles.length) {
        return res.status(400).json({
          message:
            'Select at least one recipient role.'
        });
      }

      const recipients =
        await prisma.user.findMany({
          where: {
            role: {
              in: selectedRoles
            }
          },

          select: {
            id: true
          }
        });

      if (!recipients.length) {
        return res.json({
          createdCount: 0,
          message:
            'No users found for the selected roles.'
        });
      }

      await prisma.notification.createMany({
        data:
          recipients.map(user => ({
            userId:
              user.id,

            type:
              'GENERAL',

            title:
              cleanTitle,

            message:
              cleanMessage
          }))
      });

      const userIds =
        recipients.map(
          user => user.id
        );

      const io =
        req.app.get('io');

      io?.emit(
        'notification:update',
        {
          userIds
        }
      );

      // Backward compatibility with the
      // existing frontend listener.
      io?.emit(
        'notification:new',
        {
          userIds
        }
      );

      return res.json({
        createdCount:
          recipients.length,

        message:
          `Announcement sent to ${recipients.length} account${recipients.length === 1 ? '' : 's'}.`
      });
    } catch (error) {
      console.error(
        'ANNOUNCEMENT ERROR:',
        error
      );

      return res.status(500).json({
        message:
          'Could not send announcement.'
      });
    }
  }
);

// ======================================================
// MARK ALL AS READ
// ======================================================

router.patch(
  '/read-all',
  auth,
  async (req, res) => {
    try {
      const result =
        await prisma.notification.updateMany({
          where: {
            userId:
              req.user.id,

            isRead:
              false
          },

          data: {
            isRead:
              true
          }
        });

      req.app
        .get('io')
        ?.emit(
          'notification:update',
          {
            userId:
              req.user.id
          }
        );

      return res.json({
        updatedCount:
          result.count,

        message:
          'All notifications marked as read.'
      });
    } catch (error) {
      console.error(
        'MARK ALL NOTIFICATIONS ERROR:',
        error
      );

      return res.status(500).json({
        message:
          'Could not update notifications.'
      });
    }
  }
);

// ======================================================
// MARK ONE AS READ
// ======================================================

router.patch(
  '/:id/read',
  auth,
  async (req, res) => {
    try {
      const notification =
        await prisma.notification.findFirst({
          where: {
            id:
              req.params.id,

            userId:
              req.user.id
          }
        });

      if (!notification) {
        return res.status(404).json({
          message:
            'Notification not found.'
        });
      }

      const updated =
        await prisma.notification.update({
          where: {
            id:
              notification.id
          },

          data: {
            isRead:
              true
          }
        });

      req.app
        .get('io')
        ?.emit(
          'notification:update',
          {
            userId:
              req.user.id
          }
        );

      return res.json({
        notification:
          updated,

        message:
          'Notification marked as read.'
      });
    } catch (error) {
      console.error(
        'MARK NOTIFICATION READ ERROR:',
        error
      );

      return res.status(500).json({
        message:
          'Could not update notification.'
      });
    }
  }
);

export default router;