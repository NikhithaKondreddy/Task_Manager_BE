
const {
  expandAllowedRoles,
  normalizeRole
} = require('../config/rbac');

module.exports.allowRoles = function allowRoles(roles) {
  const rawRoles = Array.isArray(roles) ? roles : Array.from(arguments);
  const allowed = expandAllowedRoles(rawRoles);
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const userRole = normalizeRole(req.user.role);
    if (!allowed.includes(userRole)) return res.status(403).json({ error: 'Forbidden' });
    next();
  };
};
module.exports.userHasRole = function (req, role) {
  const userRole = req.user && req.user.role ? normalizeRole(req.user.role) : '';
  return userRole === normalizeRole(role || '');
};
