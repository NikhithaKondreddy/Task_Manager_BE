const db = require('../db');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { resolveTenantPublicId } = require('../utils/tenantId');



module.exports = async function tenantMiddleware(req, res, next) {
  try {
    // If auth middleware has already populated req.user, use it (most reliable source)
    if (req.user && req.user.tenant_id !== undefined && req.user.tenant_id !== null) {
      req.tenantId = req.user.tenant_id;          // integer FK for DB queries
      req.publicTenantId = req.user.publicTenantId || null; // UUID string for responses
      try {
        if (req.publicTenantId) res.setHeader('x-tenant-id', String(req.publicTenantId));
      } catch (_) {}
      return next();
    }

    const auth = req.headers['authorization'] || req.headers['Authorization'];
    if (!auth || !auth.startsWith('Bearer ')) {
      return next();
    }

    const token = auth.split(' ')[1];
    let payload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET || 'secret', { ignoreExpiration: true });
    } catch (e) {
      return next();
    }

    const userId = payload && payload.id;
    if (!userId) {
      return next();
    }

    const q = 'SELECT tenant_id FROM users WHERE _id = ? OR public_id = ? LIMIT 1';
    db.query(q, [userId, String(userId)], async (err, results) => {
      if (err) return next();
      if (results && results.length > 0) {
        const intId = results[0].tenant_id;
        req.tenantId = intId;
        try {
          const publicId = await resolveTenantPublicId(intId);
          req.publicTenantId = publicId || null;
          if (publicId) res.setHeader('x-tenant-id', String(publicId));
        } catch (_) {}
      }
      return next();
    });
  } catch (e) {
    return next();
  }
};
