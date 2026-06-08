const NotificationService = require('../services/notificationService');
const notificationPreferenceService = require('../services/notificationPreferenceService');
const NotificationCleanupService = require('../services/notificationCleanupService');
const { requireAuth, requireRole } = require('../middleware/roles');
const errorResponse = require(__root + 'utils/errorResponse');

module.exports = {

  getNotifications: [
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const notifications = await NotificationService.getForUser(userId, limit, offset);
        res.json({ success: true, data: notifications, userId });
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  markAsRead: [
    requireAuth,
    async (req, res) => {
      try {
        const notificationId = req.params.id;
        const userId = req.user._id;
        await NotificationService.markAsRead(notificationId, userId);
        const updatedNotification = await NotificationService.getById(notificationId, userId);
        if (!updatedNotification) {
          return res.json({
            success: true,
            message: 'Notification already read or not available for this user',
            data: null,
          });
        }
        res.json({ success: true, data: updatedNotification });
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  markAllAsRead: [
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user._id;
        await NotificationService.markAllAsRead(userId);
        res.json({ success: true, message: 'All notifications marked as read' });
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  getUnreadCount: [
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const count = await NotificationService.getUnreadCount(userId);
        res.json({ success: true, data: { count: Number(count || 0) } });
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  getUnreadNotifications: [
    requireAuth,
    async (req, res) => {
      try {
        const userId = req.user._id;
        const limit = parseInt(req.query.limit, 10) || 50;
        const offset = parseInt(req.query.offset, 10) || 0;
        const notifications = await NotificationService.getForUser(userId, limit, offset);
        const unread = (notifications || []).filter((n) => !Number(n.is_read));
        res.json({ success: true, data: unread, userId });
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  deleteNotification: [
    requireAuth,
    async (req, res) => {
      try {
        const notificationId = req.params.id;
        const userId = req.user._id;
        await NotificationService.delete(notificationId, userId);
        res.json({ success: true, message: 'Notification deleted' });
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  sendNotification: [
    requireAuth,
    requireRole(['Admin', 'SuperAdmin', 'Manager']),
    async (req, res) => {
      try {
        const { userIds = [], roles = [], title, message, type = 'manual', entityType = null, entityId = null } = req.body || {};
        if (!title || !message) {
          return res.status(400).json(errorResponse.badRequest('title and message are required', 'MISSING_FIELDS'));
        }
        if (Array.isArray(userIds) && userIds.length) {
          await NotificationService.createAndSend(userIds, title, message, type, entityType, entityId, req.user.tenant_id);
        }
        if (Array.isArray(roles) && roles.length) {
          await NotificationService.createAndSendToRoles(roles, title, message, type, entityType, entityId, req.user.tenant_id);
        }
        return res.json({ success: true, message: 'Notification sent' });
      } catch (error) {
        return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  getPreferences: [
    requireAuth,
    async (req, res) => {
      try {
        const prefs = await notificationPreferenceService.getPreferences(req.user.tenant_id, req.user._id);
        return res.json({ success: true, data: prefs });
      } catch (error) {
        return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  updatePreferences: [
    requireAuth,
    async (req, res) => {
      try {
        const prefs = await notificationPreferenceService.updatePreferences(req.user.tenant_id, req.user._id, req.body || {});
        return res.json({ success: true, message: 'Preferences updated', data: prefs });
      } catch (error) {
        return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  // Get notification cleanup statistics
  getCleanupStats: [
    requireAuth,
    requireRole(['Admin', 'SuperAdmin']),
    async (req, res) => {
      try {
        const tenantId = req.user.role === 'SuperAdmin' ? req.query.tenantId : req.user.tenant_id;
        const result = await NotificationCleanupService.getCleanupStats(tenantId);

        if (!result.success) {
          return res.status(500).json(result);
        }

        return res.json(result);
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  // Get notifications pending cleanup
  getPendingCleanup: [
    requireAuth,
    requireRole(['Admin', 'SuperAdmin']),
    async (req, res) => {
      try {
        const daysOld = parseInt(req.query.days) || 30;
        const tenantId = req.user.role === 'SuperAdmin' ? req.query.tenantId : req.user.tenant_id;

        if (daysOld < 1 || daysOld > 365) {
          return res.status(400).json(errorResponse.badRequest('Days must be between 1 and 365', 'INVALID_DAYS'));
        }

        const result = await NotificationCleanupService.getPendingCleanup(daysOld, tenantId);

        if (!result.success) {
          return res.status(500).json(result);
        }

        return res.json(result);
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ],

  // Manually trigger notification cleanup
  cleanup: [
    requireAuth,
    requireRole(['Admin', 'SuperAdmin']),
    async (req, res) => {
      try {
        const { daysOld = 30, tenantId, force = false } = req.body;

        // Validate daysOld
        if (daysOld < 1 || daysOld > 365) {
          return res.status(400).json(errorResponse.badRequest('daysOld must be between 1 and 365', 'INVALID_DAYS'));
        }

        // Only SuperAdmin can force delete unread notifications
        if (force && req.user.role !== 'SuperAdmin') {
          return res.status(403).json(errorResponse.forbidden('Only SuperAdmin can force delete unread notifications', 'INSUFFICIENT_PERMISSIONS'));
        }

        // For non-SuperAdmin, use their tenant
        const targetTenantId = req.user.role === 'SuperAdmin' ? tenantId : req.user.tenant_id;

        const result = await NotificationCleanupService.performCleanup(daysOld, targetTenantId, force);

        if (!result.success) {
          return res.status(500).json(result);
        }

        return res.json(result);
      } catch (error) {
        res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
      }
    }
  ]
};