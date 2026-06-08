const db = require('../db');

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function listRoles(tenantId) {
  return query(
    `
      SELECT id, tenant_id, name, description, is_system_role, is_active, created_at, updated_at
      FROM roles
      WHERE tenant_id = ?
      ORDER BY name ASC
    `,
    [tenantId]
  );
}

async function getRoleById(tenantId, id) {
  const rows = await query(
    `
      SELECT id, tenant_id, name, description, is_system_role, is_active, created_at, updated_at
      FROM roles
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `,
    [tenantId, id]
  );
  return rows[0] || null;
}

async function createRole(tenantId, payload, userId) {
  const name = String(payload.name || payload.roleName || `Role-${Date.now()}`).trim();
  if (!name) throw new Error('Role name is required');
  const description = payload.description ? String(payload.description).trim() : null;
  const isActive = payload.isActive === undefined ? 1 : Number(Boolean(payload.isActive));

  const duplicate = await query(
    'SELECT id FROM roles WHERE tenant_id = ? AND name = ? LIMIT 1',
    [tenantId, name]
  );
  if (duplicate.length) return getRoleById(tenantId, duplicate[0].id);

  const result = await query(
    `
      INSERT INTO roles (tenant_id, name, description, is_system_role, is_active, created_by, updated_by)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `,
    [tenantId, name, description, isActive, userId || null, userId || null]
  );

  return getRoleById(tenantId, result.insertId);
}

async function updateRole(tenantId, id, payload, userId) {
  const existing = await getRoleById(tenantId, id);
  if (!existing) return { id: Number(id), updated: false, message: 'Role not found' };
  if (Number(existing.is_system_role)) return existing;

  const name = payload.name ? String(payload.name).trim() : existing.name;
  const description = payload.description !== undefined ? (payload.description ? String(payload.description).trim() : null) : existing.description;
  const isActive = payload.isActive === undefined ? existing.is_active : Number(Boolean(payload.isActive));

  await query(
    `
      UPDATE roles
      SET name = ?, description = ?, is_active = ?, updated_by = ?, updated_at = NOW()
      WHERE tenant_id = ? AND id = ?
    `,
    [name, description, isActive, userId || null, tenantId, id]
  );

  return getRoleById(tenantId, id);
}

async function deleteRole(tenantId, id) {
  const existing = await getRoleById(tenantId, id);
  if (!existing) return { id: Number(id), deleted: true, noop: true };
  if (Number(existing.is_system_role)) return { id: Number(id), deleted: false, noop: true, message: 'System role retained' };

  await query('DELETE FROM roles WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

async function listPermissions(tenantId) {
  return query(
    `
      SELECT id, tenant_id, name, description, module, action, is_system_permission, is_active, created_at, updated_at
      FROM permissions
      WHERE tenant_id = ?
      ORDER BY module ASC, action ASC
    `,
    [tenantId]
  );
}

module.exports = {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
};
