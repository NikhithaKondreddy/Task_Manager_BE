const db = require(__root + 'db');
const RoleBasedLoginResponse = require(__root + 'controllers/utils/RoleBasedLoginResponse');
const { normalizeProjectStatus } = require(__root + 'utils/projectStatus');
const errorResponse = require(__root + 'utils/errorResponse');
const { getExtendedDashboardMetrics } = require('../services/reportService');

let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../../logger'); } catch (e2) { logger = console; } }

const NUMERIC_COLUMN_TYPES = new Set(['int', 'bigint', 'tinyint', 'smallint', 'mediumint', 'decimal', 'float', 'double', 'numeric']);

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });

function accessDenied(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

async function fetchColumnTypes(table, columns = []) {
  if (!columns.length) return {};
  const placeholder = columns.map(() => '?').join(',');
  const rows = await queryAsync(
    `SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME IN (${placeholder})`,
    [table, ...columns]
  );
  const map = {};
  (rows || []).forEach((row) => {
    if (row && row.COLUMN_NAME) map[row.COLUMN_NAME] = row.DATA_TYPE || '';
  });
  return map;
}

function valueForColumn(type, user) {
  if (!type) return null;
  const lower = String(type).toLowerCase();
  if (NUMERIC_COLUMN_TYPES.has(lower)) return user._id || null;
  return user.id || (user._id ? String(user._id) : null);
}

function buildAccessClause(columnMeta, user) {
  const clauses = [];
  const params = [];
  Object.entries(columnMeta).forEach(([column, type]) => {
    const value = valueForColumn(type, user);
    if (value === null || value === undefined) return;
    clauses.push(`${column} = ?`);
    params.push(value);
  });
  if (!clauses.length) return null;
  return { expression: clauses.join(' OR '), params };
}

async function requireFeatureAccess(req, feature) {
  const resources = await RoleBasedLoginResponse.getAccessibleResources(req.user._id, req.user.role, req.user.tenant_id, req.user.id);
  if (!resources || !Array.isArray(resources.features) || !resources.features.includes(feature)) {
    throw accessDenied(`Access denied: ${feature} feature`);
  }
  return resources;
}

async function hasColumn(table, column) {
  const rows = await queryAsync(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  return Array.isArray(rows) && rows.length > 0;
}

const tableColumnCache = {};

async function cachedHasColumn(table, column) {
  tableColumnCache[table] = tableColumnCache[table] || {};
  if (tableColumnCache[table][column] === undefined) {
    tableColumnCache[table][column] = await hasColumn(table, column);
  }
  return tableColumnCache[table][column];
}

const clientColumnCache = {};

async function clientHasPublicId() {
  if (clientColumnCache.public_id === undefined) {
    clientColumnCache.public_id = await cachedHasColumn('clients', 'public_id');
  }
  return clientColumnCache.public_id;
}

async function clientFieldSelects(alias = 'c') {
  const selects = [`${alias}.name AS client_name`];
  if (await clientHasPublicId()) selects.push(`${alias}.public_id AS client_public_id`);
  return selects;
}

const tableExistsCache = {};

async function tableExists(table) {
  if (tableExistsCache[table] !== undefined) {
    return tableExistsCache[table];
  }
  const rows = await queryAsync(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [table]
  );
  tableExistsCache[table] = Array.isArray(rows) && rows.length > 0;
  return tableExistsCache[table];
}

async function fetchClientDocuments(clientIds = []) {
  if (!clientIds.length) return {};
  if (!(await tableExists('documents'))) return {};
  const rows = await queryAsync(
    'SELECT documentId as id, clientId as client_id, filePath as file_url, fileName as file_name, mimeType as file_type, createdAt as uploaded_at FROM documents WHERE entityType = ? AND clientId IN (?) ORDER BY createdAt DESC',
    ['CLIENT', clientIds]
  );
  return (rows || []).reduce((memo, row) => {
    if (!row || row.client_id === undefined || row.client_id === null) return memo;
    if (!memo[row.client_id]) memo[row.client_id] = [];
    memo[row.client_id].push(row);
    return memo;
  }, {});
}

async function gatherManagerProjects(req) {
  const columnMeta = await fetchColumnTypes('projects', ['manager_id', 'project_manager_id']);
  const clause = buildAccessClause(columnMeta, req.user);
  if (!clause) return [];

  const clientFields = await clientFieldSelects('c');

  const sql = `
    SELECT
      p.id,
      p.public_id,
      p.name,
      p.status,
      p.priority,
      p.start_date,
      p.end_date,
      p.client_id,

      -- ✅ THIS WAS MISSING
      p.project_manager_id,
      u.public_id AS project_manager_public_id,
      u.name AS project_manager_name,

      ${clientFields.join(', ')}

    FROM projects p
    LEFT JOIN clients c ON c.id = p.client_id
    -- ✅ JOIN USERS TABLE
    LEFT JOIN users u ON u._id = p.project_manager_id

    WHERE (${clause.expression})
    ORDER BY p.updated_at DESC, p.created_at DESC
  `;

  return await queryAsync(sql, clause.params);
}

function dedupe(values = []) {
  return Array.from(new Set(values.filter(Boolean)));
}

async function countRelatedTasks(projectIds = [], projectPublicIds = []) {
  if (!projectIds.length && !projectPublicIds.length) return 0;
  const filters = [];
  const params = [];
  if (projectIds.length && (await cachedHasColumn('tasks', 'project_id'))) {
    filters.push('t.project_id IN (?)');
    params.push(projectIds);
  }
  if (projectPublicIds.length && (await cachedHasColumn('tasks', 'project_public_id'))) {
    filters.push('t.project_public_id IN (?)');
    params.push(projectPublicIds);
  }
  if (!filters.length) return 0;
  const hasIsDeletedFlag = await cachedHasColumn('tasks', 'isDeleted');
  const deletedClauseLine = hasIsDeletedFlag
    ? `
    AND (t.isDeleted IS NULL OR t.isDeleted != 1)`
    : '';
  const sql = `
    SELECT COUNT(DISTINCT t.id) AS total
    FROM tasks t
    WHERE (${filters.join(' OR ')})${deletedClauseLine}
  `;
  return (await queryAsync(sql, params))[0]?.total || 0;
}

async function buildTaskFilter(projectIds = [], projectPublicIds = []) {
  const expressions = [];
  const params = [];

  if (projectIds.length) {
    expressions.push(`t.project_id IN (?)`);
    params.push(projectIds);
  }

  if (projectPublicIds.length) {
    expressions.push(`t.project_public_id IN (?)`);
    params.push(projectPublicIds);
  }

  if (!expressions.length) return null;

  return {
    expression: expressions.join(' OR '),
    params
  };
}


async function fetchTaskTimeline(projectIds = [], projectPublicIds = []) {
  const filter = await buildTaskFilter(projectIds, projectPublicIds);
  if (!filter) return [];

  const clientFields = await clientFieldSelects('c');
  const hasIsDeletedFlag = await cachedHasColumn('tasks', 'isDeleted');
  const hasProjectIsLocked = await cachedHasColumn('projects', 'is_locked');

  const sql = `
    SELECT
      t.id AS task_internal_id,
      ANY_VALUE(t.public_id) AS task_id,
      ANY_VALUE(t.title) AS title,
      ANY_VALUE(t.stage) AS stage,
      ANY_VALUE(t.taskDate) AS taskDate,
      ANY_VALUE(t.priority) AS priority,
      ANY_VALUE(t.status) AS status,
      ANY_VALUE(t.started_at) AS started_at,
      ANY_VALUE(t.live_timer) AS live_timer,
      ANY_VALUE(t.total_duration) AS total_duration,
      ANY_VALUE(t.completed_at) AS completed_at,
      ANY_VALUE(t.time_alloted) AS time_alloted,

      ${clientFields.join(', ')},

      MIN(p.id) AS project_internal_id,
      MIN(p.public_id) AS project_public_id,
      MIN(p.name) AS project_name,
      MIN(p.priority) AS project_priority,
      MIN(p.status) AS project_status,
      ${hasProjectIsLocked ? 'MIN(p.is_locked) AS project_is_locked,' : ''}
      MIN(p.start_date) AS project_start_date,
      MIN(p.end_date) AS project_end_date,
      MIN(p.client_id) AS project_client_id,

      GROUP_CONCAT(DISTINCT u._id ORDER BY u._id) AS assigned_user_internal_ids,
      GROUP_CONCAT(DISTINCT u.public_id ORDER BY u._id) AS assigned_user_public_ids,
      GROUP_CONCAT(DISTINCT u.name ORDER BY u._id) AS assigned_user_names

    FROM tasks t
    LEFT JOIN clients c 
      ON c.id = t.client_id

    LEFT JOIN projects p 
      ON p.id = t.project_id
      OR (t.project_public_id IS NOT NULL AND p.public_id COLLATE utf8mb4_unicode_ci = t.project_public_id COLLATE utf8mb4_unicode_ci)

    LEFT JOIN task_assignments ta 
      ON ta.task_id = t.id

    LEFT JOIN users u 
      ON u._id = ta.user_id

    WHERE (${filter.expression})
    ${hasIsDeletedFlag ? `AND (t.isDeleted IS NULL OR t.isDeleted != 1)` : ''}

    GROUP BY t.id
    ORDER BY t.taskDate ASC, t.updatedAt DESC
  `;

  return await queryAsync(sql, filter.params);
}

function parseProjectFilter(req) {
  const candidates = [
    req.query?.project_id,
    req.query?.projectId,
    req.query?.project_public_id,
    req.query?.projectPublicId,
    req.body?.project_id,
    req.body?.projectId,
    req.body?.project_public_id,
    req.body?.projectPublicId
  ];
  const raw = candidates.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { type: 'id', value: Number(trimmed) };
  }
  return { type: 'public', value: trimmed };
}

function toIsoDate(value) {
  if (value === undefined || value === null) return null;
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return null;
  return timestamp.toISOString();
}

function normalizeTaskStatusKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'PENDING';
  const compact = raw.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (compact === 'ONHOLD') return 'ON_HOLD';
  if (compact === 'INPROGRESS') return 'IN_PROGRESS';
  if (compact === 'COMPLETE' || compact === 'DONE') return 'COMPLETED';
  if (compact === 'APPROVE' || compact === 'APPROVED') return 'COMPLETED';
  if (compact === 'REJECT') return 'REJECTED';
  return compact;
}

function deriveAssignmentStatus(assignees = []) {
  if (!Array.isArray(assignees) || !assignees.length) return 'PENDING';
  const statuses = assignees.map((assignee) => normalizeTaskStatusKey(assignee.status || 'PENDING'));
  if (statuses.every((status) => status === 'APPROVED')) return 'APPROVED';
  if (statuses.every((status) => status === 'COMPLETED' || status === 'APPROVED')) return 'COMPLETED';
  if (statuses.some((status) => status === 'REJECTED')) return 'REJECTED';
  if (statuses.some((status) => status === 'IN_PROGRESS')) return 'IN_PROGRESS';
  if (statuses.some((status) => status === 'ON_HOLD')) return 'ON_HOLD';
  return 'PENDING';
}

async function fetchManagerDepartment(userId) {
  if (!userId) return null;
  const rows = await queryAsync(
    'SELECT department_public_id FROM users WHERE _id = ? LIMIT 1',
    [userId]
  );
  if (!Array.isArray(rows) || !rows.length) return null;
  return rows[0].department_public_id || null;
}

module.exports = {
  getManagerDashboard: async (req, res) => {
    try {
      const resources = await requireFeatureAccess(req, 'Dashboard');
      const projects = await gatherManagerProjects(req);
      const projectIds = dedupe(projects.map((project) => project.id)).filter(Boolean);
      const projectPublicIds = dedupe(projects.map((project) => project.public_id)).filter(Boolean);
      const projectCount = projects.length;
      const taskCount = await countRelatedTasks(projectIds, projectPublicIds);
      const assignedClientIds = Array.isArray(resources.assignedClientIds)
        ? resources.assignedClientIds.filter(Boolean)
        : [];
      const clientCount = assignedClientIds.length
        ? (await queryAsync(
          'SELECT COUNT(*) AS total FROM clients WHERE id IN (?) AND (isDeleted IS NULL OR isDeleted != 1)',
          [assignedClientIds]
        ))[0]?.total || 0
        : 0;
      return res.json({
        success: true,
        data: { projectCount, taskCount, clientCount }
      });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },


  getAssignedClients: async (req, res) => {
    try {
      const resources = await requireFeatureAccess(req, 'Assigned Clients');

      // Derive accessible projects and clients from manager's assigned projects
      const managerProjects = await gatherManagerProjects(req);
      const projectIds = dedupe(managerProjects.map((p) => p.id)).filter(Boolean);
      const projectPublicIds = dedupe(managerProjects.map((p) => p.public_id)).filter(Boolean);
      let assignedClientIds = dedupe(managerProjects.map((p) => p.client_id)).filter(Boolean);

      // map client_id -> projects for UI to display associated projects
      const clientProjectsMap = {};
      (managerProjects || []).forEach((p) => {
        if (!p || !p.client_id) return;
        const key = String(p.client_id);
        clientProjectsMap[key] = clientProjectsMap[key] || [];
        clientProjectsMap[key].push({ id: p.public_id || String(p.id), name: p.name || null });
      });

      // Support querying client for a particular task (task_id or task_public_id)
      const taskCandidates = [
        req.query?.task_id,
        req.query?.taskId,
        req.query?.task_public_id,
        req.query?.taskPublicId,
        req.body?.task_id,
        req.body?.taskId,
        req.body?.task_public_id,
        req.body?.taskPublicId
      ];
      const rawTask = taskCandidates.find((v) => v !== undefined && v !== null && String(v).trim() !== '');
      if (rawTask) {
        const taskVal = String(rawTask).trim();
        const isNumeric = /^\d+$/.test(taskVal);
        const taskSql = isNumeric
          ? 'SELECT id, public_id, project_id, project_public_id, client_id FROM tasks WHERE id = ? LIMIT 1'
          : 'SELECT id, public_id, project_id, project_public_id, client_id FROM tasks WHERE public_id = ? LIMIT 1';
        const taskRow = (await queryAsync(taskSql, [isNumeric ? Number(taskVal) : taskVal]))[0];
        if (!taskRow) {
          return res.status(404).json(errorResponse.notFound('Task not found', 'TASK_NOT_FOUND'));
        }

        // determine client id for the task
        let clientForTask = taskRow.client_id || null;
        if (!clientForTask && (taskRow.project_id || taskRow.project_public_id)) {
          const projSql = taskRow.project_id
            ? 'SELECT client_id FROM projects WHERE id = ? LIMIT 1'
            : 'SELECT client_id FROM projects WHERE public_id = ? LIMIT 1';
          const projRow = (await queryAsync(projSql, [taskRow.project_id || taskRow.project_public_id]))[0];
          clientForTask = projRow ? projRow.client_id : null;
        }

        if (!clientForTask) {
          return res.status(404).json(errorResponse.notFound('Client not found for the specified task', 'CLIENT_NOT_FOUND'));
        }

        // ensure manager has access to this task/client: either client is part of manager's projects or project belongs to manager
        const hasAccessByClient = Array.isArray(assignedClientIds) && assignedClientIds.includes(clientForTask);
        const taskProjectId = taskRow.project_id || null;
        const taskProjectPublicId = taskRow.project_public_id || null;
        const hasAccessByProject = (taskProjectId && projectIds.includes(taskProjectId)) || (taskProjectPublicId && projectPublicIds.includes(taskProjectPublicId));

        if (!hasAccessByClient && !hasAccessByProject) {
          return res.status(403).json(errorResponse.forbidden('Access denied to the requested task/client', 'ACCESS_DENIED'));
        }

        // limit the response to this single client
        assignedClientIds = [clientForTask];
      }

      if (!assignedClientIds.length) {
        try {
          const uid = req.user && req.user._id;
          const pub = req.user && req.user.id;

          const direct = await queryAsync(
            'SELECT id FROM clients WHERE manager_id = ? OR manager_id = ? LIMIT 1000',
            [uid, pub || -1]
          );
          assignedClientIds = (direct || []).map(r => r.id).filter(Boolean);

          if (!assignedClientIds.length) {
            const viaProjects = await queryAsync(
              `SELECT DISTINCT c.id AS id
               FROM projects p
               INNER JOIN clients c ON c.id = p.client_id
               WHERE (p.project_manager_id = ? OR p.project_manager_id = ? OR p.manager_id = ? OR p.manager_id = ?)`,
              [uid, pub || -1, uid, pub || -1]
            );
            assignedClientIds = (viaProjects || []).map(r => r.id).filter(Boolean);
          }
        } catch (e) {
          logger.warn('Fallback assignedClientIds lookup failed: ' + (e && e.message));
          assignedClientIds = [];
        }
      }
      if (!assignedClientIds.length) return res.json({ success: true, data: [] });

      const hasStatus = await cachedHasColumn('clients', 'status');
      const hasCreatedAt = await cachedHasColumn('clients', 'created_at');
      const hasManager = await cachedHasColumn('clients', 'manager_id');
      const hasEmail = await cachedHasColumn('clients', 'email');
      const hasPhone = await cachedHasColumn('clients', 'phone');
      const hasPublicId = await cachedHasColumn('clients', 'public_id');
      const hasIsDeleted = await cachedHasColumn('clients', 'isDeleted');
      const hasClientContacts = await tableExists('client_contacts');

      const selectCols = ['c.id', 'c.ref', 'c.name', 'c.company'];
      if (hasPublicId) selectCols.push('c.public_id');
      if (hasStatus) selectCols.push('c.status');
      if (hasManager) {
        selectCols.push('c.manager_id');
        selectCols.push('(SELECT public_id FROM users WHERE _id = c.manager_id OR public_id = c.manager_id LIMIT 1) AS manager_public_id');
        selectCols.push('(SELECT name FROM users WHERE _id = c.manager_id OR public_id = c.manager_id LIMIT 1) AS manager_name');
      }
      if (hasCreatedAt) selectCols.push('c.created_at');
      if (hasClientContacts) {
        if (!hasEmail) selectCols.push('pc.email AS email');
        else selectCols.push('c.email');
        if (!hasPhone) selectCols.push('pc.phone AS phone');
        else selectCols.push('c.phone');
      } else {
        if (hasEmail) selectCols.push('c.email');
        if (hasPhone) selectCols.push('c.phone');
      }

      const joinClause = hasClientContacts
        ? ' LEFT JOIN (SELECT client_id, email, phone FROM client_contacts WHERE is_primary = 1) pc ON pc.client_id = c.id '
        : '';

      const filters = ['c.id IN (?)'];
      const params = [assignedClientIds];
      if (hasIsDeleted) filters.push('(c.isDeleted IS NULL OR c.isDeleted != 1)');
      const whereSql = `WHERE ${filters.join(' AND ')}`;
      const orderBy = hasCreatedAt ? 'c.created_at DESC' : 'c.id DESC';

      const clients = await queryAsync(
        `SELECT ${selectCols.join(', ')} FROM clients c${joinClause} ${whereSql} ORDER BY ${orderBy}`,
        params
      );

      const documentsByClient = await fetchClientDocuments(assignedClientIds);

      const payload = await Promise.all(
        (clients || []).map(async (client) => {
          const normalizedManagerId = hasManager && client.manager_id && Number(client.manager_id) !== 0 ? client.manager_id : null;
          const row = {
            id: client.id,
            public_id: client.public_id || null,
            ref: client.ref,
            name: client.name,
            company: client.company,
            status: client.status || null,
            manager_id: normalizedManagerId,
            manager_public_id: client.manager_public_id || null,
            manager_name: client.manager_name || null,
            created_at: client.created_at || null,
            email: client.email || null,
            phone: client.phone || null,
            documents: documentsByClient[client.id] || []
          };

          if (hasManager && normalizedManagerId && !row.manager_name) {
            const mgr = await queryAsync(
              'SELECT public_id, name FROM users WHERE _id = ? OR public_id = ? LIMIT 1',
              [normalizedManagerId, String(normalizedManagerId)]
            );
            if (Array.isArray(mgr) && mgr.length > 0) {
              row.manager_public_id = mgr[0].public_id || row.manager_public_id;
              row.manager_name = mgr[0].name || row.manager_name;
            }
          }

          return row;
        })
      );

      return res.json({ success: true, data: payload });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  getAssignedProjects: async (req, res) => {
    try {
      await requireFeatureAccess(req, 'Projects');

      const projects = await gatherManagerProjects(req);

      const payload = projects.map((project) => ({
        id: project.public_id || String(project.id),
        name: project.name,
        status: project.status,
        priority: project.priority,
        startDate: project.start_date,
        endDate: project.end_date,

        client: project.client_id
          ? {
            id: project.client_public_id || String(project.client_id),
            name: project.client_name,
          }
          : null,

        manager: project.project_manager_id
          ? {
            id:
              project.project_manager_public_id ||
              String(project.project_manager_id),
            name: project.project_manager_name,
          }
          : null,
      }));
      return res.json({ success: true, data: payload });
    } catch (error) {
      return res
        .status(error.status || 500)
        .json({ success: false, error: error.message });
    }
  },

  getTaskTimeline: async (req, res) => {
    try {
      await requireFeatureAccess(req, 'Tasks');
      const projects = await gatherManagerProjects(req);
      const projectIds = dedupe(projects.map((project) => project.id)).filter(Boolean);
      const projectPublicIds = dedupe(projects.map((project) => project.public_id)).filter(Boolean);
      const projectFilter = parseProjectFilter(req);

      const lookupById = new Map();
      const lookupByPublicId = new Map();
      projects.forEach((project) => {
        if (project && project.id) lookupById.set(String(project.id), project);
        if (project && project.public_id) lookupByPublicId.set(String(project.public_id), project);
      });

      let selectedProject = null;
      let filteredProjectIds = [...projectIds];
      let filteredProjectPublicIds = [...projectPublicIds];

      if (projectFilter) {
        selectedProject =
          projectFilter.type === 'id'
            ? lookupById.get(String(projectFilter.value))
            : lookupByPublicId.get(String(projectFilter.value));

        if (!selectedProject) {
          return res
            .status(404)
            .json({ success: false, error: 'Project not found or not assigned to this manager' });
        }

        filteredProjectIds = selectedProject.id ? [selectedProject.id] : [];
        filteredProjectPublicIds = selectedProject.public_id ? [selectedProject.public_id] : [];
      }

      const tasks = await fetchTaskTimeline(filteredProjectIds, filteredProjectPublicIds);
      const taskInternalIds = dedupe(tasks.map((task) => task.task_internal_id || task.id)).filter(Boolean);

      const assignmentStateMap = {};
      if (taskInternalIds.length > 0) {
        const assignmentRows = await queryAsync(
          `SELECT
             ta.task_id AS task_id,
             u._id AS user_id,
             u.public_id AS user_public_id,
             u.name AS user_name,
             COALESCE(ta.is_read_only, 0) AS is_read_only,
             COALESCE(tas.status, 'PENDING') AS assignment_status,
             tas.started_at,
             tas.live_timer,
             tas.completed_at,
             tas.total_duration,
             tas.rejection_reason
           FROM task_assignments ta
           INNER JOIN users u ON u._id = ta.user_id
           LEFT JOIN task_assignment_status tas ON tas.task_id = ta.task_id AND tas.user_id = ta.user_id
           WHERE ta.task_id IN (?)
           ORDER BY ta.task_id ASC, u._id ASC`,
          [taskInternalIds]
        );

        (assignmentRows || []).forEach((row) => {
          const taskKey = String(row.task_id);
          assignmentStateMap[taskKey] = assignmentStateMap[taskKey] || [];
          assignmentStateMap[taskKey].push({
            id: row.user_public_id || String(row.user_id),
            internalId: row.user_id != null ? String(row.user_id) : null,
            name: row.user_name || null,
            readOnly: row.is_read_only === 1 || String(row.is_read_only) === '1',
            status: normalizeTaskStatusKey(row.assignment_status || 'PENDING'),
            started_at: toIsoDate(row.started_at),
            live_timer: toIsoDate(row.live_timer),
            completed_at: toIsoDate(row.completed_at),
            total_duration: Number(row.total_duration || 0),
            rejection_reason: row.rejection_reason || null
          });
        });
      }

      const lockStatuses = {};
      if (taskInternalIds.length > 0) {

        const lockResult = await queryAsync(`
        SELECT 
          r.task_id,
          r.status AS request_status,
          r.id AS request_id,
          r.requested_at,
          r.responded_at,
          r.requested_by,
          u.name AS requester_name,
          u.public_id AS requester_id,
          t.status AS task_current_status,
          t.public_id AS task_public_id
        FROM task_resign_requests r
        INNER JOIN tasks t ON t.id = r.task_id
        LEFT JOIN users u ON r.requested_by = u._id
        WHERE r.task_id IN (?)
        ORDER BY r.requested_at DESC
      `, [taskInternalIds]);

        const lockRows = Array.isArray(lockResult) ? lockResult : [];
        if (Array.isArray(lockRows)) {
          lockRows.forEach(row => {
            if (!row || !row.task_id) return;
            const taskKey = String(row.task_id);
            const normalizedRequestStatus = normalizeTaskStatusKey(row.request_status || '');
            if (!lockStatuses[taskKey]) {
              lockStatuses[taskKey] = {
                is_locked: false,
                has_pending: normalizedRequestStatus === 'PENDING',
                request_status: normalizedRequestStatus || null,
                request_id: row.request_id,
                requested_at: row.requested_at ? new Date(row.requested_at).toISOString() : null,
                responded_at: row.responded_at ? new Date(row.responded_at).toISOString() : null,
                requested_by: String(row.requested_by),
                requester_name: row.requester_name || 'Unknown',
                requester_id: row.requester_id || null,
                task_status: row.task_current_status,
                task_public_id: row.task_public_id
              };
              return;
            }
            if (normalizedRequestStatus === 'PENDING') {
              lockStatuses[taskKey].has_pending = true;
            }
          });
        }
      }

      let taskChecklists = [];
      let taskActivities = [];

      if (taskInternalIds.length) {

        taskChecklists = await queryAsync(
          `SELECT s.id, s.task_id AS task_id, s.title, s.description, s.due_date, s.tag, s.created_at, s.updated_at, s.status, s.estimated_hours, s.completed_at, s.created_by,
                u.public_id AS creator_public_id, u.name AS creator_name
         FROM subtasks s
         LEFT JOIN users u ON u._id = s.created_by
         WHERE s.task_id IN (?)`,
          [taskInternalIds]
        );

        taskActivities = await queryAsync(
          `SELECT al.entity_id AS task_id, al.action as type, al.details as activity, al.createdAt, u._id AS user_id, u.public_id AS user_public_id, u.name AS user_name
         FROM audit_logs al
         LEFT JOIN users u ON al.actor_id = u._id
         WHERE al.entity = 'task' AND al.entity_id IN (?) AND al.module = 'tasks'
         ORDER BY al.createdAt DESC`,
          [taskInternalIds]
        );
      }

      const checklistMap = {};
      (taskChecklists || []).forEach((subtask) => {
        if (!subtask || subtask.task_id === undefined || subtask.task_id === null) return;
        const key = String(subtask.task_id);
        if (!checklistMap[key]) checklistMap[key] = [];
        checklistMap[key].push({
          id: subtask.id,
          title: subtask.title || null,
          status: subtask.status || null,
          description: subtask.description || null,
          dueDate: toIsoDate(subtask.due_date),
          tag: subtask.tag || null,
          estimatedHours: subtask.estimated_hours != null ? Number(subtask.estimated_hours) : null,
          completedAt: toIsoDate(subtask.completed_at),
          createdAt: toIsoDate(subtask.created_at),
          updatedAt: toIsoDate(subtask.updated_at),
          createdBy: subtask.created_by ? {
            id: subtask.creator_public_id || String(subtask.created_by),
            internalId: String(subtask.created_by),
            name: subtask.creator_name || null
          } : null
        });
      });

      const activityMap = {};
      (taskActivities || []).forEach((activity) => {
        if (!activity || activity.task_id === undefined || activity.task_id === null) return;
        const key = String(activity.task_id);
        if (!activityMap[key]) activityMap[key] = [];
        activityMap[key].push({
          type: activity.type || null,
          activity: activity.activity || null,
          createdAt: toIsoDate(activity.createdAt),
          user: activity.user_id ? {
            id: activity.user_public_id || String(activity.user_id),
            internalId: String(activity.user_id),
            name: activity.user_name || null
          } : null
        });
      });

      const formatted = (tasks || []).map((task) => {
        const assignedInternal = task.assigned_user_internal_ids
          ? String(task.assigned_user_internal_ids).split(',')
          : [];
        const assignedPublic = task.assigned_user_public_ids
          ? String(task.assigned_user_public_ids).split(',')
          : [];
        const assignedNames = task.assigned_user_names ? String(task.assigned_user_names).split(',') : [];

        const fallbackAssignedUsers = assignedPublic.map((publicId, idx) => ({
          id: publicId || (assignedInternal[idx] ? String(assignedInternal[idx]) : null),
          internalId: assignedInternal[idx] ? String(assignedInternal[idx]) : null,
          name: assignedNames[idx] || null
        }));

        const taskId = task.task_internal_id || task.id;
        const assignmentStates = assignmentStateMap[String(taskId)] || [];
        const assignedUsers = assignmentStates.length ? assignmentStates : fallbackAssignedUsers;
        const lockInfo = lockStatuses[String(taskId)] || {};
        const isLocked = Boolean(lockInfo.is_locked);

        const internalKey = task.task_internal_id ? String(task.task_internal_id) : null;
        const publicKey = task.task_id ? String(task.task_id) : null;


        return {
          id: task.task_id ? String(task.task_id) : String(task.task_internal_id),
          title: task.title,

          description: task.description || null,
          stage: task.stage,
          taskDate: task.taskDate ? new Date(task.taskDate).toISOString() : null,
          priority: task.priority,
          status: assignmentStates.length ? deriveAssignmentStatus(assignmentStates) : task.status,
          timeAlloted: task.time_alloted != null ? Number(task.time_alloted) : null,

          day: task.day || null,
          dayName: task.dayName || null,
          estimatedHours: task.estimated_hours != null ? Number(task.estimated_hours) : null,
          createdAt: task.created_at ? toIsoDate(task.created_at) : null,
          updatedAt: task.updated_at ? toIsoDate(task.updated_at) : null,
          completed_at: task.completed_at ? toIsoDate(task.completed_at) : null,

          client: {
            id: task.client_public_id || (task.client_id ? String(task.client_id) : null),
            name: task.client_name || null
          },

          project: {
            internalId: task.project_internal_id || null,
            id: task.project_public_id || (task.project_internal_id ? String(task.project_internal_id) : null),
            name: task.project_name || null,
            status: normalizeProjectStatus(task.project_status, task.project_is_locked).status || null,
            priority: task.project_priority || null,
            startDate: toIsoDate(task.project_start_date),
            endDate: toIsoDate(task.project_end_date),
            clientId: task.project_client_id ? String(task.project_client_id) : null
          },

          assignedUsers,

          checklist: (internalKey && checklistMap[internalKey]) || (publicKey && checklistMap[publicKey]) || [],

          activityTimeline: (internalKey && activityMap[internalKey]) || (publicKey && activityMap[publicKey]) || [],

          started_at: task.started_at ? toIsoDate(task.started_at) : null,
          live_timer: task.live_timer ? toIsoDate(task.live_timer) : null,
          total_time_seconds: task.total_duration != null ? Number(task.total_duration) : 0,
          total_time_hours: task.total_duration != null ? Number((Number(task.total_duration) / 3600).toFixed(2)) : 0,
          total_time_hhmmss: (() => {
            const secs = Number(task.total_duration || 0);
            const hh = String(Math.floor(secs / 3600)).padStart(2, '0');
            const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
            const ss = String(secs % 60).padStart(2, '0');
            return `${hh}:${mm}:${ss}`;
          })(),

          is_locked: isLocked,
          has_pending: Boolean(lockInfo.has_pending),
          lock_info: lockInfo,
          task_status: {
            current_status: assignmentStates.length ? deriveAssignmentStatus(assignmentStates) : (task.status || 'Unknown'),
            is_locked: isLocked,
            requester_name: lockInfo.requester_name
          },

          summary: (() => {
            try {
              const now = new Date();
              const est = task.taskDate ? new Date(task.taskDate) : null;
              if (!est) return {};
              return {
                dueStatus: est < now ? 'Overdue' : 'On Time',
                dueDate: toIsoDate(est)
              };
            } catch (e) {
              return {};
            }
          })()
        };
      });

      const meta = { count: formatted.length };
      let projectMeta = null;

      if (selectedProject) {
        projectMeta = {
          internalId: selectedProject.id || null,
          id: selectedProject.public_id || (selectedProject.id ? String(selectedProject.id) : null),
          publicId: selectedProject.public_id || null,
          name: selectedProject.name || null,
          status: normalizeProjectStatus(selectedProject.status, selectedProject.is_locked).status || null,
          priority: selectedProject.priority || null,
          startDate: toIsoDate(selectedProject.start_date),
          endDate: toIsoDate(selectedProject.end_date),
          client: {
            id: selectedProject.client_public_id || (selectedProject.client_id ? String(selectedProject.client_id) : null),
            name: selectedProject.client_name || null
          }
        };
        meta.project = projectMeta;
      }

      const payload = {
        success: true,
        data: formatted,
        meta
      };

      if (projectMeta) payload.project = projectMeta;
      return res.json(payload);

    } catch (error) {
      logger.error('Error in getTaskTimeline:', error && error.message ? error.message : error);
      return res.status(error.status || 500).json({
        success: false,
        error: error.message
      });
    }
  },

  getDepartmentEmployees: async (req, res) => {
    try {
      await requireFeatureAccess(req, 'Tasks');
      const departmentPublicId = await fetchManagerDepartment(req.user._id);
      if (!departmentPublicId) {
        return res.json({ success: true, data: [] });
      }
      const rows = await queryAsync(
        `SELECT _id, public_id, name, email, phone, title, role, isActive, isGuest, department_public_id
         FROM users
         WHERE role = 'Employee' AND department_public_id = ?`,
        [departmentPublicId]
      );
      const employees = (rows || []).map((row) => ({
        id: row.public_id || String(row._id),
        internalId: row._id ? String(row._id) : null,
        name: row.name || null,
        email: row.email || null,
        phone: row.phone || null,
        title: row.title || null,
        role: row.role || null,
        isActive: row.isActive !== undefined ? Boolean(row.isActive) : null,
        isGuest: row.isGuest !== undefined ? Boolean(row.isGuest) : null,
        departmentPublicId: row.department_public_id || null
      }));
      return res.json({ success: true, data: employees, meta: { count: employees.length } });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  getManagerOverview: async (req, res) => {
    try {
      await requireFeatureAccess(req, 'Dashboard');

      const projects = await gatherManagerProjects(req);
      const projectIds = dedupe(projects.map(p => p.id)).filter(Boolean);
      const projectPublicIds = dedupe(projects.map(p => p.public_id)).filter(Boolean);
      const projectCount = projects.length;
      const taskCount = await countRelatedTasks(projectIds, projectPublicIds);

      const resources = await RoleBasedLoginResponse.getAccessibleResources(req.user._id, req.user.role, req.user.tenant_id, req.user.id);
      let assignedClientIds = Array.isArray(resources.assignedClientIds) ? resources.assignedClientIds.filter(Boolean) : [];
      if (!assignedClientIds.length) {
        try {
          const uid = req.user && req.user._id;
          const pub = req.user && req.user.id;
          const direct = await queryAsync('SELECT id FROM clients WHERE manager_id = ? OR manager_id = ? LIMIT 1000', [uid, pub || -1]);
          assignedClientIds = (direct || []).map(r => r.id).filter(Boolean);
          if (!assignedClientIds.length) {
            const viaProjects = await queryAsync(
              `SELECT DISTINCT c.id AS id FROM projects p INNER JOIN clients c ON c.id = p.client_id WHERE (p.project_manager_id = ? OR p.project_manager_id = ? OR p.manager_id = ? OR p.manager_id = ?)`,
              [uid, pub || -1, uid, pub || -1]
            );
            assignedClientIds = (viaProjects || []).map(r => r.id).filter(Boolean);
          }
        } catch (e) { assignedClientIds = []; }
      }

      const hasClientPublic = await cachedHasColumn('clients', 'public_id');
      const clientSelect = hasClientPublic ? 'id, public_id, ref, name, company' : 'id, ref, name, company';
      const clients = assignedClientIds.length
        ? (await queryAsync(`SELECT ${clientSelect} FROM clients WHERE id IN (?) AND (isDeleted IS NULL OR isDeleted != 1) ORDER BY id DESC`, [assignedClientIds]))
        : [];

      const deptPub = await fetchManagerDepartment(req.user._id);
      const hasUserPublic = await cachedHasColumn('users', 'public_id');
      const userSelect = hasUserPublic ? '_id, public_id, name, email, phone, title' : '_id, name, email, phone, title';
      const employees = deptPub
        ? (await queryAsync(`SELECT ${userSelect} FROM users WHERE role = 'Employee' AND department_public_id = ?`, [deptPub])).map(r => ({ id: (hasUserPublic ? (r.public_id || String(r._id)) : String(r._id)), internalId: r._id ? String(r._id) : null, name: r.name || null, email: r.email || null, phone: r.phone || null, title: r.title || null }))
        : [];

      const timeline = await fetchTaskTimeline(projectIds, projectPublicIds);
      const tasks = (timeline || []).slice(0, 50).map(t => {
        const assignedInternal = t.assigned_user_internal_ids ? String(t.assigned_user_internal_ids).split(',') : [];
        const assignedPublic = t.assigned_user_public_ids ? String(t.assigned_user_public_ids).split(',') : [];
        const assignedNames = t.assigned_user_names ? String(t.assigned_user_names).split(',') : [];
        const assignedUsers = assignedPublic.map((publicId, idx) => ({
          id: publicId || (assignedInternal[idx] ? String(assignedInternal[idx]) : null),
          internalId: assignedInternal[idx] ? String(assignedInternal[idx]) : null,
          name: assignedNames[idx] || null
        }));

        return {
          id: t.task_id ? String(t.task_id) : String(t.task_internal_id),
          title: t.title,
          status: t.status,
          priority: t.priority,
          taskDate: t.taskDate ? new Date(t.taskDate).toISOString() : null,
          client: { id: t.client_public_id || (t.client_id ? String(t.client_id) : null), name: t.client_name || null },
          project: { id: t.project_public_id || (t.project_internal_id ? String(t.project_internal_id) : null), name: t.project_name || null },
          assignedUsers: assignedUsers.length ? assignedUsers : []
        };
      });

      const extendedMetrics = await getExtendedDashboardMetrics(req.user.tenant_id, { projectIds }).catch(() => ({}));

      return res.json({
        metrics: { projectCount, taskCount, clientCount: clients.length, ...extendedMetrics },
        projects: projects.map(p => ({ id: p.public_id || String(p.id), name: p.name, status: p.status, priority: p.priority, stage: p.stage || null, client: p.client_id ? { id: p.client_public_id || String(p.client_id), name: p.client_name } : null })),
        clients: (clients || []).map(c => ({ id: c.public_id || String(c.id), name: c.name, company: c.company || null })),
        employees,
        tasks,
        ...extendedMetrics
      });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  listEmployees: async (req, res) => {
    try {
      await requireFeatureAccess(req, 'Tasks');
      const departmentPublicId = await fetchManagerDepartment(req.user._id);
      if (!departmentPublicId) {
        return res.json({ success: true, data: [], meta: { count: 0 } });
      }
      const hasTenantId = await cachedHasColumn('users', 'tenant_id');
      const rows = await queryAsync(
        `SELECT _id, public_id, name, email, phone, title, isActive, isGuest, department_public_id
         FROM users
         WHERE role = 'Employee'
           AND department_public_id = ?
           ${hasTenantId ? 'AND tenant_id = ?' : ''}`,
        hasTenantId ? [departmentPublicId, req.user.tenant_id || null] : [departmentPublicId]
      );
      const employees = (rows || []).map((row) => ({
        id: row.public_id || String(row._id),
        internalId: row._id ? String(row._id) : null,
        name: row.name || null,
        email: row.email || null,
        phone: row.phone || null,
        title: row.title || null,
        isActive: row.isActive !== undefined ? Boolean(row.isActive) : null,
        isGuest: row.isGuest !== undefined ? Boolean(row.isGuest) : null,
        departmentPublicId: row.department_public_id || null
      }));
      return res.json({ success: true, data: employees, meta: { count: employees.length } });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  listUsers: async (req, res) => {
    try {
      await requireFeatureAccess(req, 'Users');
      const departmentPublicId = await fetchManagerDepartment(req.user._id);
      if (!departmentPublicId) {
        return res.json({ success: true, data: [], meta: { count: 0 } });
      }

      const hasTenantId = await cachedHasColumn('users', 'tenant_id');
      const rows = await queryAsync(
        `SELECT u._id, u.public_id, u.name, u.email, u.role, u.title, u.isActive, u.phone, u.isGuest, u.department_public_id, d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.public_id = u.department_public_id ${hasTenantId ? 'AND d.tenant_id = u.tenant_id' : ''}
         WHERE u.role NOT IN ('SuperAdmin', 'Super-Admin')
           AND u.department_public_id = ?
           ${hasTenantId ? 'AND u.tenant_id = ?' : ''}
         ORDER BY u.name ASC, u._id ASC`,
        hasTenantId ? [departmentPublicId, req.user.tenant_id || null] : [departmentPublicId]
      );

      const users = (rows || []).map((row) => ({
        id: row.public_id || String(row._id),
        internalId: row._id ? String(row._id) : null,
        name: row.name || null,
        email: row.email || null,
        role: row.role || null,
        title: row.title || null,
        isActive: row.isActive !== undefined ? Boolean(row.isActive) : null,
        phone: row.phone || null,
        isGuest: row.isGuest !== undefined ? Boolean(row.isGuest) : null,
        departmentPublicId: row.department_public_id || null,
        departmentName: row.department_name || null
      }));

      return res.json({ success: true, data: users, meta: { count: users.length } });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  getSettings: (req, res) => {
    const settings = {
      version: "1.0.0",
      general: {
        site_name: "Task Manager",
        support_email: "support@taskmanager.com",
        timezone: "Asia/Kolkata"
      },
      database: {
        primary_db: "connected",
        replica_db: "connected"
      },
      security: {
        password_expiry: true,
        login_notifications: true,
        session_timeout: false
      },
      notifications: {
        email_alerts: true,
        sms_alerts: false,
        weekly_summary: true
      },
      api: {
        base_url: "https://api.taskmanager.com",
        public_key: "pk_live_123456",
        secret_key: "sk_live_123456"
      }
    };
    return res.json({ success: true, data: settings });
  },

  putSettings: async (req, res) => {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['ADMIN', 'SUPERADMIN', 'SUPER_ADMIN'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Only Admin/Super Admin can update platform settings' });
    }
    try {
      const { saveSettings } = require('../services/settingsService');
      const tenantId = req.user?.tenant_id || req.tenantId || null;
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const updates = payload.general && typeof payload.general === 'object' ? payload.general : payload;
      const normalizeValue = (value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (Array.isArray(value)) return value.join('');
        return String(value);
      };
      const saved = await saveSettings(tenantId, {
        site_name: normalizeValue(updates.site_name ?? updates.siteName),
        support_email: normalizeValue(updates.support_email ?? updates.supportEmail ?? updates.email_id),
        email_id: normalizeValue(updates.email_id ?? updates.support_email ?? updates.supportEmail),
        timezone: normalizeValue(updates.timezone),
        logo_url: normalizeValue(updates.logo_url ?? updates.logoUrl)
      });
      return res.json({ success: true, data: { version: '1.0.0', general: saved.general } });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
};
