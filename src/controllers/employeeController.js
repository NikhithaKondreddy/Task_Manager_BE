const db = require(__root + 'db');
const errorResponse = require(__root + 'utils/errorResponse');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = require('../../logger'); }
const RoleBasedLoginResponse = require(__root + 'controllers/utils/RoleBasedLoginResponse');
const { normalizeProjectStatus } = require(__root + 'utils/projectStatus');
const columnExistenceCache = Object.create(null);
let subtaskColumnPresenceCache = null;
const MAX_CHECKLIST_ITEMS = Number.isFinite(Number(process.env.MAX_CHECKLIST_ITEMS)) && Number(process.env.MAX_CHECKLIST_ITEMS) > 0
  ? Number(process.env.MAX_CHECKLIST_ITEMS)
  : 100;

const normalizeUserTaskStatus = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return 'PENDING';
  const compact = raw.toUpperCase().replace(/\s+/g, '_').replace(/-/g, '_');
  if (compact === 'ONHOLD') return 'ON_HOLD';
  if (compact === 'INPROGRESS') return 'IN_PROGRESS';
  if (compact === 'COMPLETED' || compact === 'COMPLETE' || compact === 'DONE') return 'COMPLETED';
  return compact;
};

async function ensureTaskAssignmentStatusTable() {
  try {
    await queryAsync('SELECT 1 FROM task_assignment_status LIMIT 1');
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
      try {
        await queryAsync(`
          CREATE TABLE IF NOT EXISTS task_assignment_status (
            id INT AUTO_INCREMENT PRIMARY KEY,
            task_id INT NOT NULL,
            user_id INT NOT NULL,
            tenant_id INT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            review_requested TINYINT(1) NOT NULL DEFAULT 0,
            started_at DATETIME NULL,
            live_timer DATETIME NULL,
            completed_at DATETIME NULL,
            approved_at DATETIME NULL,
            rejected_at DATETIME NULL,
            rejection_reason TEXT NULL,
            total_duration INT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_tas_task_user (task_id, user_id),
            INDEX idx_tas_task_id (task_id),
            INDEX idx_tas_user_id (user_id)
          )
        `);
        logger.info('Created task_assignment_status table');
      } catch (createErr) {
        logger.warn('Failed to create task_assignment_status table: ' + createErr.message);
      }
    }
  }
}

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

async function hasColumn(table, column) {
  const cacheKey = `${table}::${column}`;
  if (columnExistenceCache[cacheKey] !== undefined) return columnExistenceCache[cacheKey];
  const rows = await queryAsync(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  columnExistenceCache[cacheKey] = Array.isArray(rows) && rows.length > 0;
  return columnExistenceCache[cacheKey];
}

async function getSubtaskColumnPresence() {
  if (subtaskColumnPresenceCache) return subtaskColumnPresenceCache;
  const columnsToCheck = ['description', 'completed_at', 'created_at', 'updated_at', 'created_by', 'deleted_at', 'isDeleted'];
  const presence = {};
  for (const col of columnsToCheck) {
    presence[col] = await hasColumn('subtasks', col);
  }
  subtaskColumnPresenceCache = presence;
  return presence;
}

async function buildTenantClause(alias = 't', tenantId) {
  const columnExists = await hasColumn('tasks', 'tenant_id');
  if (!columnExists) return { clause: '', params: [] };
  if (tenantId !== undefined && tenantId !== null) {
    return { clause: `AND ${alias}.tenant_id = ?`, params: [tenantId] };
  }
  return { clause: `AND ${alias}.tenant_id IS NULL`, params: [] };
}

async function buildTaskDeletionClause(alias = 't') {
  const columnExists = await hasColumn('tasks', 'isDeleted');
  if (!columnExists) return { clause: '', params: [] };
  return { clause: `AND (${alias}.isDeleted IS NULL OR ${alias}.isDeleted != 1)`, params: [] };
}

async function buildSubtaskDeletedClause(alias = 's') {
  const columnExists = await hasColumn('subtasks', 'isDeleted');
  if (!columnExists) return { clause: '', params: [] };
  return { clause: `AND (${alias}.isDeleted IS NULL OR ${alias}.isDeleted != 1)`, params: [] };
}

async function buildProjectJoinClause() {
  const projectIdExists = await hasColumn('tasks', 'project_id');
  const projectPublicIdExists = await hasColumn('tasks', 'project_public_id');
  const projectIsLockedExists = await hasColumn('projects', 'is_locked');
  const startedAtExists = await hasColumn('tasks', 'started_at');
  const liveTimerExists = await hasColumn('tasks', 'live_timer');
  const totalDurationExists = await hasColumn('tasks', 'total_duration');
  const joinClauses = [];
  const selects = [];
  const joinConditions = [];
  if (projectIdExists) {
    joinConditions.push('p.id = t.project_id');
  }
  if (projectPublicIdExists) {
    joinConditions.push('p.public_id COLLATE utf8mb4_unicode_ci = t.project_public_id COLLATE utf8mb4_unicode_ci');
  }
  if (joinConditions.length) {
    joinClauses.push(`LEFT JOIN projects p ON (${joinConditions.join(' OR ')})`);
    selects.push('MIN(p.id) AS project_internal_id', 'MIN(p.name) AS project_name', 'MIN(p.status) AS project_status', 'MIN(p.priority) AS project_priority');
    if (projectIsLockedExists) {
      selects.push('MIN(p.is_locked) AS project_is_locked');
    }
  }
  if (projectPublicIdExists) {
    selects.push('MIN(t.project_public_id) AS project_public_id');
  }
  if (startedAtExists) {
    selects.push('MIN(t.started_at) AS started_at');
  }
  if (liveTimerExists) {
    selects.push('MIN(t.live_timer) AS live_timer');
  }
  if (totalDurationExists) {
    selects.push('MIN(t.total_duration) AS total_duration');
  }
  return { join: joinClauses.join(' '), selects };
}

function formatChecklistItem(row) {
  if (!row) return null;
  return {
    id: row.id != null ? String(row.id) : null,
    title: row.title || null,
    description: row.description || null,
    status: row.status || null,
    dueDate: row.due_date ? new Date(row.due_date).toISOString() : null,
    completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null
  };
}

async function fetchChecklistMap(taskIds = [], userId = null, tenantId = null) {
  if (!taskIds.length) return {};
  const uniqueIds = Array.from(new Set(taskIds));
  const { clause } = await buildSubtaskDeletedClause('s');
  const { description, completed_at, created_at, updated_at } = await getSubtaskColumnPresence();
  const checklistColumns = ['id', 'task_id', 'title'];
  if (description) checklistColumns.push('description');
  checklistColumns.push('status', 'due_date');
  if (completed_at) checklistColumns.push('completed_at');
  if (created_at) checklistColumns.push('created_at');
  if (updated_at) checklistColumns.push('updated_at');
  const rows = await queryAsync(
    `SELECT ${checklistColumns.join(', ')}
     FROM subtasks s
     WHERE s.task_id IN (${uniqueIds.map(() => '?').join(', ')}) ${clause}
     ORDER BY s.created_at ASC`,
    uniqueIds
  );

  const progressByTaskSubtask = {};
  if (userId) {
    await ensureUserChecklistProgressTable();
    const tenantFilter = tenantId != null ? ' AND (tenant_id = ? OR tenant_id IS NULL)' : '';
    const progressRows = await queryAsync(
      `SELECT task_id, subtask_id, status, completed_at
       FROM user_checklist_progress
       WHERE task_id IN (${uniqueIds.map(() => '?').join(', ')}) AND user_id = ?${tenantFilter}`,
      tenantId != null ? [...uniqueIds, userId, tenantId] : [...uniqueIds, userId]
    );
    (progressRows || []).forEach((row) => {
      progressByTaskSubtask[`${row.task_id}:${row.subtask_id}`] = row;
    });
  }

  const map = {};
  (rows || []).forEach(row => {
    const formatted = formatChecklistItem(row);
    const progress = progressByTaskSubtask[`${row.task_id}:${row.id}`];
    if (progress) {
      formatted.status = progress.status || formatted.status;
      formatted.completedAt = progress.completed_at ? new Date(progress.completed_at).toISOString() : null;
    }
    if (!map[row.task_id]) map[row.task_id] = [];
    map[row.task_id].push(formatted);
  });
  return map;
}

async function ensureAssignedTask(taskId, userId, tenantId) {
  let internalTaskId = taskId;
  if (typeof taskId === 'string' && !/^\d+$/.test(taskId)) { // if not numeric, assume public_id
    const taskRows = await queryAsync('SELECT id FROM tasks WHERE public_id = ?', [taskId]);
    if (taskRows.length === 0) {
      throw new Error('Task not found');
    }
    internalTaskId = taskRows[0].id;
  }
  const { clause, params } = await buildTenantClause('t', tenantId);
  const rows = await queryAsync(
    `SELECT t.id
     FROM task_assignments ta
     INNER JOIN tasks t ON t.id = ta.task_id
     WHERE ta.task_id = ? AND ta.user_id = ? AND (ta.is_read_only IS NULL OR ta.is_read_only != 1) ${clause}
     LIMIT 1`,
    [internalTaskId, userId, ...params]
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw accessDenied('Access denied: task not assigned to you');
  }
  return rows[0];
}

async function ensureSubtaskPermission(subtaskId, userId, tenantId) {
  const { clause, params } = await buildTenantClause('t', tenantId);
  const rows = await queryAsync(
    `SELECT s.id
     FROM subtasks s
     INNER JOIN tasks t ON t.id = s.task_id
     INNER JOIN task_assignments ta ON ta.task_id = t.id
     WHERE s.id = ? AND ta.user_id = ? AND (ta.is_read_only IS NULL OR ta.is_read_only != 1) ${clause}
     LIMIT 1`,
    [subtaskId, userId, ...params]
  );
  if (!Array.isArray(rows) || !rows.length) {
    throw accessDenied('Access denied: cannot modify this subtask');
  }
  return rows[0];
}

function accessDenied(message) {
  const error = new Error(message);
  error.status = 403;
  return error;
}

async function checkTaskLocked(taskId, userId = null, tenantId = null) {
  // Convert public_id to internal ID if needed
  let internalTaskId = taskId;
  if (typeof taskId === 'string' && !/^\d+$/.test(taskId)) {
    const taskRows = await queryAsync('SELECT id FROM tasks WHERE public_id = ?', [taskId]);
    if (taskRows.length === 0) {
      return null; // Task not found, let caller handle
    }
    internalTaskId = taskRows[0].id;
  }

  // Restrict only requester when their reassignment request is pending.
  const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');
  const reassignRows = userId
    ? await queryAsync(
      `SELECT id
       FROM task_resign_requests
       WHERE task_id = ?
         AND requested_by = ?
         AND status = 'PENDING'
         ${hasReassignmentTenantId ? 'AND tenant_id = ?' : ''}
       LIMIT 1`,
      hasReassignmentTenantId ? [internalTaskId, userId, tenantId || null] : [internalTaskId, userId]
    )
    : [];
  const isLockedForUser = reassignRows && reassignRows.length > 0;

  if (isLockedForUser) {
    const error = new Error('You already requested reassignment. Action restricted.');
    error.status = 423;
    error.code = 'TASK_LOCKED_FOR_REQUESTER';
    return error;
  }
  return null;
}

async function requireFeatureAccess(req, feature) {
  const resources = await RoleBasedLoginResponse.getAccessibleResources(req.user._id, req.user.role, req.user.tenant_id, req.user.id);
  if (!resources || !Array.isArray(resources.features) || !resources.features.includes(feature)) {
    throw accessDenied(`Access denied: ${feature} feature`);
  }
  return resources;
}

async function insertChecklistItem({ taskId, title, description, dueDate, userId, tenantId }) {
  if (!title) {
    const error = new Error('Checklist title is required');
    error.status = 400;
    throw error;
  }
  // Check if task is locked due to reassignment
  const lockError = await checkTaskLocked(taskId, userId, tenantId);
  if (lockError) throw lockError;
  
  const taskInfo = await ensureAssignedTask(taskId, userId, tenantId);
  const internalTaskId = taskInfo.id;
  const { clause } = await buildSubtaskDeletedClause('s');
  const countRows = await queryAsync(`SELECT COUNT(*) AS total FROM subtasks s WHERE s.task_id = ? ${clause}`, [internalTaskId]);
  const existingCount = countRows && countRows[0] ? Number(countRows[0].total || 0) : 0;
  if (existingCount >= MAX_CHECKLIST_ITEMS) {
    const error = new Error(`Checklist cannot have more than ${MAX_CHECKLIST_ITEMS} items`);
    error.status = 400;
    throw error;
  }
  const columnsPresence = await getSubtaskColumnPresence();
  const insertColumns = [];
  const placeholders = [];
  const insertParams = [];

  const pushParam = (column, value) => {
    insertColumns.push(column);
    placeholders.push('?');
    insertParams.push(value);
  };

  pushParam('task_id', internalTaskId);
  pushParam('title', title);
  if (columnsPresence.description) {
    pushParam('description', description || null);
  }
  pushParam('status', 'PENDING');
  pushParam('due_date', dueDate || null);
  if (columnsPresence.created_by) {
    pushParam('created_by', userId);
  }
  if (columnsPresence.created_at) {
    insertColumns.push('created_at');
    placeholders.push('NOW()');
  }
  const result = await queryAsync(
    `INSERT INTO subtasks (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
    insertParams
  );
  const newSubtaskId = result.insertId;
  const insertedRows = await queryAsync('SELECT * FROM subtasks WHERE id = ? LIMIT 1', [newSubtaskId]);

  // Propagate the new checklist item to ALL current assignees of this task
  // (including the creator and all other assignees, per-user progress isolation)
  try {
    await ensureUserChecklistProgressTable();
    const assigneeRows = await queryAsync(
      'SELECT user_id FROM task_assignments WHERE task_id = ?',
      [internalTaskId]
    );
    for (const row of (assigneeRows || [])) {
      await queryAsync(
        `INSERT IGNORE INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status) VALUES (?, ?, ?, ?, 'PENDING')`,
        [internalTaskId, row.user_id, newSubtaskId, tenantId || null]
      );
    }
  } catch (propagateErr) {
    logger.warn('Failed to propagate checklist item to assignees: ' + propagateErr.message);
  }

  return insertedRows[0];
}

async function ensureUserChecklistProgressTable() {
  try {
    await queryAsync('SELECT 1 FROM user_checklist_progress LIMIT 1');
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
      try {
        await queryAsync(`
          CREATE TABLE IF NOT EXISTS user_checklist_progress (
            id INT AUTO_INCREMENT PRIMARY KEY,
            task_id INT NOT NULL,
            user_id INT NOT NULL,
            subtask_id INT NOT NULL,
            tenant_id INT NULL,
            status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
            completed_at DATETIME NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_ucp_task_user_subtask (task_id, user_id, subtask_id),
            INDEX idx_ucp_task_user (task_id, user_id),
            INDEX idx_ucp_subtask (subtask_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
      } catch (createErr) {
        logger.warn('Failed to create user_checklist_progress table: ' + createErr.message);
      }
    }
  }
}

function buildClientPayload(row) {
  if (!row.client_id && !row.client_name) return null;
  return {
    id: row.client_id != null ? String(row.client_id) : null,
    name: row.client_name || null
  };
}

function buildProjectPayload(row) {
  const hasInternal = row.project_internal_id != null;
  const hasPublic = row.project_public_id != null;
  if (!hasInternal && !hasPublic) return null;
  const norm = normalizeProjectStatus(row.project_status, row.project_is_locked);
  return {
    id: hasInternal ? String(row.project_internal_id) : null,
    publicId: hasPublic ? row.project_public_id : null,
    name: row.project_name || null,
    status: norm.status || null,
    priority: row.project_priority || null
  };
}

module.exports = {

  getMyTasks: async (req, res) => {
    try {
      const axios = require('axios');
      const baseHost = (process.env.BASE_URL || process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, '');
      const url = `${baseHost}/api/tasks/gettaskss`;
      const params = { ...(req.query || {}) };
      // ensure userId is set so the tasks endpoint filters for this user
      params.userId = req.user._id;
      const headers = {};
      if (req.headers && req.headers.authorization) headers.Authorization = req.headers.authorization;
      const resp = await axios.get(url, { params, headers, timeout: 15000 });
      return res.status(resp.status).json(resp.data);
    } catch (error) {
      logger.error('getMyTasks proxy error:', error && error.message);
      const status = (error && error.response && error.response.status) ? error.response.status : 500;
      const data = (error && error.response && error.response.data) ? error.response.data : { success: false, error: error.message };
      return res.status(status).json(data);
    }
  },

  tasksOverview: async (req, res) => {
    try {
      return res.json({
        success: true,
        data: {
          metrics: {
            totalTasks: 8,
            completedTasks: 3,
            pendingTasks: 4,
            reassignedTasks: 1
          },
          tasks: [
            {
              id: 't101',
              title: 'Fix login issue',
              description: 'Resolve login redirect bug',
              status: 'pending',

              reassignment: {
                requested: true,
                status: 'pending',
                requestedBy: 'employee',
                requestedAt: '2026-01-25T10:30:00Z',
                reason: 'Workload high'
              }
            },
            {
              id: 't102',
              title: 'Create dashboard UI',
              description: 'Employee dashboard layout',
              status: 'in_progress',

              reassignment: {
                requested: false,
                status: null
              }
            },
            {
              id: 't103',
              title: 'API integration',
              description: 'Integrate task APIs',
              status: 'completed',

              reassignment: {
                requested: false,
                status: null
              }
            },
            {
              id: 't104',
              title: 'Write unit tests',
              description: 'Coverage for task module',
              status: 'pending',

              reassignment: {
                requested: true,
                status: 'approved',
                approvedBy: 'manager',
                approvedAt: '2026-01-24T14:15:00Z'
              }
            }
          ],

          rules: {
            allowReassignment: true,
            allowMultipleRequestsForSameTask: false,
            allowedStatuses: ['pending', 'in_progress']
          }
        }
      });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },
  createChecklistItem: async (req, res) => {
    try {
      const { taskId } = req.params;
      const { title, description, dueDate } = req.body;
      const inserted = await insertChecklistItem({
        taskId,
        title,
        description,
        dueDate,
        userId: req.user._id,
        tenantId: req.user.tenant_id
      });
      return res.status(201).json({ success: true, data: formatChecklistItem(inserted) });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  updateChecklistItem: async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, dueDate, status } = req.body;
      if (!id) {
        return res.status(400).json(errorResponse.badRequest('Checklist item id required', 'BAD_REQUEST'));
      }
      await ensureSubtaskPermission(id, req.user._id, req.user.tenant_id);
      
      // Check if task is locked before allowing update
      const subtaskTaskId = await queryAsync('SELECT task_id FROM subtasks WHERE id = ? LIMIT 1', [id]);
      if (subtaskTaskId && subtaskTaskId.length > 0) {
        const lockError = await checkTaskLocked(subtaskTaskId[0].task_id, req.user._id, req.user.tenant_id);
        if (lockError) {
          return res.status(lockError.status).json({ success: false, error: lockError.message, is_locked: true });
        }
      }

      // Template metadata updates (title, description, dueDate) go to the shared subtasks row
      const templateUpdates = [];
      const templateParams = [];
      if (title) { templateUpdates.push('title = ?'); templateParams.push(title); }
      if (description) { templateUpdates.push('description = ?'); templateParams.push(description); }
      if (dueDate) { templateUpdates.push('due_date = ?'); templateParams.push(dueDate); }
      if (templateUpdates.length) {
        const columnsPresence = await getSubtaskColumnPresence();
        if (columnsPresence.updated_at) templateUpdates.push('updated_at = NOW()');
        await queryAsync(`UPDATE subtasks SET ${templateUpdates.join(', ')} WHERE id = ?`, [...templateParams, id]);
      }

      // Status update is per-user — write to user_checklist_progress
      if (status) {
        const subtaskInfo = await queryAsync('SELECT task_id FROM subtasks WHERE id = ? LIMIT 1', [id]);
        if (subtaskInfo && subtaskInfo.length) {
          const taskId = subtaskInfo[0].task_id;
          await ensureUserChecklistProgressTable();
          const completedAt = (status === 'COMPLETED') ? 'NOW()' : 'NULL';
          await queryAsync(
            `INSERT INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status, completed_at)
             VALUES (?, ?, ?, ?, ?, ${completedAt === 'NULL' ? 'NULL' : 'NOW()'})
             ON DUPLICATE KEY UPDATE status = ?, completed_at = ${completedAt}, updated_at = NOW()`,
            completedAt === 'NULL'
              ? [taskId, req.user._id, id, req.user.tenant_id || null, status, status]
              : [taskId, req.user._id, id, req.user.tenant_id || null, status, status]
          );
        }
      }

      if (!templateUpdates.length && !status) {
        return res.status(400).json(errorResponse.badRequest('Nothing to update', 'BAD_REQUEST'));
      }

      const rows = await queryAsync('SELECT * FROM subtasks WHERE id = ? LIMIT 1', [id]);
      const item = formatChecklistItem(rows[0]);
      // Overlay user-specific progress if status was updated
      if (status && item) {
        const subtaskInfo = rows.length ? { task_id: rows[0].task_id } : null;
        if (subtaskInfo) {
          const progressRow = await queryAsync(
            'SELECT status, completed_at FROM user_checklist_progress WHERE task_id = ? AND user_id = ? AND subtask_id = ? LIMIT 1',
            [subtaskInfo.task_id, req.user._id, id]
          );
          if (progressRow && progressRow.length) {
            item.status = progressRow[0].status;
            item.completedAt = progressRow[0].completed_at ? new Date(progressRow[0].completed_at).toISOString() : null;
          }
        }
      }
      return res.json({ success: true, data: item });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  completeChecklistItem: async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json(errorResponse.badRequest('Checklist item id required', 'BAD_REQUEST'));
      }
      // Verify user is assigned to the task that owns this subtask
      await ensureSubtaskPermission(id, req.user._id, req.user.tenant_id);

      // Obtain the task_id for this subtask so we can update user_checklist_progress
      const subtaskInfo = await queryAsync('SELECT task_id FROM subtasks WHERE id = ? LIMIT 1', [id]);
      
      // Check if task is locked before allowing completion
      if (subtaskInfo && subtaskInfo.length > 0) {
        const lockError = await checkTaskLocked(subtaskInfo[0].task_id, req.user._id, req.user.tenant_id);
        if (lockError) {
          return res.status(lockError.status).json({ success: false, error: lockError.message, is_locked: true });
        }
      }
      if (!subtaskInfo || !subtaskInfo.length) {
        return res.status(404).json({ success: false, error: 'Checklist item not found' });
      }
      const taskId = subtaskInfo[0].task_id;

      // Update per-user progress (isolated to this user only)
      await ensureUserChecklistProgressTable();
      const affected = await queryAsync(
        `UPDATE user_checklist_progress SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
         WHERE task_id = ? AND user_id = ? AND subtask_id = ?`,
        [taskId, req.user._id, id]
      );
      if (!affected || affected.affectedRows === 0) {
        // Row might not exist yet (legacy data) — insert it
        await queryAsync(
          `INSERT INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status, completed_at)
           VALUES (?, ?, ?, ?, 'COMPLETED', NOW())
           ON DUPLICATE KEY UPDATE status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()`,
          [taskId, req.user._id, id, req.user.tenant_id || null]
        );
      }
      const rows = await queryAsync('SELECT * FROM subtasks WHERE id = ? LIMIT 1', [id]);
      const progressRow = await queryAsync(
        'SELECT status, completed_at FROM user_checklist_progress WHERE task_id = ? AND user_id = ? AND subtask_id = ? LIMIT 1',
        [taskId, req.user._id, id]
      );
      const item = formatChecklistItem(rows[0]);
      if (item && progressRow && progressRow.length) {
        item.status = progressRow[0].status;
        item.completedAt = progressRow[0].completed_at ? new Date(progressRow[0].completed_at).toISOString() : null;
      }
      return res.json({ success: true, data: item });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  softDeleteChecklistItem: async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json(errorResponse.badRequest('Checklist item id required', 'BAD_REQUEST'));
      }
      await ensureSubtaskPermission(id, req.user._id, req.user.tenant_id);
      
      // Check if task is locked before allowing deletion
      const subtaskInfo = await queryAsync('SELECT task_id FROM subtasks WHERE id = ? LIMIT 1', [id]);
      if (subtaskInfo && subtaskInfo.length > 0) {
        const lockError = await checkTaskLocked(subtaskInfo[0].task_id, req.user._id, req.user.tenant_id);
        if (lockError) {
          return res.status(lockError.status).json({ success: false, error: lockError.message, is_locked: true });
        }
      }

      // Soft-delete from the user's checklist perspective (per-user, not shared template)
      if (subtaskInfo && subtaskInfo.length) {
        const taskId = subtaskInfo[0].task_id;
        await ensureUserChecklistProgressTable();
        await queryAsync(
          `INSERT INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status, completed_at)
           VALUES (?, ?, ?, ?, 'SKIPPED', NOW())
           ON DUPLICATE KEY UPDATE status = 'SKIPPED', completed_at = NOW(), updated_at = NOW()`,
          [taskId, req.user._id, id, req.user.tenant_id || null]
        );
      }
      const rows = await queryAsync('SELECT * FROM subtasks WHERE id = ? LIMIT 1', [id]);
      return res.json({ success: true, data: formatChecklistItem(rows[0]) });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  deleteChecklistItem: async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) {
        return res.status(400).json(errorResponse.badRequest('Checklist item id required', 'BAD_REQUEST'));
      }
      await ensureSubtaskPermission(id, req.user._id, req.user.tenant_id);
      
      // Check if task is locked before allowing hard deletion
      const subtaskInfo = await queryAsync('SELECT task_id FROM subtasks WHERE id = ? LIMIT 1', [id]);
      if (subtaskInfo && subtaskInfo.length > 0) {
        const lockError = await checkTaskLocked(subtaskInfo[0].task_id, req.user._id, req.user.tenant_id);
        if (lockError) {
          return res.status(lockError.status).json({ success: false, error: lockError.message, is_locked: true });
        }
      }
      
      const hasDeleted = await hasColumn('subtasks', 'isDeleted');
      if (hasDeleted) {
        await queryAsync('UPDATE subtasks SET isDeleted = 1, deleted_at = NOW() WHERE id = ?', [id]);
      } else {
        await queryAsync('DELETE FROM subtasks WHERE id = ?', [id]);
      }
      return res.json({ success: true, message: 'Checklist item deleted' });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  addSubtask: async (req, res) => {
    try {
      const { taskId, title, description, dueDate } = req.body;
      const inserted = await insertChecklistItem({
        taskId,
        title,
        description,
        dueDate,
        userId: req.user._id,
        tenantId: req.user.tenant_id
      });
      return res.json({ success: true, data: formatChecklistItem(inserted) });
    } catch (error) {
      return res.status(error.status || 500).json({ success: false, error: error.message });
    }
  },

  updateSubtask: async (req, res) => {
    return module.exports.updateChecklistItem(req, res);
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

