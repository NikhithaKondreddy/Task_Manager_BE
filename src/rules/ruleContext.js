


const buildRuleContext = (req, user, resource = {}) => {
  const context = {
    userId: user ? user._id : null,
    userRole: user ? user.role : null,
    userDepartment: user ? user.department : null,
    resourceOwnerId: resource.ownerId || resource.userId || null,
    resourceId: resource.id || (req.params && req.params.id) || null,




    action: (() => {
      try {
        const norm = s => (s || '').toString().replace(/^\//, '').replace(/\//g, '_').toUpperCase();
        const routePart = req.route && req.route.path ? norm(req.route.path) : '';
        const basePart = req.baseUrl ? norm(req.baseUrl) : '';
        const pathPart = norm(req.path || req.url || '');
        const variants = [];
        variants.push(`${req.method}_${routePart}`); // primary
        if (basePart && routePart) variants.push(`${req.method}_${basePart}_${routePart}`);
        if (pathPart) variants.push(`${req.method}_${pathPart}`);

        return variants[0] || `${req.method}_`;
      } catch (e) {
        return `${req.method}_`;
      }
    })(),
    payload: req.body || {},
    recordStatus: resource.status || null,
    timestamp: new Date().toISOString(),
    ip: req.ip || (req.connection && req.connection.remoteAddress) || 'unknown',

    LEAVE_MAX_DAYS: parseInt(process.env.LEAVE_MAX_DAYS || '5', 10),
    OTP_MAX_REQUESTS: parseInt(process.env.OTP_MAX_REQUESTS || '3', 10),
    recentRequests: 0 // Placeholder, implement based on your rate limiting logic
  };

  if (context.payload.leaveDays) {
    context.leaveDays = context.payload.leaveDays;
  }

  try {
    const p = context.payload || {};

    if (p.clientId && !p.client_id) p.client_id = p.clientId;
    if (p.clientPublicId && !p.client_id) p.client_id = p.clientPublicId;
    if (p.clientPublicId && !p.client_public_id) p.client_public_id = p.clientPublicId;

    if (p.projectId && !p.project_id) p.project_id = p.projectId;
    if (p.projectPublicId && !p.project_id) p.project_id = p.projectPublicId;
    if (p.projectPublicId && !p.project_public_id) p.project_public_id = p.projectPublicId;

    if (p.projectName && !p.name) p.name = p.projectName;
    if (p.project_name && !p.name) p.name = p.project_name;

    if (p.projectManagerPublicId && !p.project_manager_id) p.project_manager_id = p.projectManagerPublicId;
    if (p.project_manager_public_id && !p.project_manager_id) p.project_manager_id = p.project_manager_public_id;

    if (p.startDate && !p.start_date) p.start_date = p.startDate;
    if (p.endDate && !p.end_date) p.end_date = p.endDate;

    if (p.leaveDays && !p.leave_days) p.leave_days = p.leaveDays;

    if (p.priority && typeof p.priority === 'string') p.priority = p.priority.toUpperCase();
  } catch (e) {

  }

  return context;
};

module.exports = { buildRuleContext };