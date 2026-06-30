const { q } = require('../utils/db');

async function add(taskId, userId, tenantId, comment) {
  const result = await q(
    `INSERT INTO tm_task_comments (task_id, user_id, tenant_id, comment) VALUES (?, ?, ?, ?)`,
    [taskId, userId, tenantId, comment]
  );
  const rows = await q(
    `SELECT c.*, u.name AS user_name, u.photo AS user_photo FROM tm_task_comments c
     JOIN users u ON u._id = c.user_id WHERE c.id = ?`,
    [result.insertId]
  );
  return rows[0];
}

async function listForTask(taskId) {
  return q(
    `SELECT c.*, u.name AS user_name, u.photo AS user_photo FROM tm_task_comments c
     JOIN users u ON u._id = c.user_id WHERE c.task_id = ? ORDER BY c.created_at ASC`,
    [taskId]
  );
}

module.exports = { add, listForTask };
