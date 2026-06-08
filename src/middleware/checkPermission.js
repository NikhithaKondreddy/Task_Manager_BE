const db = require('../db');
const HttpError = require('../errors/HttpError');
const { normalizeRole, hasPermission } = require('../config/rbac');

function parsePermissionName(name) {
  if (!name) return { moduleKey: null, permissionKey: null };
  const raw = String(name).trim();
  if (raw.includes(':')) {
    const [moduleKey, permissionKey] = raw.split(':').map((part) => part.trim());
    return { moduleKey, permissionKey };
  }
  if (raw.includes('.')) {
    const [moduleKey, permissionKey] = raw.split('.').map((part) => part.trim());
    return { moduleKey, permissionKey };
  }
  return { moduleKey: null, permissionKey: raw };
}

function loadOverrides(roleKey, tenantId) {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT module_key, permission_key, allowed FROM role_permissions WHERE role_key = ? AND (tenant_id = ? OR tenant_id IS NULL)';
    db.query(sql, [roleKey, tenantId], (err, rows) => {
      if (err) return reject(err);
      return resolve(rows || []);
    });
  });
}

function resolvePermissionDefinition(permissionName) {
  const parsed = parsePermissionName(permissionName);
  if (parsed.moduleKey && parsed.permissionKey) return Promise.resolve(parsed);

  return new Promise((resolve, reject) => {
    const sql = 'SELECT module, action FROM permissions WHERE name = ? LIMIT 1';
    db.query(sql, [permissionName], (err, rows) => {
      if (err) return reject(err);
      const row = rows && rows[0];
      if (!row) return resolve(parsed);
      resolve({ moduleKey: row.module, permissionKey: row.action });
    });
  });
}

function checkPermission(permissionName) {
  return async function (req, res, next) {
    try {
      if (!req.user) return next(new HttpError(401, 'Not authenticated', 'AUTH_MISSING'));
      const roleKey = normalizeRole(req.user.role);
      if (!roleKey) return next(new HttpError(403, 'Insufficient role', 'AUTH_FORBIDDEN'));

      const { moduleKey, permissionKey } = await resolvePermissionDefinition(permissionName);
      if (!moduleKey || !permissionKey) {
        return next(new HttpError(403, 'Permission not configured', 'PERMISSION_NOT_CONFIGURED'));
      }

      const overrides = await loadOverrides(roleKey, req.user.tenant_id);
      const allowed = hasPermission(roleKey, moduleKey, permissionKey, overrides);
      if (!allowed) return next(new HttpError(403, 'Permission denied', 'PERMISSION_DENIED'));

      return next();
    } catch (error) {
      return next(new HttpError(500, 'Permission check failed', 'PERMISSION_ERROR', { details: error.message }));
    }
  };
}

module.exports = {
  checkPermission,
};
