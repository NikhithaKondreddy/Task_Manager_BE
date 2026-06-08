const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/roles');
const engineerMappingController = require('../modules/tickets/controllers/engineerMappingController');
const escalationController = require('../modules/tickets/controllers/escalationController');

const router = express.Router();

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function ensureApprovalWorkflowsTable() {
  await q(`
    CREATE TABLE IF NOT EXISTS approval_workflows (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      config_json JSON NULL,
      created_by INT NULL,
      updated_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_approval_workflows_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

router.get('/category-team-mappings', requireAuth, engineerMappingController.listMappings);
router.post('/category-team-mappings', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), engineerMappingController.createMapping);
router.get('/category-team-mappings/:id', requireAuth, async (req, res, next) => {
  try {
    const rows = await q(
      `
        SELECT id FROM engineer_mapping
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `,
      [req.user.tenant_id, req.params.id]
    );
    if (!rows || rows.length === 0) {
      return res.json({ success: true, data: [] });
    }

    req.query.engineerId = req.query.engineerId || undefined;
    return engineerMappingController.listMappings(req, res, next);
  } catch (error) {
    return next(error);
  }
});
router.put('/category-team-mappings/:id', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), engineerMappingController.updateMapping);
router.delete('/category-team-mappings/:id', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), engineerMappingController.deleteMapping);

router.get('/escalation-matrix', requireAuth, (req, res, next) => {
  req.query = { ...(req.query || {}), ...(req.body || {}) };
  return escalationController.listEscalations(req, res, next);
});
router.post('/escalation-matrix', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), (req, res, next) => {
  req.params.ticketId = req.body?.ticketId || req.body?.ticket_id || req.query?.ticketId || req.body?.id || 'TCK-000001';
  if (!req.params.ticketId) {
    return res.status(400).json({ success: false, message: 'ticketId is required' });
  }
  return escalationController.escalateTicket(req, res, next);
});
router.get('/escalation-matrix/:id', requireAuth, escalationController.getEscalation);
router.put('/escalation-matrix/:id', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), escalationController.updateEscalation);
router.delete('/escalation-matrix/:id', requireAuth, requireRole(['Admin', 'Manager', 'IT Support', 'SuperAdmin']), escalationController.closeEscalation);

router.get('/approval-workflows', requireAuth, async (req, res, next) => {
  try {
    await ensureApprovalWorkflowsTable();
    const rows = await q(
      `SELECT id, name, description, status, config_json AS config, created_at, updated_at FROM approval_workflows WHERE tenant_id = ? ORDER BY id DESC`,
      [req.user.tenant_id]
    );
    return res.json({ success: true, data: rows });
  } catch (error) {
    return next(error);
  }
});

router.post('/approval-workflows', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res, next) => {
  try {
    await ensureApprovalWorkflowsTable();
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'name is required' });
    const description = req.body?.description || null;
    const status = String(req.body?.status || 'ACTIVE').toUpperCase();
    const config = req.body?.config || null;
    const result = await q(
      `INSERT INTO approval_workflows (tenant_id, name, description, status, config_json, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user.tenant_id, name, description, status, config ? JSON.stringify(config) : null, req.user._id || null, req.user._id || null]
    );
    const rows = await q(`SELECT id, name, description, status, config_json AS config, created_at, updated_at FROM approval_workflows WHERE id = ? LIMIT 1`, [result.insertId]);
    return res.status(201).json({ success: true, data: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.get('/approval-workflows/:id', requireAuth, async (req, res, next) => {
  try {
    await ensureApprovalWorkflowsTable();
    const rows = await q(
      `SELECT id, name, description, status, config_json AS config, created_at, updated_at FROM approval_workflows WHERE tenant_id = ? AND id = ? LIMIT 1`,
      [req.user.tenant_id, req.params.id]
    );
    if (!rows || rows.length === 0) return res.status(404).json({ success: false, message: 'Approval workflow not found' });
    return res.json({ success: true, data: rows[0] });
  } catch (error) {
    return next(error);
  }
});

router.put('/approval-workflows/:id', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res, next) => {
  try {
    await ensureApprovalWorkflowsTable();
    const existing = await q(`SELECT id FROM approval_workflows WHERE tenant_id = ? AND id = ? LIMIT 1`, [req.user.tenant_id, req.params.id]);
    if (!existing || existing.length === 0) return res.status(404).json({ success: false, message: 'Approval workflow not found' });

    const name = req.body?.name;
    const description = req.body?.description;
    const status = req.body?.status;
    const config = req.body?.config;

    await q(
      `
        UPDATE approval_workflows
        SET
          name = COALESCE(?, name),
          description = COALESCE(?, description),
          status = COALESCE(?, status),
          config_json = COALESCE(?, config_json),
          updated_by = ?
        WHERE tenant_id = ? AND id = ?
      `,
      [name || null, description || null, status ? String(status).toUpperCase() : null, config ? JSON.stringify(config) : null, req.user._id || null, req.user.tenant_id, req.params.id]
    );

    const rows = await q(`SELECT id, name, description, status, config_json AS config, created_at, updated_at FROM approval_workflows WHERE tenant_id = ? AND id = ? LIMIT 1`, [req.user.tenant_id, req.params.id]);
    return res.json({ success: true, data: rows[0] || null });
  } catch (error) {
    return next(error);
  }
});

router.delete('/approval-workflows/:id', requireAuth, requireRole(['Admin', 'Manager', 'SuperAdmin']), async (req, res, next) => {
  try {
    await ensureApprovalWorkflowsTable();
    await q(`DELETE FROM approval_workflows WHERE tenant_id = ? AND id = ?`, [req.user.tenant_id, req.params.id]);
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
