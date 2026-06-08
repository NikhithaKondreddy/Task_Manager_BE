const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/roles');
const tenantMiddleware = require('../middleware/tenant');
const { assertTenantId } = require('../utils/tenantScope');
const taskWorkflowAutomationService = require('../services/taskWorkflowAutomationService');

router.use(requireAuth);
router.use(tenantMiddleware);

function sendError(res, error) {
  return res.status(error.status || 500).json({
    success: false,
    error: error.message || 'Operation failed'
  });
}

router.get('/escalated', requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const limit = Number(req.query.limit || 100);
    const offset = Number(req.query.offset || 0);
    const data = await taskWorkflowAutomationService.getEscalatedTasks({ tenantId, limit, offset });
    return res.json({ success: true, data, meta: { count: data.length, limit, offset } });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/automation/run', requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const result = await taskWorkflowAutomationService.runAutomation(tenantId);
    return res.json({ success: true, data: result });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/start', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.startTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer started', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/timer/start', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.startTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer started', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/pause', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.pauseTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer paused', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/timer/pause', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.pauseTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer paused', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/resume', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.resumeTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer resumed', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/timer/resume', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.resumeTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer resumed', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/stop', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.stopTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer stopped', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:id/timer/stop', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.stopTaskTimer(req.params.id, req.user, tenantId);
    return res.json({ success: true, message: 'Timer stopped', data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:id/time-logs', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.getTaskTimerLogs(req.params.id, req.user, tenantId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:id/timer/logs', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.getTaskTimerLogs(req.params.id, req.user, tenantId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/:id/escalation-history', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const data = await taskWorkflowAutomationService.getEscalationHistory(req.params.id, tenantId);
    return res.json({ success: true, data });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
