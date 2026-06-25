const db = require(__root + 'db');
const express = require('express');
const router = express.Router();
const logger = require(__root + 'logger');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mime = require('mime-types');
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const { authorize } = require(__root + 'middleware/authorize');
const errorResponse = require(__root + 'utils/errorResponse');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const RULES = require(__root + 'rules/ruleCodes');
const { normalizeProjectStatus } = require(__root + 'utils/projectStatus');
const { assertTenantId, tableHasColumn: hasTenantColumn } = require(__root + 'utils/tenantScope');

function createProjectStatusInfo(projectStatus, isLocked) {
  const raw = projectStatus == null ? null : String(projectStatus);
  const upper = raw ? raw.toUpperCase() : '';
  const locked = isLocked === 1 || isLocked === true;

  const isPendingClosure = upper === 'PENDING_FINAL_APPROVAL';
  const isProjectClosed = upper === 'CLOSED' || upper === 'COMPLETED' || upper === 'CANCELLED' || (locked && !isPendingClosure);
  const isActive = upper === 'ACTIVE' || upper === 'ONHOLD';

  return {

    raw: raw,

    display: isPendingClosure ? 'PENDING_CLOSURE' : (isProjectClosed ? 'CLOSED' : raw || 'PLANNING'),

    is_closed: isProjectClosed,
    is_pending_closure: isPendingClosure,
    is_locked: locked,
    can_create_tasks: !locked && !isPendingClosure && !isProjectClosed,
    can_edit_project: !locked && !isPendingClosure && !isProjectClosed,
    can_request_closure: !locked && !isPendingClosure && !isProjectClosed && upper === 'ACTIVE'
  };
}

const NotificationService = require('../services/notificationService');
require('dotenv').config();
let env;
try { env = require(__root + 'config/env'); } catch (e) { env = require('../config/env'); }
router.use(requireAuth);

const uploadsRoot = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsRoot);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const base = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9-_\.]/g, '_');
    const name = `${base}_${Date.now()}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function hasColumn(table, column) {
  try {
    const rows = await q("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    return false;
  }
}

function resolveTenantId(req) {
  return assertTenantId(req);
}

function currentRole(req) {
  return String((req.user && req.user.role) || '').toLowerCase();
}

function isAdminLike(req) {
  const role = currentRole(req);
  return role === 'admin' || role === 'superadmin';
}

function isManagerLike(req) {
  return currentRole(req) === 'manager';
}

function isEmployeeLike(req) {
  return currentRole(req) === 'employee';
}

async function resolveProjectForTenant(id, tenantId, includeArchived = false) {
  let sql = 'SELECT * FROM projects WHERE tenant_id = ? AND (id = ? OR public_id = ?)';
  const params = [tenantId, id, id];
  if (!includeArchived) sql += ' AND COALESCE(is_active, 1) = 1';
  sql += ' LIMIT 1';
  const rows = await q(sql, params);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function resolveClientForTenant(identifier, tenantId) {
  const hasPublic = await hasColumn('clients', 'public_id');
  const hasDeleted = await hasColumn('clients', 'isDeleted');
  const conditions = [];
  const params = [tenantId];

  if (/^\d+$/.test(String(identifier))) {
    conditions.push('id = ?');
    params.push(Number(identifier));
  }

  if (hasPublic) {
    conditions.push('public_id = ?');
    params.push(String(identifier));
  }

  conditions.push('ref = ?');
  params.push(String(identifier));

  let sql = `SELECT id, name, email${hasPublic ? ', public_id' : ''}, ref FROM clients WHERE tenant_id = ? AND (${conditions.join(' OR ')})`;
  if (hasDeleted) sql += ' AND COALESCE(isDeleted, 0) != 1';
  sql += ' LIMIT 1';

  const rows = await q(sql, params);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function resolveUserForTenant(identifier, tenantId) {
  if (identifier === undefined || identifier === null || identifier === '') return null;

  const conditions = [];
  const params = [tenantId];
  const hasPublicId = await hasColumn('users', 'public_id');
  const hasEmail = await hasColumn('users', 'email');
  if (/^\d+$/.test(String(identifier))) {
    conditions.push('_id = ?');
    params.push(Number(identifier));
  }
  if (hasPublicId) {
    conditions.push('public_id = ?');
    params.push(String(identifier));
  }
  if (hasEmail) {
    conditions.push('LOWER(email) = LOWER(?)');
    params.push(String(identifier));
  }

  if (!conditions.length) return null;

  const rows = await q(
    `SELECT _id${hasPublicId ? ', public_id' : ', NULL as public_id'}, name, email
     FROM users
     WHERE tenant_id = ? AND (${conditions.join(' OR ')})
     LIMIT 1`,
    params
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function resolveDepartmentsForTenant(values, tenantId) {
  const inputs = Array.isArray(values) ? values.filter(Boolean).map((value) => String(value)) : [];
  if (!inputs.length) return [];

  const numeric = inputs.filter((value) => /^\d+$/.test(value)).map((value) => Number(value));
  const publicIds = inputs.filter((value) => !/^\d+$/.test(value));
  const clauses = [];
  const params = [tenantId];

  if (numeric.length) {
    clauses.push(`id IN (${numeric.map(() => '?').join(',')})`);
    params.push(...numeric);
  }

  if (publicIds.length) {
    clauses.push(`public_id IN (${publicIds.map(() => '?').join(',')})`);
    params.push(...publicIds);
  }

  const rows = await q(
    `SELECT id, public_id, name
     FROM departments
     WHERE tenant_id = ? AND (${clauses.join(' OR ')})`,
    params
  );
  return Array.isArray(rows) ? rows : [];
}

async function getManagerDepartmentPublicId(req, tenantId) {
  const rows = await q(
    'SELECT department_public_id FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1',
    [req.user._id, tenantId]
  ).catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0].department_public_id : null;
}

async function canAccessProject(req, project, tenantId) {
  if (!project) return false;
  if (isAdminLike(req)) return true;

  if (isManagerLike(req)) {
    if (String(project.project_manager_id || '') === String(req.user._id || '')) return true;
    if (String(project.project_manager_id || '') === String(req.user.public_id || '')) return true;

    const departmentPublicId = await getManagerDepartmentPublicId(req, tenantId);
    if (!departmentPublicId) return false;

    const rows = await q(
      `SELECT 1
       FROM project_departments pd
       JOIN departments d ON d.id = pd.department_id
       WHERE pd.project_id = ?
         AND d.tenant_id = ?
         AND d.public_id = ?
       LIMIT 1`,
      [project.id, tenantId, departmentPublicId]
    ).catch(() => []);

    return Array.isArray(rows) && rows.length > 0;
  }

  if (isEmployeeLike(req)) {
    const rows = await q(
      `SELECT 1
       FROM task_assignments ta
       JOIN tasks t ON t.id = ta.task_id
       WHERE t.tenant_id = ?
         AND ta.user_id = ?
         AND (t.project_id = ? OR t.project_public_id = ?)
       LIMIT 1`,
      [tenantId, req.user._id, project.id, project.public_id]
    ).catch(() => []);

    return Array.isArray(rows) && rows.length > 0;
  }

  return false;
}

async function loadProjectDepartments(projectId, tenantId) {
  return q(
    `SELECT pd.department_id, d.name, d.public_id
     FROM project_departments pd
     JOIN departments d ON pd.department_id = d.id
     WHERE pd.project_id = ?
       AND d.tenant_id = ?`,
    [projectId, tenantId]
  ).catch(() => []);
}

async function loadProjectUsers(projectId, tenantId) {
  return q(
    `SELECT DISTINCT
        u._id,
        u.public_id,
        u.name,
        u.email,
        u.phone,
        u.title,
        u.role,
        u.isActive,
        u.isGuest,
        u.department_public_id,
        d.name AS department_name
     FROM project_departments pd
     JOIN departments d
       ON d.id = pd.department_id
      AND d.tenant_id = pd.tenant_id
     JOIN users u
       ON u.department_public_id = d.public_id
      AND u.tenant_id = d.tenant_id
     WHERE pd.project_id = ?
       AND pd.tenant_id = ?
       AND u.role = 'Employee'
     ORDER BY u.name ASC, u._id ASC`,
    [projectId, tenantId]
  ).catch(() => []);
}

router.post('/', upload.array('documents', 10), ruleEngine(RULES.PROJECT_CREATE), requireRole(['Admin', 'Manager']), authorize('projects', 'create'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { projectName, description, clientPublicId, projectManagerId, projectManagerPublicId, project_manager_id: request_project_manager_id, projectManagerEmail, project_manager_email, managerEmail, department_ids = [], departmentIds = [], departmentPublicIds = [], priority = 'Medium', startDate, endDate, start_date, end_date, budget } = req.body;

    if (!projectName || !clientPublicId) {
      return res.status(400).json(errorResponse.badRequest('projectName and clientPublicId are required', 'MISSING_REQUIRED_FIELDS'));
    }

    const client = await resolveClientForTenant(clientPublicId, tenantId);
    if (!client) {
      return res.status(404).json(errorResponse.notFound('Client not found', 'CLIENT_NOT_FOUND'));
    }
    const clientId = client.id;
    const clientInfo = client;

    const deptInput = Array.isArray(departmentPublicIds) && departmentPublicIds.length > 0 ? departmentPublicIds : (department_ids.length > 0 ? department_ids : departmentIds);
    let deptIdMap = {};
    let departmentNames = [];
    if (Array.isArray(deptInput) && deptInput.length > 0) {

      const deptRecords = await resolveDepartmentsForTenant(deptInput, tenantId);

      deptRecords.forEach(d => {
        if (d.public_id) deptIdMap[d.public_id] = d.id;
        deptIdMap[String(d.id)] = d.id;
        departmentNames.push(d.name);
      });

      const notFound = deptInput.filter(di => !deptIdMap[String(di)]);
      if (notFound.length > 0) {
        return res.status(400).json({ success: false, message: `Departments not found: ${notFound.join(', ')}` });
      }
    }

    const publicId = crypto.randomBytes(8).toString('hex');
    const user = req.user || {};
    const userId = user.id || user._id;
    const userRole = String(user.role || '').toUpperCase();
    const createdBy = req.user._id;

    let project_manager_id = request_project_manager_id;
    if (userRole === 'MANAGER') {
      project_manager_id = userId; // override with self
    }

    let pmId = null;
    let projectManagerInfo = null;
    if (userRole === 'MANAGER') {
      const pmUser = await resolveUserForTenant(project_manager_id || userId, tenantId);
      if (!pmUser) {
        return res.status(400).json(errorResponse.badRequest('Project manager not found', 'PROJECT_MANAGER_NOT_FOUND'));
      }
      pmId = pmUser._id;
      projectManagerInfo = pmUser;
    } else {
      const pmPublic = projectManagerPublicId || projectManagerId || project_manager_id || request_project_manager_id || projectManagerEmail || project_manager_email || managerEmail || null;
      if (pmPublic) {
        const pmUser = await resolveUserForTenant(pmPublic, tenantId);
        if (!pmUser) {
          return res.status(400).json(errorResponse.badRequest('Project manager not found', 'PROJECT_MANAGER_NOT_FOUND'));
        }
        pmId = pmUser._id;
        projectManagerInfo = pmUser;
      }
    }

    const projectSql = `
      INSERT INTO projects (tenant_id, public_id, client_id, project_manager_id, name, description, priority, start_date, end_date, budget, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANNING', ?)
    `;
    const projectParams = [tenantId, publicId, clientId, pmId, projectName, description || null, priority, startDate || start_date || null, endDate || end_date || null, budget || null, createdBy];

    const result = await q(projectSql, projectParams);
    const projectId = result.insertId;

    if (Array.isArray(deptInput) && deptInput.length > 0) {
      for (const di of deptInput) {
        const deptId = deptIdMap[String(di)];
        if (deptId) {
          await q('INSERT INTO project_departments (project_id, department_id, tenant_id) VALUES (?, ?, ?)', [projectId, deptId, tenantId]).catch(async () => {
            await q('INSERT IGNORE INTO project_departments (project_id, department_id, tenant_id) VALUES (?, ?, ?)', [projectId, deptId, tenantId]);
          });
        }
      }
    }

    const projectRows = await q('SELECT * FROM projects WHERE id = ? AND tenant_id = ? LIMIT 1', [projectId, tenantId]);
    const project = projectRows[0];
    const depts = await loadProjectDepartments(projectId, tenantId);

    const response = {
      id: project.public_id,
      public_id: project.public_id,
      name: project.name,
      description: project.description,
      priority: project.priority,
      start_date: project.start_date,
      end_date: project.end_date,
      budget: project.budget,
      status: project.status,
      created_at: project.created_at,
      tenant_id: project.tenant_id,
      departments: depts.map(d => ({ public_id: d.public_id, name: d.name })),
      client: { public_id: client.public_id || client.ref || client.id, name: client.name }
    };

    if (project.project_manager_id) {
      const pmRows = await q('SELECT public_id, name FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1', [project.project_manager_id, tenantId]);
      if (pmRows && pmRows.length > 0) {
        response.project_manager = { public_id: pmRows[0].public_id, name: pmRows[0].name };
      }
    }

    const emailService = require(__root + 'utils/emailService');

    const projectLink = `${env.FRONTEND_URL || env.BASE_URL}/projects/${publicId}`;
    const creatorName = req.user.name || 'Administrator';

    const emailResults = await emailService.sendProjectNotifications({
      projectManagerInfo,
      clientInfo,
      projectName,
      publicId,
      priority,
      startDate: startDate || start_date,
      endDate: endDate || end_date,
      budget,
      departmentNames,
      projectLink,
      creatorName
    });

    logger.info('Project emails sent:', emailResults);

    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id,
        tenant_id: req.user.tenant_id,
        action: 'CREATE_PROJECT',
        entity: 'Project',
        entity_id: publicId,
        details: { name: projectName, clientId: clientPublicId }
      });
    } catch (auditErr) {
      logger.warn('Failed to log create_project audit:', auditErr.message);
    }

    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin', 'Manager'], 'Project Created', `New project "${projectName}" has been created`, 'PROJECT_CREATED', 'project', projectId, req.user ? req.user.tenant_id : null);
      } catch (notifErr) {
        logger.error('Project creation notification error:', notifErr);
      }
    })();

    const attachedDocuments = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${encodeURIComponent(file.filename)}`;
          const fileType = mime.lookup(file.originalname) || file.mimetype || null;
          const documentId = crypto.randomBytes(8).toString('hex');
          await q(
            'INSERT INTO documents (tenant_id, documentId, entityType, entityId, uploadedBy, storageProvider, filePath, encrypted, createdAt, projectId, fileName, mimeType) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?, ?)',
            [tenantId, documentId, 'PROJECT', projectId, req.user._id, 'local', fileUrl, false, projectId, file.originalname, fileType]
          );
          attachedDocuments.push({ documentId, fileName: file.originalname, fileType, fileUrl });
        } catch (e) {
          logger.debug('Failed to attach document for project ' + projectId + ': ' + (e && e.message));
        }
      }
    }

    response.documents = attachedDocuments;

    res.status(201).json({ success: true, data: response });
  } catch (e) {
    logger.error('Create project error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/', authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    if (req.query.dropdown === '1' || req.query.dropdown === 'true') {
      let rows;
      if (isAdminLike(req)) {
        rows = await q('SELECT public_id as projectId, name as projectName FROM projects WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY name', [tenantId]);
      } else if (isManagerLike(req)) {
        rows = await q('SELECT public_id as projectId, name as projectName FROM projects WHERE tenant_id = ? AND (project_manager_id = ? OR project_manager_id = ?) AND COALESCE(is_active, 1) = 1 ORDER BY name', [tenantId, req.user._id, req.user.public_id || null]);
      } else if (isEmployeeLike(req)) {
        rows = await q(`
          SELECT DISTINCT p.public_id as projectId, p.name as projectName FROM projects p
          JOIN tasks t ON p.id = t.project_id
          JOIN task_assignments ta ON t.id = ta.task_id
          WHERE p.tenant_id = ? AND t.tenant_id = ? AND ta.tenant_id = ? AND ta.user_id = ? AND COALESCE(p.is_active, 1) = 1
          ORDER BY p.name
        `, [tenantId, tenantId, tenantId, req.user._id]);
      } else {
        rows = [];
      }

      const out = (rows || []).map(r => ({ projectId: r.projectId, projectName: r.projectName }));
      return res.json(out);
    }

    let projects;

    if (isAdminLike(req)) {

      projects = await q('SELECT * FROM projects WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY created_at DESC', [tenantId]);
    } else if (isManagerLike(req)) {

      projects = await q(`
        SELECT p.* FROM projects p
        WHERE (
          p.project_manager_id = ? OR
          p.project_manager_id = ?
        )
          AND p.tenant_id = ?
          AND COALESCE(p.is_active, 1) = 1
        ORDER BY p.created_at DESC
      `, [req.user._id, req.user.public_id || null, tenantId]);
    } else if (isEmployeeLike(req)) {

      projects = await q(`
        SELECT DISTINCT p.* FROM projects p
        JOIN tasks t ON p.id = t.project_id
        JOIN task_assignments ta ON t.id = ta.task_id
        WHERE p.tenant_id = ?
          AND t.tenant_id = p.tenant_id
          AND ta.tenant_id = p.tenant_id
          AND ta.user_id = ?
          AND COALESCE(p.is_active, 1) = 1
        ORDER BY p.created_at DESC
      `, [tenantId, req.user._id]);
    } else {
      projects = [];
    }

    const clientHasPublic = await hasColumn('clients', 'public_id');
    const enriched = await Promise.all(projects.map(async (p) => {
      const depts = await loadProjectDepartments(p.id, tenantId);
      const out = {
        id: p.public_id,
        public_id: p.public_id,
        name: p.name,
        description: p.description,
        priority: p.priority,
        start_date: p.start_date,
        end_date: p.end_date,
        budget: p.budget,
        status: createProjectStatusInfo(p.status, p.is_locked).display,
        created_at: p.created_at,
        departments: depts.map(d => ({ public_id: d.public_id, name: d.name }))
      };

      try {
        const clientInfo = clientHasPublic ? await q('SELECT public_id, name FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [p.client_id, tenantId]) : await q('SELECT id as public_id, name FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [p.client_id, tenantId]);
        if (clientInfo && clientInfo.length > 0) out.client = { public_id: clientInfo[0].public_id, name: clientInfo[0].name };
      } catch (e) { }
      if (p.project_manager_id) {
        const pm = await q('SELECT public_id, name FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1', [p.project_manager_id, tenantId]);
        if (pm && pm.length > 0) out.project_manager = { public_id: pm[0].public_id, name: pm[0].name };
      }
      return out;
    }));

    res.json({ success: true, data: enriched });
  } catch (e) {
    logger.error('Get projects error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.get('/stats', authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    let projectIds = [];
    let taskIds = [];
    let subtaskIds = [];

    if (isAdminLike(req)) {

      const projects = await q('SELECT id FROM projects WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1', [tenantId]);
      projectIds = projects.map(p => p.id);
    } else if (isManagerLike(req)) {

      const projects = await q('SELECT id FROM projects WHERE tenant_id = ? AND (project_manager_id = ? OR project_manager_id = ?) AND COALESCE(is_active, 1) = 1', [tenantId, req.user._id, req.user.public_id || null]);
      projectIds = projects.map(p => p.id);
    } else if (isEmployeeLike(req)) {

      const projects = await q(`
        SELECT DISTINCT p.id FROM projects p
        JOIN tasks t ON p.id = t.project_id
        JOIN task_assignments ta ON t.id = ta.task_id
        WHERE p.tenant_id = ?
          AND t.tenant_id = p.tenant_id
          AND ta.tenant_id = p.tenant_id
          AND ta.user_id = ?
          AND COALESCE(p.is_active, 1) = 1
      `, [tenantId, req.user._id]);
      projectIds = projects.map(p => p.id);
    }

    if (projectIds.length === 0) {
      return res.json({
        success: true,
        data: {
          projects: { total: 0, byStatus: {} },
          tasks: { total: 0, byStage: {}, totalHours: 0 },
          subtasks: { total: 0, byStatus: {} }
        }
      });
    }

    if (isEmployeeLike(req)) {

      const tasks = projectIds.length > 0 ? await q('SELECT t.id FROM tasks t JOIN task_assignments ta ON t.id = ta.task_id WHERE t.tenant_id = ? AND ta.tenant_id = ? AND ta.user_id = ? AND t.project_id IN (?)', [tenantId, tenantId, req.user._id, projectIds]) : [];
      taskIds = tasks.map(t => t.id);
    } else {

      const tasks = projectIds.length > 0 ? await q('SELECT id FROM tasks WHERE tenant_id = ? AND project_id IN (?)', [tenantId, projectIds]) : [];
      taskIds = tasks.map(t => t.id);
    }

    const subtasks = taskIds.length > 0 ? await q('SELECT id FROM subtasks WHERE tenant_id = ? AND task_id IN (?)', [tenantId, taskIds]).catch(() => []) : [];
    subtaskIds = subtasks.map(s => s.id);

    const projectStats = projectIds.length > 0 ? await q('SELECT status, COUNT(*) as count FROM projects WHERE tenant_id = ? AND id IN (?) GROUP BY status', [tenantId, projectIds]) : [];
    const projectsByStatus = {};
    let totalProjects = 0;
    projectStats.forEach(ps => {
      const key = normalizeProjectStatus(ps.status, false).status || ps.status;
      projectsByStatus[key] = (projectsByStatus[key] || 0) + ps.count;
      totalProjects += ps.count;
    });

    const taskStats = taskIds.length > 0 ? await q('SELECT stage, COUNT(*) as count FROM tasks WHERE tenant_id = ? AND id IN (?) GROUP BY stage', [tenantId, taskIds]) : [];
    const tasksByStage = {};
    let totalTasks = 0;
    taskStats.forEach(ts => {
      tasksByStage[ts.stage] = ts.count;
      totalTasks += ts.count;
    });

    const subtaskStats = subtaskIds.length > 0 ? await q('SELECT status, COUNT(*) as count FROM subtasks WHERE tenant_id = ? AND id IN (?) GROUP BY status', [tenantId, subtaskIds]).catch(() => []) : [];
    const subtasksByStatus = {};
    let totalSubtasks = 0;
    subtaskStats.forEach(ss => {
      subtasksByStatus[ss.status] = ss.count;
      totalSubtasks += ss.count;
    });

    const hoursResult = taskIds.length > 0 ? await q('SELECT SUM(total_duration) as totalSecs FROM tasks WHERE tenant_id = ? AND id IN (?)', [tenantId, taskIds]) : [{ totalSecs: 0 }];
    const totalSecsRaw = hoursResult[0].totalSecs || 0;
    const totalHours = Number((totalSecsRaw / 3600).toFixed(2));

    res.json({
      success: true,
      data: {
        projects: {
          total: totalProjects,
          byStatus: projectsByStatus
        },
        tasks: {
          total: totalTasks,
          byStage: tasksByStage,
          totalHours: totalHours
        },
        subtasks: {
          total: totalSubtasks,
          byStatus: subtasksByStatus
        }
      }
    });
  } catch (e) {
    logger.error('Get stats error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.get('/projectdropdown', requireRole(['Admin', 'Manager', 'Employee']), authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    let results = [];

    if (isAdminLike(req)) {
      results = await q('SELECT public_id as id, name FROM projects WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1 ORDER BY name', [tenantId]);
    } else if (isManagerLike(req)) {
      results = await q('SELECT public_id as id, name FROM projects WHERE tenant_id = ? AND (project_manager_id = ? OR project_manager_id = ?) AND COALESCE(is_active, 1) = 1 ORDER BY name', [tenantId, req.user._id, req.user.public_id || null]);
    } else if (isEmployeeLike(req)) {
      results = await q(`
        SELECT DISTINCT p.public_id as id, p.name
        FROM projects p
        JOIN tasks t ON p.id = t.project_id
        JOIN task_assignments ta ON ta.task_id = t.id
        WHERE p.tenant_id = ?
          AND t.tenant_id = ?
          AND ta.tenant_id = ?
          AND ta.user_id = ?
          AND COALESCE(p.is_active, 1) = 1
        ORDER BY p.name
      `, [tenantId, tenantId, tenantId, req.user._id]);
    }

    return res.status(200).json(results);
  } catch (error) {
    logger.error('Project dropdown error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

router.get('/:id', authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const project = await resolveProjectForTenant(id, tenantId, true);

    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const p = project;
    const depts = await loadProjectDepartments(p.id, tenantId);

    const out = {
      id: p.public_id,
      public_id: p.public_id,
      name: p.name,
      description: p.description,
      priority: p.priority,
      start_date: p.start_date,
      end_date: p.end_date,
      budget: p.budget,
      status: normalizeProjectStatus(p.status, p.is_locked).status,
      created_at: p.created_at,
      departments: depts.map(d => ({ public_id: d.public_id, name: d.name }))
    };
    if (p.project_manager_id) {
      const pmRows = await q('SELECT public_id, name FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1', [p.project_manager_id, tenantId]);
      if (pmRows && pmRows.length > 0) out.project_manager = { public_id: pmRows[0].public_id, name: pmRows[0].name };
    }
    try {
      const clientHasPublic_single = await hasColumn('clients', 'public_id');
      const clientInfo_single = clientHasPublic_single ? await q('SELECT public_id, name FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [p.client_id, tenantId]) : await q('SELECT id as public_id, name FROM clients WHERE id = ? AND tenant_id = ? LIMIT 1', [p.client_id, tenantId]);
      if (clientInfo_single && clientInfo_single.length > 0) out.client = { public_id: clientInfo_single[0].public_id, name: clientInfo_single[0].name };
    } catch (e) { }

    res.json({ success: true, data: out });
  } catch (e) {
    logger.error('Get project error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.put('/:id', ruleEngine(RULES.PROJECT_UPDATE), requireRole(['Admin', 'Manager']), authorize('projects', 'update'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;

    const {
      name,
      description,
      priority,
      startDate,
      endDate,
      start_date,
      end_date,
      budget,
      status,
      department_ids,
      projectManagerId,
      project_manager_id,
      clientPublicId,
      projectManagerPublicId,
      projectManagerEmail,
      project_manager_email,
      managerEmail
    } = req.body;

    const project = await resolveProjectForTenant(id, tenantId, true);
    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const projectId = project.id;
    const projectPublicId = project.public_id;
    const updateFields = [];
    const params = [];

    if (clientPublicId !== undefined) {
      const client = await resolveClientForTenant(clientPublicId, tenantId);
      if (!client) {
        return res.status(400).json({ success: false, message: 'Client not found' });
      }
      updateFields.push('client_id = ?');
      params.push(client.id);
    }

    if (projectManagerPublicId || projectManagerId || project_manager_id || projectManagerEmail || project_manager_email || managerEmail) {
      const pmPublic = projectManagerPublicId || projectManagerId || project_manager_id || projectManagerEmail || project_manager_email || managerEmail;
      const pmUser = await resolveUserForTenant(pmPublic, tenantId);
      if (!pmUser) {
        return res.status(400).json(errorResponse.badRequest('Project manager not found', 'PROJECT_MANAGER_NOT_FOUND'));
      }
      updateFields.push('project_manager_id = ?');
      params.push(pmUser._id);
    }

    if (name) { updateFields.push('name = ?'); params.push(name); }
    if (description !== undefined) { updateFields.push('description = ?'); params.push(description); }
    if (priority) { updateFields.push('priority = ?'); params.push(priority); }
    if (startDate || start_date) { updateFields.push('start_date = ?'); params.push(startDate || start_date); }
    if (endDate || end_date) { updateFields.push('end_date = ?'); params.push(endDate || end_date); }
    if (budget !== undefined) { updateFields.push('budget = ?'); params.push(budget); }
    if (status) { updateFields.push('status = ?'); params.push(status); }

    if (updateFields.length > 0) {
      params.push(projectId, tenantId);
      const sql = `UPDATE projects SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND tenant_id = ?`;
      await q(sql, params);
    }

    if (Array.isArray(department_ids) && department_ids.length > 0) {
      await q('DELETE FROM project_departments WHERE project_id = ? AND tenant_id = ?', [projectId, tenantId]).catch(async () => {
        await q(`DELETE pd FROM project_departments pd JOIN departments d ON pd.department_id = d.id WHERE pd.project_id = ? AND d.tenant_id = ?`, [projectId, tenantId]);
      });
      const deptRecords = await resolveDepartmentsForTenant(department_ids, tenantId);
      const deptIdMap = {};
      deptRecords.forEach(d => deptIdMap[d.public_id] = d.id);

      const notFound = department_ids.filter(deptPublicId => !deptIdMap[deptPublicId]);
      if (notFound.length > 0) {
        return res.status(400).json({ success: false, message: `Departments not found: ${notFound.join(', ')}` });
      }

      for (const deptPublicId of department_ids) {
        const deptId = deptIdMap[deptPublicId];
        if (deptId) {
          try {
            await q('INSERT INTO project_departments (project_id, department_id, tenant_id) VALUES (?, ?, ?)', [projectId, deptId, tenantId]);
          } catch (e) {
            if (!e.message.includes('Duplicate')) {
              throw e;
            }
          }
        }
      }
    }

    const updated = await q('SELECT * FROM projects WHERE id = ? AND tenant_id = ? LIMIT 1', [projectId, tenantId]);
    const depts = await loadProjectDepartments(projectId, tenantId);

    const out = {
      ...updated[0],
      id: updated[0].public_id,
      public_id: updated[0].public_id,
      status: createProjectStatusInfo(updated[0].status, updated[0].is_locked).display,
      departments: depts.map(d => ({ id: d.department_id, name: d.name, public_id: d.public_id }))
    };
    if (updated[0].project_manager_id) {
      const pmRows = await q('SELECT public_id, name FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1', [updated[0].project_manager_id, tenantId]);
      if (pmRows && pmRows.length > 0) out.project_manager = { id: pmRows[0].public_id, name: pmRows[0].name };
    }

    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin', 'Manager'], 'Project Updated', `Project "${name || updated[0].name}" has been updated`, 'PROJECT_UPDATED', 'project', projectId, req.user ? req.user.tenant_id : null);
      } catch (notifErr) {
        logger.error('Project update notification error:', notifErr);
      }
    })();

    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id,
        tenant_id: tenantId,
        action: 'UPDATE_PROJECT',
        entity: 'Project',
        entity_id: projectPublicId,
        details: { before: project, after: updated[0], name: name || updated[0].name, updates: req.body }
      });
    } catch (auditErr) {
      logger.warn('Failed to log update_project audit:', auditErr.message);
    }

    res.json({ success: true, data: out });
  } catch (e) {
    logger.error('Update project error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.post('/:id/departments', ruleEngine(RULES.PROJECT_UPDATE), requireRole(['Admin', 'Manager']), authorize('projects', 'update'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const { department_ids } = req.body;

    if (!Array.isArray(department_ids) || department_ids.length === 0) {
      return res.status(400).json(errorResponse.badRequest('department_ids must be a non-empty array', 'INVALID_DEPARTMENT_IDS'));
    }

    const project = await resolveProjectForTenant(id, tenantId, true);
    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const deptRecords = await resolveDepartmentsForTenant(department_ids, tenantId);
    const deptIdMap = {};
    deptRecords.forEach(d => deptIdMap[d.public_id] = d.id);

    const notFound = department_ids.filter(deptPublicId => !deptIdMap[deptPublicId]);
    if (notFound.length > 0) {
      return res.status(400).json({ success: false, message: `Departments not found: ${notFound.join(', ')}` });
    }

    for (const deptPublicId of department_ids) {
      const deptId = deptIdMap[deptPublicId];
      if (deptId) {
        try {
          await q('INSERT INTO project_departments (project_id, department_id, tenant_id) VALUES (?, ?, ?)', [project.id, deptId, tenantId]);
        } catch (e) {
          if (!e.message.includes('Duplicate')) {
            throw e;
          }
        }
      }
    }

    const depts = await loadProjectDepartments(project.id, tenantId);

    res.json({
      success: true,
      message: 'Departments added to project',
      data: depts.map(d => ({ id: d.department_id, name: d.name, public_id: d.public_id }))
    });
  } catch (e) {
    logger.error('Add departments error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.delete('/:id/departments/:deptId', ruleEngine(RULES.PROJECT_UPDATE), requireRole(['Admin', 'Manager']), authorize('projects', 'update'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id, deptId } = req.params;

    const project = await resolveProjectForTenant(id, tenantId, true);
    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    await q('DELETE FROM project_departments WHERE project_id = ? AND department_id = ? AND tenant_id = ?', [project.id, deptId, tenantId]).catch(async () => {
      await q(`DELETE pd FROM project_departments pd JOIN departments d ON pd.department_id = d.id WHERE pd.project_id = ? AND pd.department_id = ? AND d.tenant_id = ?`, [project.id, deptId, tenantId]);
    });

    res.json({ success: true, message: 'Department removed from project' });
  } catch (e) {
    logger.error('Remove department error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.delete('/:id', ruleEngine(RULES.PROJECT_DELETE), requireRole(['Admin']), authorize('projects', 'delete'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;

    const project = await resolveProjectForTenant(id, tenantId, true);
    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const hasDeletedAt = await hasTenantColumn('projects', 'deleted_at');
    const hasDeletedBy = await hasTenantColumn('projects', 'deleted_by');
    const setParts = ['is_active = 0', 'updated_at = NOW()'];
    const params = [];
    if (hasDeletedAt) setParts.push('deleted_at = NOW()');
    if (hasDeletedBy) {
      setParts.push('deleted_by = ?');
      params.push(req.user._id || null);
    }
    params.push(project.id, tenantId);

    await q(`UPDATE projects SET ${setParts.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id,
        tenant_id: tenantId,
        action: 'ARCHIVE_PROJECT',
        entity: 'Project',
        entity_id: project.public_id,
        details: { before: project, after: { is_active: 0, deleted_by: req.user._id || null } }
      });
    } catch (auditErr) {
      logger.warn('Failed to log archive_project audit:', auditErr.message);
    }

    res.json({ success: true, message: 'Project archived successfully' });
  } catch (e) {
    logger.error('Delete project error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.get('/:id/summary', authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const project = await resolveProjectForTenant(id, tenantId, true);
    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const projectId = project.id;
    const projectPublicId = project.public_id;

    const taskStats = await q('SELECT status, COUNT(*) as count FROM tasks WHERE tenant_id = ? AND (project_id = ? OR project_public_id = ?) GROUP BY status', [tenantId, projectId, projectPublicId]);
    const tasksByStatus = {};
    let totalTasks = 0;
    taskStats.forEach(ts => {
      // Normalize REVIEW to Review to prevent duplicate counts
      const tStatus = ts.status ? (ts.status.toUpperCase() === 'REVIEW' ? 'Review' : ts.status) : 'Unknown';
      tasksByStatus[tStatus] = (tasksByStatus[tStatus] || 0) + ts.count;
      totalTasks += ts.count;
    });

    const completedTasks = await q("SELECT COUNT(*) as count FROM tasks WHERE tenant_id = ? AND (project_id = ? OR project_public_id = ?) AND UPPER(status) IN ('COMPLETED', 'APPROVED')", [tenantId, projectId, projectPublicId]);
    const completedCount = completedTasks[0].count;

    const inProgressTasks = await q("SELECT COUNT(*) as count FROM tasks WHERE tenant_id = ? AND (project_id = ? OR project_public_id = ?) AND UPPER(status) IN ('IN PROGRESS', 'IN_PROGRESS', 'ON HOLD', 'REVIEW', 'PENDING', 'REJECTED')", [tenantId, projectId, projectPublicId]);
    const inProgressCount = inProgressTasks[0].count;

    const hoursResult = await q('SELECT SUM(total_duration) as totalSecs FROM tasks WHERE tenant_id = ? AND (project_id = ? OR project_public_id = ?)', [tenantId, projectId, projectPublicId]);
    const totalSecsRaw = hoursResult[0].totalSecs || 0;
    const totalHours = Number((totalSecsRaw / 3600).toFixed(2));

    const progressPercentage = totalTasks > 0 ? Math.round((completedCount / totalTasks) * 100) : 0;

    res.json({
      success: true,
      data: {
        project: {
          id: project.public_id,
          name: project.name,
          status: createProjectStatusInfo(project.status, project.is_locked).display
        },
        tasks: {
          total: totalTasks,
          completed: completedCount,
          inProgress: inProgressCount,
          byStatus: tasksByStatus
        },
        totalHours: totalHours,
        progressPercentage: progressPercentage
      }
    });
  } catch (e) {
    logger.error('Get project summary error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.get('/:id/users', requireRole(['Admin', 'Manager']), authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const project = await resolveProjectForTenant(id, tenantId, true);

    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const users = await loadProjectUsers(project.id, tenantId);

    res.json({
      success: true,
      data: {
        project: {
          id: project.public_id,
          public_id: project.public_id,
          name: project.name
        },
        users: users.map((user) => ({
          id: user.public_id || String(user._id),
          internalId: String(user._id),
          public_id: user.public_id || null,
          name: user.name || null,
          email: user.email || null,
          phone: user.phone || null,
          title: user.title || null,
          role: user.role || null,
          isActive: user.isActive === undefined ? null : Boolean(user.isActive),
          isGuest: user.isGuest === undefined ? null : Boolean(user.isGuest),
          departmentPublicId: user.department_public_id || null,
          departmentName: user.department_name || null
        }))
      }
    });
  } catch (e) {
    logger.error('Get project users error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});


router.get('/:id/tasks', authorize('projects', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const project = await resolveProjectForTenant(id, tenantId, true);

    if (!project) {
      return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
    }

    if (!await canAccessProject(req, project, tenantId)) {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const projectId = project.id;
    const projectPublicId = project.public_id;
    let tasks;

    if (isAdminLike(req) || isManagerLike(req)) {

      tasks = await q(`
        SELECT
          t.id,
          ANY_VALUE(t.public_id) AS public_id,
          ANY_VALUE(t.title) AS title,
          ANY_VALUE(t.description) AS description,
          ANY_VALUE(t.priority) AS priority,
          ANY_VALUE(t.status) AS status,
          ANY_VALUE(t.stage) AS stage,
          ANY_VALUE(t.taskDate) AS taskDate,
          ANY_VALUE(t.time_alloted) AS time_alloted,
          ANY_VALUE(t.total_duration) AS total_duration,
          ANY_VALUE(t.started_at) AS started_at,
          ANY_VALUE(t.completed_at) AS completed_at,
          ANY_VALUE(t.createdAt) AS createdAt,
          GROUP_CONCAT(DISTINCT u.name) as assigned_users,
          GROUP_CONCAT(DISTINCT u._id) as assigned_user_ids
        FROM tasks t
        LEFT JOIN task_assignments ta ON t.id = ta.task_id
        LEFT JOIN users u ON ta.user_id = u._id
        WHERE t.tenant_id = ?
          AND (t.project_id = ? OR t.project_public_id = ?)
        GROUP BY t.id
        ORDER BY t.createdAt DESC
      `, [tenantId, projectId, projectPublicId]);
    } else if (isEmployeeLike(req)) {

      tasks = await q(`
        SELECT
          t.id,
          ANY_VALUE(t.public_id) AS public_id,
          ANY_VALUE(t.title) AS title,
          ANY_VALUE(t.description) AS description,
          ANY_VALUE(t.priority) AS priority,
          ANY_VALUE(t.status) AS status,
          ANY_VALUE(t.stage) AS stage,
          ANY_VALUE(t.taskDate) AS taskDate,
          ANY_VALUE(t.time_alloted) AS time_alloted,
          ANY_VALUE(t.total_duration) AS total_duration,
          ANY_VALUE(t.started_at) AS started_at,
          ANY_VALUE(t.completed_at) AS completed_at,
          ANY_VALUE(t.createdAt) AS createdAt,
          GROUP_CONCAT(DISTINCT u.name) as assigned_users,
          GROUP_CONCAT(DISTINCT u._id) as assigned_user_ids
        FROM tasks t
        JOIN task_assignments ta ON t.id = ta.task_id
        LEFT JOIN users u ON ta.user_id = u._id
        WHERE t.tenant_id = ?
          AND ta.tenant_id = t.tenant_id
          AND (t.project_id = ? OR t.project_public_id = ?)
          AND ta.user_id = ?
        GROUP BY t.id
        ORDER BY t.createdAt DESC
      `, [tenantId, projectId, projectPublicId, req.user._id]);
    } else {
      return res.status(403).json(errorResponse.forbidden('Access denied', 'ACCESS_DENIED'));
    }

    const formattedTasks = tasks.map(task => ({
      id: task.id,
      public_id: task.public_id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      status: task.status,
      stage: task.stage,
      taskDate: task.taskDate,
      time_alloted: task.time_alloted,
      total_duration: task.total_duration || 0,
      started_at: task.started_at,
      completed_at: task.completed_at,
      created_at: task.created_at,
      assigned_users: task.assigned_users ? task.assigned_users.split(',') : [],
      assigned_user_ids: task.assigned_user_ids ? task.assigned_user_ids.split(',').map(id => parseInt(id)) : []
      ,
      subtasks: []
    }));

    // Fetch subtasks for the tasks and attach only those that belong to this project
    try {
      const taskIds = formattedTasks.map(t => t.id).filter(Boolean);
      if (taskIds.length) {
        const subs = await q(`SELECT id, COALESCE(task_id, task_id) AS task_id, COALESCE(project_id, project_Id) AS project_id, title, description, due_date, tag, status, estimated_hours, completed_at, created_at, updated_at, created_by FROM subtasks WHERE tenant_id = ? AND COALESCE(task_id, task_id) IN (?) AND COALESCE(project_id, project_Id) = ?`, [tenantId, taskIds, projectId]).catch(() => []);
        const subMap = {};
        (subs || []).forEach(s => {
          if (!s || s.task_id === undefined || s.task_id === null) return;
          if (String(s.project_id) !== String(projectId)) return;
          const key = String(s.task_id);
          subMap[key] = subMap[key] || [];
          subMap[key].push({
            id: s.id,
            title: s.title || null,
            description: s.description || null,
            due_date: s.due_date || null,
            tag: s.tag || null,
            status: s.status || null,
            estimated_hours: s.estimated_hours != null ? Number(s.estimated_hours) : null,
            completed_at: s.completed_at || null,
            created_at: s.created_at || null,
            updated_at: s.updated_at || null,
            created_by: s.created_by || null
          });
        });
        formattedTasks.forEach(t => { const key = String(t.id); if (subMap[key]) t.subtasks = subMap[key]; });
      }
    } catch (e) {
      logger.debug('Failed to fetch subtasks for project tasks: ' + (e && e.message));
    }

    res.json({
      success: true,
      data: {
        project_id: projectId,
        project_public_id: projectPublicId,
        tasks: formattedTasks,
        kanban_columns: {
          'To Do': formattedTasks.filter(t => t.status === 'To Do' || t.status === 'Pending' || t.status === 'PENDING'),
          'In Progress': formattedTasks.filter(t => t.status === 'In Progress'),
          'On Hold': formattedTasks.filter(t => t.status === 'On Hold'),
          'Completed': formattedTasks.filter(t => t.status === 'Completed')
        }
      }
    });
  } catch (e) {
    logger.error('Get project tasks error:', e.message);
    res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

module.exports = router;


