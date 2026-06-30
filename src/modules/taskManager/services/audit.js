const auditLogger = require('../../../services/auditLogger');

/**
 * Thin wrapper over the shared audit_logs writer, scoped to module='TaskManager'.
 * Also doubles as the data source for the Task Details "History" tab
 * (query audit_logs by entity + entity_id).
 */
async function logTaskEvent(req, { action, entity, entityId, details, previousValue, newValue }) {
  return auditLogger.logAudit({
    action,
    tenant_id: req.user ? req.user.tenant_id : null,
    actor_id: req.user ? req.user._id : null,
    entity,
    entity_id: String(entityId),
    module: 'TaskManager',
    ip_address: req.ip,
    user_agent: req.headers ? req.headers['user-agent'] : null,
    details,
    previous_value: previousValue,
    new_value: newValue
  });
}

module.exports = { logTaskEvent };
