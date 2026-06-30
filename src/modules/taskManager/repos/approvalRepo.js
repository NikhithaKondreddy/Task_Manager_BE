const { q, parsePagination } = require('../utils/db');

async function findById(id, tenantId) {
  const rows = await q(`SELECT * FROM tm_approvals WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return rows[0] || null;
}

async function list(tenantId, query = {}, scopeUserIds = null) {
  const { page, limit, offset } = parsePagination(query);
  const where = ['a.tenant_id = ?'];
  const params = [tenantId];
  if (query.status) { where.push('a.status = ?'); params.push(query.status); }
  if (query.type) { where.push('a.approval_type = ?'); params.push(query.type); }

  if (scopeUserIds && scopeUserIds.length) {
    const ph = scopeUserIds.map(() => '?').join(',');
    where.push(`(
      (a.approval_type = 'TASK_COMPLETION' AND EXISTS (SELECT 1 FROM tm_tasks t WHERE t.id = a.entity_id AND t.assigned_to IN (${ph})))
      OR (a.approval_type = 'OCCURRENCE_COMPLETION' AND EXISTS (SELECT 1 FROM tm_task_occurrences o WHERE o.id = a.entity_id AND o.assigned_to IN (${ph})))
      OR (a.approval_type = 'PROJECT_CLOSURE' AND EXISTS (SELECT 1 FROM tm_projects p WHERE p.id = a.entity_id AND p.manager_id IN (${ph})))
    )`);
    params.push(...scopeUserIds, ...scopeUserIds, ...scopeUserIds);
  }

  const whereSql = where.join(' AND ');
  const rows = await q(
    `SELECT a.*, u.name AS requested_by_name FROM tm_approvals a
     LEFT JOIN users u ON u._id = a.requested_by
     WHERE ${whereSql} ORDER BY a.requested_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  for (const row of rows) {
    if (row.approval_type === 'PROJECT_CLOSURE') {
      const p = await q(`SELECT name AS title, public_id FROM tm_projects WHERE id = ?`, [row.entity_id]);
      row.entity = p[0] || null;
    } else if (row.approval_type === 'TASK_COMPLETION') {
      const t = await q(`SELECT title, public_id, priority FROM tm_tasks WHERE id = ?`, [row.entity_id]);
      row.entity = t[0] || null;
    } else {
      const o = await q(
        `SELECT t.title, t.public_id, t.priority, o.due_date FROM tm_task_occurrences o JOIN tm_tasks t ON t.id = o.task_id WHERE o.id = ?`,
        [row.entity_id]
      );
      row.entity = o[0] || null;
    }
  }

  const countRows = await q(`SELECT COUNT(*) AS total FROM tm_approvals a WHERE ${whereSql}`, params);
  return { rows, total: countRows[0].total, page, limit };
}

async function countPending(tenantId, scopeUserIds = null) {
  const result = await list(tenantId, { status: 'Pending', limit: 1 }, scopeUserIds);
  return result.total;
}

module.exports = { findById, list, countPending };
