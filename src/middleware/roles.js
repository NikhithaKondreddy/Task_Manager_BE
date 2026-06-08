const jwt = require('jsonwebtoken');
const db = require('../db');
const HttpError = require('../errors/HttpError');
const env = require('../config/env');
const {
  expandAllowedRoles,
  normalizeRole
} = require('../config/rbac');

async function requireAuth(req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization || req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new HttpError(401, 'Missing or invalid Authorization header', 'AUTH_MISSING'));
  }
  const token = auth.split(' ')[1];
  try {
    const secret = env.JWT_SECRET || env.SECRET || 'secret';
    const payload = jwt.verify(token, secret);
    if (!payload || !payload.id) return next(new HttpError(401, 'Invalid token', 'AUTH_INVALID'));

    const tokenId = payload.id;
    const isNumeric = /^\d+$/.test(String(tokenId));
    const sql = isNumeric ? 'SELECT * FROM users WHERE _id = ? LIMIT 1' : 'SELECT * FROM users WHERE public_id = ? LIMIT 1';
    db.query(sql, [tokenId], (err, results) => {
      if (err) return next(new HttpError(500, 'DB error', 'DB_ERROR'));
      if (!results || results.length === 0) return next(new HttpError(401, 'User not found', 'AUTH_USER_NOT_FOUND'));
      const user = results[0];

      if (req.tenantId && String(user.tenant_id) !== String(req.tenantId)) {
        return next(new HttpError(403, 'Tenant mismatch', 'TENANT_MISMATCH'));
      }

      const externalId = user.public_id || user._id;
      req.user = {
        _id: user._id,
        id: externalId,
        public_id: user.public_id || null,
        name: user.name,
        email: user.email,
        role: user.role,
        normalized_role: normalizeRole(user.role),
        tenant_id: user.tenant_id
      };
      req.tokenExpired = false;
      next();
    });
  } catch (e) {
    if (e && e.name === 'TokenExpiredError') {
      try {
        const secret = env.JWT_SECRET || env.SECRET || 'secret';
        const payload = jwt.verify(token, secret, { ignoreExpiration: true });
        if (!payload || !payload.id) return next(new HttpError(401, 'Invalid token', 'AUTH_INVALID'));

        const tokenId = payload.id;
        const isNumeric = /^\d+$/.test(String(tokenId));
        const sql = isNumeric ? 'SELECT * FROM users WHERE _id = ? LIMIT 1' : 'SELECT * FROM users WHERE public_id = ? LIMIT 1';
        db.query(sql, [tokenId], (err, results) => {
          if (err) return next(new HttpError(500, 'DB error', 'DB_ERROR'));
          if (!results || results.length === 0) return next(new HttpError(401, 'User not found', 'AUTH_USER_NOT_FOUND'));
          const user = results[0];

          if (req.tenantId && String(user.tenant_id) !== String(req.tenantId)) {
            return next(new HttpError(403, 'Tenant mismatch', 'TENANT_MISMATCH'));
          }

          const externalId = user.public_id || user._id;
          req.user = {
            _id: user._id,
            id: externalId,
            public_id: user.public_id || null,
            name: user.name,
            email: user.email,
            role: user.role,
            normalized_role: normalizeRole(user.role),
            tenant_id: user.tenant_id
          };
          req.tokenExpired = true;
          next();
        });
      } catch (e2) {
        return next(new HttpError(401, 'Invalid token', 'AUTH_INVALID'));
      }
    }
    return next(new HttpError(401, 'Invalid token', 'AUTH_INVALID'));
  }
}

function requireRole(roles) {
  const rawRoles = Array.isArray(roles) ? roles : Array.from(arguments);
  const allowed = expandAllowedRoles(rawRoles);
  return function (req, res, next) {
    if (!req.user) return next(new HttpError(401, 'Not authenticated', 'AUTH_MISSING'));
    const userRole = normalizeRole(req.user.role);
    if (!allowed.includes(userRole)) return next(new HttpError(403, 'Insufficient role', 'AUTH_FORBIDDEN'));
    next();
  };
}

module.exports = { requireAuth, requireRole };
