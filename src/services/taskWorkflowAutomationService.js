const cron = require('node-cron');
const db = require('../db');
const NotificationService = require('./notificationService');
const emailService = require('../utils/emailService');

let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = require('../../logger'); }

const DEFAULT_TASK_WORKFLOW_SETTINGS = {
  automation_enabled: true,
  scheduler_interval_minutes: 15,
  escalation_level1_hours: 0,
  escalation_level2_hours: 24,
  escalation_level3_hours: 48,
  review_reminder_hours: '24,48,72',
  review_repeat_hours: 24
};

let schedulerTask = null;
let isRunning = false;

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function toMySQLDate(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function toIso(value) {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds || 0));
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(Math.floor(seconds % 60)).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function normalizeStatus(value) {
  const raw = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (raw === 'INPROGRESS') return 'IN_PROGRESS';
  if (raw === 'ONHOLD') return 'ON_HOLD';
  if (raw === 'IN_REVIEW') return 'REVIEW';
  if (raw === 'COMPLETE' || raw === 'APPROVE' || raw === 'APPROVED') return 'COMPLETED';
  if (raw === 'TODO' || raw === 'TO_DO') return 'PENDING';
  return raw || 'PENDING';
}

function isTerminalTaskStatus(value) {
  const status = normalizeStatus(value);
  return ['COMPLETED', 'APPROVED', 'CLOSED', 'CANCELLED', 'DELETED'].includes(status);
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = true) {
  if (value === true || value === false) return value;
  if (value === 1 || value === 0) return Boolean(value);
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  if (['true', '1', 'yes', 'on'].includes(raw)) return true;
  if (['false', '0', 'no', 'off'].includes(raw)) return false;
  return fallback;
}

function parseReviewHours(value) {
  const fallback = [24, 48, 72];
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const parsed = raw
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => a - b);
  return parsed.length ? parsed : fallback;
}

async function tableExists(tableName) {
  const rows = await q(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1',
    [tableName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasColumn(tableName, columnName) {
  const rows = await q(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function getColumnType(tableName, columnName) {
  const rows = await q(
    `SELECT DATA_TYPE, COLUMN_TYPE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
    [tableName, columnName]
  );
  return rows && rows.length ? rows[0] : null;
}

async function ensureColumn(tableName, columnName, definitionSql) {
  if (!await hasColumn(tableName, columnName)) {
    await q(`ALTER TABLE ${tableName} ADD COLUMN ${definitionSql}`);
  }
}

async function ensureIndex(tableName, indexName, indexSql) {
  const rows = await q(
    `SELECT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1`,
    [tableName, indexName]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    await q(indexSql);
  }
}

async function ensureTaskTimeEntriesCompatibility() {
  if (!await tableExists('task_time_entries')) {
    await q(`
      CREATE TABLE IF NOT EXISTS task_time_entries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        task_id INT NOT NULL,
        user_id INT NOT NULL,
        action ENUM('start','pause','resume','complete','reassign','stop','review','reset') NOT NULL,
        timestamp DATETIME NOT NULL,
        duration_seconds INT NULL,
        entry_type VARCHAR(30) DEFAULT 'event',
        date DATE NULL,
        hours DECIMAL(8,2) NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_task_time_entries_task_user (task_id, user_id),
        INDEX idx_task_time_entries_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    return;
  }

  await ensureColumn('task_time_entries', 'duration_seconds', 'duration_seconds INT NULL');
  await ensureColumn('task_time_entries', 'entry_type', "entry_type VARCHAR(30) DEFAULT 'event'");
  await ensureColumn('task_time_entries', 'date', 'date DATE NULL');
  await ensureColumn('task_time_entries', 'hours', 'hours DECIMAL(8,2) NULL');
  await ensureColumn('task_time_entries', 'created_at', 'created_at DATETIME DEFAULT CURRENT_TIMESTAMP');
  await ensureColumn('task_time_entries', 'updated_at', 'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  const actionType = await getColumnType('task_time_entries', 'action');
  const columnType = String(actionType && actionType.COLUMN_TYPE ? actionType.COLUMN_TYPE : '').toLowerCase();
  if (columnType.startsWith('enum(') && (!columnType.includes("'stop'") || !columnType.includes("'review'") || !columnType.includes("'reset'"))) {
    await q(`
      ALTER TABLE task_time_entries
      MODIFY COLUMN action ENUM('start','pause','resume','complete','reassign','stop','review','reset') NOT NULL
    `);
  }

  await ensureIndex(
    'task_time_entries',
    'idx_task_time_entries_task_user',
    'CREATE INDEX idx_task_time_entries_task_user ON task_time_entries (task_id, user_id)'
  ).catch(() => {});
}

async function ensureTaskEnhancementSchema() {
  await ensureTaskTimeEntriesCompatibility();

  if (!await tableExists('task_assignment_status')) {
    await q(`
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  await q(`
    CREATE TABLE IF NOT EXISTS task_timer_sessions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      task_id INT NOT NULL,
      user_id INT NOT NULL,
      started_by INT NULL,
      start_time DATETIME NULL,
      pause_time DATETIME NULL,
      resume_time DATETIME NULL,
      stop_time DATETIME NULL,
      end_time DATETIME NULL,
      duration_seconds INT NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'STOPPED',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_task_timer_sessions_task_user (task_id, user_id),
      INDEX idx_task_timer_sessions_status (status),
      INDEX idx_task_timer_sessions_tenant (tenant_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS task_escalation_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      task_id INT NOT NULL,
      escalation_level INT NOT NULL,
      escalated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      escalated_to INT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'SENT',
      notification_type VARCHAR(80) NOT NULL,
      trigger_reason VARCHAR(255) NULL,
      overdue_minutes INT NULL,
      email_sent TINYINT(1) NOT NULL DEFAULT 0,
      notification_sent TINYINT(1) NOT NULL DEFAULT 0,
      dedupe_key VARCHAR(190) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_task_escalation_dedupe (dedupe_key),
      INDEX idx_task_escalation_task (task_id),
      INDEX idx_task_escalation_tenant_level (tenant_id, escalation_level),
      INDEX idx_task_escalation_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS task_review_alert_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      task_id INT NOT NULL,
      employee_id INT NULL,
      manager_id INT NULL,
      alert_type VARCHAR(80) NOT NULL,
      alert_step INT NULL,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status VARCHAR(40) NOT NULL DEFAULT 'SENT',
      email_sent TINYINT(1) NOT NULL DEFAULT 0,
      notification_sent TINYINT(1) NOT NULL DEFAULT 0,
      dedupe_key VARCHAR(190) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_task_review_alert_dedupe (dedupe_key),
      INDEX idx_task_review_alert_task (task_id),
      INDEX idx_task_review_alert_tenant (tenant_id),
      INDEX idx_task_review_alert_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  if (await tableExists('tasks')) {
    await ensureColumn('tasks', 'is_escalated', 'is_escalated TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('tasks', 'escalation_level', 'escalation_level INT NULL');
    await ensureColumn('tasks', 'escalation_status', "escalation_status VARCHAR(40) NULL");
    await ensureColumn('tasks', 'last_escalated_at', 'last_escalated_at DATETIME NULL');
  }

  if (await tableExists('task_assignment_status')) {
    await ensureColumn('task_assignment_status', 'review_requested_at', 'review_requested_at DATETIME NULL');
    await ensureColumn('task_assignment_status', 'last_review_reminder_at', 'last_review_reminder_at DATETIME NULL');
  }
}

function settingKeys(key, tenantId) {
  const prefixed = `task_workflow_${key}`;
  const keys = [prefixed, `global:${prefixed}`, key, `global:${key}`];
  if (tenantId !== undefined && tenantId !== null) {
    keys.unshift(`tenant:${tenantId}:${prefixed}`, `tenant:${tenantId}:${key}`);
  }
  return keys;
}

async function readPlatformSetting(key, tenantId) {
  if (!await tableExists('platform_settings')) return null;
  const keys = settingKeys(key, tenantId);
  const hasTenantId = await hasColumn('platform_settings', 'tenant_id');

  let sql = `SELECT setting_key, setting_value${hasTenantId ? ', tenant_id' : ''} FROM platform_settings WHERE setting_key IN (?)`;
  const params = [keys];
  if (hasTenantId) {
    sql += ' OR (tenant_id = ? AND setting_key IN (?)) OR (tenant_id IS NULL AND setting_key IN (?))';
    params.push(tenantId || null, [key, `task_workflow_${key}`], [key, `task_workflow_${key}`]);
  }

  const rows = await q(sql, params).catch(() => []);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const byKey = new Map(rows.map((row) => [row.setting_key, row.setting_value]));
  for (const candidate of keys) {
    if (byKey.has(candidate)) return byKey.get(candidate);
  }
  return rows[0].setting_value;
}

async function loadTaskWorkflowSettings(tenantId = null) {
  const settings = { ...DEFAULT_TASK_WORKFLOW_SETTINGS };
  const keys = Object.keys(DEFAULT_TASK_WORKFLOW_SETTINGS);
  for (const key of keys) {
    const value = await readPlatformSetting(key, tenantId);
    if (value !== null && value !== undefined) settings[key] = value;
  }

  settings.automation_enabled = parseBoolean(settings.automation_enabled, true);
  settings.scheduler_interval_minutes = Math.max(1, Math.round(parsePositiveNumber(settings.scheduler_interval_minutes, 15)));
  settings.escalation_level1_hours = parsePositiveNumber(settings.escalation_level1_hours, 0);
  settings.escalation_level2_hours = parsePositiveNumber(settings.escalation_level2_hours, 24);
  settings.escalation_level3_hours = parsePositiveNumber(settings.escalation_level3_hours, 48);
  settings.review_reminder_hours = parseReviewHours(settings.review_reminder_hours);
  settings.review_repeat_hours = Math.max(1, parsePositiveNumber(settings.review_repeat_hours, 24));

  return settings;
}

async function resolveTask(identifier, tenantId, includeDeleted = false) {
  const numericId = /^\d+$/.test(String(identifier || '')) ? Number(identifier) : null;
  const hasTenantId = await hasColumn('tasks', 'tenant_id');
  const hasDeleted = await hasColumn('tasks', 'isDeleted');
  const hasProjectPublicId = await hasColumn('projects', 'public_id');
  const hasClientPublicId = await hasColumn('clients', 'public_id');
  let sql = `
    SELECT t.*,
           p.name AS project_name,
           ${hasProjectPublicId ? 'p.public_id' : 'NULL'} AS project_public_id,
           p.project_manager_id,
           c.name AS client_name,
           ${hasClientPublicId ? 'c.public_id' : 'NULL'} AS client_public_id
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE (t.id = ? OR t.public_id = ?)
  `;
  const params = [numericId, String(identifier)];
  if (hasTenantId) {
    sql += ' AND t.tenant_id = ?';
    params.push(tenantId);
  }
  if (!includeDeleted && hasDeleted) {
    sql += ' AND (t.isDeleted IS NULL OR t.isDeleted != 1)';
  }
  sql += ' LIMIT 1';
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function validateAssignedWritable(taskId, userId, tenantId) {
  const hasTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasReadOnly = await hasColumn('task_assignments', 'is_read_only');
  let sql = 'SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?';
  const params = [taskId, userId];
  if (hasTenantId) {
    sql += ' AND tenant_id = ?';
    params.push(tenantId);
  }
  if (hasReadOnly) {
    sql += ' AND (is_read_only IS NULL OR is_read_only != 1)';
  }
  sql += ' LIMIT 1';
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function ensureAssignmentState(taskId, userId, tenantId) {
  await q(
    `INSERT IGNORE INTO task_assignment_status (task_id, user_id, tenant_id, status, total_duration)
     VALUES (?, ?, ?, 'PENDING', 0)`,
    [taskId, userId, tenantId || null]
  );
  const rows = await q(
    'SELECT * FROM task_assignment_status WHERE task_id = ? AND user_id = ? LIMIT 1',
    [taskId, userId]
  );
  return rows && rows.length ? rows[0] : null;
}

async function getTimerSummary(task, userId, tenantId) {
  const assignmentRows = await q(
    `SELECT total_duration, live_timer, started_at, status
     FROM task_assignment_status
     WHERE task_id = ? AND user_id = ? LIMIT 1`,
    [task.id, userId]
  );
  const state = assignmentRows && assignmentRows.length ? assignmentRows[0] : {};
  const liveTimer = state.live_timer ? new Date(state.live_timer) : null;
  const liveElapsed = liveTimer && !Number.isNaN(liveTimer.getTime())
    ? Math.max(0, Math.floor((Date.now() - liveTimer.getTime()) / 1000))
    : 0;
  const totalSeconds = Number(state.total_duration || 0) + liveElapsed;
  const estimatedHours = task.estimated_hours != null ? Number(task.estimated_hours) : Number(task.time_alloted || 0);
  const estimatedSeconds = Math.max(0, Math.round(estimatedHours * 3600));
  const remainingSeconds = Math.max(0, estimatedSeconds - totalSeconds);

  return {
    taskId: task.public_id || String(task.id),
    status: normalizeStatus(state.status || 'PENDING'),
    started_at: toIso(state.started_at),
    live_timer: liveTimer ? liveTimer.toISOString() : null,
    estimated_time_seconds: estimatedSeconds,
    estimated_time_hours: Number((estimatedSeconds / 3600).toFixed(2)),
    estimated_time_hhmmss: formatDuration(estimatedSeconds),
    actual_time_seconds: totalSeconds,
    actual_time_hours: Number((totalSeconds / 3600).toFixed(2)),
    actual_time_hhmmss: formatDuration(totalSeconds),
    remaining_time_seconds: remainingSeconds,
    remaining_time_hours: Number((remainingSeconds / 3600).toFixed(2)),
    remaining_time_hhmmss: formatDuration(remainingSeconds),
    total_time_seconds: totalSeconds,
    total_time_hours: Number((totalSeconds / 3600).toFixed(2)),
    total_time_hhmmss: formatDuration(totalSeconds),
    tenantId: tenantId || null
  };
}

async function resolveAssignedTimerTask(identifier, user, tenantId) {
  await ensureTaskEnhancementSchema();
  const task = await resolveTask(identifier, tenantId, true);
  if (!task) {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }

  const assignment = await validateAssignedWritable(task.id, user._id, tenantId);
  if (!assignment) {
    const error = new Error('Task is not assigned to you or is read-only');
    error.status = 403;
    throw error;
  }

  const state = await ensureAssignmentState(task.id, user._id, tenantId);
  return { task, assignment, state };
}

async function startTaskTimer(identifier, user, tenantId) {
  const { task, state } = await resolveAssignedTimerTask(identifier, user, tenantId);
  const currentStatus = normalizeStatus(state && state.status);
  if (currentStatus === 'REVIEW' || currentStatus === 'COMPLETED') {
    const error = new Error(`Cannot start timer from ${currentStatus}`);
    error.status = 400;
    throw error;
  }
  if (state && state.live_timer) {
    return getTimerSummary(task, user._id, tenantId);
  }

  const now = new Date();
  await q(
    `UPDATE task_assignment_status
     SET status = 'IN_PROGRESS',
         started_at = COALESCE(started_at, ?),
         live_timer = ?,
         review_requested = 0,
         review_requested_at = NULL,
         updated_at = NOW()
     WHERE task_id = ? AND user_id = ?`,
    [toMySQLDate(now), toMySQLDate(now), task.id, user._id]
  );

  await q(
    `INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp)
     VALUES (?, ?, 'event', ?, ?)`,
    [task.id, user._id, currentStatus === 'ON_HOLD' ? 'resume' : 'start', toMySQLDate(now)]
  );

  const pausedRows = await q(
    `SELECT id FROM task_timer_sessions
     WHERE task_id = ? AND user_id = ? AND status = 'PAUSED'
     ORDER BY id DESC LIMIT 1`,
    [task.id, user._id]
  );
  if (pausedRows && pausedRows.length) {
    await q(
      `UPDATE task_timer_sessions
       SET resume_time = ?, status = 'RUNNING', updated_at = NOW()
       WHERE id = ?`,
      [toMySQLDate(now), pausedRows[0].id]
    );
  } else {
    await q(
      `INSERT INTO task_timer_sessions
         (tenant_id, task_id, user_id, started_by, start_time, status)
       VALUES (?, ?, ?, ?, ?, 'RUNNING')`,
      [tenantId || null, task.id, user._id, user._id, toMySQLDate(now)]
    );
  }

  await q(
    `UPDATE tasks SET updatedAt = NOW() WHERE id = ?`,
    [task.id]
  ).catch(() => {});

  return getTimerSummary(task, user._id, tenantId);
}

async function pauseTaskTimer(identifier, user, tenantId) {
  const { task, state } = await resolveAssignedTimerTask(identifier, user, tenantId);
  const currentStatus = normalizeStatus(state && state.status);
  if (currentStatus !== 'IN_PROGRESS' || !state.live_timer) {
    const error = new Error(`Cannot pause timer from ${currentStatus}. Timer is not running.`);
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const liveTimer = new Date(state.live_timer);
  const duration = !Number.isNaN(liveTimer.getTime())
    ? Math.max(0, Math.floor((now.getTime() - liveTimer.getTime()) / 1000))
    : 0;

  await q(
    `UPDATE task_assignment_status
     SET status = 'ON_HOLD',
         live_timer = NULL,
         total_duration = COALESCE(total_duration, 0) + ?,
         review_requested = 0,
         review_requested_at = NULL,
         updated_at = NOW()
     WHERE task_id = ? AND user_id = ?`,
    [duration, task.id, user._id]
  );

  await q(
    `INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds)
     VALUES (?, ?, 'event', 'pause', ?, ?)`,
    [task.id, user._id, toMySQLDate(now), duration]
  );

  await q(
    `UPDATE task_timer_sessions
     SET pause_time = ?,
         duration_seconds = COALESCE(duration_seconds, 0) + ?,
         status = 'PAUSED',
         updated_at = NOW()
     WHERE task_id = ? AND user_id = ? AND status = 'RUNNING'
     ORDER BY id DESC LIMIT 1`,
    [toMySQLDate(now), duration, task.id, user._id]
  ).catch(() => {});

  await q(
    `UPDATE tasks SET updatedAt = NOW() WHERE id = ?`,
    [task.id]
  ).catch(() => {});

  return getTimerSummary(task, user._id, tenantId);
}

async function resumeTaskTimer(identifier, user, tenantId) {
  const { state } = await resolveAssignedTimerTask(identifier, user, tenantId);
  const currentStatus = normalizeStatus(state && state.status);
  if (currentStatus !== 'ON_HOLD') {
    const error = new Error(`Cannot resume timer from ${currentStatus}`);
    error.status = 400;
    throw error;
  }
  return startTaskTimer(identifier, user, tenantId);
}

async function updateTimerSessionOnStop(taskId, userId, tenantId, now, durationSeconds, startTime) {
  const activeRows = await q(
    `SELECT id, duration_seconds
     FROM task_timer_sessions
     WHERE task_id = ? AND user_id = ? AND status IN ('RUNNING','PAUSED')
     ORDER BY id DESC LIMIT 1`,
    [taskId, userId]
  );

  if (activeRows && activeRows.length) {
    await q(
      `UPDATE task_timer_sessions
       SET stop_time = ?, end_time = ?, duration_seconds = COALESCE(duration_seconds, 0) + ?, status = 'STOPPED', updated_at = NOW()
       WHERE id = ?`,
      [toMySQLDate(now), toMySQLDate(now), durationSeconds, activeRows[0].id]
    );
    return activeRows[0].id;
  }

  const result = await q(
    `INSERT INTO task_timer_sessions
       (tenant_id, task_id, user_id, started_by, start_time, stop_time, end_time, duration_seconds, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'STOPPED')`,
    [tenantId || null, taskId, userId, userId, toMySQLDate(startTime || now), toMySQLDate(now), toMySQLDate(now), durationSeconds]
  );
  return result.insertId;
}

async function stopTaskTimer(identifier, user, tenantId) {
  await ensureTaskEnhancementSchema();
  const task = await resolveTask(identifier, tenantId, true);
  if (!task) {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }

  const assignment = await validateAssignedWritable(task.id, user._id, tenantId);
  if (!assignment) {
    const error = new Error('Task is not assigned to you or is read-only');
    error.status = 403;
    throw error;
  }

  const state = await ensureAssignmentState(task.id, user._id, tenantId);
  const currentStatus = normalizeStatus(state && state.status);
  if (!['IN_PROGRESS', 'ON_HOLD'].includes(currentStatus)) {
    const error = new Error(`Cannot stop timer from ${currentStatus}. Start the task first.`);
    error.status = 400;
    throw error;
  }

  const now = new Date();
  const liveTimer = state && state.live_timer ? new Date(state.live_timer) : null;
  const duration = liveTimer && !Number.isNaN(liveTimer.getTime())
    ? Math.max(0, Math.floor((now.getTime() - liveTimer.getTime()) / 1000))
    : 0;
  const totalDuration = Number(state.total_duration || 0) + duration;

  await q(
    `UPDATE task_assignment_status
     SET status = 'ON_HOLD',
         live_timer = NULL,
         total_duration = ?,
         review_requested = 0,
         review_requested_at = NULL,
         updated_at = NOW()
     WHERE task_id = ? AND user_id = ?`,
    [totalDuration, task.id, user._id]
  );

  await q(
    `INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds)
     VALUES (?, ?, 'event', 'stop', ?, ?)`,
    [task.id, user._id, toMySQLDate(now), duration]
  );

  await updateTimerSessionOnStop(task.id, user._id, tenantId, now, duration, liveTimer || state.started_at || now);

  return {
    taskId: task.public_id || String(task.id),
    status: 'ON_HOLD',
    stopped_at: now.toISOString(),
    total_time_seconds: totalDuration,
    total_time_hours: Number((totalDuration / 3600).toFixed(2)),
    total_time_hhmmss: formatDuration(totalDuration)
  };
}

async function getTaskTimerLogs(identifier, user, tenantId) {
  await ensureTaskEnhancementSchema();
  const task = await resolveTask(identifier, tenantId, true);
  if (!task) {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }

  const role = String(user.role || '').toUpperCase().replace(/[\s-]+/g, '_');
  const isManager = ['ADMIN', 'SUPER_ADMIN', 'SUPERADMIN', 'MANAGER'].includes(role);
  if (!isManager) {
    const assigned = await validateAssignedWritable(task.id, user._id, tenantId)
      || await q('SELECT id FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1', [task.id, user._id]).then((rows) => rows && rows[0]);
    if (!assigned) {
      const error = new Error('You do not have access to this task timer');
      error.status = 403;
      throw error;
    }
  }

  const params = isManager ? [task.id] : [task.id, user._id];
  const logFilter = isManager ? 'task_id = ?' : 'task_id = ? AND user_id = ?';
  const logs = await q(
    `SELECT id, task_id, user_id, action, timestamp, duration_seconds AS duration, entry_type, created_at
     FROM task_time_entries
     WHERE ${logFilter}
     ORDER BY timestamp DESC, id DESC`,
    params
  );

  const sessions = await q(
    `SELECT id, task_id, user_id, started_by, start_time, pause_time, resume_time, stop_time, end_time, duration_seconds, status, created_at, updated_at
     FROM task_timer_sessions
     WHERE ${logFilter}
     ORDER BY COALESCE(end_time, updated_at, created_at) DESC, id DESC`,
    params
  );

  const assignmentRows = await q(
    `SELECT SUM(COALESCE(total_duration, 0)) AS total_seconds,
            MAX(live_timer) AS live_timer
     FROM task_assignment_status
     WHERE task_id = ?${isManager ? '' : ' AND user_id = ?'}`,
    isManager ? [task.id] : [task.id, user._id]
  );
  const assignmentTotal = Number((assignmentRows && assignmentRows[0] && assignmentRows[0].total_seconds) || 0);
  const liveTimer = assignmentRows && assignmentRows[0] && assignmentRows[0].live_timer
    ? new Date(assignmentRows[0].live_timer)
    : null;
  const liveElapsed = liveTimer && !Number.isNaN(liveTimer.getTime())
    ? Math.max(0, Math.floor((Date.now() - liveTimer.getTime()) / 1000))
    : 0;
  const totalSeconds = assignmentTotal + liveElapsed;
  const estimatedHours = task.estimated_hours != null ? Number(task.estimated_hours) : Number(task.time_alloted || 0);
  const estimatedSeconds = Math.max(0, Math.round(estimatedHours * 3600));
  const remainingSeconds = Math.max(0, estimatedSeconds - totalSeconds);

  return {
    taskId: task.public_id || String(task.id),
    estimated_time_seconds: estimatedSeconds,
    estimated_time_hours: Number((estimatedSeconds / 3600).toFixed(2)),
    estimated_time_hhmmss: formatDuration(estimatedSeconds),
    actual_time_seconds: totalSeconds,
    actual_time_hours: Number((totalSeconds / 3600).toFixed(2)),
    actual_time_hhmmss: formatDuration(totalSeconds),
    remaining_time_seconds: remainingSeconds,
    remaining_time_hours: Number((remainingSeconds / 3600).toFixed(2)),
    remaining_time_hhmmss: formatDuration(remainingSeconds),
    live_timer: liveTimer ? liveTimer.toISOString() : null,
    logs,
    sessions
  };
}

async function getTaskAssignees(taskId, tenantId) {
  const hasTenantId = await hasColumn('task_assignments', 'tenant_id');
  let sql = `
    SELECT DISTINCT u._id, u.public_id, u.name, u.email, u.role
    FROM task_assignments ta
    INNER JOIN users u ON u._id = ta.user_id
    WHERE ta.task_id = ?
  `;
  const params = [taskId];
  if (hasTenantId) {
    sql += ' AND (ta.tenant_id = ? OR ta.tenant_id IS NULL)';
    params.push(tenantId || null);
  }
  return q(sql, params);
}

async function getManagerRecipients(task, tenantId) {
  const managerIds = [];
  if (task && task.project_manager_id) managerIds.push(Number(task.project_manager_id));

  const rows = await q(
    `SELECT DISTINCT _id, public_id, name, email, role
     FROM users
     WHERE tenant_id = ?
       AND (
         role IN ('Manager','Admin','SuperAdmin','Super-Admin')
         ${managerIds.length ? 'OR _id IN (?)' : ''}
       )`,
    managerIds.length ? [tenantId || null, managerIds] : [tenantId || null]
  ).catch(() => []);

  const seen = new Set();
  return (rows || []).filter((row) => {
    if (!row || !row._id || seen.has(String(row._id))) return false;
    seen.add(String(row._id));
    return true;
  });
}

function getTaskLink(task) {
  const base = (process.env.FRONTEND_URL || process.env.BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/tasks/${task.public_id || task.id}` : '';
}

async function sendEmailSafely(to, template) {
  if (!to || !template) return { sent: false, error: 'Missing recipient or template' };
  try {
    return await emailService.sendEmail({ to, ...template });
  } catch (error) {
    logger.warn(`Task workflow email failed for ${to}: ${error.message}`);
    return { sent: false, error: error.message };
  }
}

async function insertEscalationHistory(payload) {
  const result = await q(
    `INSERT IGNORE INTO task_escalation_history
       (tenant_id, task_id, escalation_level, escalated_to, status, notification_type, trigger_reason, overdue_minutes, email_sent, notification_sent, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId || null,
      payload.taskId,
      payload.level,
      payload.recipientId || null,
      payload.status || 'SENT',
      payload.notificationType,
      payload.triggerReason || null,
      payload.overdueMinutes || 0,
      payload.emailSent ? 1 : 0,
      payload.notificationSent ? 1 : 0,
      payload.dedupeKey
    ]
  );
  return result && result.affectedRows > 0;
}

async function updateEscalationHistoryDelivery(dedupeKey, emailSent, notificationSent) {
  await q(
    `UPDATE task_escalation_history
     SET email_sent = ?, notification_sent = ?, status = 'SENT'
     WHERE dedupe_key = ?`,
    [emailSent ? 1 : 0, notificationSent ? 1 : 0, dedupeKey]
  ).catch(() => {});
}

async function triggerEscalation(task, level, settings, overdueMinutes) {
  const assignees = await getTaskAssignees(task.id, task.tenant_id);
  const managers = await getManagerRecipients(task, task.tenant_id);
  const managerIds = new Set(managers.map((row) => String(row._id)));
  const recipients = level === 1
    ? assignees
    : [...assignees, ...managers.filter((row) => !assignees.some((a) => String(a._id) === String(row._id)))];

  const projectName = task.project_name || 'Unassigned project';
  const taskLink = getTaskLink(task);
  const remainingSeconds = Math.max(0, Math.round(Number(task.estimated_hours || task.time_alloted || 0) * 3600) - Number(task.total_duration || 0));
  const notificationType = level === 1 ? 'TASK_DUE_REMINDER' : `TASK_ESCALATION_LEVEL_${level}`;
  const title = level === 1 ? 'Task Due Reminder' : `Task Escalation Level ${level}`;
  const message = level === 1
    ? `Task "${task.title}" is overdue.`
    : `Task "${task.title}" has reached escalation level ${level}.`;

  for (const recipient of recipients) {
    const dedupeKey = `task:${task.id}:esc:${level}:user:${recipient._id}`;
    const inserted = await insertEscalationHistory({
      tenantId: task.tenant_id,
      taskId: task.id,
      level,
      recipientId: recipient._id,
      notificationType,
      triggerReason: level === 1 ? 'Due date crossed' : `Overdue threshold ${level} crossed`,
      overdueMinutes,
      dedupeKey,
      emailSent: false,
      notificationSent: false
    });
    if (!inserted) continue;

    let emailResult = { sent: false };
    if (recipient.email) {
      const template = level === 1
        ? emailService.taskDueReminderTemplate({
            employeeName: recipient.name || 'Team member',
            projectName,
            taskName: task.title,
            dueDate: toIso(task.taskDate) || task.taskDate,
            remainingTime: formatDuration(remainingSeconds),
            taskLink
          })
        : emailService.taskEscalationTemplate({
            recipientName: recipient.name || 'Team member',
            taskName: task.title,
            projectName,
            escalationLevel: level,
            overdueDuration: formatDuration(overdueMinutes * 60),
            projectDetails: projectName,
            taskLink,
            isManager: managerIds.has(String(recipient._id))
          });
      emailResult = await sendEmailSafely(recipient.email, template);
    }

    let notificationSent = false;
    try {
      await NotificationService.createAndSend(
        [recipient._id],
        title,
        message,
        notificationType,
        'task',
        task.public_id || String(task.id),
        task.tenant_id
      );
      notificationSent = true;
    } catch (error) {
      logger.warn(`Task escalation notification failed: ${error.message}`);
    }

    await updateEscalationHistoryDelivery(dedupeKey, emailResult.sent, notificationSent);
  }

  const escalationStatus = level >= 3 ? 'ESCALATED' : 'OVERDUE';
  await q(
    `UPDATE tasks
     SET is_escalated = ?,
         escalation_level = GREATEST(COALESCE(escalation_level, 0), ?),
         escalation_status = ?,
         last_escalated_at = NOW()
     WHERE id = ?`,
    [level >= 3 ? 1 : 0, level, escalationStatus, task.id]
  ).catch((error) => logger.warn(`Failed to update task escalation status: ${error.message}`));
}

async function getOverdueTasks(tenantId = null) {
  const hasTenantId = await hasColumn('tasks', 'tenant_id');
  const hasDeleted = await hasColumn('tasks', 'isDeleted');
  const hasProjectPublicId = await hasColumn('projects', 'public_id');
  let sql = `
    SELECT t.*,
           p.name AS project_name,
           ${hasProjectPublicId ? 'p.public_id' : 'NULL'} AS project_public_id,
           p.project_manager_id,
           c.name AS client_name
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE t.taskDate IS NOT NULL
      AND t.taskDate < NOW()
  `;
  const params = [];
  if (hasTenantId && tenantId !== null && tenantId !== undefined) {
    sql += ' AND t.tenant_id = ?';
    params.push(tenantId);
  }
  if (hasDeleted) {
    sql += ' AND (t.isDeleted IS NULL OR t.isDeleted != 1)';
  }
  sql += `
      AND UPPER(REPLACE(COALESCE(t.status, t.stage, 'PENDING'), ' ', '_')) NOT IN ('COMPLETED','APPROVED','CLOSED','CANCELLED')
    ORDER BY t.taskDate ASC
    LIMIT 250
  `;
  return q(sql, params);
}

function getEscalationLevel(overdueHours, settings) {
  if (overdueHours >= settings.escalation_level3_hours) return 3;
  if (overdueHours >= settings.escalation_level2_hours) return 2;
  if (overdueHours >= settings.escalation_level1_hours) return 1;
  return 0;
}

async function processOverdueTasks(tenantId = null) {
  const settings = await loadTaskWorkflowSettings(tenantId);
  if (!settings.automation_enabled) return { processed: 0, skipped: true };

  const tasks = await getOverdueTasks(tenantId);
  let processed = 0;
  const now = Date.now();
  for (const task of tasks) {
    if (!task.taskDate || isTerminalTaskStatus(task.status || task.stage)) continue;
    const due = new Date(task.taskDate);
    if (Number.isNaN(due.getTime())) continue;
    const taskSettings = tenantId === null || tenantId === undefined
      ? await loadTaskWorkflowSettings(task.tenant_id || null)
      : settings;
    if (!taskSettings.automation_enabled) continue;
    const overdueMinutes = Math.max(0, Math.floor((now - due.getTime()) / 60000));
    const level = getEscalationLevel(overdueMinutes / 60, taskSettings);
    if (level <= 0) continue;
    await triggerEscalation(task, level, taskSettings, overdueMinutes);
    processed += 1;
  }
  return { processed };
}

async function insertReviewAlertLog(payload) {
  const result = await q(
    `INSERT IGNORE INTO task_review_alert_logs
       (tenant_id, task_id, employee_id, manager_id, alert_type, alert_step, status, email_sent, notification_sent, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.tenantId || null,
      payload.taskId,
      payload.employeeId || null,
      payload.managerId || null,
      payload.alertType,
      payload.alertStep || null,
      payload.status || 'SENT',
      payload.emailSent ? 1 : 0,
      payload.notificationSent ? 1 : 0,
      payload.dedupeKey
    ]
  );
  return result && result.affectedRows > 0;
}

async function updateReviewAlertDelivery(dedupeKey, emailSent, notificationSent) {
  await q(
    `UPDATE task_review_alert_logs
     SET email_sent = ?, notification_sent = ?, status = 'SENT'
     WHERE dedupe_key = ?`,
    [emailSent ? 1 : 0, notificationSent ? 1 : 0, dedupeKey]
  ).catch(() => {});
}

async function sendReviewAlert({ task, employee, manager, alertType, alertStep, daysPending, dedupeKey, tenantId }) {
  const inserted = await insertReviewAlertLog({
    tenantId,
    taskId: task.id,
    employeeId: employee ? employee._id : null,
    managerId: manager ? manager._id : null,
    alertType,
    alertStep,
    dedupeKey,
    emailSent: false,
    notificationSent: false
  });
  if (!inserted) return false;

  let emailResult = { sent: false };
  if (manager && manager.email) {
    const template = alertType === 'TASK_REVIEW_REQUEST'
      ? emailService.taskReviewRequestTemplate({
          managerName: manager.name || 'Manager',
          taskName: task.title,
          employeeName: employee ? employee.name : 'Employee',
          reviewLink: getTaskLink(task)
        })
      : emailService.taskReviewReminderTemplate({
          managerName: manager.name || 'Manager',
          taskName: task.title,
          employeeName: employee ? employee.name : 'Employee',
          daysPending,
          reviewLink: getTaskLink(task)
        });
    emailResult = await sendEmailSafely(manager.email, template);
  }

  let notificationSent = false;
  if (manager && manager._id) {
    try {
      await NotificationService.createAndSend(
        [manager._id],
        alertType === 'TASK_REVIEW_REQUEST' ? 'Review Requested' : 'Review Reminder',
        alertType === 'TASK_REVIEW_REQUEST'
          ? `Task "${task.title}" was submitted by ${employee ? employee.name : 'an employee'}.`
          : `Task "${task.title}" is still pending review.`,
        alertType,
        'task',
        task.public_id || String(task.id),
        tenantId
      );
      notificationSent = true;
    } catch (error) {
      logger.warn(`Task review notification failed: ${error.message}`);
    }
  }

  await updateReviewAlertDelivery(dedupeKey, emailResult.sent, notificationSent);
  return true;
}

async function sendReviewRequestNotification({ task, requester, tenantId }) {
  await ensureTaskEnhancementSchema();
  const taskRow = task && task.id && task.project_manager_id !== undefined
    ? task
    : await resolveTask(task.id || task.public_id || task, tenantId, true);
  if (!taskRow) return false;

  const managers = await getManagerRecipients(taskRow, tenantId);
  const employee = requester && requester._id
    ? {
        _id: requester._id,
        name: requester.name || requester.email || 'Employee',
        email: requester.email || null
      }
    : null;

  let sent = false;
  for (const manager of managers) {
    const dedupeKey = `task:${taskRow.id}:review-request:${employee ? employee._id : 'unknown'}:manager:${manager._id}:${Date.now()}`;
    const didSend = await sendReviewAlert({
      task: taskRow,
      employee,
      manager,
      alertType: 'TASK_REVIEW_REQUEST',
      alertStep: 0,
      daysPending: 0,
      dedupeKey,
      tenantId
    });
    sent = sent || didSend;
  }
  return sent;
}

async function getPendingReviews(tenantId = null) {
  const hasTaskTenantId = await hasColumn('tasks', 'tenant_id');
  let sql = `
    SELECT tas.task_id,
           tas.user_id AS employee_id,
           tas.tenant_id,
           COALESCE(tas.review_requested_at, tas.updated_at, tas.created_at) AS review_requested_at,
           tas.last_review_reminder_at,
           t.title,
           t.public_id,
           t.project_id,
           t.taskDate,
           p.name AS project_name,
           p.project_manager_id,
           emp.name AS employee_name,
           emp.email AS employee_email
    FROM task_assignment_status tas
    INNER JOIN tasks t ON t.id = tas.task_id
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN users emp ON emp._id = tas.user_id
    WHERE tas.review_requested = 1
      AND UPPER(REPLACE(COALESCE(tas.status, ''), ' ', '_')) IN ('REVIEW','IN_REVIEW')
      AND UPPER(REPLACE(COALESCE(t.status, t.stage, 'PENDING'), ' ', '_')) NOT IN ('COMPLETED','APPROVED','CLOSED','CANCELLED')
  `;
  const params = [];
  if (hasTaskTenantId && tenantId !== null && tenantId !== undefined) {
    sql += ' AND t.tenant_id = ?';
    params.push(tenantId);
  }
  sql += ' ORDER BY review_requested_at ASC LIMIT 250';
  return q(sql, params);
}

function reviewReminderStep(pendingHours, settings) {
  const thresholds = settings.review_reminder_hours;
  if (pendingHours < thresholds[0]) return 0;
  for (let index = thresholds.length - 1; index >= 0; index -= 1) {
    if (pendingHours >= thresholds[index]) {
      const baseStep = index + 1;
      if (index === thresholds.length - 1) {
        const extra = Math.floor((pendingHours - thresholds[index]) / settings.review_repeat_hours);
        return baseStep + extra;
      }
      return baseStep;
    }
  }
  return 0;
}

async function processReviewReminders(tenantId = null) {
  const settings = await loadTaskWorkflowSettings(tenantId);
  if (!settings.automation_enabled) return { processed: 0, skipped: true };

  const rows = await getPendingReviews(tenantId);
  let processed = 0;
  for (const row of rows || []) {
    const requestedAt = row.review_requested_at ? new Date(row.review_requested_at) : null;
    if (!requestedAt || Number.isNaN(requestedAt.getTime())) continue;
    const rowSettings = tenantId === null || tenantId === undefined
      ? await loadTaskWorkflowSettings(row.tenant_id || null)
      : settings;
    if (!rowSettings.automation_enabled) continue;
    const pendingHours = Math.max(0, (Date.now() - requestedAt.getTime()) / 3600000);
    const step = reviewReminderStep(pendingHours, rowSettings);
    if (step <= 0) continue;

    const task = {
      id: row.task_id,
      public_id: row.public_id,
      title: row.title,
      project_id: row.project_id,
      project_name: row.project_name,
      project_manager_id: row.project_manager_id,
      tenant_id: row.tenant_id || tenantId
    };
    const employee = {
      _id: row.employee_id,
      name: row.employee_name || 'Employee',
      email: row.employee_email || null
    };
    const managers = await getManagerRecipients(task, task.tenant_id);
    const daysPending = Math.max(1, Math.ceil(pendingHours / 24));
    for (const manager of managers) {
      const dedupeKey = `task:${task.id}:review-reminder:${row.employee_id}:manager:${manager._id}:step:${step}`;
      const sent = await sendReviewAlert({
        task,
        employee,
        manager,
        alertType: 'TASK_REVIEW_REMINDER',
        alertStep: step,
        daysPending,
        dedupeKey,
        tenantId: task.tenant_id
      });
      if (sent) processed += 1;
    }

    await q(
      'UPDATE task_assignment_status SET last_review_reminder_at = NOW() WHERE task_id = ? AND user_id = ?',
      [row.task_id, row.employee_id]
    ).catch(() => {});
  }
  return { processed };
}

async function runAutomation(tenantId = null) {
  if (isRunning) return { skipped: true, reason: 'already_running' };
  isRunning = true;
  try {
    await ensureTaskEnhancementSchema();
    const [overdueResult, reviewResult] = await Promise.all([
      processOverdueTasks(tenantId),
      processReviewReminders(tenantId)
    ]);
    return { success: true, overdue: overdueResult, reviews: reviewResult };
  } finally {
    isRunning = false;
  }
}

async function start() {
  if (schedulerTask) return schedulerTask;
  if (process.env.TASK_AUTOMATION_ENABLED === 'false') {
    logger.info('Task workflow automation scheduler disabled by TASK_AUTOMATION_ENABLED=false');
    return null;
  }

  await ensureTaskEnhancementSchema().catch((error) => {
    logger.warn(`Task workflow automation schema check failed: ${error.message}`);
  });

  const settings = await loadTaskWorkflowSettings(null).catch(() => DEFAULT_TASK_WORKFLOW_SETTINGS);
  const interval = Math.min(59, Math.max(1, Number(settings.scheduler_interval_minutes || 15)));
  const expression = `*/${interval} * * * *`;
  schedulerTask = cron.schedule(expression, () => {
    runAutomation().catch((error) => logger.error(`Task workflow automation failed: ${error.message}`));
  }, { scheduled: true });
  logger.info(`Task workflow automation scheduler started (${expression})`);
  return schedulerTask;
}

async function getEscalationHistory(identifier, tenantId) {
  await ensureTaskEnhancementSchema();
  const task = await resolveTask(identifier, tenantId, true);
  if (!task) {
    const error = new Error('Task not found');
    error.status = 404;
    throw error;
  }

  const rows = await q(
    `SELECT h.*, u.public_id AS escalated_to_public_id, u.name AS escalated_to_name, u.email AS escalated_to_email
     FROM task_escalation_history h
     LEFT JOIN users u ON u._id = h.escalated_to
     WHERE h.task_id = ?
     ORDER BY h.escalated_at DESC, h.id DESC`,
    [task.id]
  );
  return {
    taskId: task.public_id || String(task.id),
    history: rows || []
  };
}

async function getEscalatedTasks({ tenantId, limit = 100, offset = 0 } = {}) {
  await ensureTaskEnhancementSchema();
  const hasTenantId = await hasColumn('tasks', 'tenant_id');
  const hasProjectPublicId = await hasColumn('projects', 'public_id');
  const hasClientPublicId = await hasColumn('clients', 'public_id');
  let sql = `
    SELECT t.id,
           t.public_id,
           t.title,
           t.status,
           t.stage,
           t.priority,
           t.taskDate,
           t.escalation_level,
           t.escalation_status,
           t.is_escalated,
           t.last_escalated_at,
           p.name AS project_name,
           ${hasProjectPublicId ? 'p.public_id' : 'NULL'} AS project_public_id,
           c.name AS client_name,
           ${hasClientPublicId ? 'c.public_id' : 'NULL'} AS client_public_id
    FROM tasks t
    LEFT JOIN projects p ON p.id = t.project_id
    LEFT JOIN clients c ON c.id = t.client_id
    WHERE (t.is_escalated = 1 OR COALESCE(t.escalation_level, 0) > 0)
  `;
  const params = [];
  if (hasTenantId && tenantId !== null && tenantId !== undefined) {
    sql += ' AND t.tenant_id = ?';
    params.push(tenantId);
  }
  sql += ' ORDER BY t.last_escalated_at DESC, t.taskDate ASC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 100, Number(offset) || 0);

  const rows = await q(sql, params);
  return (rows || []).map((row) => ({
    id: row.public_id || String(row.id),
    internalId: String(row.id),
    title: row.title,
    status: row.status || row.stage || null,
    priority: row.priority || null,
    taskDate: toIso(row.taskDate),
    escalationLevel: row.escalation_level != null ? Number(row.escalation_level) : null,
    escalationStatus: row.escalation_status || null,
    isEscalated: Number(row.is_escalated || 0) === 1,
    lastEscalatedAt: toIso(row.last_escalated_at),
    project: row.project_public_id || row.project_name ? {
      id: row.project_public_id || null,
      name: row.project_name || null
    } : null,
    client: row.client_public_id || row.client_name ? {
      id: row.client_public_id || null,
      name: row.client_name || null
    } : null
  }));
}

module.exports = {
  DEFAULT_TASK_WORKFLOW_SETTINGS,
  ensureTaskEnhancementSchema,
  loadTaskWorkflowSettings,
  startTaskTimer,
  pauseTaskTimer,
  resumeTaskTimer,
  stopTaskTimer,
  getTaskTimerLogs,
  getEscalationHistory,
  getEscalatedTasks,
  sendReviewRequestNotification,
  runAutomation,
  start,
  formatDuration
};
