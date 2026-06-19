const db = require('../db');
const { normalizeRole, persistRole } = require('../config/rbac');

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

async function createRole(tenantId, payload, user) {
  const rawName = String(payload.name || payload.roleName || `Role-${Date.now()}`).trim();
  if (!rawName) throw new Error('Role name is required');
  const description = payload.description ? String(payload.description).trim() : null;
  const isActive = payload.isActive === undefined ? 1 : Number(Boolean(payload.isActive));

  const creatorRole = user && user.role ? user.role : null;
  const creatorNormalized = normalizeRole(creatorRole);

  // SuperAdmin creating any 'engineer' role should persist as 'IT Admin' instead of defaulting to IT Support
  let finalName = rawName;
  if (creatorNormalized === 'SUPER_ADMIN' && /engineer/i.test(rawName)) {
    finalName = 'IT Admin';
  }

  // Use canonical persisted name when possible
  const persistedName = persistRole(finalName) || finalName;

  // If creator is an IT admin, restrict which roles they may create to IT-scoped roles
  if (creatorNormalized === 'CENTRAL_IT_ADMIN' || creatorNormalized === 'IT_ADMIN') {
    const allowedItRoles = [
      'End User', 'L1 Engineer', 'Cluster Lead', 'Regional IT Manager', 'Central IT Admin', 'IT Admin', 'IT Support'
    ];
    const allowedNormalized = allowedItRoles.map(normalizeRole).filter(Boolean);
    const newNormalized = normalizeRole(persistedName);
    if (!newNormalized || !allowedNormalized.includes(newNormalized)) {
      throw new Error('IT_ADMIN_CANNOT_CREATE_ROLE');
    }
  }

  const duplicate = await query(
    'SELECT id FROM roles WHERE tenant_id = ? AND name = ? LIMIT 1',
    [tenantId, persistedName]
  );
  if (duplicate.length) return getRoleById(tenantId, duplicate[0].id);

  const createdBy = user && (user._id || user.id) ? (user._id || user.id) : null;
  const result = await query(
    `
      INSERT INTO roles (tenant_id, name, description, is_system_role, is_active, created_by, updated_by)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `,
    [tenantId, persistedName, description, isActive, createdBy, createdBy]
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

async function getPermissionById(tenantId, id) {
  const rows = await query(
    `
      SELECT id, tenant_id, name, description, module, action, is_system_permission, is_active, created_at, updated_at
      FROM permissions
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `,
    [tenantId, id]
  );
  return rows[0] || null;
}

async function createPermission(tenantId, payload, user) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Permission name is required');
  const moduleName = String(payload.module || '').trim();
  const action = String(payload.action || 'read').trim();
  const description = payload.description ? String(payload.description).trim() : null;
  const isActive = payload.isActive === undefined ? 1 : Number(Boolean(payload.isActive));

  const duplicate = await query(
    'SELECT id FROM permissions WHERE tenant_id = ? AND name = ? LIMIT 1',
    [tenantId, name]
  );
  if (duplicate.length) return getPermissionById(tenantId, duplicate[0].id);

  const createdBy = user && (user._id || user.id) ? (user._id || user.id) : null;
  const result = await query(
    `
      INSERT INTO permissions (tenant_id, name, description, module, action, is_system_permission, is_active, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)
    `,
    [tenantId, name, description, moduleName, action, isActive, createdBy, createdBy]
  );

  return getPermissionById(tenantId, result.insertId);
}

async function updatePermission(tenantId, id, payload, userId) {
  const existing = await getPermissionById(tenantId, id);
  if (!existing) throw new Error('Permission not found');
  if (Number(existing.is_system_permission)) return existing;

  const name = payload.name ? String(payload.name).trim() : existing.name;
  const description = payload.description !== undefined ? (payload.description ? String(payload.description).trim() : null) : existing.description;
  const moduleName = payload.module ? String(payload.module).trim() : existing.module;
  const action = payload.action ? String(payload.action).trim() : existing.action;
  const isActive = payload.isActive === undefined ? existing.is_active : Number(Boolean(payload.isActive));

  await query(
    `
      UPDATE permissions
      SET name = ?, description = ?, module = ?, action = ?, is_active = ?, updated_by = ?, updated_at = NOW()
      WHERE tenant_id = ? AND id = ?
    `,
    [name, description, moduleName, action, isActive, userId || null, tenantId, id]
  );

  return getPermissionById(tenantId, id);
}

async function deletePermission(tenantId, id) {
  const existing = await getPermissionById(tenantId, id);
  if (!existing) return { id: Number(id), deleted: true, noop: true };
  if (Number(existing.is_system_permission)) return { id: Number(id), deleted: false, noop: true, message: 'System permission retained' };

  await query('DELETE FROM permissions WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

module.exports = {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  listPermissions,
  getPermissionById,
  createPermission,
  updatePermission,
  deletePermission,
};
