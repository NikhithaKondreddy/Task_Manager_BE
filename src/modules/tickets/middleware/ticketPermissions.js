const { normalizeTicketRoleKey, buildPermissionSet } = require('../helpers/ticketUtils');

function withTicketPermissions(req) {
  const ticketRole = normalizeTicketRoleKey(req.user && req.user.role);
  const permissions = buildPermissionSet(req.user && req.user.role);
  req.ticketRoleKey = ticketRole;
  req.ticketPermissions = permissions;
  return { ticketRole, permissions };
}

function deny(res, message) {
  return res.status(403).json({
    success: false,
    message,
  });
}

function requireTicketViewAccess(req, res, next) {
  const userRole = req.user && req.user.role;
  // Allow Admin, Manager, and SuperAdmin to view tickets directly
  if (['Admin', 'Manager', 'SuperAdmin'].includes(userRole)) {
    return next();
  }
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole) return deny(res, 'Not allowed to view tickets');
  // allow scoped reads (e.g., regional/state scoped engineers) as well
  if (!permissions.readAll && !permissions.readAssigned && !permissions.readOwn && !permissions.readScoped) {
    return deny(res, 'Not allowed to view tickets');
  }
  return next();
}

function requireTicketCreateAccess(req, res, next) {
  const userRole = req.user && req.user.role;
  // Allow Admin, Manager, and SuperAdmin to create tickets directly
  if (['Admin', 'Manager', 'SuperAdmin'].includes(userRole)) {
    return next();
  }
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.create) return deny(res, 'Not allowed to create tickets');
  return next();
}

function requireTicketManagementAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || (!permissions.update && !permissions.updateOwn)) return deny(res, 'Not allowed to update tickets');
  return next();
}

function requireTicketAssignAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.assign) return deny(res, 'Not allowed to assign tickets');
  return next();
}

function requireTicketCommentAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.comment) return deny(res, 'Not allowed to comment on tickets');
  return next();
}

function requireTicketCatalogManagementAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.manageCatalog) return deny(res, 'Not allowed to manage categories');
  return next();
}

function requireTicketMappingManagementAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.manageMappings) return deny(res, 'Not allowed to manage engineer mappings');
  return next();
}

function requireTicketSlaManagementAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.manageSla) return deny(res, 'Not allowed to manage SLA policies');
  return next();
}

function requireTicketReportAccess(req, res, next) {
  const { ticketRole, permissions } = withTicketPermissions(req);
  if (!ticketRole || !permissions.readReports) return deny(res, 'Not allowed to view ticket reports');
  return next();
}

module.exports = {
  requireTicketViewAccess,
  requireTicketCreateAccess,
  requireTicketManagementAccess,
  requireTicketAssignAccess,
  requireTicketCommentAccess,
  requireTicketCatalogManagementAccess,
  requireTicketMappingManagementAccess,
  requireTicketSlaManagementAccess,
  requireTicketReportAccess,
};
