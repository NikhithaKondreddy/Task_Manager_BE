const db = require('../db');
const HttpError = require('../errors/HttpError');
const {
  normalizeRole,
  buildPermissionMatrix,
  hasPermission,
  expandAllowedRoles
} = require('../config/rbac');

const permissionCache = new Map();
const CACHE_TTL_MS = 60 * 1000;

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function loadPermissionOverrides(tenantId, role) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return [];

  const cacheKey = `${tenantId || 'global'}::${normalizedRole}`;
  const cached = permissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;

  try {
    const rows = await q(
      `
        SELECT tenant_id, role_key, module_key, permission_key, allowed
        FROM role_permissions
        WHERE role_key = ?
          AND (tenant_id = ? OR tenant_id IS NULL)
        ORDER BY tenant_id DESC, updated_at DESC, id DESC
      `,
      [normalizedRole, tenantId || null]
    );
    permissionCache.set(cacheKey, {
      rows,
      expiresAt: Date.now() + CACHE_TTL_MS
    });
    return rows;
  } catch (error) {
    if (error && (error.code === 'ER_NO_SUCH_TABLE' || /role_permissions/i.test(error.message || ''))) {
      return [];
    }
    throw error;
  }
}

async function resolvePermissionContext(req) {
  const tenantId = req.user && req.user.tenant_id ? req.user.tenant_id : (req.tenantId || null);
  const overrides = await loadPermissionOverrides(tenantId, req.user && req.user.role);
  const matrix = buildPermissionMatrix(req.user && req.user.role, overrides);
  return { tenantId, overrides, matrix };
}

function authorize(moduleKey, permissionKey) {
  return async function authorizeMiddleware(req, res, next) {
    try {
      if (!req.user) {
        return next(new HttpError(401, 'Not authenticated', 'AUTH_MISSING'));
      }

      const permissionContext = await resolvePermissionContext(req);
      req.permissionMatrix = permissionContext.matrix;

      if (!hasPermission(req.user.role, moduleKey, permissionKey, permissionContext.overrides)) {
        return next(new HttpError(403, `Missing permission ${moduleKey}.${permissionKey}`, 'AUTH_FORBIDDEN'));
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = {
  authorize,
  authorizeRole,
  loadPermissionOverrides,
  resolvePermissionContext
};

/**
 * authorizeRole(...roles) — simple role-level gate using RBAC hierarchy.
 * Accepts one or more role names (persisted or alias). SuperAdmin always passes
 * if any listed role has a level <= 100. Uses expandAllowedRoles so higher-level
 * roles are automatically included.
 *
 * Usage:
 *   router.get('/admin/dashboard', auth, authorizeRole('Admin'), handler);
 *   router.get('/manager/tasks',   auth, authorizeRole('Manager', 'Admin'), handler);
 */
function authorizeRole(...roles) {
  const expanded = expandAllowedRoles(roles.flat());
  return function authorizeRoleMiddleware(req, res, next) {
    if (!req.user) return next(new HttpError(401, 'Not authenticated', 'AUTH_MISSING'));
    const userRole = normalizeRole(req.user.role);
    if (!userRole || !expanded.includes(userRole)) {
      return next(new HttpError(403, 'Access denied for role: ' + (req.user.role || 'unknown'), 'AUTH_FORBIDDEN'));
    }
    next();
  };
}
