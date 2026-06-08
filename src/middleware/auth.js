const jwt = require('jsonwebtoken');
const db = require(__root + 'db');
const HttpError = require('../errors/HttpError');
const env = require('../config/env');
const { resolveTenantPublicId } = require('../utils/tenantId');
const { resolveScopedEntity } = require('../utils/tenantScope');
module.exports = function (req, res, next) {
  const auth = req.headers.authorization || req.headers.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return next(new HttpError(401, 'Unauthorized', 'AUTH_MISSING'));
  const token = auth.split(' ')[1];
  try {
    const secret = env.JWT_SECRET || env.SECRET || process.env.SECRET || 'secret';
    // Debug log
    // console.log('Verifying token with secret:', secret.substring(0, 5) + '...');
    const decoded = jwt.verify(token, secret);
    const tokenId = decoded.id;
    if (!tokenId) return next(new HttpError(401, 'Invalid token', 'AUTH_INVALID'));

    const isNumeric = /^\d+$/.test(String(tokenId));
    const sql = isNumeric
      ? 'SELECT _id, public_id, name, email, role, tenant_id FROM users WHERE _id = ? LIMIT 1'
      : 'SELECT _id, public_id, name, email, role, tenant_id FROM users WHERE public_id = ? LIMIT 1';

    db.query(sql, [tokenId], async (err, rows) => {
      if (err) return next(new HttpError(500, 'Database error', 'DB_ERROR'));
      if (!rows || rows.length === 0) return next(new HttpError(401, 'User not found', 'AUTH_USER_NOT_FOUND'));
      const u = rows[0];
      // Ensure tenant_id is a numeric internal id. Coerce numeric strings, or
      // resolve a public_id -> internal id when needed. Fall back to original
      // value if resolution fails.
      let tenantInternal = u.tenant_id;
      try {
        if (tenantInternal !== null && tenantInternal !== undefined && tenantInternal !== '') {
          const s = String(tenantInternal).trim();
          if (/^\d+$/.test(s)) {
            tenantInternal = Number(s);
          } else {
            const resolved = await resolveScopedEntity('tenants', s, null).catch(() => null);
            if (resolved && resolved.id) tenantInternal = resolved.id;
          }
        }
      } catch (e) {
        // keep original tenantInternal on error
      }

      const publicTenantId = await resolveTenantPublicId(tenantInternal).catch(() => null);
      req.user = { _id: u._id, id: u.public_id || String(u._id), name: u.name, email: u.email, role: u.role, tenant_id: tenantInternal, publicTenantId };
      next();
    });
  } catch (e) {
    console.error('Auth Middleware Error:', e.message);
    if (e && e.name === 'TokenExpiredError') return next(new HttpError(401, 'Token expired', 'AUTH_EXPIRED'));
    return next(new HttpError(401, 'Invalid token: ' + e.message, 'AUTH_INVALID'));
  }
};
