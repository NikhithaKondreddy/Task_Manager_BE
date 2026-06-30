const { q, parsePagination } = require('../utils/db');

async function list(tenantId, query = {}) {
  const { page, limit, offset } = parsePagination(query);
  const where = ["al.module = 'TaskManager'"];
  const params = [];
  if (tenantId) { where.push('al.tenant_id = ?'); params.push(String(tenantId)); }
  if (query.entity) { where.push('al.entity = ?'); params.push(query.entity); }
  if (query.entityId) { where.push('al.entity_id = ?'); params.push(String(query.entityId)); }
  if (query.action) { where.push('al.action = ?'); params.push(query.action); }

  const whereSql = where.join(' AND ');
  const rows = await q(
    `SELECT al.*, u.name AS actor_name FROM audit_logs al LEFT JOIN users u ON u._id = al.actor_id
     WHERE ${whereSql} ORDER BY al.createdAt DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const countRows = await q(`SELECT COUNT(*) AS total FROM audit_logs al WHERE ${whereSql}`, params);
  return { rows, total: countRows[0].total, page, limit };
}

module.exports = { list };
