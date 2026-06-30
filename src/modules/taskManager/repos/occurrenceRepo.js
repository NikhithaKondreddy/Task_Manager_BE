const { q, parsePagination } = require('../utils/db');

async function findById(id, tenantId) {
  const rows = await q(
    `SELECT o.*, t.title, t.task_type, t.priority, t.public_id AS task_public_id, t.photo_required, t.multiple_photos
     FROM tm_task_occurrences o JOIN tm_tasks t ON t.id = o.task_id
     WHERE o.id = ? AND o.tenant_id = ?`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function findByPublicId(publicId, tenantId) {
  const rows = await q(
    `SELECT o.*, t.title, t.task_type, t.priority, t.public_id AS task_public_id, t.photo_required, t.multiple_photos
     FROM tm_task_occurrences o JOIN tm_tasks t ON t.id = o.task_id
     WHERE o.public_id = ? AND o.tenant_id = ?`,
    [publicId, tenantId]
  );
  return rows[0] || null;
}

async function listForTask(taskId, query = {}) {
  const { page, limit, offset } = parsePagination(query);
  const rows = await q(
    `SELECT * FROM tm_task_occurrences WHERE task_id = ? ORDER BY due_date DESC LIMIT ? OFFSET ?`,
    [taskId, limit, offset]
  );
  const countRows = await q(`SELECT COUNT(*) AS total FROM tm_task_occurrences WHERE task_id = ?`, [taskId]);
  return { rows, total: countRows[0].total, page, limit };
}

async function listForUser(tenantId, userId, query = {}) {
  const { page, limit, offset } = parsePagination(query);
  const where = ['o.tenant_id = ?', 'o.assigned_to = ?'];
  const params = [tenantId, userId];
  if (query.status) { where.push('o.status = ?'); params.push(query.status); }
  if (query.taskType) { where.push('t.task_type = ?'); params.push(query.taskType); }
  const whereSql = where.join(' AND ');
  const rows = await q(
    `SELECT o.*, t.title, t.task_type, t.priority, t.public_id AS task_public_id FROM tm_task_occurrences o
     JOIN tm_tasks t ON t.id = o.task_id WHERE ${whereSql} ORDER BY o.due_date ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const countRows = await q(
    `SELECT COUNT(*) AS total FROM tm_task_occurrences o JOIN tm_tasks t ON t.id = o.task_id WHERE ${whereSql}`,
    params
  );
  return { rows, total: countRows[0].total, page, limit };
}

async function markOverdueOccurrences() {
  return q(
    `UPDATE tm_task_occurrences SET status = 'Overdue', updated_at = NOW()
     WHERE status IN ('Pending','In Progress') AND due_date < NOW()`
  );
}

module.exports = { findById, findByPublicId, listForTask, listForUser, markOverdueOccurrences };
