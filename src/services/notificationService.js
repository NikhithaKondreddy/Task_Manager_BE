const db = require('../db');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = require('../../logger'); }
 
class NotificationService {

  static async hasColumn(tableName, columnName) {
    const rows = await new Promise((resolve, reject) => {
      db.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [tableName, columnName],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });
    return Array.isArray(rows) && rows.length > 0;
  }

  static async validateUsers(userIds, tenantId = null) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
   
    const placeholders = userIds.map(() => '?').join(',');
    const sql = `SELECT _id FROM users WHERE _id IN (${placeholders}) ${tenantId !== null && tenantId !== undefined ? 'AND tenant_id = ?' : ''}`;
    const params = [...userIds];
    if (tenantId !== null && tenantId !== undefined) params.push(tenantId);
   
    const validUsers = await new Promise((resolve, reject) => {
      db.query(sql, params, (err, results) => {
        if (err) reject(err);
        else resolve(results.map(u => u._id));
      });
    });
   
    return validUsers;
  }

  static async createAndSend(userIds, title, message, type, entityType = null, entityId = null, tenantId = null) {
    if (!Array.isArray(userIds) || userIds.length === 0) return;

    const validUserIds = await this.validateUsers(userIds, tenantId);
    if (validUserIds.length === 0) {
      logger.warn('No valid users found for notification');
      return;
    }

    const notificationsHasTenant = tenantId !== null && tenantId !== undefined
      ? await this.hasColumn('notifications', 'tenant_id')
      : false;
 
    const notifications = validUserIds.map(userId => ({
      user_id: userId,
      tenant_id: notificationsHasTenant ? tenantId : null,
      title,
      message,
      type,
      entity_type: entityType,
      entity_id: entityId
    }));

    const values = notifications.map((n) => (
      notificationsHasTenant
        ? [n.user_id, n.tenant_id, n.title, n.message, n.type, n.entity_type, n.entity_id]
        : [n.user_id, n.title, n.message, n.type, n.entity_type, n.entity_id]
    ));
    const sql = notificationsHasTenant
      ? 'INSERT INTO notifications (user_id, tenant_id, title, message, type, entity_type, entity_id) VALUES ?'
      : 'INSERT INTO notifications (user_id, title, message, type, entity_type, entity_id) VALUES ?';
   
    await new Promise((resolve, reject) => {
      db.query(sql, [values], (err, results) => {
        if (err) {
          logger.error('Notification insert error:', err);
          reject(err);
        } else {
          resolve(results);
        }
      });
    });

    const payload = {
      title,
      message,
      type,
      entityId: entityId,
      createdAt: new Date().toISOString()
    };
 
    validUserIds.forEach(userId => {
      if (global.io) {
        global.io.to(`user_${userId}`).emit('notification', payload);
      }
    });
  }

  static async createAndSendToRoles(roles, title, message, type, entityType = null, entityId = null, tenantId = null) {
    if (!Array.isArray(roles) || roles.length === 0) return;
 
    const placeholders = roles.map(() => '?').join(',');
    const sql = `SELECT _id FROM users WHERE role IN (${placeholders}) ${tenantId ? 'AND tenant_id = ?' : ''}`;
    const params = [...roles];
    if (tenantId) params.push(tenantId);
 
    const users = await new Promise((resolve, reject) => {
      db.query(sql, params, (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
 
    const userIds = users.map(u => u._id);
    if (userIds.length === 0) return;
 
    await this.createAndSend(userIds, title, message, type, entityType, entityId, tenantId);
  }
 
  static async getForUser(userId, limit = 50, offset = 0) {
    const userExists = await new Promise((resolve, reject) => {
      db.query('SELECT _id FROM users WHERE _id = ?', [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results.length > 0);
      });
    });
 
    if (!userExists) return [];
 
    const sql = 'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
    return new Promise((resolve, reject) => {
      db.query(sql, [userId, limit, offset], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }

  static async getById(notificationId, userId) {
    const sql = 'SELECT * FROM notifications WHERE id = ? AND user_id = ?';
    return new Promise((resolve, reject) => {
      db.query(sql, [notificationId, userId], (err, results) => {
        if (err) reject(err);
        else resolve(results[0] || null);
      });
    });
  }

  static async markAsRead(notificationId, userId) {
    const sql = 'UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?';
    return new Promise((resolve, reject) => {
      db.query(sql, [notificationId, userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }

  static async markAllAsRead(userId) {
    const sql = 'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE';
    return new Promise((resolve, reject) => {
      db.query(sql, [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }

  static async delete(notificationId, userId) {
    const sql = 'DELETE FROM notifications WHERE id = ? AND user_id = ?';
    return new Promise((resolve, reject) => {
      db.query(sql, [notificationId, userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }
 
  static async cleanupForUser(userId) {
    const sql = 'DELETE FROM notifications WHERE user_id = ?';
    return new Promise((resolve, reject) => {
      db.query(sql, [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  }

  static async getUnreadCount(userId) {
    const sql = 'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE';
    return new Promise((resolve, reject) => {
      db.query(sql, [userId], (err, results) => {
        if (err) reject(err);
        else resolve(results[0].count);
      });
    });
  }
}
 
module.exports = NotificationService;
 
 
