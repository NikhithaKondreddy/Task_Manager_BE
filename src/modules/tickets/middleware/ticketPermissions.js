const { normalizeRole } = require('../../../config/rbac');

const VIEWABLE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'IT_SUPPORT', 'MANAGER', 'EMPLOYEE']);
const MANAGE_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'IT_SUPPORT']);
const COMMENT_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'IT_SUPPORT', 'MANAGER', 'EMPLOYEE']);

function getRoleKey(req) {
  return normalizeRole(req.user && req.user.role);
}

function requireTicketViewAccess(req, res, next) {
  const roleKey = getRoleKey(req);
  if (!roleKey || !VIEWABLE_ROLES.has(roleKey)) {
    return res.status(403).json({
      success: false,
      message: 'Not allowed to view tickets'
    });
  }
  req.ticketRoleKey = roleKey;
  next();
}

function requireTicketManagementAccess(req, res, next) {
  const roleKey = getRoleKey(req);
  if (!roleKey || !MANAGE_ROLES.has(roleKey)) {
    return res.status(403).json({
      success: false,
      message: 'Only Admin or IT Support can update tickets'
    });
  }
  req.ticketRoleKey = roleKey;
  next();
}

function requireTicketCommentAccess(req, res, next) {
  const roleKey = getRoleKey(req);
  if (!roleKey || !COMMENT_ROLES.has(roleKey)) {
    return res.status(403).json({
      success: false,
      message: 'Not allowed to comment on tickets'
    });
  }
  req.ticketRoleKey = roleKey;
  next();
}

module.exports = {
  getRoleKey,
  requireTicketViewAccess,
  requireTicketManagementAccess,
  requireTicketCommentAccess,
};
