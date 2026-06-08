const db = require('../db');
let errorResponse;
try {
  if (typeof __root !== 'undefined') errorResponse = require(__root + 'utils/errorResponse');
  else errorResponse = require('../utils/errorResponse');
} catch (e) {
  errorResponse = { serverError: (m) => ({ success: false, message: m }) };
}


const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

const auditCleanupService = require('../services/auditCleanupService');

let logger = console;
try {
  if (typeof __root !== 'undefined') logger = require(__root + 'logger');
  else logger = require('../logger');
} catch (e) {
  logger = console;
}

function parsePagination(req) {
  const perPage = parseInt(req.query.limit || '25', 10) || 25;
  const page = parseInt(req.query.page || '1', 10) || 1;
  const offset = (page - 1) * perPage;
  return { perPage, page, offset };
}

async function buildBaseQuery(filters = {}) {
  const where = [];
  const params = [];
  if (filters.tenantId !== undefined && filters.tenantId !== null) {
    where.push('a.tenant_id = ?');
    params.push(filters.tenantId);
  }
  if (filters.from) { where.push('a.createdAt >= ?'); params.push(filters.from); }
  if (filters.to) { where.push('a.createdAt <= ?'); params.push(filters.to); }
  if (filters.actor) { where.push('(u.name LIKE ? OR a.actor_id = ?)'); params.push('%' + filters.actor + '%'); params.push(filters.actor); }
  if (filters.action) { where.push('a.action = ?'); params.push(filters.action); }
  return { whereClause: where.length ? ('WHERE ' + where.join(' AND ')) : '', params };
}

function inferActor(details, row) {
  if (!details || typeof details !== 'object') return null;
  const keys = ['performedBy', 'userName', 'actor_name', 'uploadedBy', 'approvedBy', 'userRole', 'clientName', 'sentTo', 'assignedBy', 'assignedTo'];
  for (const k of keys) {
    if (details[k]) {
      const name = String(details[k]);
      const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-_]/g, '');
      return { id, name };
    }
  }
  return null;
}

function normalizeLogRow(r) {
  let details = r.details;
  try { if (typeof details === 'string' && details.length) details = JSON.parse(details); } catch (e) { }

  if (details && details.status === 'error' && details.message) {
    details.message = 'Something went wrong. Please try again later.';
  }

  let actorId = (r.actor_id !== null && r.actor_id !== undefined) ? r.actor_id : null;
  let actorName = r.actor_name || null;
  if (!actorName || actorName === null) {
    const inferred = inferActor(details, r);
    if (inferred) { actorId = actorId || inferred.id; actorName = inferred.name; }
  }

  if (!actorId) {
    if ((r.entity && r.entity.toLowerCase() === 'system') || (r.action && /system/i.test(r.action))) actorId = 'system';
    else actorId = 'unknown';
  }
  if (!actorName) {
    if (actorId === 'system') actorName = 'System';
    else actorName = 'Unknown';
  }

  const entityId = (r.entity_id === null || r.entity_id === undefined) ? '' : r.entity_id;

  function fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => (n < 10 ? '0' + n : '' + n);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  const merged = Object.assign({}, details || {});
  const topLevelFields = [
    'performedBy', 'userName', 'tenant', 'ipAddress', 'device', 'status',
    'assignedTo', 'assignedBy', 'project', 'from', 'to', 'clientName',
    'fileName', 'uploadedBy', 'userRole', 'location', 'reason', 'attemptsLeft',
    'type', 'channel', 'sentTo', 'approvedBy', 'previousStatus', 'newStatus'
  ];

  const out = {
    id: r.id,
    actor: { id: String(actorId), name: actorName },
    action: r.action,
    entity: r.entity,
    entityId: entityId,
    details: details || {},
    timestamp: fmt(r.createdAt)
  };

  for (const k of topLevelFields) {
    if (merged && Object.prototype.hasOwnProperty.call(merged, k)) {
      out[k] = merged[k];
    }
  }

  out.logId = `LOG${r.id}`;
  out.module = r.entity || (merged.module || merged.entity) || null;
  out.performedBy = out.performedBy || actorName || null;
  out.userId = out.userId || String(actorId) || null;
  out.tenantId = merged.tenant || merged.tenantId || null;
  out.ipAddress = merged.ipAddress || merged.ip || null;
  out.status = merged.status || null;

  return out;
}

module.exports = {

  log: async (entry) => {
    try {
      const actorId = entry.user_id || entry.actor_id || null;
      const action = entry.action || 'ACTION';
      const entity = entry.entity || null;
      const entityId = entry.entity_id || entry.entityId || null;
      const tenantId = entry.tenant_id || entry.tenantId || null;
      const details = entry.metadata || entry.details || {};
      await q(`INSERT INTO audit_logs (tenant_id, actor_id, action, entity, entity_id, details, createdAt) VALUES (?, ?, ?, ?, ?, ?, NOW())`, [tenantId, actorId, action, entity, entityId, JSON.stringify(details)]);
    } catch (e) {
      try { logger.error('auditController.log failed:', e); } catch (_) { console.error('auditController.log failed:', e); }
    }
  },


  // auditlogs 
  admin: async (req, res, next) => {
    try {
      const { perPage, page, offset } = parsePagination(req);
      const filters = { tenantId: req.user && req.user.tenant_id, from: req.query.from, to: req.query.to, actor: req.query.actor, action: req.query.action };
      const base = await buildBaseQuery(filters);

      const returnAll = String(req.query.all || '').toLowerCase() === 'true';
      let rows = [];
      let total = 0;
      if (returnAll) {
        const sqlAll = `
          SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.details, a.createdAt
          FROM audit_logs a
          LEFT JOIN users u ON u._id = a.actor_id
          ${base.whereClause}
          ORDER BY a.createdAt DESC
        `;
        rows = await q(sqlAll, base.params);
        total = (rows && rows.length) || 0;
      } else {
        const countSql = `SELECT COUNT(*) AS total FROM audit_logs a LEFT JOIN users u ON u._id = a.actor_id ${base.whereClause}`;
        const totalRows = await q(countSql, base.params);
        total = (totalRows && totalRows[0] && totalRows[0].total) || 0;

        const sql = `
          SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.details, a.createdAt
          FROM audit_logs a
          LEFT JOIN users u ON u._id = a.actor_id
          ${base.whereClause}
          ORDER BY a.createdAt DESC
          LIMIT ? OFFSET ?
        `;
        rows = await q(sql, [...base.params, perPage, offset]);
      }

      const logs = (rows || []).map(normalizeLogRow);

      return res.json({ success: true, data: { total, page, perPage, logs } });
    } catch (err) {
      return next(err);
    }
  },

  manager: async (req, res, next) => {
    try {
      const { perPage, page, offset } = parsePagination(req);
      const filters = { tenantId: req.user && req.user.tenant_id, from: req.query.from, to: req.query.to, actor: req.query.actor, action: req.query.action };

      const projectId = req.query.projectId || req.query.project_id;
      const base = await buildBaseQuery(filters);

      const managerInternalId = req.user && (req.user._id || null);
      const managerPublicId = req.user && (req.user.public_id || req.user.id || null);

      let assignedClientIds = [];
      try {
        const RoleBasedLoginResponse = require('../controllers/utils/RoleBasedLoginResponse');
        const resources = await RoleBasedLoginResponse.getAccessibleResources(managerInternalId, req.user.role, req.user.tenant_id, managerPublicId);
        if (resources && Array.isArray(resources.assignedClientIds)) assignedClientIds = resources.assignedClientIds;
      } catch (e) {
        assignedClientIds = [];
      }

      const projRows = await q(`SELECT id, public_id FROM projects WHERE project_manager_id = ? OR project_manager_id = ? OR manager_id = ? OR manager_id = ?`, [managerInternalId, managerPublicId || -1, managerInternalId, managerPublicId || -1]).catch(() => []);
      const projectIds = (projRows || []).map(r => r && r.id).filter(Boolean);
      const projectPublicIds = (projRows || []).map(r => r && r.public_id).filter(Boolean);

      const teamRows = await q('SELECT _id, public_id FROM users WHERE manager_id = ? OR manager_id = ? LIMIT 1000', [managerInternalId, managerPublicId || -1]).catch(() => []);
      const teamInternalIds = (teamRows || []).map(r => r && r._id).filter(Boolean);
      const teamPublicIds = (teamRows || []).map(r => r && r.public_id).filter(Boolean);

      let whereClause = base.whereClause;
      const params = [...base.params];
      if (projectId) { // narrow to project-related entries
        whereClause = whereClause ? (whereClause + ' AND a.entity = ? AND a.entity_id = ?') : 'WHERE a.entity = ? AND a.entity_id = ?';
        params.push('project'); params.push(projectId);
      }

      const mgrParts = [];
      const mgrParams = [];
      if (assignedClientIds && assignedClientIds.length) {
        mgrParts.push("(a.entity = 'Client' AND a.entity_id IN (?))");
        mgrParams.push(assignedClientIds);
      }
      if (projectPublicIds && projectPublicIds.length) {
        mgrParts.push("(a.entity = 'Project' AND a.entity_id IN (?))");
        mgrParams.push(projectPublicIds);
      }
      if (projectIds && projectIds.length) {

        mgrParts.push("(a.entity = 'Task' AND EXISTS (SELECT 1 FROM tasks t WHERE (t.public_id = a.entity_id OR t.id = a.entity_id) AND (t.project_id IN (?) OR t.project_public_id IN (?))))");
        mgrParams.push(projectIds);
        mgrParams.push(projectPublicIds.length ? projectPublicIds : projectIds);
      } else if (projectPublicIds && projectPublicIds.length) {
        mgrParts.push("(a.entity = 'Task' AND EXISTS (SELECT 1 FROM tasks t WHERE (t.public_id = a.entity_id OR t.id = a.entity_id) AND (t.project_public_id IN (?))))");
        mgrParams.push(projectPublicIds);
      }
      const actorFilterIds = new Set();
      if (managerInternalId) actorFilterIds.add(managerInternalId);
      if (managerPublicId) actorFilterIds.add(managerPublicId);
      if (teamInternalIds && teamInternalIds.length) teamInternalIds.forEach(id => actorFilterIds.add(id));
      if (teamPublicIds && teamPublicIds.length) teamPublicIds.forEach(id => actorFilterIds.add(id));

      const distinctActorIds = Array.from(actorFilterIds);
      if (distinctActorIds.length) {
        mgrParts.push('(a.actor_id IN (?))');
        mgrParams.push(distinctActorIds);
      }

      if (mgrParts.length) {
        whereClause = whereClause ? (whereClause + ' AND (' + mgrParts.join(' OR ') + ')') : ('WHERE (' + mgrParts.join(' OR ') + ')');
        params.push(...mgrParams);
      }

      const returnAll = String(req.query.all || '').toLowerCase() === 'true';
      let rows = [];
      let total = 0;
      if (returnAll) {
        const sqlAll = `
          SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.details, a.createdAt
          FROM audit_logs a
          LEFT JOIN users u ON u._id = a.actor_id
          ${whereClause}
          ORDER BY a.createdAt DESC
        `;
        rows = await q(sqlAll, params);
        total = (rows && rows.length) || 0;
      } else {
        const sql = `
            SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.details, a.createdAt
            FROM audit_logs a
            LEFT JOIN users u ON u._id = a.actor_id
            ${whereClause}
            ORDER BY a.createdAt DESC
            LIMIT ? OFFSET ?
          `;
        rows = await q(sql, [...params, perPage, offset]);
      }

      const logs = (rows || []).map(normalizeLogRow);

      return res.json({ success: true, data: { total, page, perPage, logs } });
    } catch (err) {
      return next(err);
    }
  },

  employee: async (req, res, next) => {
    try {
      const { perPage, page, offset } = parsePagination(req);
      const filters = { tenantId: req.user && req.user.tenant_id, from: req.query.from, to: req.query.to, action: req.query.action };
      const base = await buildBaseQuery(filters);



      const actorInternal = req.user && (req.user._id || null);
      const actorPublic = req.user && (req.user.public_id || req.user.id || null);
      const actorIds = [];
      if (actorInternal !== null && actorInternal !== undefined) actorIds.push(actorInternal);
      if (actorPublic !== null && actorPublic !== undefined && actorPublic !== actorInternal) actorIds.push(actorPublic);

      if (actorIds.length === 0) {
        return res.json({ success: true, data: { total: 0, page, perPage, logs: [] } });
      }

      const whereClause = base.whereClause ? (base.whereClause + ' AND (a.actor_id IN (?))') : 'WHERE (a.actor_id IN (?))';
      const params = [...base.params, actorIds];

      const returnAll = String(req.query.all || '').toLowerCase() === 'true';
      let rows = [];
      let total = 0;
      const actorId = req.user && (req.user._id || req.user.id);
      if (returnAll) {
        const sqlAll = `
          SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.details, a.createdAt
          FROM audit_logs a
          LEFT JOIN users u ON u._id = a.actor_id
          ${whereClause}
          ORDER BY a.createdAt DESC
        `;
        rows = await q(sqlAll, params);
        total = (rows && rows.length) || 0;
      } else {
        const countSql = `SELECT COUNT(*) AS total FROM audit_logs a LEFT JOIN users u ON u._id = a.actor_id ${whereClause}`;
        const totalRows = await q(countSql, params);
        total = (totalRows && totalRows[0] && totalRows[0].total) || 0;

        const sql = `
          SELECT a.id, a.actor_id, u.name AS actor_name, a.action, a.entity, a.entity_id, a.details, a.createdAt
          FROM audit_logs a
          LEFT JOIN users u ON u._id = a.actor_id
          ${whereClause}
          ORDER BY a.createdAt DESC
          LIMIT ? OFFSET ?
        `;
        rows = await q(sql, [...params, perPage, offset]);
      }

      const logs = (rows || []).map(normalizeLogRow);

      return res.json({ success: true, data: { total, page, perPage, logs } });
    } catch (err) {
      return next(err);
    }
  },

  // Delete audit logs older than specified days or by specific criteria
  delete: async (req, res, next) => {
    try {
      const { days, beforeDate, tenantId, actorId, action, entity } = req.body;

      // Build WHERE clause for deletion
      const whereConditions = [];
      const params = [];

      // Only allow deletion by authorized roles (Admin, SuperAdmin)
      if (!req.user || !['Admin', 'SuperAdmin'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions to delete audit logs'
        });
      }

      // Add tenant filter for non-SuperAdmin users
      if (req.user.role !== 'SuperAdmin') {
        whereConditions.push('tenant_id = ?');
        params.push(req.user.tenant_id);
      } else if (tenantId) {
        whereConditions.push('tenant_id = ?');
        params.push(tenantId);
      }

      // Add date filter
      if (days && days > 0) {
        whereConditions.push('createdAt < DATE_SUB(NOW(), INTERVAL ? DAY)');
        params.push(days);
      } else if (beforeDate) {
        whereConditions.push('createdAt < ?');
        params.push(beforeDate);
      }

      // Add optional filters
      if (actorId) {
        whereConditions.push('actor_id = ?');
        params.push(actorId);
      }
      if (action) {
        whereConditions.push('action = ?');
        params.push(action);
      }
      if (entity) {
        whereConditions.push('entity = ?');
        params.push(entity);
      }

      if (whereConditions.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No deletion criteria specified. Please provide days, beforeDate, or other filters.'
        });
      }

      const whereClause = 'WHERE ' + whereConditions.join(' AND ');

      // First, get count of records to be deleted
      const countSql = `SELECT COUNT(*) as count FROM audit_logs ${whereClause}`;
      const countResult = await q(countSql, params);
      const recordsToDelete = countResult[0].count;

      if (recordsToDelete === 0) {
        return res.json({
          success: true,
          message: 'No audit logs found matching the criteria',
          data: { deletedCount: 0 }
        });
      }

      // Perform the deletion
      const deleteSql = `DELETE FROM audit_logs ${whereClause}`;
      await q(deleteSql, params);

      // Log the deletion action
      await module.exports.log({
        user_id: req.user._id,
        tenant_id: req.user.tenant_id,
        action: 'DELETE_AUDIT_LOGS',
        entity: 'AuditLog',
        entity_id: null,
        details: {
          deletedCount: recordsToDelete,
          criteria: { days, beforeDate, tenantId, actorId, action, entity },
          performedBy: req.user.name || req.user.email
        }
      });

      return res.json({
        success: true,
        message: `Successfully deleted ${recordsToDelete} audit log entries`,
        data: { deletedCount: recordsToDelete }
      });

    } catch (err) {
      logger.error('auditController.delete failed:', err);
      return next(err);
    }
  },

  // Get audit cleanup statistics
  getCleanupStats: async (req, res, next) => {
    try {
      const tenantId = req.user.role === 'SuperAdmin' ? req.query.tenantId : req.user.tenant_id;
      const result = await auditCleanupService.getCleanupStats(tenantId);

      if (!result.success) {
        return res.status(500).json(result);
      }

      return res.json(result);
    } catch (err) {
      logger.error('auditController.getCleanupStats failed:', err);
      return next(err);
    }
  },

  // Manually trigger audit cleanup
  cleanup: async (req, res, next) => {
    try {
      // Only allow Admin and SuperAdmin to trigger cleanup
      if (!req.user || !['Admin', 'SuperAdmin'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions to trigger audit cleanup'
        });
      }

      const { daysOld = 30, tenantId } = req.body;

      // Validate daysOld
      if (daysOld < 1 || daysOld > 365) {
        return res.status(400).json({
          success: false,
          error: 'daysOld must be between 1 and 365'
        });
      }

      // For non-SuperAdmin, use their tenant
      const targetTenantId = req.user.role === 'SuperAdmin' ? tenantId : req.user.tenant_id;

      const result = await auditCleanupService.performCleanup(daysOld, targetTenantId);

      if (!result.success) {
        return res.status(500).json(result);
      }

      return res.json(result);
    } catch (err) {
      logger.error('auditController.cleanup failed:', err);
      return next(err);
    }
  }
};
