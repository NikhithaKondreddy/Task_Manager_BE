
const express = require('express');
const router = express.Router();
const workflowService = require('./workflowService');
const auth = require('../middleware/auth');
const { requireAuth, requireRole } = require('../middleware/roles');
const errorResponse = require('../utils/errorResponse');
let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { logger = require('../logger'); }

router.use(auth);

router.use((req, res, next) => {
  let tid = req.tenantId || (req.user && req.user.tenant_id) || null;
  if (typeof tid === 'string' && tid.startsWith('tenant_')) {
    const suffix = tid.replace('tenant_', '');
    if (suffix && !isNaN(suffix)) {
      tid = parseInt(suffix, 10);
    }
  }
  req.normalizedTenantId = tid;
  next();
});


router.post('/request', requireAuth, async (req, res) => {
  try {
    const { entityType, entityId, toState, projectId, meta } = req.body;
    logger.info(`[WORKFLOW REQUEST] Body: ${JSON.stringify(req.body)}, User: ${req.user._id}, Role: ${req.user.role}`);

    if (!entityType) return res.status(400).json(errorResponse.badRequest('entityType is required', 'MISSING_PARAMETER', null, 'entityType'));
    if (!entityId) return res.status(400).json(errorResponse.badRequest('entityId is required', 'MISSING_PARAMETER', null, 'entityId'));
    if (!toState) return res.status(400).json(errorResponse.badRequest('toState is required', 'MISSING_PARAMETER', null, 'toState'));
    if (!['TASK', 'PROJECT'].includes(entityType)) return res.status(400).json(errorResponse.badRequest('entityType must be TASK or PROJECT', 'INVALID_PARAMETER', null, 'entityType'));

    const tenantId = req.normalizedTenantId;
    const userId = req.user._id;
    const role = req.user.role;

    const result = await workflowService.requestTransition({
      tenantId,
      entityType,
      entityId,
      toState,
      userId,
      role,
      projectId,
      meta
    });
    res.json({ success: true, data: result });
  } catch (e) {
    logger.error("[ERROR] /workflow/request:", e);
    res.status(400).json(errorResponse.badRequest(e.message, 'WORKFLOW_REQUEST_ERROR'));
  }
});


router.post('/project/close-request', requireAuth, requireRole(['MANAGER']), async (req, res) => {
  try {
    const { projectId, reason } = req.body;
    const tenantId = req.normalizedTenantId;
    const userId = req.user._id;

    if (!projectId) return res.status(400).json(errorResponse.badRequest('projectId is required', 'MISSING_PARAMETER', null, 'projectId'));

    const result = await workflowService.requestProjectClosure({ tenantId, projectId, reason, userId });
    return res.json({ success: true, message: 'Project closure request sent to admin', data: result });
  } catch (e) {
    logger.error('[ERROR] /workflow/project/close-request:', e);
    return res.status(400).json(errorResponse.badRequest(e.message, 'PROJECT_CLOSURE_ERROR'));
  }
});


router.post('/approve', requireAuth, requireRole(['MANAGER', 'ADMIN']), async (req, res) => {
  try {
    const { requestId, action, reason } = req.body;
    const tenantId = req.normalizedTenantId;
    const userId = req.user._id;
    const userRole = req.user.role;

    if (!['APPROVE', 'REJECT'].includes(action)) {
      return res.status(400).json(errorResponse.badRequest("Invalid action. Must be 'APPROVE' or 'REJECT'.", 'INVALID_ACTION'));
    }

    const result = await workflowService.processApproval({
      tenantId,
      requestId,
      action,
      reason,
      userId,
      userRole
    });

    res.json({
      success: true,
      message: result.message,
      data: result
    });
  } catch (e) {
    logger.error("[ERROR] /workflow/approve:", e);
    res.status(400).json(errorResponse.badRequest(e.message, 'APPROVAL_PROCESSING_ERROR'));
  }
});




router.get('/pending', requireAuth, async (req, res) => {
  try {
    let role = req.query.role || req.user.role;
    if (role.toUpperCase() === 'ADMIN') role = 'Admin';
    else if (role.toUpperCase() === 'MANAGER') role = 'Manager';

    const requestedStatus = req.query.status || (['Manager', 'Admin'].includes(role) ? 'all' : 'PENDING');

    const tenantId = req.normalizedTenantId;
    const userId = req.user._id; // Get the logged-in user's ID
    const userPublicId = req.user.public_id || req.user.id; // Get the user's public ID
    const projectId = req.query.projectId;

    let pendingRequests = [];
    let approvedRequests = [];

    if (requestedStatus === 'all' || requestedStatus === 'PENDING') {
        pendingRequests = await workflowService.getRequests({ tenantId, role, status: 'PENDING', userId, userPublicId, projectId });
    }

    if (requestedStatus === 'all' || requestedStatus === 'APPROVED') {
        approvedRequests = await workflowService.getRequests({ tenantId, role, status: 'APPROVED', userId, userPublicId, projectId });
    }

    const filterClosedProjects = (requests) =>
      requests.filter((r) => String((r.project && r.project.status) || '').toUpperCase() !== 'CLOSED');

    const filteredPendingRequests = filterClosedProjects(pendingRequests);

    const filteredApprovedRequests = approvedRequests;

    const responseData = {
      ready_to_approve: filteredPendingRequests,
      already_approved: filteredApprovedRequests
    };

    const totalRequests = responseData.ready_to_approve.length + responseData.already_approved.length;
    const listMessage = totalRequests > 0
      ? `Fetched ${responseData.ready_to_approve.length} pending and ${responseData.already_approved.length} approved workflow requests.`
      : "No workflow requests found.";

    res.json({
      success: true,
      message: listMessage,
      data: responseData,
      readOnly: false // Both sections are clearly separated
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/history/:entityType/:entityId', requireAuth, async (req, res) => {
  try {
    const { entityType, entityId } = req.params;
    const tenantId = req.normalizedTenantId;

    const history = await workflowService.getHistory(tenantId, entityType, entityId);
    res.json({ success: true, data: history });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
