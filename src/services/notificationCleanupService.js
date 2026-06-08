const cron = require('node-cron');
const db = require('../db');
const logger = require('../logger');

let loggerInstance;
try { loggerInstance = require(global.__root + 'logger'); } catch (e) { try { loggerInstance = require('../logger'); } catch (e2) { loggerInstance = console; } }

const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

class NotificationCleanupService {
  constructor() {
    this.isRunning = false;
    this.job = null;
  }

  /**
   * Start the automatic notification cleanup job
   * Runs every day at 3:00 AM to clean notifications older than 30 days
   */
  start() {
    if (this.isRunning) {
      loggerInstance.info('Notification cleanup service is already running');
      return;
    }

    try {
      // Schedule to run every day at 3:00 AM
      this.job = cron.schedule('0 3 * * *', async () => {
        await this.performCleanup();
      }, {
        scheduled: false // Don't start immediately
      });

      this.job.start();
      this.isRunning = true;
      loggerInstance.info('Notification cleanup service started - will run every day at 3:00 AM');
    } catch (error) {
      loggerInstance.error('Failed to start notification cleanup service:', error);
    }
  }

  /**
   * Stop the automatic cleanup job
   */
  stop() {
    if (this.job) {
      this.job.stop();
      this.job = null;
    }
    this.isRunning = false;
    loggerInstance.info('Notification cleanup service stopped');
  }

  /**
   * Manually trigger notification cleanup
   * @param {number} daysOld - Delete notifications older than this many days (default: 30)
   * @param {string} tenantId - Optional tenant ID filter
   * @param {boolean} force - Force deletion even of unread notifications (admin only)
   */
  async performCleanup(daysOld = 30, tenantId = null, force = false) {
    try {
      loggerInstance.info(`Starting notification cleanup for notifications older than ${daysOld} days${tenantId ? ` (tenant: ${tenantId})` : ''}${force ? ' (forced)' : ''}`);

      // Build WHERE clause
      const whereConditions = [];
      const params = [];

      // Add tenant filter if specified
      if (tenantId) {
        whereConditions.push('tenant_id = ?');
        params.push(tenantId);
      }

      // Add date filter
      whereConditions.push('created_at < DATE_SUB(NOW(), INTERVAL ? DAY)');
      params.push(daysOld);

      // Add safety filter for unread notifications unless forced
      if (!force) {
        // Don't delete unread notifications that are less than 7 days old (give users time to read)
        whereConditions.push('(is_read = TRUE OR created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))');
      }

      const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

      // Get count before deletion
      const countSql = `SELECT COUNT(*) as count FROM notifications ${whereClause}`;
      const countResult = await q(countSql, params);
      const recordsToDelete = countResult[0].count;

      if (recordsToDelete === 0) {
        loggerInstance.info('No old notifications to clean up');
        return { success: true, deletedCount: 0, message: 'No notifications to clean up' };
      }

      // Perform deletion
      const deleteSql = `DELETE FROM notifications ${whereClause}`;
      await q(deleteSql, params);

      // Log the cleanup action to audit logs
      await this.logCleanupAction(recordsToDelete, daysOld, tenantId, force);

      loggerInstance.info(`Notification cleanup completed: ${recordsToDelete} records deleted`);
      return {
        success: true,
        deletedCount: recordsToDelete,
        message: `Successfully deleted ${recordsToDelete} notification entries older than ${daysOld} days`
      };

    } catch (error) {
      loggerInstance.error('Notification cleanup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Log the cleanup action to audit logs
   */
  async logCleanupAction(deletedCount, daysOld, tenantId, force) {
    try {
      const logEntry = {
        tenant_id: tenantId || 'SYSTEM',
        actor_id: null, // System action
        action: 'AUTO_CLEANUP_NOTIFICATIONS',
        entity: 'Notification',
        entity_id: null,
        details: {
          deletedCount,
          daysOld,
          tenantId,
          force,
          cleanupType: 'automatic',
          performedBy: 'SYSTEM'
        }
      };

      await q(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, details, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [logEntry.tenant_id, logEntry.actor_id, logEntry.action, logEntry.entity, logEntry.entity_id, JSON.stringify(logEntry.details)]);
    } catch (logError) {
      loggerInstance.error('Failed to log notification cleanup action:', logError);
    }
  }

  /**
   * Get cleanup statistics
   */
  async getCleanupStats(tenantId = null) {
    try {
      const whereClause = tenantId ? 'WHERE tenant_id = ?' : '';
      const params = tenantId ? [tenantId] : [];

      // Get total count
      const totalSql = `SELECT COUNT(*) as total FROM notifications ${whereClause}`;
      const totalResult = await q(totalSql, params);

      // Get count of notifications older than 30 days
      const oldSql = `SELECT COUNT(*) as old_count FROM notifications ${whereClause ? whereClause + ' AND' : 'WHERE'} created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`;
      const oldResult = await q(oldSql, params);

      // Get count of unread notifications older than 7 days
      const unreadOldSql = `SELECT COUNT(*) as unread_old_count FROM notifications ${whereClause ? whereClause + ' AND' : 'WHERE'} is_read = FALSE AND created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`;
      const unreadOldResult = await q(unreadOldSql, params);

      // Get oldest notification date
      const oldestSql = `SELECT MIN(created_at) as oldest_date FROM notifications ${whereClause}`;
      const oldestResult = await q(oldestSql, params);

      return {
        success: true,
        data: {
          totalNotifications: totalResult[0].total,
          notificationsOlderThan30Days: oldResult[0].old_count,
          unreadNotificationsOlderThan7Days: unreadOldResult[0].unread_old_count,
          oldestNotificationDate: oldestResult[0].oldest_date
        }
      };
    } catch (error) {
      loggerInstance.error('Failed to get notification cleanup stats:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get notifications that would be deleted in the next cleanup
   * @param {number} daysOld - Days threshold
   * @param {string} tenantId - Optional tenant filter
   */
  async getPendingCleanup(daysOld = 30, tenantId = null) {
    try {
      const whereConditions = [];
      const params = [];

      if (tenantId) {
        whereConditions.push('tenant_id = ?');
        params.push(tenantId);
      }

      whereConditions.push('created_at < DATE_SUB(NOW(), INTERVAL ? DAY)');
      params.push(daysOld);

      // Include both read and unread older than 7 days
      whereConditions.push('(is_read = TRUE OR created_at < DATE_SUB(NOW(), INTERVAL 7 DAY))');

      const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

      const sql = `SELECT id, user_id, title, type, is_read, created_at FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT 100`;
      const notifications = await q(sql, params);

      return {
        success: true,
        data: notifications,
        count: notifications.length
      };
    } catch (error) {
      loggerInstance.error('Failed to get pending cleanup notifications:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new NotificationCleanupService();