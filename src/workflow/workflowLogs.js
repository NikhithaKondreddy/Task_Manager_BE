

// const db = require('../db');

// const q = (sql, params = []) => (db.q ? db.q(sql, params) : new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r))));

// async function logAction(requestId, tenantId, entityType, entityId, action, fromState, toState, userId, details = {}) {
//   await q(
//     'INSERT INTO workflow_logs (request_id, tenant_id, entity_type, entity_id, action, from_state, to_state, user_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
//     [requestId, tenantId, entityType, entityId, action, fromState, toState, userId, JSON.stringify(details)]
//   );
// }

// async function getHistory(tenantId, entityType, entityId) {
//   const rows = await q(
//     'SELECT * FROM workflow_logs WHERE tenant_id = ? AND entity_type = ? AND entity_id = ? ORDER BY timestamp DESC',
//     [tenantId, entityType, entityId]
//   );
//   return rows.map(row => ({
//     id: row.id,
//     action: row.action,
//     from_state: row.from_state,
//     to_state: row.to_state,
//     user_id: row.user_id,
//     details: JSON.parse(row.details),
//     timestamp: row.timestamp
//   }));
// }

// module.exports = {
//   logAction,
//   getHistory
// };