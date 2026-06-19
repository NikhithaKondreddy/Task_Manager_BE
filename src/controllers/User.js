const express = require("express");
const router = express.Router();
const db = require(__root + "db");
const logger = require("../logger");
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const otpService = require(__root + 'utils/otpService');
const emailService = require(__root + 'utils/emailService');
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const { authorize } = require(__root + 'middleware/authorize');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const RULES = require(__root + 'rules/ruleCodes');
const {
  persistRole,
  normalizeRole,
  canManageRole
} = require(__root + 'config/rbac');
const {
  buildTenantFilter,
  appendWhere,
  resolveScopedEntity
} = require(__root + 'utils/tenantScope');

const NotificationService = require('../services/notificationService');
const errorResponse = require(__root + 'utils/errorResponse');
const engineerMappingService = require('../modules/tickets/services/engineerMappingService');
require('dotenv').config();
let env;
try { env = require(__root + 'config/env'); } catch (e) { env = require('../config/env'); }

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

const tableHasColumn = async (table, column) => {
  const rows = await queryAsync(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
};

const formatDurationHms = (totalSeconds) => {
  const safeSeconds = Math.max(0, Number(totalSeconds || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
};

const normalizeUserTaskStatus = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'PENDING';
  const compact = raw.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (compact === 'ONHOLD') return 'ON_HOLD';
  if (compact === 'INPROGRESS') return 'IN_PROGRESS';
  if (compact === 'COMPLETED' || compact === 'COMPLETE' || compact === 'DONE') return 'COMPLETED';
  return compact;
};

const omitNullish = (obj) => {
  const out = {};
  Object.keys(obj || {}).forEach((key) => {
    const value = obj[key];
    if (value !== null && value !== undefined) out[key] = value;
  });
  return out;
};

async function resolveDepartment(input, tenantId) {
  if (!input) return null;
  const rows = await queryAsync(
    `
      SELECT id, public_id, name
      FROM departments
      WHERE (public_id = ? OR name = ? OR id = ?)
        AND tenant_id = ?
      LIMIT 1
    `,
    [input, input, /^\d+$/.test(String(input)) ? Number(input) : -1, tenantId]
  );
  return rows && rows.length ? rows[0] : null;
}

function resolveTenantId(req) {
  const tenantId = req.user && req.user.tenant_id ? req.user.tenant_id : req.tenantId;
  if (tenantId === undefined || tenantId === null || tenantId === '') {
    throw new Error('tenant_id is required but not available');
  }
  return tenantId;
}

// Allow three states: Active (true, false), Inactive (false, false), Guest (false, true)
function validateGuestState(isActive, isGuest) {
  const activeValue = Boolean(isActive);
  const guestValue = Boolean(isGuest);
  // Valid: [true, false] (Active), [false, false] (Inactive), [false, true] (Guest)
  // Invalid: [true, true]
  return !(activeValue && guestValue);
}

router.use(requireAuth);

router.get('/', requireRole('Admin', 'Manager', 'IT Admin'), authorize('users', 'read'), (req, res) => {
  return res.redirect(307, `${req.baseUrl}/getusers`);
});



router.put('/:id/status', requireRole('Admin', 'IT Admin'), authorize('users', 'update'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const status = String(req.body.status || '').trim().toUpperCase();
    if (!status) {
      return res.status(400).json({ success: false, message: 'status is required' });
    }

    let isActive = null;
    let isGuest = null;
    if (status === 'ACTIVE') {
      isActive = true;
      isGuest = false;
    } else if (status === 'INACTIVE') {
      isActive = false;
      isGuest = false;
    } else if (status === 'GUEST') {
      isActive = false;
      isGuest = true;
    } else {
      return res.status(400).json({ success: false, message: 'Invalid status value' });
    }

    if (!validateGuestState(isActive, isGuest)) {
      return res.status(400).json({ success: false, message: 'Invalid user state' });
    }

    const isNumeric = /^\d+$/.test(String(id));
    const sql = `UPDATE users SET isActive = ?, isGuest = ? WHERE ${isNumeric ? '_id' : 'public_id'} = ? AND tenant_id = ?`;
    await queryAsync(sql, [isActive, isGuest, id, tenantId]);
    return res.json({ success: true, message: 'User status updated' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update status', error: error.message });
  }
});

router.put('/:id/role', requireRole('Admin', 'IT Admin'), authorize('users', 'update'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const { id } = req.params;
    const role = persistRole(req.body.role || '');
    if (!role) return res.status(400).json({ success: false, message: 'role is required' });

    if (!canManageRole(req.user.role, role)) {
      return res.status(403).json({ success: false, message: 'You cannot assign this role' });
    }

    const isNumeric = /^\d+$/.test(String(id));
    const sql = `UPDATE users SET role = ? WHERE ${isNumeric ? '_id' : 'public_id'} = ? AND tenant_id = ?`;
    await queryAsync(sql, [role, id, tenantId]);
    return res.json({ success: true, message: 'User role updated' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update role', error: error.message });
  }
});

router.post('/', requireRole('Admin', 'IT Admin'), authorize('users', 'create'), (req, res) => {
  return res.redirect(307, `${req.baseUrl}/create`);
});

router.get("/getusers", ruleEngine(RULES.USER_LIST), requireRole('Admin', 'Manager', 'IT Admin'), authorize('users', 'read'), async (req, res) => {
  const tenantId = resolveTenantId(req);
  const requesterRole = String(req.user?.role || '').toUpperCase();
  const params = [tenantId];
  let departmentScope = '';
  if (requesterRole === 'MANAGER') {
    const managerRows = await queryAsync(
      'SELECT department_public_id FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1',
      [req.user._id, tenantId]
    );
    const managerDepartmentId = managerRows && managerRows[0] ? managerRows[0].department_public_id : null;
    if (!managerDepartmentId) {
      return res.status(200).json([]);
    }
    departmentScope = ' AND u.department_public_id = ?';
    params.push(managerDepartmentId);
  }

  let roleScope = '';
  const isITAdmin = requesterRole === 'IT ADMIN' || requesterRole === 'CENTRAL IT ADMIN' || req.user?.normalized_role === 'IT_ADMIN' || req.user?.normalized_role === 'CENTRAL_IT_ADMIN';
  if (isITAdmin) {
    roleScope = ` AND u.role IN ('IT Admin', 'Central IT Admin', 'State Engineer', 'Regional Engineer', 'Regional IT Manager', 'IT Support', 'Cluster Engineer', 'Cluster Lead', 'L2 Engineer', 'Branch Engineer', 'L1 Engineer')`;
  }

  const query = `
    SELECT 
      u._id, u.public_id, u.name, u.role, u.email, u.title, u.isActive, u.phone, u.isGuest, u.department_public_id, d.name AS department_name,
      u.first_name, u.last_name, u.employee_id, u.state_id, u.region_id, u.cluster_id, u.branch_id, u.reporting_manager_id
    FROM users u
    LEFT JOIN departments d ON d.public_id = u.department_public_id AND d.tenant_id = u.tenant_id
    WHERE u.tenant_id = ? AND u.role NOT IN ('SuperAdmin', 'Super-Admin')${departmentScope}${roleScope}
  `;

  try {
    // Ensure every call returns fresh task/assignee state.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');

    const results = await queryAsync(query, params);
    const employeeIds = (results || [])
      .filter(r => r.role === 'Employee' && r._id)
      .map(r => r._id);

    let taskRows = [];
    if (employeeIds.length) {
      const hasTaskUpdatedAt = await tableHasColumn('tasks', 'updatedAt');
      const hasTaskCreatedAt = await tableHasColumn('tasks', 'createdAt');
      const hasAssignmentTenantId = await tableHasColumn('task_assignments', 'tenant_id');
      const hasReassignmentTenantId = await tableHasColumn('task_resign_requests', 'tenant_id');

      const placeholders = employeeIds.map(() => '?').join(',');
      const latestTaskSort = hasTaskUpdatedAt
        ? 'COALESCE(tas.updated_at, t.updatedAt, t.createdAt)'
        : (hasTaskCreatedAt ? 'COALESCE(tas.updated_at, t.createdAt)' : 'tas.updated_at');

      const latestReassignmentSubquery = `
        SELECT tr.task_id, tr.requested_by, tr.id, tr.status, tr.reason, tr.requested_at, tr.responded_at, tr.responded_by
        FROM task_resign_requests tr
        INNER JOIN (
          SELECT task_id, requested_by, MAX(id) AS latest_id
          FROM task_resign_requests
          ${hasReassignmentTenantId ? 'WHERE tenant_id = ?' : ''}
          GROUP BY task_id, requested_by
        ) tr_latest ON tr_latest.task_id = tr.task_id AND tr_latest.requested_by = tr.requested_by AND tr_latest.latest_id = tr.id
        ${hasReassignmentTenantId ? 'WHERE tr.tenant_id = ?' : ''}
      `;

      const taskParams = [];
      if (hasReassignmentTenantId) taskParams.push(tenantId);
      if (hasReassignmentTenantId) taskParams.push(tenantId);
      taskParams.push(...employeeIds);
      if (hasAssignmentTenantId) taskParams.push(tenantId);

      const taskQuery = `
        SELECT
          ta.user_id,
          t.id AS task_internal_id,
          t.public_id AS task_public_id,
          t.title,
          t.status,
          t.priority,
          tas.status AS assignee_status,
          tas.started_at AS assignee_started_at,
          tas.completed_at AS assignee_completed_at,
          tas.total_duration AS assignee_total_duration,
          tas.updated_at AS assignee_updated_at,
          tr_state.id AS reassignment_request_id,
          tr_state.status AS reassignment_status,
          t.project_id AS task_project_internal_id,
          t.project_public_id AS task_project_public_id,
          p.public_id AS project_public_id,
          p.name AS project_name
        FROM task_assignments ta
        JOIN tasks t ON t.id = ta.task_id
        LEFT JOIN task_assignment_status tas ON tas.task_id = ta.task_id AND tas.user_id = ta.user_id
        LEFT JOIN (${latestReassignmentSubquery}) tr_state ON tr_state.task_id = t.id AND tr_state.requested_by = ta.user_id
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE ta.user_id IN (${placeholders})
          ${hasAssignmentTenantId ? 'AND ta.tenant_id = ?' : ''}
        ORDER BY ${latestTaskSort} DESC, ta.task_id DESC
      `;
      taskRows = await queryAsync(taskQuery, taskParams);
    }

    const tasksByUser = {};
    taskRows.forEach(row => {
      if (!row || row.user_id === undefined || row.user_id === null) return;
      const userKey = String(row.user_id);
      if (!tasksByUser[userKey]) tasksByUser[userKey] = [];
      const assigneeStatus = normalizeUserTaskStatus(row.assignee_status || row.status || null);
      const startedAt = row.assignee_started_at ? new Date(row.assignee_started_at) : null;
      const completedAt = row.assignee_completed_at ? new Date(row.assignee_completed_at) : null;
      const storedDuration = Number(row.assignee_total_duration || 0);
      const projectId = row.project_public_id || row.task_project_public_id || (row.task_project_internal_id != null ? String(row.task_project_internal_id) : null);
      const projectPublicId = row.project_public_id || row.task_project_public_id || null;
      const reassignmentStatus = row.reassignment_status ? normalizeUserTaskStatus(row.reassignment_status) : null;
      const reassignment = reassignmentStatus
        ? {
          has_pending: reassignmentStatus === 'PENDING',
          request_status: reassignmentStatus
        }
        : null;

      const taskPayload = omitNullish({
        task_id: row.task_public_id ? String(row.task_public_id) : (row.task_internal_id != null ? String(row.task_internal_id) : null),
        title: row.title || null,
        status: assigneeStatus,
        priority: row.priority || null,
        started_at: startedAt ? startedAt.toISOString() : null,
        completed_at: completedAt ? completedAt.toISOString() : null,
        total_time: formatDurationHms(storedDuration),
        project: projectId ? omitNullish({ id: projectPublicId || projectId, name: row.project_name || null }) : null,
        reassignment
      });

      tasksByUser[userKey].push(taskPayload);
    });

    const out = (results || []).map(r => {
      const key = r._id ? String(r._id) : null;
      const orderedTasks = key ? (tasksByUser[key] || []) : [];
      const currentTask = orderedTasks.length > 0
        ? omitNullish({
          task_id: orderedTasks[0].task_id,
          title: orderedTasks[0].title,
          status: orderedTasks[0].status,
          priority: orderedTasks[0].priority,
          started_at: orderedTasks[0].started_at,
          completed_at: orderedTasks[0].completed_at,
          total_time: orderedTasks[0].total_time,
          project: orderedTasks[0].project,
          reassignment: orderedTasks[0].reassignment,
          reassignment_status: orderedTasks[0].reassignment ? orderedTasks[0].reassignment.request_status : null
        })
        : null;

      const minimalTasks = orderedTasks.slice(currentTask ? 1 : 0).map((task) => omitNullish({
        task_id: task.task_id,
        title: task.title,
        status: task.status,
        reassignment_status: task.reassignment ? task.reassignment.request_status : null
      }));

      return omitNullish({
        user_id: r.public_id || r._id,
        name: r.name || null,
        role: r.role || null,
        email: r.email || null,
        title: r.title || null,
        isActive: r.isActive !== undefined ? Boolean(r.isActive) : null,
        phone: r.phone || null,
        isGuest: r.isGuest !== undefined ? Boolean(r.isGuest) : null,
        departmentPublicId: r.department_public_id || null,
        departmentName: r.department_name || null,
        first_name: r.first_name || null,
        last_name: r.last_name || null,
        employee_id: r.employee_id || null,
        state_id: r.state_id || null,
        region_id: r.region_id || null,
        cluster_id: r.cluster_id || null,
        branch_id: r.branch_id || null,
        reporting_manager_id: r.reporting_manager_id || null,
        current_task: currentTask,
        tasks: minimalTasks
      });
    });

    res.status(200).json(out);
  } catch (err) {
    logger.error(`Error fetching users: ${err.message}`);
    if (err.sqlMessage) logger.error(`SQL Error: ${err.sqlMessage}`);
    if (err.sql) logger.error(`Failing Query: ${err.sql}`);
    res.status(500).json({ error: "Failed to fetch users", details: err.message });
  }
});

router.post('/create', ruleEngine(RULES.USER_CREATE), requireRole('Admin', 'IT Admin'), authorize('users', 'create'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const {
      name, email, phone, role, departmentId, departmentName, title, isActive, isGuest,
      first_name, last_name, employee_id, state_id, region_id, cluster_id, branch_id,
      skills, supported_categories, supportedCategories, reporting_manager_id
    } = req.body;
    const persistedRole = persistRole(role);
    const normalizedTargetRole = normalizeRole(persistedRole);

    const finalName = (name || `${first_name || ''} ${last_name || ''}`.trim()) || email.split('@')[0];

    if (!finalName || !email || !persistedRole || !title) {
      return res.status(400).json({ success: false, message: 'Name, email, role and title required' });
    }

    if (!normalizedTargetRole) {
      return res.status(400).json({ success: false, message: 'Invalid role provided' });
    }

    // Role hierarchy restrictions
    const creator = normalizeRole(req.user.role);
    const newRole = persistedRole;

    if (normalizeRole(newRole) === 'ADMIN' && creator !== 'SUPER_ADMIN') {
      return res.status(403).json({
        success: false,
        message: "Only Super Admin can create Admin"
      });
    }

    if (normalizeRole(newRole) === 'IT_SUPPORT' && !['SUPER_ADMIN', 'ADMIN', 'IT_ADMIN'].includes(creator)) {
      return res.status(403).json({
        success: false,
        message: "Not allowed to create IT Support"
      });
    }

    if (normalizeRole(newRole) === 'MANAGER' && !['SUPER_ADMIN', 'ADMIN'].includes(creator)) {
      return res.status(403).json({
        success: false,
        message: "Not allowed to create Manager"
      });
    }

    if (normalizeRole(newRole) === 'EMPLOYEE' && !['SUPER_ADMIN', 'ADMIN', 'MANAGER'].includes(creator)) {
      return res.status(403).json({
        success: false,
        message: "Not allowed to create Employee"
      });
    }

    if (!canManageRole(req.user.role, persistedRole)) {
      return res.status(403).json({ success: false, message: 'You cannot assign this role' });
    }

    const creatorNorm = normalizeRole(req.user.role);
    const isITAdminCreator = creatorNorm === 'IT_ADMIN' || creatorNorm === 'CENTRAL_IT_ADMIN';
    const isITAdminTarget = normalizedTargetRole === 'IT_ADMIN' || normalizedTargetRole === 'CENTRAL_IT_ADMIN';
    if (!isITAdminCreator && !isITAdminTarget && !departmentId && !departmentName) {
      return res.status(400).json({ success: false, message: 'Department assignment is mandatory' });
    }

    const derivedIsGuest = typeof isGuest === 'undefined' ? normalizedTargetRole === 'CLIENT' : Boolean(isGuest);
    const derivedIsActive = typeof isActive === 'undefined' ? !derivedIsGuest : Boolean(isActive);
    if (!validateGuestState(derivedIsActive, derivedIsGuest)) {
      return res.status(400).json({ success: false, message: 'Invalid user state: cannot be both active and guest at the same time.' });
    }

    const exists = await new Promise((resolve, reject) => {
      db.query('SELECT _id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1', [email, tenantId], (err, results) => {
        if (err) reject(err);
        else resolve(results);
      });
    });

    if (exists && exists.length > 0) {
      return res.status(409).json({ success: false, message: 'User already exists with this email' });
    }

    const department = await resolveDepartment(departmentId || departmentName, tenantId);
    if (!department && (departmentId || departmentName)) {
      return res.status(400).json({ success: false, message: 'Invalid department' });
    }
    const departmentPublicId = department ? department.public_id : null;
    const resolvedDepartmentName = department ? department.name : null;

    const tempPassword = crypto.randomBytes(6).toString('hex');
    const hashed = await bcrypt.hash(tempPassword, 10);
    const publicId = crypto.randomBytes(8).toString('hex');
    const inviteToken = crypto.randomBytes(24).toString('hex');

    const fields = ['tenant_id', 'public_id', 'name', 'email', 'password', 'phone', 'role'];
    const placeholders = ['?', '?', '?', '?', '?', '?', '?'];
    const params = [tenantId, publicId, finalName, email, hashed, phone || null, persistedRole];

    fields.push('title'); placeholders.push('?'); params.push(title);
    fields.push('department_public_id'); placeholders.push('?'); params.push(departmentPublicId);
    fields.push('isActive'); placeholders.push('?'); params.push(derivedIsActive);
    fields.push('isGuest'); placeholders.push('?'); params.push(derivedIsGuest);

    if (first_name !== undefined) { fields.push('first_name'); placeholders.push('?'); params.push(first_name); }
    if (last_name !== undefined) { fields.push('last_name'); placeholders.push('?'); params.push(last_name); }
    if (employee_id !== undefined) { fields.push('employee_id'); placeholders.push('?'); params.push(employee_id); }
    if (state_id !== undefined) { fields.push('state_id'); placeholders.push('?'); params.push(state_id); }
    if (region_id !== undefined) { fields.push('region_id'); placeholders.push('?'); params.push(region_id); }
    if (cluster_id !== undefined) { fields.push('cluster_id'); placeholders.push('?'); params.push(cluster_id); }
    if (branch_id !== undefined) { fields.push('branch_id'); placeholders.push('?'); params.push(branch_id); }
    if (reporting_manager_id !== undefined) { fields.push('reporting_manager_id'); placeholders.push('?'); params.push(reporting_manager_id); }

    const hasCreatedAt = await new Promise(resolve => {
      db.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'created_at'",
        [], (err, rows) => resolve(!err && Array.isArray(rows) && rows.length > 0)
      );
    });

    const insertCols = hasCreatedAt ? `${fields.join(', ')}, created_at` : fields.join(', ');
    const insertVals = hasCreatedAt ? `${placeholders.join(', ')}, NOW()` : placeholders.join(', ');

    const sql = `INSERT INTO users (${insertCols}) VALUES (${insertVals})`;
    const result = await new Promise((resolve, reject) => {
      db.query(sql, params, (err, res) => err ? reject(err) : resolve(res));
    });

    const insertId = result.insertId;

    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id,
        tenant_id: tenantId,
        action: 'CREATE_USER',
        entity: 'User',
        entity_id: publicId,
        details: { name, email, role: persistedRole, title }
      });
    } catch (auditErr) {
      logger.warn('Failed to log create_user audit:', auditErr.message);
    }

    const setupToken = jwt.sign({ id: publicId, step: 'setup', tenant_id: tenantId }, env.JWT_SECRET || env.SECRET || 'change_this_secret', { expiresIn: '7d' });
    const setupUrlBase = env.FRONTEND_URL || env.BASE_URL;
    const setupLink = `${setupUrlBase.replace(/\/$/, '')}/setup-password?token=${encodeURIComponent(setupToken)}`;

    await queryAsync(
      `
        INSERT INTO invite_tokens (tenant_id, user_id, email, role_key, department_public_id, invited_by, token, expires_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), ?)
      `,
      [tenantId, insertId, email, normalizeRole(persistedRole), departmentPublicId, req.user._id, inviteToken, JSON.stringify({ setupToken })]
    ).catch(() => null);

    const tpl = emailService.welcomeTemplate({
      name,
      email,
      role: persistedRole,
      title: title || "Employee",
      tempPassword,
      createdBy: req.user?.name || "System Admin",
      createdAt: new Date(),
      setupLink,
      userId: email
    });

    emailService.sendEmail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html })
      .then(r => {
        if (r.sent) logger.info(`✅ Welcome email sent to ${email}`);
        else logger.warn(`⚠️ Welcome email not sent to ${email}`);
      })
      .catch(err => logger.error(`❌ Failed to send welcome email to ${email}:`, err?.message));

    const selSql = `
      SELECT u._id, u.public_id, u.name, u.email, u.role, u.title, u.isActive, u.phone, u.isGuest, u.tenant_id,
             u.department_public_id, d.name AS department_name,
             u.first_name, u.last_name, u.employee_id, u.state_id, u.region_id, u.cluster_id, u.branch_id, u.reporting_manager_id
      FROM users u
      LEFT JOIN departments d ON d.public_id = u.department_public_id
      WHERE u._id = ? LIMIT 1
    `;
    db.query(selSql, [insertId], async (err, saved) => {
      if (err || !saved || !saved[0]) {
        return res.status(201).json({
          success: true,
          data: {
            id: publicId, name: finalName, email, role: persistedRole, title: title || null,
            isActive: Boolean(derivedIsActive), phone: phone || null, tempPassword, setupToken,
            departmentPublicId, departmentName: resolvedDepartmentName
          }
        });
      }

      const user = saved[0];
      
      // Auto-create engineer mapping if applicable
      if (normalizedTargetRole === 'IT_SUPPORT' || normalizedTargetRole === 'L1_ENGINEER' || normalizedTargetRole === 'L2_ENGINEER' || normalizedTargetRole === 'REGIONAL_IT_MANAGER') {
        try {
          await engineerMappingService.createMapping(tenantId, {
            engineerId: insertId,
            stateId: state_id || null,
            regionId: region_id || null,
            clusterId: cluster_id || null,
            branchId: branch_id || null,
            skills: skills || [],
            supportedCategories: supportedCategories || supported_categories || [],
            isActive: derivedIsActive
          }, req.user);
        } catch (e) {
          logger.error('Failed to auto-create engineer mapping during user creation:', e.message);
        }
      }

      res.status(201).json({
        success: true,
        data: {
          id: user.public_id || user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          title: user.title,
          isActive: user.isActive,
          phone: user.phone,
          isGuest: user.isGuest || false,
          tenant_id: user.tenant_id || tenantId,
          departmentPublicId: user.department_public_id,
          departmentName: user.department_name || resolvedDepartmentName,
          first_name: user.first_name || null,
          last_name: user.last_name || null,
          employee_id: user.employee_id || null,
          state_id: user.state_id || null,
          region_id: user.region_id || null,
          cluster_id: user.cluster_id || null,
          branch_id: user.branch_id || null,
          reporting_manager_id: user.reporting_manager_id || null,
          tempPassword,
          setupToken
        }
      });

      if (normalizedTargetRole === 'MANAGER') {
        await queryAsync(
          `
            UPDATE departments
            SET manager_id = ?, head_id = COALESCE(head_id, ?)
            WHERE public_id = ? AND tenant_id = ?
          `,
          [insertId, insertId, departmentPublicId, tenantId]
        ).catch(() => null);
      }
    });

  } catch (error) {
    logger.error('Create user error:', error);
    res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
  }
});

router.put("/update/:id", ruleEngine(RULES.USER_UPDATE), requireRole('Admin', 'IT Admin'), authorize('users', 'update'), async (req, res) => {
  const { id } = req.params;
  const tenantId = resolveTenantId(req);
  let {
    name, title, email, role, isActive, isGuest, phone, departmentId, departmentName, status,
    first_name, last_name, employee_id, state_id, region_id, cluster_id, branch_id,
    skills, supported_categories, supportedCategories, reporting_manager_id
  } = req.body;
  const persistedRole = role !== undefined ? persistRole(role) : undefined;

  // Accept partial updates: only require name/email/role if present
  if ((name !== undefined && !name) || (email !== undefined && !email) || (role !== undefined && !persistedRole)) {
    return res.status(400).json(errorResponse.badRequest('Name, email and role are required', 'MISSING_REQUIRED_FIELD', null, 'email'));
  }

  try {
    const isNumeric = /^\d+$/.test(String(id));
    const existingUserRows = await queryAsync(
      `SELECT _id, public_id, name, role, first_name, last_name, isActive FROM users WHERE ${isNumeric ? '_id' : 'public_id'} = ? AND tenant_id = ? LIMIT 1`,
      [id, tenantId]
    );
    if (!existingUserRows || existingUserRows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    const existingUser = existingUserRows[0];

    if (role !== undefined && !canManageRole(req.user.role, persistedRole) && normalizeRole(req.user.role) !== normalizeRole(persistedRole)) {
      return res.status(403).json({ success: false, message: 'You cannot assign this role' });
    }

    const department = await resolveDepartment(departmentId || departmentName, tenantId);
    if (!department && (departmentId || departmentName)) {
      return res.status(400).json({ success: false, message: 'Invalid department' });
    }
    const departmentPublicId = department ? department.public_id : null;
    const resolvedDepartmentName = department ? department.name : null;

    // Status mapping logic
    if (status) {
      const statusNorm = String(status).toUpperCase();
      if (statusNorm === 'ACTIVE') {
        isActive = true;
        isGuest = false;
      } else if (statusNorm === 'INACTIVE') {
        isActive = false;
        isGuest = false;
      } else if (statusNorm === 'GUEST') {
        isActive = false;
        isGuest = true;
      } else {
        return res.status(400).json({ success: false, message: 'Invalid status value. Must be ACTIVE, INACTIVE, or GUEST.' });
      }
    }

    // Auto-resolve: if isGuest is true, force isActive false
    if (isGuest === true) isActive = false;
    // If both are true, that's invalid
    if (isActive === true && isGuest === true) {
      return res.status(400).json({ success: false, message: 'Invalid user state: cannot be both active and guest at the same time.' });
    }

    // Build dynamic update
    const updates = {};
    if (name !== undefined) {
      updates.name = name;
    } else if (first_name !== undefined || last_name !== undefined) {
      const updatedFirstName = first_name !== undefined ? first_name : existingUser.first_name;
      const updatedLastName = last_name !== undefined ? last_name : existingUser.last_name;
      updates.name = `${updatedFirstName || ''} ${updatedLastName || ''}`.trim() || existingUser.name;
    }
    if (title !== undefined) updates.title = title;
    if (email !== undefined) updates.email = email;
    if (role !== undefined) updates.role = persistedRole;
    if (isActive !== undefined) updates.isActive = isActive;
    if (isGuest !== undefined) updates.isGuest = isGuest;
    if (phone !== undefined) updates.phone = phone;
    if (departmentId !== undefined || departmentName !== undefined) {
      updates.department_public_id = departmentPublicId;
    }
    if (first_name !== undefined) updates.first_name = first_name;
    if (last_name !== undefined) updates.last_name = last_name;
    if (employee_id !== undefined) updates.employee_id = employee_id;
    if (state_id !== undefined) updates.state_id = state_id;
    if (region_id !== undefined) updates.region_id = region_id;
    if (cluster_id !== undefined) updates.cluster_id = cluster_id;
    if (branch_id !== undefined) updates.branch_id = branch_id;
    if (reporting_manager_id !== undefined) updates.reporting_manager_id = reporting_manager_id;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json(errorResponse.badRequest('No fields to update', 'NO_FIELDS_PROVIDED'));
    }

    const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
    const values = Object.values(updates);
    values.push(id, tenantId);

    const sql = `UPDATE users SET ${setClause} WHERE ${isNumeric ? '_id' : 'public_id'} = ? AND tenant_id = ?`;

    db.query(sql, values, (err, result) => {
      if (err) {
        logger.error(`Database error updating user ${id}: ${err.message}`);
        return res.status(500).json({ success: false, message: "Database error", error: err.message });
      }
      if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "User not found" });

      const selectSql = `
        SELECT u._id, u.public_id, u.name, u.title, u.email, u.role, u.isActive, u.phone, u.isGuest, u.tenant_id,
               u.department_public_id, d.name AS department_name,
               u.first_name, u.last_name, u.employee_id, u.state_id, u.region_id, u.cluster_id, u.branch_id, u.reporting_manager_id
        FROM users u
        LEFT JOIN departments d ON d.public_id = u.department_public_id
        WHERE ${isNumeric ? 'u._id' : 'u.public_id'} = ? AND u.tenant_id = ? LIMIT 1
      `;
      db.query(selectSql, [id, tenantId], async (err, user) => {
        if (err || !user || user.length === 0) {
          try {
            const auditController = require('./auditController');
            auditController.log({
              user_id: req.user._id,
              tenant_id: req.user.tenant_id,
              action: 'UPDATE_USER',
              entity: 'User',
              entity_id: String(id),
              details: { updates }
            });
          } catch (auditErr) {
            logger.warn('Failed to log update_user audit (fallback):', auditErr.message);
          }
          return res.status(200).json({
            success: true,
            message: "User updated but could not fetch updated data",
            user: { id, name, email, role: persistedRole, title, isActive: updates.isActive, phone: phone || null, departmentPublicId, departmentName: resolvedDepartmentName }
          });
        }

        const u = user[0];

        // Sync mapping in engineer_mapping if applicable
        const checkRole = persistedRole || existingUser.role;
        const normCheckRole = normalizeRole(checkRole);
        if (normCheckRole === 'IT_SUPPORT' || normCheckRole === 'L1_ENGINEER' || normCheckRole === 'L2_ENGINEER' || normCheckRole === 'REGIONAL_IT_MANAGER') {
          try {
            const mappings = await engineerMappingService.listMappings(tenantId, { engineerId: u._id });
            const activeState = isActive !== undefined ? isActive : existingUser.isActive;
            if (mappings && mappings.length > 0) {
              await engineerMappingService.updateMapping(tenantId, mappings[0].id, {
                stateId: state_id !== undefined ? state_id : mappings[0].stateId,
                regionId: region_id !== undefined ? region_id : mappings[0].regionId,
                clusterId: cluster_id !== undefined ? cluster_id : mappings[0].clusterId,
                branchId: branch_id !== undefined ? branch_id : mappings[0].branchId,
                skills: skills || undefined,
                supportedCategories: supportedCategories || supported_categories || undefined,
                isActive: activeState
              }, req.user);
            } else {
              await engineerMappingService.createMapping(tenantId, {
                engineerId: u._id,
                stateId: state_id !== undefined ? state_id : null,
                regionId: region_id !== undefined ? region_id : null,
                clusterId: cluster_id !== undefined ? cluster_id : null,
                branchId: branch_id !== undefined ? branch_id : null,
                skills: skills || [],
                supportedCategories: supportedCategories || supported_categories || [],
                isActive: activeState
              }, req.user);
            }
          } catch (e) {
            logger.error('Failed to sync engineer mapping during user update:', e.message);
          }
        }

        try {
          const auditController = require('./auditController');
          auditController.log({
            user_id: req.user._id,
            tenant_id: req.user.tenant_id,
            action: 'UPDATE_USER',
            entity: 'User',
            entity_id: u.public_id || String(u._id),
            details: { name: u.name, updates }
          });
        } catch (auditErr) {
          logger.warn('Failed to log update_user audit:', auditErr.message);
        }
        res.status(200).json({
          success: true,
          message: "User updated successfully",
          user: {
            id: u.public_id || u._id,
            name: u.name,
            email: u.email,
            role: u.role,
            title: u.title,
            isActive: u.isActive,
            phone: u.phone,
            isGuest: u.isGuest || false,
            tenant_id: u.tenant_id || tenantId,
            departmentPublicId: u.department_public_id,
            departmentName: u.department_name || resolvedDepartmentName,
            first_name: u.first_name || null,
            last_name: u.last_name || null,
            employee_id: u.employee_id || null,
            state_id: u.state_id || null,
            region_id: u.region_id || null,
            cluster_id: u.cluster_id || null,
            branch_id: u.branch_id || null,
            reporting_manager_id: u.reporting_manager_id || null
          }
        });

        if (role !== undefined && normalizeRole(persistedRole) === 'MANAGER') {
          await queryAsync(
            `
              UPDATE departments
              SET manager_id = ?, head_id = COALESCE(head_id, ?)
              WHERE public_id = ? AND tenant_id = ?
            `,
            [u._id, u._id, departmentPublicId, tenantId]
          ).catch(() => null);
        }
      });
    });

  } catch (error) {
    logger.error('Update user error:', error);
    return res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
  }
});

router.get("/getuserbyid/:id", ruleEngine(RULES.USER_VIEW), requireRole('Admin', 'Manager', 'IT Admin'), authorize('users', 'read'), (req, res) => {
  const { id } = req.params;
  const tenantId = resolveTenantId(req);
  const isNumeric = /^\d+$/.test(String(id));
  const requesterRole = String(req.user?.role || '').toUpperCase();
  const run = async () => {
    let departmentScope = '';
    const params = [id, tenantId];
    if (requesterRole === 'MANAGER') {
      const managerRows = await queryAsync(
        'SELECT department_public_id FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1',
        [req.user._id, tenantId]
      );
      const managerDepartmentId = managerRows && managerRows[0] ? managerRows[0].department_public_id : null;
      if (!managerDepartmentId) {
        return res.status(403).json({ error: 'Manager department not configured' });
      }
      departmentScope = ' AND u.department_public_id = ?';
      params.push(managerDepartmentId);
    }
    const query = `
    SELECT u.name, u.title, u.email, u.role, u.isActive, u.phone, u.public_id, u.isGuest,
           u.department_public_id, d.name AS department_name,
           u.first_name, u.last_name, u.employee_id, u.state_id, u.region_id, u.cluster_id, u.branch_id, u.reporting_manager_id
    FROM users u
    LEFT JOIN departments d ON d.public_id = u.department_public_id
    WHERE ${isNumeric ? 'u._id' : 'u.public_id'} = ? AND u.tenant_id = ?${departmentScope}
    LIMIT 1
  `;
    db.query(query, params, (err, results) => {
      if (err) return res.status(500).json({ error: "Failed to fetch user" });
      if (!results || results.length === 0) return res.status(404).json({ error: 'User not found' });

      const out = results[0];
      res.status(200).json({
        id: out.public_id,
        name: out.name,
        title: out.title,
        email: out.email,
        role: out.role,
        isActive: out.isActive,
        isGuest: out.isGuest || false,
        phone: out.phone,
        departmentPublicId: out.department_public_id,
        departmentName: out.department_name,
        first_name: out.first_name || null,
        last_name: out.last_name || null,
        employee_id: out.employee_id || null,
        state_id: out.state_id || null,
        region_id: out.region_id || null,
        cluster_id: out.cluster_id || null,
        branch_id: out.branch_id || null,
        reporting_manager_id: out.reporting_manager_id || null
      });
    });
  };
  run().catch((error) => res.status(500).json({ error: error.message }));
});

router.delete("/delete/:user_id", ruleEngine(RULES.USER_DELETE), requireRole('Admin', 'IT Admin'), authorize('users', 'deactivate'), (req, res) => {
  const { user_id } = req.params;
  const tenantId = resolveTenantId(req);
  const isNumeric = /^\d+$/.test(String(user_id));
  const sqlDelete = isNumeric
    ? `DELETE FROM users WHERE _id = ? AND tenant_id = ?`
    : `DELETE FROM users WHERE public_id = ? AND tenant_id = ?`;
  db.query(sqlDelete, [user_id, tenantId], (err, result) => {
    if (err) return res.status(500).json({ success: false, message: "Database error", error: err.message });
    if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "User not found" });
    return res.status(200).json({ success: true, message: "User deleted successfully" });
  });
});

router.get('/:id', requireRole('Admin', 'Manager', 'IT Admin'), authorize('users', 'read'), (req, res) => {
  return res.redirect(307, `${req.baseUrl}/getuserbyid/${req.params.id}`);
});

router.put('/:id', requireRole('Admin', 'IT Admin'), authorize('users', 'update'), (req, res) => {
  return res.redirect(307, `${req.baseUrl}/update/${req.params.id}`);
});

router.delete('/:id', requireRole('Admin', 'IT Admin'), authorize('users', 'deactivate'), (req, res) => {
  return res.redirect(307, `${req.baseUrl}/delete/${req.params.id}`);
});

module.exports = router;

