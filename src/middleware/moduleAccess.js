const db = require('../db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function checkModuleAccess(moduleName, accessType = 'full') {
  return async function checkModuleAccessMiddleware(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Not authenticated' });
      }

      const userId = req.user._id;
      const role = req.user.role;

      // For SuperAdmin, allow all
      if (role === 'SuperAdmin') {
        return next();
      }

      // For Admin, check admin_modules table
      if (role === 'Admin') {
        const modules = await q(
          'SELECT name, access FROM admin_modules WHERE admin_id = ?',
          [userId]
        );
        const module = modules.find(m => m.name === moduleName);
        if (!module) {
          return res.status(403).json({ success: false, error: 'Module access denied' });
        }
        if (accessType === 'full' && module.access !== 'full') {
          return res.status(403).json({ success: false, error: 'Full access required' });
        }
        if (accessType === 'read' && !['read', 'full'].includes(module.access)) {
          return res.status(403).json({ success: false, error: 'Read access required' });
        }
        return next();
      }

      // For other roles, check default modules or deny
      return res.status(403).json({ success: false, error: 'Module access denied' });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
}

module.exports = { checkModuleAccess };