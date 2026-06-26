const db = require(__root + 'db');

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

async function getTaskEscalationHistory(taskId, tenantId = null) {
  const sql = `
    SELECT id, task_id, escalated_by, escalated_to, escalation_level, reason, comments, escalated_at 
    FROM task_escalations 
    WHERE task_id = ? ${tenantId ? 'AND tenant_id = ?' : ''}
    ORDER BY escalated_at DESC
  `;
  const params = tenantId ? [taskId, tenantId] : [taskId];
  const rows = await query(sql, params);
  return rows || [];
}

module.exports = {
  getTaskEscalationHistory
};
