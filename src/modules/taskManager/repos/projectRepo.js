const { q, genPublicId, parsePagination, parseSort } = require('../utils/db');

async function create({ tenantId, name, description, priority, startDate, endDate, managerId, createdBy }) {
  const publicId = genPublicId('tmp');
  const result = await q(
    `INSERT INTO tm_projects (public_id, tenant_id, name, description, priority, start_date, end_date, manager_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [publicId, tenantId, name, description || null, priority || 'Medium', startDate || null, endDate || null, managerId || null, createdBy]
  );
  if (managerId) {
    await q(
      `INSERT IGNORE INTO tm_project_members (project_id, user_id, role_in_project, tenant_id) VALUES (?, ?, 'Manager', ?)`,
      [result.insertId, managerId, tenantId]
    );
  }
  return findById(result.insertId, tenantId);
}

async function findById(id, tenantId) {
  const rows = await q(
    `SELECT p.*, u.name AS manager_name FROM tm_projects p
     LEFT JOIN users u ON u._id = p.manager_id
     WHERE p.id = ? AND p.tenant_id = ? AND p.is_deleted = 0`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function findByPublicId(publicId, tenantId) {
  const rows = await q(
    `SELECT p.*, u.name AS manager_name FROM tm_projects p
     LEFT JOIN users u ON u._id = p.manager_id
     WHERE p.public_id = ? AND p.tenant_id = ? AND p.is_deleted = 0`,
    [publicId, tenantId]
  );
  return rows[0] || null;
}

async function list(tenantId, query = {}, scopeUserId = null) {
  const { page, limit, offset } = parsePagination(query);
  const sort = parseSort(query, ['name', 'created_at', 'start_date', 'end_date', 'priority', 'status'], 'created_at');

  const where = ['p.tenant_id = ?', 'p.is_deleted = 0'];
  const params = [tenantId];

  if (query.status) { where.push('p.status = ?'); params.push(query.status); }
  if (query.priority) { where.push('p.priority = ?'); params.push(query.priority); }
  if (query.search) { where.push('p.name LIKE ?'); params.push(`%${query.search}%`); }
  if (scopeUserId) {
    where.push('(p.manager_id = ? OR EXISTS (SELECT 1 FROM tm_project_members m WHERE m.project_id = p.id AND m.user_id = ?))');
    params.push(scopeUserId, scopeUserId);
  }

  const whereSql = where.join(' AND ');
  const rows = await q(
    `SELECT p.*, u.name AS manager_name,
       (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.is_deleted = 0) AS task_count,
       (SELECT COUNT(*) FROM tm_tasks t WHERE t.project_id = p.id AND t.is_deleted = 0 AND t.status IN ('Completed','Approved')) AS completed_task_count
     FROM tm_projects p
     LEFT JOIN users u ON u._id = p.manager_id
     WHERE ${whereSql} ORDER BY p.${sort} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const countRows = await q(`SELECT COUNT(*) AS total FROM tm_projects p WHERE ${whereSql}`, params);
  return { rows, total: countRows[0].total, page, limit };
}

async function update(id, tenantId, fields) {
  const allowed = ['name', 'description', 'status', 'priority', 'start_date', 'end_date', 'manager_id'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) { sets.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return findById(id, tenantId);
  sets.push('updated_at = NOW()');
  params.push(id, tenantId);
  await q(`UPDATE tm_projects SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  return findById(id, tenantId);
}

async function softDelete(id, tenantId, deletedBy) {
  return q(
    `UPDATE tm_projects SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ?`,
    [deletedBy, id, tenantId]
  );
}

async function addMember(projectId, userId, tenantId, roleInProject = 'Member') {
  return q(
    `INSERT IGNORE INTO tm_project_members (project_id, user_id, role_in_project, tenant_id) VALUES (?, ?, ?, ?)`,
    [projectId, userId, roleInProject, tenantId]
  );
}

async function removeMember(projectId, userId) {
  return q(`DELETE FROM tm_project_members WHERE project_id = ? AND user_id = ?`, [projectId, userId]);
}

async function getMembers(projectId) {
  return q(
    `SELECT u._id, u.name, u.email, u.role, u.photo, pm.role_in_project FROM tm_project_members pm
     JOIN users u ON u._id = pm.user_id WHERE pm.project_id = ?`,
    [projectId]
  );
}

async function getMemberUserIds(projectId) {
  const rows = await q(`SELECT user_id FROM tm_project_members WHERE project_id = ?`, [projectId]);
  return rows.map((r) => r.user_id);
}

async function allTasksCompleted(projectId) {
  const rows = await q(
    `SELECT COUNT(*) AS pending FROM tm_tasks WHERE project_id = ? AND is_deleted = 0 AND status NOT IN ('Completed','Approved')`,
    [projectId]
  );
  return rows[0].pending === 0;
}

async function isManagerOrMember(projectId, userId) {
  const rows = await q(
    `SELECT 1 FROM tm_projects WHERE id = ? AND manager_id = ?
     UNION SELECT 1 FROM tm_project_members WHERE project_id = ? AND user_id = ?`,
    [projectId, userId, projectId, userId]
  );
  return rows.length > 0;
}

module.exports = {
  create, findById, findByPublicId, list, update, softDelete,
  addMember, removeMember, getMembers, getMemberUserIds,
  allTasksCompleted, isManagerOrMember
};
