const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/roles');
const ticketService = require('../modules/tickets/services/ticketService');
const reportService = require('../modules/tickets/services/reportService');
const metricsService = require('../modules/tickets/services/metricsService');
const searchService = require('../modules/tickets/services/searchService');
const workloadService = require('../modules/tickets/services/workloadService');
const locationService = require('../modules/tickets/services/locationService');
const bulkTicketService = require('../modules/tickets/services/bulkTicketService');
const emailTemplateService = require('../services/emailTemplateService');
const knowledgeBaseService = require('../services/knowledgeBaseService');
const adminController = require('../controllers/adminController');
const approvalWorkflowController = require('../modules/tickets/controllers/approvalWorkflowController');

const router = express.Router();

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

router.get('/dashboard/admin', requireAuth, requireRole(['Admin', 'SuperAdmin']), async (req, res) => {
  const data = await ticketService.getDashboard(req.user);
  res.json({ success: true, message: 'Admin dashboard fetched', data });
});

router.get('/dashboard/manager', requireAuth, requireRole(['Manager', 'Admin', 'SuperAdmin']), async (req, res) => {
  const data = await ticketService.getDashboard(req.user);
  res.json({ success: true, message: 'Manager dashboard fetched', data });
});

router.get('/dashboard/engineer', requireAuth, requireRole(['IT Support', 'Manager', 'Admin', 'SuperAdmin']), async (req, res) => {
  const data = await ticketService.getDashboard(req.user);
  res.json({ success: true, message: 'Engineer dashboard fetched', data });
});

router.get('/dashboard/requester', requireAuth, requireRole(['Employee', 'Client-Viewer', 'END_USER', 'Admin', 'SuperAdmin']), async (req, res) => {
  const data = await ticketService.getDashboard(req.user);
  res.json({ success: true, message: 'Requester dashboard fetched', data });
});

router.get('/reports/tickets', requireAuth, async (req, res) => {
  const payload = await reportService.buildReportPayload(req.user.tenant_id, 'summary', req.query);
  if (payload.type === 'application/json') return res.json({ success: true, data: payload.body });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/reports/sla', requireAuth, async (req, res) => {
  const payload = await reportService.buildReportPayload(req.user.tenant_id, 'sla', req.query);
  if (payload.type === 'application/json') return res.json({ success: true, data: payload.body });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/reports/engineers', requireAuth, async (req, res) => {
  const payload = await reportService.buildReportPayload(req.user.tenant_id, 'engineer-performance', req.query);
  if (payload.type === 'application/json') return res.json({ success: true, data: payload.body });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/reports/categories', requireAuth, async (req, res) => {
  const payload = await reportService.buildReportPayload(req.user.tenant_id, 'category', req.query);
  if (payload.type === 'application/json') return res.json({ success: true, data: payload.body });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/reports/locations', requireAuth, async (req, res) => {
  const payload = await reportService.buildReportPayload(req.user.tenant_id, 'region', req.query);
  if (payload.type === 'application/json') return res.json({ success: true, data: payload.body });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/reports/escalations', requireAuth, async (req, res) => {
  const rows = await q(
    `
      SELECT e.id, t.ticket_id, e.escalation_level, e.status, e.reason, e.created_at, e.resolved_at
      FROM ticket_escalations e
      INNER JOIN tickets t ON t.id = e.ticket_id
      WHERE t.tenant_id = ?
      ORDER BY e.created_at DESC
    `,
    [req.user.tenant_id]
  );
  res.json({ success: true, data: rows });
});

router.get('/reports/export/excel', requireAuth, async (req, res) => {
  const type = req.query.type || 'summary';
  const payload = await reportService.buildReportPayload(req.user.tenant_id, type, { ...req.query, format: 'csv' });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/reports/export/pdf', requireAuth, async (req, res) => {
  const type = req.query.type || 'summary';
  const payload = await reportService.buildReportPayload(req.user.tenant_id, type, { ...req.query, format: 'pdf' });
  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

router.get('/audit-logs', requireAuth, requireRole(['Admin', 'SuperAdmin', 'Audit']), async (req, res, next) => {
  const auditController = require('../controllers/auditController');
  return auditController.admin(req, res, next);
});

router.get('/audit-logs/:ticketId', requireAuth, requireRole(['Admin', 'SuperAdmin', 'Audit']), async (req, res) => {
  const rows = await q(
    `
      SELECT id, actor_id, action, entity, entity_id, details, createdAt
      FROM audit_logs
      WHERE entity = 'Ticket' AND entity_id = ? AND tenant_id = ?
      ORDER BY createdAt DESC
    `,
    [String(req.params.ticketId), req.user.tenant_id]
  );
  res.json({ success: true, data: rows });
});

router.get('/email-templates', requireAuth, requireRole(['Admin', 'SuperAdmin']), async (req, res) => {
  const data = await emailTemplateService.listTemplates(req.user.tenant_id);
  res.json({ success: true, data });
});

router.post('/email-templates', requireAuth, requireRole(['Admin', 'SuperAdmin']), async (req, res) => {
  const data = await emailTemplateService.createTemplate(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, data });
});

router.put('/email-templates/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), async (req, res) => {
  const data = await emailTemplateService.updateTemplate(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, data });
});

router.delete('/email-templates/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), async (req, res) => {
  const data = await emailTemplateService.deleteTemplate(req.user.tenant_id, req.params.id);
  res.json({ success: true, data });
});

router.get('/knowledge-base', requireAuth, async (req, res) => {
  const data = await knowledgeBaseService.listArticles(req.user.tenant_id, req.query);
  res.json({ success: true, data });
});

router.post('/knowledge-base', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res) => {
  const data = await knowledgeBaseService.createArticle(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, data });
});

router.put('/knowledge-base/:id', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res) => {
  const data = await knowledgeBaseService.updateArticle(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, data });
});

router.delete('/knowledge-base/:id', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res) => {
  const data = await knowledgeBaseService.deleteArticle(req.user.tenant_id, req.params.id);
  res.json({ success: true, data });
});

router.get('/engineers/workload', requireAuth, async (req, res) => {
  const data = await workloadService.listWorkloads(req.user.tenant_id);
  res.json({ success: true, data });
});

router.get('/engineers/:id/workload', requireAuth, async (req, res) => {
  const data = await workloadService.getWorkloadForEngineer(req.user.tenant_id, req.params.id);
  res.json({ success: true, data });
});

router.get('/engineers/:id/assigned-tickets', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res) => {
  const rows = await q(
    `
      SELECT id, ticket_id, title, status, assigned_to, created_at
      FROM tickets
      WHERE tenant_id = ? AND assigned_to = ?
      ORDER BY created_at DESC
      LIMIT 200
    `,
    [req.user.tenant_id, req.params.id]
  );
  res.json({ success: true, data: rows });
});

router.get('/teams/:id/queue', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res) => {
  const rows = await q(
    `
      SELECT id, ticket_id, title, status, assigned_team_id, created_at
      FROM tickets
      WHERE tenant_id = ? AND assigned_team_id = ? AND assigned_to IS NULL
      ORDER BY created_at DESC
      LIMIT 200
    `,
    [req.user.tenant_id, req.params.id]
  );
  res.json({ success: true, data: rows });
});

router.get('/location-hierarchy', requireAuth, async (req, res) => {
  const data = await locationService.getHierarchy(req.user.tenant_id);
  res.json({ success: true, data });
});

router.get('/states/:id/regions', requireAuth, async (req, res) => {
  const data = await locationService.getRegionsByState(req.user.tenant_id, req.params.id);
  res.json({ success: true, data });
});

router.get('/regions/:id/clusters', requireAuth, async (req, res) => {
  const data = await locationService.getClustersByRegion(req.user.tenant_id, req.params.id);
  res.json({ success: true, data });
});

router.get('/clusters/:id/branches', requireAuth, async (req, res) => {
  const data = await locationService.getBranchesByCluster(req.user.tenant_id, req.params.id);
  res.json({ success: true, data });
});

router.post('/tickets/bulk-assign', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res) => {
  const data = await bulkTicketService.bulkAssign(req.user.tenant_id, req.body || {});
  res.json({ success: true, data });
});

router.post('/tickets/bulk-close', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res) => {
  const data = await bulkTicketService.bulkClose(req.user.tenant_id, req.body || {});
  res.json({ success: true, data });
});

router.post('/tickets/bulk-update-priority', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res) => {
  const data = await bulkTicketService.bulkUpdatePriority(req.user.tenant_id, req.body || {});
  res.json({ success: true, data });
});

router.post('/tickets/bulk-delete', requireAuth, requireRole(['Admin', 'SuperAdmin']), async (req, res) => {
  const data = await bulkTicketService.bulkDelete(req.user.tenant_id, req.body || {});
  res.json({ success: true, data });
});

router.get('/search/tickets', requireAuth, async (req, res) => {
  const data = await searchService.searchTickets(req.user.tenant_id, req.query.q || req.query.search || '');
  res.json({ success: true, data });
});

router.get('/search/users', requireAuth, async (req, res) => {
  const data = await searchService.searchUsers(req.user.tenant_id, req.query.q || req.query.search || '');
  res.json({ success: true, data });
});

router.get('/search/categories', requireAuth, async (req, res) => {
  const data = await searchService.searchCategories(req.user.tenant_id, req.query.q || req.query.search || '');
  res.json({ success: true, data });
});

router.get('/search/engineers', requireAuth, async (req, res) => {
  const data = await searchService.searchEngineers(req.user.tenant_id, req.query.q || req.query.search || '');
  res.json({ success: true, data });
});

router.get('/metrics/tickets', requireAuth, async (req, res) => {
  const data = await metricsService.getTicketMetrics(req.user.tenant_id);
  res.json({ success: true, data });
});

router.get('/metrics/sla', requireAuth, async (req, res) => {
  const data = await metricsService.getSlaMetrics(req.user.tenant_id);
  res.json({ success: true, data });
});

router.get('/metrics/engineers', requireAuth, async (req, res) => {
  const data = await metricsService.getEngineerMetrics(req.user.tenant_id);
  res.json({ success: true, data });
});

router.get('/metrics/dashboard', requireAuth, async (req, res) => {
  const data = await ticketService.getDashboard(req.user);
  res.json({ success: true, data });
});

router.get('/settings', requireAuth, requireRole(['Admin', 'SuperAdmin']), adminController.getSettings);
router.put('/settings', requireAuth, requireRole(['Admin', 'SuperAdmin']), adminController.putSettings);

// Approval actions by approval id
router.post('/approvals/:approvalId/approve', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res, next) => {
  return approvalWorkflowController.approveById(req, res, next);
});

router.post('/approvals/:approvalId/reject', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res, next) => {
  return approvalWorkflowController.rejectById(req, res, next);
});

router.post('/approvals/:approvalId/request-changes', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), async (req, res, next) => {
  return approvalWorkflowController.requestChangesById(req, res, next);
});

// Master data endpoints
router.get('/ticket-statuses', requireAuth, async (req, res) => {
  const statuses = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED', 'REOPENED', 'DRAFT'];
  res.json({ success: true, data: statuses });
});

router.get('/ticket-priorities', requireAuth, async (req, res) => {
  const priorities = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  res.json({ success: true, data: priorities });
});

module.exports = router;
