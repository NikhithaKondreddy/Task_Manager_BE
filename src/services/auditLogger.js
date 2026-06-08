// =====================================================
// 2) NODE.JS AUDIT LOGGER SERVICE
// =====================================================

const db = require('../db');

let logger;
try {
    logger = require(global.__root + 'logger');
} catch (e) {
    try {
        logger = require('../logger');
    } catch (e2) {
        logger = console;
    }
}

const q = (sql, params = []) =>
    new Promise((resolve, reject) =>
        db.query(sql, params, (e, r) => (e ? reject(e) : resolve(r)))
    );

/**
 * Non-blocking audit logger service
 * Logs audit events to MySQL database
 */
class AuditLogger {
    /**
     * Log an audit event
     * @param {Object} data - Audit data
     * @param {string} data.action - Action performed
     * @param {number} data.tenant_id - Tenant ID
     * @param {string} data.actor_id - User ID or system identifier
     * @param {string} data.entity - Entity type (Task, Project, Client, etc.)
     * @param {string} data.entity_id - Entity ID
     * @param {string} data.module - Module name (Auth, Tasks, Projects, etc.)
     * @param {string} data.ip_address - IP address
     * @param {string} data.user_agent - User agent string
     * @param {string} data.correlation_id - Request correlation ID
     * @param {Object} data.details - Additional metadata
     * @param {Object} data.previous_value - Previous state
     * @param {Object} data.new_value - New state
     * @param {Date} data.created_at - Timestamp (auto-generated if missing)
     */
    async logAudit(data) {
        try {
            const {
                action = 'UNKNOWN_ACTION',
                tenant_id = null,
                actor_id = null,
                entity = null,
                entity_id = null,
                module = null,
                ip_address = null,
                user_agent = null,
                correlation_id = null,
                details = {},
                previous_value = null,
                new_value = null,
                created_at = null
            } = data;

            const sql = `
        INSERT INTO audit_logs (
          actor_id, tenant_id, action, entity, entity_id, module,
          ip_address, user_agent, correlation_id, details,
          previous_value, new_value, createdAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

            const params = [
                actor_id,
                tenant_id,
                action,
                entity,
                entity_id,
                module,
                ip_address,
                user_agent,
                correlation_id,
                JSON.stringify(details),
                previous_value ? JSON.stringify(previous_value) : null,
                new_value ? JSON.stringify(new_value) : null,
                created_at || new Date()
            ];

            await q(sql, params);
        } catch (error) {
            // Non-blocking: log internal failures separately
            logger.error('[AuditLogger] Failed to log audit event:', {
                error: error.message,
                stack: error.stack,
                data
            });
        }
    }

    /**
     * Batch log multiple audit events
     * @param {Array} events - Array of audit data objects
     */
    async logBatch(events) {
        if (!Array.isArray(events) || events.length === 0) return;

        try {
            const values = [];
            const placeholders = [];

            for (const data of events) {
                const {
                    action = 'UNKNOWN_ACTION',
                    tenant_id = null,
                    actor_id = null,
                    entity = null,
                    entity_id = null,
                    module = null,
                    ip_address = null,
                    user_agent = null,
                    correlation_id = null,
                    details = {},
                    previous_value = null,
                    new_value = null,
                    created_at = null
                } = data;

                placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
                values.push(
                    actor_id,
                    tenant_id,
                    action,
                    entity,
                    entity_id,
                    module,
                    ip_address,
                    user_agent,
                    correlation_id,
                    JSON.stringify(details),
                    previous_value ? JSON.stringify(previous_value) : null,
                    new_value ? JSON.stringify(new_value) : null,
                    created_at || new Date()
                );
            }

            const sql = `
        INSERT INTO audit_logs (
          actor_id, tenant_id, action, entity, entity_id, module,
          ip_address, user_agent, correlation_id, details,
          previous_value, new_value, createdAt
        ) VALUES ${placeholders.join(', ')}
      `;

            await q(sql, values);
        } catch (error) {
            logger.error('[AuditLogger] Failed to batch log audit events:', {
                error: error.message,
                stack: error.stack,
                count: events.length
            });
        }
    }
}

// Singleton instance
const auditLogger = new AuditLogger();

module.exports = auditLogger;
