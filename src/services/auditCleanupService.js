const cron = require('node-cron');
const db = require('../db');
const logger = require('../logger');

let loggerInstance;
try { loggerInstance = require(global.__root + 'logger'); } catch (e) { try { loggerInstance = require('../logger'); } catch (e2) { loggerInstance = console; } }

const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

class AuditCleanupService {
  constructor() {
    this.isRunning = false;
    this.job = null;
  }

  /**
   * Start the automatic audit log cleanup job
   * Runs every 30 days at 2 AM
   */
  start() {
    if (this.isRunning) {
      loggerInstance.info('Audit cleanup service is already running');
      return;
    }

    try {
      // Schedule to run every 30 days at 2:00 AM
      // Cron expression: "0 2 */30 * *" (every 30 days at 2 AM)
      // Note: node-cron doesn't support */30 directly, so we'll use a daily check
      this.job = cron.schedule('0 2 * * *', async () => {
        await this.performCleanup();
      }, {
        scheduled: false // Don't start immediately
      });

      this.job.start();
      this.isRunning = true;
      loggerInstance.info('Audit cleanup service started - will run every 30 days at 2:00 AM');
    } catch (error) {
      loggerInstance.error('Failed to start audit cleanup service:', error);
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
    loggerInstance.info('Audit cleanup service stopped');
  }

  /**
   * Manually trigger audit log cleanup
   * @param {number} daysOld - Delete logs older than this many days (default: 30)
   * @param {string} tenantId - Optional tenant ID filter
   */
  async performCleanup(daysOld = 30, tenantId = null) {
    try {
      loggerInstance.info(`Starting audit log cleanup for logs older than ${daysOld} days${tenantId ? ` (tenant: ${tenantId})` : ''}`);

      const whereConditions = [];
      const params = [];

      // Add tenant filter if specified
      if (tenantId) {
        whereConditions.push('tenant_id = ?');
        params.push(tenantId);
      }

      // Add date filter
      whereConditions.push('createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)');
      params.push(daysOld);

      const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

      // Get count before deletion
      const countSql = `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`;
      const countResult = await q(countSql, params);
      const recordsToDelete = countResult[0].count;

      if (recordsToDelete === 0) {
        loggerInstance.info('No old audit logs to clean up');
        return { success: true, deletedCount: 0, message: 'No logs to clean up' };
      }

      // Perform deletion
      const deleteSql = `DELETE FROM audit_logs ${whereClause}`;
      await q(deleteSql, params);

      // Log the cleanup action
      await this.logCleanupAction(recordsToDelete, daysOld, tenantId);

      loggerInstance.info(`Audit cleanup completed: ${recordsToDelete} records deleted`);
      return {
        success: true,
        deletedCount: recordsToDelete,
        message: `Successfully deleted ${recordsToDelete} audit log entries older than ${daysOld} days`
      };

    } catch (error) {
      loggerInstance.error('Audit cleanup failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Log the cleanup action to audit logs
   */
  async logCleanupAction(deletedCount, daysOld, tenantId) {
    try {
      const logEntry = {
        tenant_id: tenantId || 'SYSTEM',
        actor_id: null, // System action
        action: 'AUTO_CLEANUP_AUDIT_LOGS',
        entity: 'AuditLog',
        entity_id: null,
        details: {
          deletedCount,
          daysOld,
          tenantId,
          cleanupType: 'automatic',
          performedBy: 'SYSTEM'
        }
      };

      await q(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, details, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [logEntry.tenant_id, logEntry.actor_id, logEntry.action, logEntry.entity, logEntry.entity_id, JSON.stringify(logEntry.details)]);
    } catch (logError) {
      loggerInstance.error('Failed to log cleanup action:', logError);
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
      const totalSql = `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`;
      const totalResult = await q(totalSql, params);

      // Get count of logs older than 30 days
      const oldSql = `SELECT COUNT(*) as old_count FROM audit_logs ${whereClause ? whereClause + ' AND' : 'WHERE'} createdAt < DATE_SUB(NOW(), INTERVAL 30 DAY)`;
      const oldResult = await q(oldSql, params);

      // Get oldest log date
      const oldestSql = `SELECT MIN(createdAt) as oldest_date FROM audit_logs ${whereClause}`;
      const oldestResult = await q(oldestSql, params);

      return {
        success: true,
        data: {
          totalLogs: totalResult[0].total,
          logsOlderThan30Days: oldResult[0].old_count,
          oldestLogDate: oldestResult[0].oldest_date
        }
      };
    } catch (error) {
      loggerInstance.error('Failed to get cleanup stats:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new AuditCleanupService();