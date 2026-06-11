
const db = require(__root + 'db');
const express = require('express');
const router = express.Router();
const logger = require(__root + 'logger');
const crypto = require('crypto');
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const taskLockCheckMiddleware = require(__root + 'middleware/taskLockCheck');
require('dotenv').config();
const jwt = require('jsonwebtoken');
const emailService = require(__root + 'utils/emailService');
const tenantMiddleware = require(__root + 'middleware/tenant');
const upload = require("../multer");
const multer = require("multer");
const CryptoJS = require("crypto-js");
const dayjs = require('dayjs');
const { asyncHandler } = require(__root + 'utils/asyncHandler');
const { handleDbError, safeQuery } = require(__root + 'utils/dbErrorHandler');
const { assertTenantId } = require(__root + 'utils/tenantScope');
// Convert various JS Date/ISO inputs to MySQL DATETIME format `YYYY-MM-DD HH:MM:SS`
const toMySQLDate = (d) => {
  if (d === null || d === undefined) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};
const NotificationService = require(__root + 'services/notificationService');
const workflowService = require(__root + 'workflow/workflowService');
const taskWorkflowAutomationService = require(__root + 'services/taskWorkflowAutomationService');
const errorResponse = require(__root + 'utils/errorResponse');
const { check } = require('express-validator');
const validateRequest = require(__root + 'middleware/validateRequest');
router.use(requireAuth);        // ✅ Sets req.user from JWT
router.use(tenantMiddleware);

function normalizeTaskRole(role) {
  return String(role || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

function isTenantAdminRole(role) {
  const normalized = normalizeTaskRole(role);
  return normalized === 'SUPER_ADMIN' || normalized === 'ADMIN';
}

function isAuditRole(role) {
  return normalizeTaskRole(role) === 'AUDIT';
}

function isManagerRole(role) {
  return normalizeTaskRole(role) === 'MANAGER';
}

function isEmployeeRole(role) {
  return normalizeTaskRole(role) === 'EMPLOYEE';
}

function isClientLikeRole(role) {
  const normalized = normalizeTaskRole(role);
  return normalized === 'CLIENT' || normalized === 'CLIENT_VIEWER';
}

function canManageTenantTasks(role) {
  return isTenantAdminRole(role) || isManagerRole(role);
}

function normalizeTaskLifecycleStatus(value) {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  switch (raw) {
    case 'TODO':
    case 'TO_DO':
      return 'PENDING';
    case 'INPROGRESS':
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'IN_REVIEW':
      return 'REVIEW';
    case 'ONHOLD':
    case 'ON_HOLD':
      return 'ON_HOLD';
    case 'COMPLETE':
    case 'COMPLETED':
      return 'COMPLETED';
    case 'APPROVE':
    case 'APPROVED':
      // Changed from 'APPROVED' to 'COMPLETED' as per requirement:
      // When manager approves task in REVIEW, status should be COMPLETED
      return 'COMPLETED';
    case 'REJECT':
    case 'REJECTED':
      return 'REJECTED';
    case 'PENDING':
      return 'PENDING';
    default:
      return raw || 'PENDING';
  }
}

function taskStatusToDb(status) {
  switch (normalizeTaskLifecycleStatus(status)) {
    case 'PENDING':
      return 'PENDING';
    case 'IN_PROGRESS':
      return 'In Progress';
    case 'ON_HOLD':
      return 'On Hold';
    case 'COMPLETED':
      return 'Completed';
    case 'APPROVED':
      return 'Approved';
    case 'REJECTED':
      return 'Rejected';
    default:
      return status || 'PENDING';
  }
}

function taskStageToDb(status) {
  switch (normalizeTaskLifecycleStatus(status)) {
    case 'PENDING':
      return 'TODO';
    case 'IN_PROGRESS':
      return 'IN_PROGRESS';
    case 'ON_HOLD':
      return 'ON_HOLD';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return status || 'TODO';
  }
}

function normalizeTaskPriority(value) {
  const normalized = String(value || 'MEDIUM').trim().toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH'].includes(normalized)) return normalized;
  return 'MEDIUM';
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildTaskPublicId() {
  return `tsk_${crypto.randomBytes(8).toString('hex')}`;
}

function parseTaskAssigneeRefs(payload) {
  const rawValue =
    payload.assigned_to ??
    payload.assignedTo ??
    payload.assignees ??
    payload.assignee_ids ??
    payload.assigneeIds ??
    payload.userIds ??
    [];

  const rawItems = Array.isArray(rawValue)
    ? rawValue
    : (typeof rawValue === 'string' ? rawValue.split(',') : [rawValue]);

  return [...new Set(rawItems
    .map((item) => {
      if (item && typeof item === 'object') {
        return item.public_id || item.publicId || item.user_id || item.userId || item.id || item._id || null;
      }
      return item;
    })
    .map((item) => String(item || '').trim())
    .filter(Boolean))];
}

function toIsoOrNull(value) {
  try {
    return value ? new Date(value).toISOString() : null;
  } catch (error) {
    return null;
  }
}

function formatDuration(totalSeconds) {
  const seconds = Number(totalSeconds || 0);
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

// Return a minimal task representation suitable for Kanban columns.
function minimalKanbanTask(t) {
  return {
    id: t.id,
    internalId: t.internalId || t.internal_id || null,
    title: t.title || null,
    status: t.status || t.stage || null,
    priority: t.priority || null,
    client: t.client ? { id: t.client.id || t.client.publicId || t.client.public_id || null, internalId: t.client.internalId || t.client.internal_id || null, name: t.client.name || null } : (t.client_name ? { name: t.client_name, publicId: t.client_public_id || null } : null),
    project: t.project ? { id: t.project.id || t.project.publicId || t.project.public_id || null, internalId: t.project.internalId || t.project.internal_id || null, name: t.project.name || null } : (t.project_name ? { name: t.project_name, publicId: t.project_public_id || null } : null),
    started_at: t.started_at || null,
    live_timer: t.live_timer || null,
    completed_at: t.completed_at || null,
    total_time_hours: (t.total_time_hours != null) ? t.total_time_hours : (t.live_total_hours != null ? t.live_total_hours : null),
    total_time_hhmmss: t.total_time_hhmmss || t.live_total_hhmmss || null,
    checklist_progress: t.checklist_progress || null,
    permissions: t.permissions || null
  };
}

function normalizeApprovalRule(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'ANY_COMPLETED' || normalized === 'ANY') return 'ANY_COMPLETED';
  return 'ALL_COMPLETED';
}

function normalizeReassignmentRequestStatus(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  switch (normalized) {
    case 'APPROVE':
    case 'APPROVED':
      return 'APPROVED';
    case 'REJECT':
    case 'REJECTED':
      return 'REJECTED';
    case 'CANCEL':
    case 'CANCELLED':
      return 'CANCELLED';
    case 'PENDING':
      return 'PENDING';
    default:
      return normalized || 'PENDING';
  }
}

function buildReassignmentPermissions(req, reassignment) {
  const role = normalizeTaskRole(req && req.user ? req.user.role : '');
  const isPrivileged = role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'MANAGER';
  const isPending = normalizeReassignmentRequestStatus(reassignment && reassignment.request_status) === 'PENDING';
  const isRequester = Boolean(reassignment && reassignment.requested_by_internal_id != null)
    && String(reassignment.requested_by_internal_id) === String(req && req.user ? req.user._id : '');
  const isLockedForUser = isPending && isRequester;

  return {
    can_edit: !isLockedForUser,
    can_approve: isPrivileged,
    can_reassign: !isLockedForUser,
    is_requester: isRequester,
    is_locked_for_user: isLockedForUser
  };
}

function emitTaskUpdatedEvent(taskId, tenantId, payload = {}) {
  try {
    if (!global.io) return;
    global.io.emit('task_updated', {
      taskId: String(taskId),
      tenant_id: tenantId != null ? Number(tenantId) : null,
      timestamp: new Date().toISOString(),
      ...payload
    });
  } catch (_) {
    // Realtime emit failures should never break API flow.
  }
}

async function ensureTaskReassignmentSchema() {
  try {
    await q('SELECT 1 FROM task_resign_requests LIMIT 1');
  } catch (error) {
    return;
  }

  const requiredColumns = [
    { name: 'tenant_id', sql: 'ALTER TABLE task_resign_requests ADD COLUMN tenant_id INT NULL' },
    { name: 'new_assignee_id', sql: 'ALTER TABLE task_resign_requests ADD COLUMN new_assignee_id INT NULL' },
    { name: 'previous_status', sql: 'ALTER TABLE task_resign_requests ADD COLUMN previous_status VARCHAR(50) NULL' },
    { name: 'previous_started_at', sql: 'ALTER TABLE task_resign_requests ADD COLUMN previous_started_at DATETIME NULL' },
    { name: 'previous_completed_at', sql: 'ALTER TABLE task_resign_requests ADD COLUMN previous_completed_at DATETIME NULL' },
    { name: 'previous_total_duration', sql: 'ALTER TABLE task_resign_requests ADD COLUMN previous_total_duration INT NULL DEFAULT 0' },
    { name: 'previous_rejection_reason', sql: 'ALTER TABLE task_resign_requests ADD COLUMN previous_rejection_reason TEXT NULL' }
  ];

  for (const column of requiredColumns) {
    try {
      if (!await hasColumn('task_resign_requests', column.name)) {
        await q(column.sql);
      }
    } catch (error) {
      logger.warn(`Failed to ensure task_resign_requests.${column.name}: ${error.message}`);
    }
  }
}

async function updateTaskAssignedToColumn(connection, taskId, tenantId) {
  if (!await hasColumn('tasks', 'assigned_to')) return;

  const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
  const assigneeRows = await qConn(
    connection,
    `SELECT user_id FROM task_assignments WHERE task_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''} ORDER BY user_id ASC`,
    hasAssignmentTenantId ? [taskId, tenantId] : [taskId]
  );

  const assigneeIds = (assigneeRows || [])
    .map((row) => Number(row.user_id))
    .filter((value) => Number.isFinite(value) && value > 0);

  await qConn(
    connection,
    `UPDATE tasks SET assigned_to = ?${await hasColumn('tasks', 'updatedAt') ? ', updatedAt = NOW()' : ''} WHERE id = ?${await hasColumn('tasks', 'tenant_id') ? ' AND tenant_id = ?' : ''}`,
    await hasColumn('tasks', 'tenant_id')
      ? [JSON.stringify(assigneeIds), taskId, tenantId]
      : [JSON.stringify(assigneeIds), taskId]
  );
}

async function copyChecklistProgressToAssignee(connection, taskId, sourceUserId, targetUserId, tenantId) {
  await ensureUserChecklistProgressTable();
  const checklistSubtaskIds = await loadTaskChecklistSubtaskIds(connection, taskId);

  if (!checklistSubtaskIds.length) return;

  const sourceRows = await qConn(
    connection,
    'SELECT subtask_id, status, completed_at FROM user_checklist_progress WHERE task_id = ? AND user_id = ?',
    [taskId, sourceUserId]
  );
  const targetRows = await qConn(
    connection,
    'SELECT subtask_id, status, completed_at FROM user_checklist_progress WHERE task_id = ? AND user_id = ?',
    [taskId, targetUserId]
  );

  const sourceMap = {};
  const targetMap = {};

  for (const row of (sourceRows || [])) {
    sourceMap[String(row.subtask_id)] = row;
  }
  for (const row of (targetRows || [])) {
    targetMap[String(row.subtask_id)] = row;
  }

  const terminalStatuses = new Set(['COMPLETED', 'SKIPPED']);

  for (const subtaskId of checklistSubtaskIds) {
    const key = String(subtaskId);
    const source = sourceMap[key] || null;
    const target = targetMap[key] || null;

    let resolvedStatus = 'PENDING';
    let resolvedCompletedAt = null;

    const normalizedTargetStatus = normalizeTaskLifecycleStatus(target && target.status ? target.status : 'PENDING');
    const normalizedSourceStatus = normalizeTaskLifecycleStatus(source && source.status ? source.status : 'PENDING');

    if (target && terminalStatuses.has(normalizedTargetStatus)) {
      resolvedStatus = normalizedTargetStatus;
      resolvedCompletedAt = target.completed_at || null;
    } else if (source && terminalStatuses.has(normalizedSourceStatus)) {
      resolvedStatus = normalizedSourceStatus;
      resolvedCompletedAt = source.completed_at || null;
    } else if (target) {
      resolvedStatus = normalizedTargetStatus;
      resolvedCompletedAt = target.completed_at || null;
    } else if (source) {
      resolvedStatus = normalizedSourceStatus;
      resolvedCompletedAt = source.completed_at || null;
    }

    await qConn(
      connection,
      `INSERT INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status, completed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), completed_at = VALUES(completed_at), updated_at = NOW()`,
      [taskId, targetUserId, subtaskId, tenantId || null, resolvedStatus, resolvedCompletedAt]
    );
  }
}

async function loadTaskReassignmentState(taskId, tenantId, req = null) {
  await ensureTaskReassignmentSchema();

  const hasTenantId = await hasColumn('task_resign_requests', 'tenant_id');
  const hasNewAssigneeId = await hasColumn('task_resign_requests', 'new_assignee_id');
  const rows = await q(
    `
      SELECT r.*,
             requester.public_id AS requester_public_id,
             requester.name AS requester_name,
             responder.public_id AS responder_public_id,
             responder.name AS responder_user_name,
             ${hasNewAssigneeId ? 'new_assignee.public_id' : 'NULL'} AS new_assignee_public_id,
             ${hasNewAssigneeId ? 'new_assignee.name' : 'NULL'} AS new_assignee_name,
             ${hasNewAssigneeId ? 'new_assignee.email' : 'NULL'} AS new_assignee_email
      FROM task_resign_requests r
      LEFT JOIN users requester ON requester._id = r.requested_by
      LEFT JOIN users responder ON responder._id = r.responded_by
      ${hasNewAssigneeId ? 'LEFT JOIN users new_assignee ON new_assignee._id = r.new_assignee_id' : ''}
      WHERE r.task_id = ?${hasTenantId ? ' AND r.tenant_id = ?' : ''}
      ORDER BY r.requested_at DESC, r.id DESC
    `,
    hasTenantId ? [taskId, tenantId] : [taskId]
  );

  const normalizedRows = (rows || []).map((row) => ({
    ...row,
    normalized_status: normalizeReassignmentRequestStatus(row.status)
  }));

  const latest = normalizedRows[0] || null;
  const pendingRequests = normalizedRows.filter((row) => row.normalized_status === 'PENDING');
  const currentUserId = req && req.user ? req.user._id : null;
  const pendingForUser = currentUserId == null
    ? null
    : pendingRequests.find((row) => String(row.requested_by) === String(currentUserId)) || null;

  const isLockedForUser = Boolean(pendingForUser);
  const hasPending = pendingRequests.length > 0;
  const sourceRow = pendingForUser || latest;

  const reassignment = {
    is_locked: isLockedForUser,
    is_locked_for_user: isLockedForUser,
    has_pending: hasPending,
    request_status: sourceRow ? sourceRow.normalized_status : null,
    request_id: sourceRow ? Number(sourceRow.id) : null,
    requested_by: sourceRow ? (sourceRow.requester_public_id || String(sourceRow.requested_by || '')) : null,
    requested_by_internal_id: sourceRow ? sourceRow.requested_by : null,
    requester_name: sourceRow ? (sourceRow.requester_name || null) : null,
    reason: sourceRow ? (sourceRow.reason || null) : null,
    requested_at: sourceRow && sourceRow.requested_at ? new Date(sourceRow.requested_at).toISOString() : null,
    responded_by: sourceRow
      ? (sourceRow.responder_public_id || (sourceRow.responded_by != null ? String(sourceRow.responded_by) : null))
      : null,
    responder_name: sourceRow ? (sourceRow.responder_name || sourceRow.responder_user_name || null) : null,
    responded_at: sourceRow && sourceRow.responded_at ? new Date(sourceRow.responded_at).toISOString() : null,
    new_assignee: sourceRow && sourceRow.new_assignee_public_id
      ? {
        id: sourceRow.new_assignee_public_id,
        name: sourceRow.new_assignee_name || null,
        email: sourceRow.new_assignee_email || null
      }
      : null,
    pending_request_count: pendingRequests.length
  };

  return reassignment;
}

async function loadTenantTaskEnvelope(taskId, tenantId, req) {
  const taskData = await loadTenantTaskForResponse(taskId, tenantId, req);
  if (!taskData) return null;

  const reassignment = await loadTaskReassignmentState(taskId, tenantId, req);
  const permissions = buildReassignmentPermissions(req, reassignment);

  return {
    ...taskData,
    is_locked: reassignment.is_locked,
    is_locked_for_user: reassignment.is_locked_for_user,
    has_pending: reassignment.has_pending,
    request_status: reassignment.request_status,
    request_id: reassignment.request_id,
    lock: {
      is_locked: reassignment.is_locked,
      locked_for: reassignment.is_locked ? 'REQUESTER_ONLY' : null
    },
    reassignment,
    permissions
  };
}

async function loadTenantTaskReassignmentRequests(taskId, tenantId) {
  await ensureTaskReassignmentSchema();

  const hasTenantId = await hasColumn('task_resign_requests', 'tenant_id');
  const hasNewAssigneeId = await hasColumn('task_resign_requests', 'new_assignee_id');
  const rows = await q(
    `
      SELECT r.*,
             requester.public_id AS requester_public_id,
             requester.name AS requester_name,
             responder.public_id AS responder_public_id,
             responder.name AS responder_user_name,
             ${hasNewAssigneeId ? 'new_assignee.public_id' : 'NULL'} AS new_assignee_public_id,
             ${hasNewAssigneeId ? 'new_assignee.name' : 'NULL'} AS new_assignee_name,
             ${hasNewAssigneeId ? 'new_assignee.email' : 'NULL'} AS new_assignee_email
      FROM task_resign_requests r
      LEFT JOIN users requester ON requester._id = r.requested_by
      LEFT JOIN users responder ON responder._id = r.responded_by
      ${hasNewAssigneeId ? 'LEFT JOIN users new_assignee ON new_assignee._id = r.new_assignee_id' : ''}
      WHERE r.task_id = ?${hasTenantId ? ' AND r.tenant_id = ?' : ''}
      ORDER BY r.requested_at DESC, r.id DESC
    `,
    hasTenantId ? [taskId, tenantId] : [taskId]
  );

  return (rows || []).map((row) => ({
    id: Number(row.id),
    task_id: String(taskId),
    request_status: normalizeReassignmentRequestStatus(row.status),
    requested_by: row.requester_public_id || String(row.requested_by || ''),
    requested_by_internal_id: row.requested_by || null,
    requester_name: row.requester_name || null,
    reason: row.reason || null,
    requested_at: row.requested_at ? new Date(row.requested_at).toISOString() : null,
    responded_by: row.responder_public_id || (row.responded_by != null ? String(row.responded_by) : null),
    responded_by_internal_id: row.responded_by || null,
    responder_name: row.responder_name || row.responder_user_name || null,
    responded_at: row.responded_at ? new Date(row.responded_at).toISOString() : null,
    previous_status: row.previous_status || null,
    previous_started_at: row.previous_started_at ? new Date(row.previous_started_at).toISOString() : null,
    previous_completed_at: row.previous_completed_at ? new Date(row.previous_completed_at).toISOString() : null,
    previous_total_duration: row.previous_total_duration != null ? Number(row.previous_total_duration) : 0,
    previous_rejection_reason: row.previous_rejection_reason || null,
    new_assignee: row.new_assignee_public_id
      ? {
        id: row.new_assignee_public_id,
        name: row.new_assignee_name || null,
        email: row.new_assignee_email || null
      }
      : null
  }));
}

async function loadEligibleReassignmentCandidates(task, tenantId) {
  if (!task || !task.project_id) return [];

  const hasProjectDepartmentsTenantId = await hasColumn('project_departments', 'tenant_id');
  const hasTaskAssignmentsTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');

  return q(
    `
      SELECT DISTINCT
        u._id,
        u.public_id,
        u.name,
        u.email,
        u.phone,
        u.title,
        u.role,
        u.department_public_id,
        d.name AS department_name
      FROM project_departments pd
      JOIN departments d
        ON d.id = pd.department_id
       AND d.tenant_id = ?
      JOIN users u
        ON u.department_public_id = d.public_id
       AND u.tenant_id = d.tenant_id
      WHERE pd.project_id = ?
        ${hasProjectDepartmentsTenantId ? 'AND pd.tenant_id = ?' : ''}
        AND u.role = 'Employee'
        AND NOT EXISTS (
          SELECT 1
          FROM task_assignments ta
          WHERE ta.task_id = ?
            AND ta.user_id = u._id
            ${hasTaskAssignmentsTenantId ? 'AND ta.tenant_id = ?' : ''}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM task_resign_requests trr
          WHERE trr.task_id = ?
            AND trr.requested_by = u._id
            AND trr.status = 'PENDING'
            ${hasReassignmentTenantId ? 'AND trr.tenant_id = ?' : ''}
        )
      ORDER BY u.name ASC, u._id ASC
    `,
    [
      tenantId,
      task.project_id,
      ...(hasProjectDepartmentsTenantId ? [tenantId] : []),
      task.id,
      ...(hasTaskAssignmentsTenantId ? [tenantId] : []),
      task.id,
      ...(hasReassignmentTenantId ? [tenantId] : [])
    ]
  );
}

async function reviewTenantTaskReassignment(task, requestId, action, req, tenantId) {
  await ensureTaskReassignmentSchema();
  await ensureTaskAssignmentStatusTable();
  await ensureUserChecklistProgressTable();
  await ensureTaskActivitiesTable();
  await ensureTaskTimeLogsTable();

  const hasRequestTenantId = await hasColumn('task_resign_requests', 'tenant_id');
  const hasNewAssigneeId = await hasColumn('task_resign_requests', 'new_assignee_id');
  const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasAssignmentReadOnly = await hasColumn('task_assignments', 'is_read_only');
  const hasTaskUpdatedAt = await hasColumn('tasks', 'updatedAt');

  const requestRows = await q(
    `
      SELECT r.*,
             requester.public_id AS requester_public_id,
             requester.name AS requester_name,
             requester.email AS requester_email,
             ${hasNewAssigneeId ? 'new_assignee.public_id' : 'NULL'} AS new_assignee_public_id,
             ${hasNewAssigneeId ? 'new_assignee.name' : 'NULL'} AS new_assignee_name,
             ${hasNewAssigneeId ? 'new_assignee.email' : 'NULL'} AS new_assignee_email
      FROM task_resign_requests r
      LEFT JOIN users requester ON requester._id = r.requested_by
      ${hasNewAssigneeId ? 'LEFT JOIN users new_assignee ON new_assignee._id = r.new_assignee_id' : ''}
      WHERE r.id = ? AND r.task_id = ?${hasRequestTenantId ? ' AND r.tenant_id = ?' : ''}
      LIMIT 1
    `,
    hasRequestTenantId ? [requestId, task.id, tenantId] : [requestId, task.id]
  );

  if (!requestRows.length) {
    const error = new Error('Reassignment request not found');
    error.status = 404;
    throw error;
  }

  const resignRequest = requestRows[0];
  const currentStatus = normalizeReassignmentRequestStatus(resignRequest.status);
  if (currentStatus !== 'PENDING') {
    const error = new Error(`Request has already been ${String(currentStatus || resignRequest.status || 'processed').toLowerCase()}`);
    error.status = 409;
    throw error;
  }

  const oldAssigneeUser = await resolveTenantUser(resignRequest.requested_by, tenantId);
  if (!oldAssigneeUser) {
    const error = new Error('Requesting assignee no longer exists');
    error.status = 404;
    throw error;
  }

  let newAssigneeUser = null;
  let finalNewAssigneeId = req.body?.new_assignee_id ?? req.body?.newAssigneeId ?? (hasNewAssigneeId ? resignRequest.new_assignee_id : null);
  if (action === 'APPROVED') {
    if (!finalNewAssigneeId) {
      const error = new Error('new_assignee_id is required when approving reassignment');
      error.status = 400;
      throw error;
    }
    const resolvedUsers = await resolveTenantUsers([finalNewAssigneeId], tenantId);
    newAssigneeUser = resolvedUsers[0];
    finalNewAssigneeId = newAssigneeUser._id;

    if (String(newAssigneeUser._id) === String(oldAssigneeUser._id)) {
      const error = new Error('New assignee must be different from the requesting user');
      error.status = 400;
      throw error;
    }

    const eligibleCandidates = await loadEligibleReassignmentCandidates(task, tenantId);
    const candidateSet = new Set((eligibleCandidates || []).map((candidate) => String(candidate._id)));
    if (!candidateSet.has(String(newAssigneeUser._id))) {
      const error = new Error('Selected reassignment user is already assigned to this task or has a pending reassignment request');
      error.status = 400;
      throw error;
    }
  }

  const oldAssignmentRows = await q(
    `SELECT user_id FROM task_assignments
     WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}
     LIMIT 1`,
    hasAssignmentTenantId ? [task.id, oldAssigneeUser._id, tenantId] : [task.id, oldAssigneeUser._id]
  );
  if (!oldAssignmentRows.length) {
    const error = new Error('Requesting user is no longer assigned to this task');
    error.status = 409;
    throw error;
  }

  const connection = await getConnectionAsync();
  const now = new Date();
  const restoredCandidate = normalizeTaskLifecycleStatus(resignRequest.previous_status || 'IN_PROGRESS');
  const restoredStatus = ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED'].includes(restoredCandidate)
    ? restoredCandidate
    : 'IN_PROGRESS';

  try {
    await beginTransactionAsync(connection);

    const requestUpdateParts = ['status = ?', 'responded_at = ?', 'responded_by = ?', 'responder_name = ?'];
    const requestUpdateValues = [action, now, req.user._id, req.user.name || null];
    if (hasNewAssigneeId && action === 'APPROVED') {
      requestUpdateParts.push('new_assignee_id = ?');
      requestUpdateValues.push(finalNewAssigneeId);
    }
    await qConn(
      connection,
      `UPDATE task_resign_requests SET ${requestUpdateParts.join(', ')} WHERE id = ?`,
      [...requestUpdateValues, requestId]
    );

    if (action === 'APPROVED') {
      const newAssignmentRows = await qConn(
        connection,
        `SELECT user_id${hasAssignmentReadOnly ? ', is_read_only' : ''} FROM task_assignments
         WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}
         LIMIT 1`,
        hasAssignmentTenantId ? [task.id, finalNewAssigneeId, tenantId] : [task.id, finalNewAssigneeId]
      );

      if (!newAssignmentRows.length) {
        if (hasAssignmentTenantId && hasAssignmentReadOnly) {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id, tenant_id, is_read_only) VALUES (?, ?, ?, 0)', [task.id, finalNewAssigneeId, tenantId]);
        } else if (hasAssignmentTenantId) {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id, tenant_id) VALUES (?, ?, ?)', [task.id, finalNewAssigneeId, tenantId]);
        } else if (hasAssignmentReadOnly) {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id, is_read_only) VALUES (?, ?, 0)', [task.id, finalNewAssigneeId]);
        } else {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)', [task.id, finalNewAssigneeId]);
        }
      } else if (hasAssignmentReadOnly && (newAssignmentRows[0].is_read_only === 1 || String(newAssignmentRows[0].is_read_only) === '1')) {
        await qConn(
          connection,
          `UPDATE task_assignments SET is_read_only = 0
           WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}`,
          hasAssignmentTenantId ? [task.id, finalNewAssigneeId, tenantId] : [task.id, finalNewAssigneeId]
        );
      }

      await qConn(
        connection,
        `INSERT IGNORE INTO task_assignment_status (task_id, user_id, tenant_id, status, total_duration)
         VALUES (?, ?, ?, 'PENDING', 0)`,
        [task.id, finalNewAssigneeId, tenantId]
      );

      await copyChecklistProgressToAssignee(connection, task.id, oldAssigneeUser._id, finalNewAssigneeId, tenantId);
      await qConn(connection, 'DELETE FROM user_checklist_progress WHERE task_id = ? AND user_id = ?', [task.id, oldAssigneeUser._id]);
      await qConn(connection, 'DELETE FROM task_assignment_status WHERE task_id = ? AND user_id = ?', [task.id, oldAssigneeUser._id]);
      await qConn(
        connection,
        `DELETE FROM task_assignments
         WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}`,
        hasAssignmentTenantId ? [task.id, oldAssigneeUser._id, tenantId] : [task.id, oldAssigneeUser._id]
      );

      await updateTaskAssignedToColumn(connection, task.id, tenantId);
      if (hasTaskUpdatedAt) {
        await qConn(connection, 'UPDATE tasks SET updatedAt = ? WHERE id = ?', [now, task.id]);
      }

      try {
        await qConn(
          connection,
          'INSERT INTO audit_logs (actor_id, tenant_id, action, entity, entity_id, details, module) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [req.user._id, req.tenantId, 'REASSIGNMENT_APPROVED', 'task', task.id, `Reassignment approved for ${oldAssigneeUser.name}. Request #${requestId}`, 'tasks']
        );
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[audit_logs] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }
    } else {
      const requesterAssignmentRows = await qConn(
        connection,
        `SELECT user_id FROM task_assignments
         WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}
         LIMIT 1`,
        hasAssignmentTenantId ? [task.id, oldAssigneeUser._id, tenantId] : [task.id, oldAssigneeUser._id]
      );

      if (!requesterAssignmentRows.length) {
        if (hasAssignmentTenantId && hasAssignmentReadOnly) {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id, tenant_id, is_read_only) VALUES (?, ?, ?, 0)', [task.id, oldAssigneeUser._id, tenantId]);
        } else if (hasAssignmentTenantId) {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id, tenant_id) VALUES (?, ?, ?)', [task.id, oldAssigneeUser._id, tenantId]);
        } else if (hasAssignmentReadOnly) {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id, is_read_only) VALUES (?, ?, 0)', [task.id, oldAssigneeUser._id]);
        } else {
          await qConn(connection, 'INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)', [task.id, oldAssigneeUser._id]);
        }
      } else if (hasAssignmentReadOnly) {
        await qConn(
          connection,
          `UPDATE task_assignments SET is_read_only = 0
           WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}`,
          hasAssignmentTenantId ? [task.id, oldAssigneeUser._id, tenantId] : [task.id, oldAssigneeUser._id]
        );
      }

      await qConn(
        connection,
        `INSERT INTO task_assignment_status
           (task_id, user_id, tenant_id, status, started_at, live_timer, completed_at, total_duration, rejection_reason, approved_at, rejected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON DUPLICATE KEY UPDATE
           status = VALUES(status),
           started_at = VALUES(started_at),
           live_timer = VALUES(live_timer),
           completed_at = VALUES(completed_at),
           total_duration = VALUES(total_duration),
           rejection_reason = VALUES(rejection_reason),
           approved_at = NULL,
           rejected_at = NULL,
           updated_at = NOW()`,
        [
          task.id,
          oldAssigneeUser._id,
          tenantId,
          restoredStatus,
          resignRequest.previous_started_at || null,
          restoredStatus === 'IN_PROGRESS' ? now : null,
          restoredStatus === 'COMPLETED' ? (resignRequest.previous_completed_at || now) : null,
          Number(resignRequest.previous_total_duration || 0),
          resignRequest.previous_rejection_reason || null
        ]
      );

      if (hasTaskUpdatedAt) {
        await qConn(connection, 'UPDATE tasks SET updatedAt = ? WHERE id = ?', [now, task.id]);
      }

      try {
        await qConn(
          connection,
          'INSERT INTO audit_logs (actor_id, tenant_id, action, entity, entity_id, details, module) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [req.user._id, req.tenantId, 'REASSIGNMENT_REJECTED', 'task', task.id, `Reassignment rejected for ${oldAssigneeUser.name}. Request #${requestId}`, 'tasks']
        );
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[audit_logs] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }
    }

    await commitTransactionAsync(connection);
  } catch (error) {
    await rollbackTransactionAsync(connection);
    throw error;
  } finally {
    connection.release();
  }

  const taskLink = `${(process.env.FRONTEND_URL || process.env.BASE_URL || '')}/tasks/${task.public_id || task.id}`;
  if (action === 'APPROVED') {
    if (oldAssigneeUser?.email) {
      await safeSendEmailForTask(task.id, oldAssigneeUser.email, emailService.taskReassignmentOldAssigneeTemplate({
        taskTitle: task.title || 'Task',
        newAssignee: newAssigneeUser?.name || 'New Assignee',
        taskLink
      }));
    }
    if (newAssigneeUser?.email) {
      await safeSendEmailForTask(task.id, newAssigneeUser.email, emailService.taskReassignmentApprovedTemplate({
        taskTitle: task.title || 'Task',
        oldAssignee: oldAssigneeUser?.name || 'Previous Assignee',
        newAssignee: newAssigneeUser.name,
        taskLink
      }));
    }
  } else if (oldAssigneeUser?.email) {
    await safeSendEmailForTask(task.id, oldAssigneeUser.email, emailService.taskReassignmentRejectedTemplate({
      taskTitle: task.title || 'Task',
      taskLink
    }));
  }

  const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
  emitTaskUpdatedEvent(task.public_id || task.id, tenantId, {
    action: action === 'APPROVED' ? 'REASSIGNMENT_APPROVED' : 'REASSIGNMENT_REJECTED',
    reassignment: taskResponse ? taskResponse.reassignment : null,
    assigned_to: newAssigneeUser
      ? {
        id: newAssigneeUser.public_id || String(newAssigneeUser._id),
        name: newAssigneeUser.name,
        email: newAssigneeUser.email || null
      }
      : null
  });

  return {
    success: true,
    message: action === 'APPROVED'
      ? `Reassignment approved. ${oldAssigneeUser.name} has been removed and ${newAssigneeUser?.name || 'the new assignee'} can continue the task.`
      : `Reassignment rejected. ${oldAssigneeUser.name} can continue the task with the restored state.`,
    data: taskResponse
  };
}

// Derive a global task status from the individual per-user assignment statuses.
// Used only for manager/admin views; never surfaced to employees.
function deriveGlobalStatus(assignees) {
  if (!Array.isArray(assignees) || assignees.length === 0) return 'PENDING';
  const statuses = assignees.map((a) => normalizeTaskLifecycleStatus(a.status || 'PENDING'));
  if (statuses.every((s) => s === 'APPROVED')) return 'COMPLETED';
  if (statuses.every((s) => s === 'COMPLETED' || s === 'APPROVED')) return 'COMPLETED';
  if (statuses.some((s) => s === 'REJECTED')) return 'REJECTED';
  if (statuses.some((s) => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
  if (statuses.some((s) => s === 'ON_HOLD')) return 'ON_HOLD';
  return 'PENDING';
}

// Filter a fully-built task response object down to a role-appropriate shape.
// - Employee: sees ONLY their own status / checklist; global status is removed.
// - Manager / Admin: sees the full object with global_status clearly labelled.
function filterTaskResponseForRole(taskData, req) {
  if (!taskData || !req || !req.user) return taskData;

  // Managers, Admins, Auditors → full data (assigned_to duplicate already gone)
  if (!isEmployeeRole(req.user.role)) return taskData;

  // ── Employee view ──────────────────────────────────────────────────────────
  const assignees = taskData.assignees || [];
  const myAssignment = assignees.find(
    (a) => String(a.id) === String(req.user.id) || String(a.internalId) === String(req.user._id)
  ) || {};
  const employeeStatus = normalizeTaskLifecycleStatus(myAssignment.status || 'PENDING') === 'APPROVED'
    ? 'COMPLETED'
    : (myAssignment.status || 'PENDING');

  return {
    id: taskData.id,
    internalId: taskData.internalId,
    title: taskData.title,
    description: taskData.description,
    priority: taskData.priority,
    taskDate: taskData.taskDate,
    dueDate: taskData.dueDate,
    timeAlloted: taskData.timeAlloted,
    estimatedHours: taskData.estimatedHours,
    client: taskData.client,
    project: taskData.project,
    // ── per-user status fields (NEVER the global task status) ──────────────
    status: employeeStatus,
    started_at: myAssignment.started_at || null,
    live_timer: myAssignment.live_timer || null,
    completed_at: myAssignment.completed_at || null,
    rejection_reason: myAssignment.rejection_reason || null,
      // Use live_total_seconds which already incorporates elapsed time when IN_PROGRESS
      total_time_seconds: myAssignment.live_total_seconds != null ? myAssignment.live_total_seconds : (myAssignment.total_duration || 0),
      total_time_hours: myAssignment.live_total_hours != null ? myAssignment.live_total_hours : Number(((myAssignment.total_duration || 0) / 3600).toFixed(2)),
      total_time_hhmmss: myAssignment.live_total_hhmmss != null ? myAssignment.live_total_hhmmss : formatDuration(myAssignment.total_duration || 0),
    // ── per-user checklist ──────────────────────────────────────────────────
    checklist: myAssignment.checklist || [],
    checklist_progress: myAssignment.checklist_progress || { total: 0, completed: 0, percent: 0 }
  };
}

function formatTenantTask(task, assignees, tenantId) {
  const derivedGlobalStatus = deriveGlobalStatus(assignees);
  const totalSeconds = Number(task.total_duration || 0);
  return {
    id: task.public_id || String(task.id),
    internalId: String(task.id),
    title: task.title || null,
    description: task.description || null,
    priority: task.priority || null,
    stage: task.stage || null,
    status: derivedGlobalStatus,
    status_key: normalizeTaskLifecycleStatus(derivedGlobalStatus),
    taskDate: toIsoOrNull(task.taskDate),
    dueDate: toIsoOrNull(task.taskDate),
    timeAlloted: task.time_alloted != null ? Number(task.time_alloted) : null,
    estimatedHours: task.estimated_hours != null
      ? Number(task.estimated_hours)
      : (task.time_alloted != null ? Number(task.time_alloted) : null),
    started_at: toIsoOrNull(task.started_at),
    live_timer: toIsoOrNull(task.live_timer),
    completed_at: toIsoOrNull(task.completed_at),
    approved_at: toIsoOrNull(task.approved_at),
    rejected_at: toIsoOrNull(task.rejected_at),
    rejection_reason: task.rejection_reason || null,
    total_time_seconds: totalSeconds,
    total_time_hours: Number((totalSeconds / 3600).toFixed(2)),
    total_time_hhmmss: formatDuration(totalSeconds),
    is_escalated: Number(task.is_escalated || 0) === 1,
    isEscalated: Number(task.is_escalated || 0) === 1,
    escalation_level: task.escalation_level != null ? Number(task.escalation_level) : null,
    escalationLevel: task.escalation_level != null ? Number(task.escalation_level) : null,
    escalation_status: task.escalation_status || null,
    escalationStatus: task.escalation_status || null,
    last_escalated_at: toIsoOrNull(task.last_escalated_at),
    lastEscalatedAt: toIsoOrNull(task.last_escalated_at),
    client: task.client_id ? {
      id: task.client_public_id || String(task.client_id),
      internalId: String(task.client_id),
      name: task.client_name || null
    } : null,
    project: task.project_id ? {
      id: task.project_public_id || String(task.project_id),
      internalId: String(task.project_id),
      name: task.project_name || null
    } : null,
    assignees,
    global_status: derivedGlobalStatus
  };
}

async function loadTaskChecklistSubtaskIds(connection, taskId) {
  const subtasksDeletedCol = await hasColumn('subtasks', 'isDeleted');
  const subtasksDeleteFilter = subtasksDeletedCol
    ? 'AND (isDeleted IS NULL OR isDeleted != 1)'
    : '';

  const templateRows = await qConn(
    connection,
    `SELECT id AS subtask_id FROM subtasks WHERE task_id = ? ${subtasksDeleteFilter} ORDER BY id ASC`,
    [taskId]
  );

  const mergedIds = (templateRows || [])
    .map((row) => Number(row.subtask_id))
    .filter((value) => Number.isFinite(value) && value > 0);

  try {
    await ensureUserChecklistProgressTable();
    const dynamicRows = await qConn(
      connection,
      `SELECT DISTINCT subtask_id FROM user_checklist_progress WHERE task_id = ?`,
      [taskId]
    );
    for (const row of (dynamicRows || [])) {
      const subtaskId = Number(row.subtask_id);
      if (Number.isFinite(subtaskId) && subtaskId > 0) mergedIds.push(subtaskId);
    }
  } catch (error) {
    logger.warn(`Checklist merge fallback for task ${taskId}: ${error.message}`);
  }

  return [...new Set(mergedIds)];
}

function getConnectionAsync() {
  return new Promise((resolve, reject) => {
    db.getConnection((err, connection) => (err ? reject(err) : resolve(connection)));
  });
}

function qConn(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function beginTransactionAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.beginTransaction((err) => (err ? reject(err) : resolve()));
  });
}

function commitTransactionAsync(connection) {
  return new Promise((resolve, reject) => {
    connection.commit((err) => (err ? reject(err) : resolve()));
  });
}

function rollbackTransactionAsync(connection) {
  return new Promise((resolve) => {
    connection.rollback(() => resolve());
  });
}

async function resolveTenantUser(identifier, tenantId) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
  const hasTenantId = await hasColumn('users', 'tenant_id');
  let sql = 'SELECT _id, public_id, name, email, role, tenant_id FROM users WHERE (_id = ? OR public_id = ? OR email = ?) ';
  const params = [numericId, String(identifier), String(identifier)];
  if (hasTenantId) {
    sql += 'AND (tenant_id IS NULL OR tenant_id = ?) ';
    params.push(tenantId);
  }
  sql += 'LIMIT 1';
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function resolveTenantUsers(identifiers, tenantId) {
  const resolved = [];
  const seen = new Set();

  for (const identifier of identifiers) {
    const user = await resolveTenantUser(identifier, tenantId);
    if (!user) {
      const error = new Error(`User ${identifier} not found for tenant`);
      error.status = 400;
      throw error;
    }

    if (String(user.role || '').toLowerCase() !== 'employee') {
      const error = new Error(`User ${user.public_id || user._id} cannot be assigned to tasks`);
      error.status = 400;
      throw error;
    }

    if (!seen.has(String(user._id))) {
      seen.add(String(user._id));
      resolved.push(user);
    }
  }

  return resolved;
}

async function resolveTenantProject(identifier, tenantId) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
  const hasTenantId = await hasColumn('projects', 'tenant_id');
  const hasPublicId = await hasColumn('projects', 'public_id');

  let sql = `SELECT id, ${hasPublicId ? 'public_id' : 'id AS public_id'}, name, client_id, project_manager_id, tenant_id, status FROM projects WHERE (id = ?${hasPublicId ? ' OR public_id = ?' : ''}) `;
  const params = hasPublicId ? [numericId, String(identifier)] : [numericId];

  if (hasTenantId) {
    sql += 'AND tenant_id = ? ';
    params.push(tenantId);
  }
  sql += 'LIMIT 1';
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function resolveTenantClient(identifier, tenantId) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
  const hasTenantId = await hasColumn('clients', 'tenant_id');
  const hasPublicId = await hasColumn('clients', 'public_id');

  let sql = `SELECT id, ${hasPublicId ? 'public_id' : 'id AS public_id'}, name, tenant_id FROM clients WHERE (id = ?${hasPublicId ? ' OR public_id = ?' : ''}) `;
  const params = hasPublicId ? [numericId, String(identifier)] : [numericId];

  if (hasTenantId) {
    sql += 'AND tenant_id = ? ';
    params.push(tenantId);
  }
  if (await hasColumn('clients', 'isDeleted')) {
    sql += 'AND (isDeleted IS NULL OR isDeleted != 1) ';
  }
  sql += 'LIMIT 1';
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function resolveTenantTask(identifier, tenantId, options = {}) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
  const includeDeleted = options.includeDeleted === true;
  const hasTenantId = await hasColumn('tasks', 'tenant_id');
  let sql = 'SELECT * FROM tasks WHERE (id = ? OR public_id = ?) ';
  const params = [numericId, String(identifier)];
  if (hasTenantId) {
    sql += 'AND tenant_id = ? ';
    params.push(tenantId);
  }
  if (!includeDeleted && await hasColumn('tasks', 'isDeleted')) {
    sql += 'AND (isDeleted IS NULL OR isDeleted != 1) ';
  }
  sql += 'LIMIT 1';
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function loadTaskAssignmentsForTenant(taskId, tenantId) {
  // Ensure per-user status table exists before querying it
  await ensureTaskAssignmentStatusTable();

  const hasTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasTasTenantId = await hasColumn('task_assignment_status', 'tenant_id');
  let sql = `
    SELECT ta.task_id, ta.user_id, COALESCE(ta.is_read_only, 0) AS is_read_only, ta.checklist,
           u._id, u.public_id, u.name, u.email, u.role,
           COALESCE(tas.status, 'PENDING') AS user_status,
           tas.started_at AS user_started_at,
           tas.live_timer AS user_live_timer,
           tas.completed_at AS user_completed_at,
           tas.total_duration AS user_total_duration,
           tas.rejection_reason AS user_rejection_reason
    FROM task_assignments ta
    JOIN users u ON u._id = ta.user_id
    LEFT JOIN task_assignment_status tas ON tas.task_id = ta.task_id AND tas.user_id = ta.user_id${hasTasTenantId ? ' AND (tas.tenant_id IS NULL OR tas.tenant_id = ?)' : ''}
    WHERE ta.task_id = ?
  `;
  const params = [];
  if (hasTasTenantId) params.push(tenantId);
  params.push(taskId);
  if (hasTenantId) {
    sql += ' AND ta.tenant_id = ?';
    params.push(tenantId);
  }
  sql += ' ORDER BY u.name ASC';
  const rows = await q(sql, params);
  const queryTime = Date.now();
  const merged = new Map();
  for (const row of (rows || [])) {
    const storedDuration = Number(row.user_total_duration || 0);
    const liveTimerRaw = row.user_live_timer ? new Date(row.user_live_timer) : null;
    const assigneeStatus = normalizeTaskLifecycleStatus(row.user_status || 'PENDING');
    let liveTotalSeconds = storedDuration;
    if (assigneeStatus === 'IN_PROGRESS' && liveTimerRaw) {
      const elapsed = Math.max(0, Math.floor((queryTime - liveTimerRaw.getTime()) / 1000));
      liveTotalSeconds = storedDuration + elapsed;
    }

    const key = String(row._id);
    if (!merged.has(key)) {
      merged.set(key, {
        id: row.public_id || String(row._id),
        internalId: String(row._id),
        name: row.name || null,
        email: row.email || null,
        role: row.role || null,
        readOnly: Number(row.is_read_only || 0) === 1,
        status: assigneeStatus,
        started_at: row.user_started_at ? new Date(row.user_started_at).toISOString() : null,
        live_timer: liveTimerRaw ? liveTimerRaw.toISOString() : null,
        completed_at: row.user_completed_at ? new Date(row.user_completed_at).toISOString() : null,
        total_duration: storedDuration,
        live_total_seconds: liveTotalSeconds,
        live_total_hours: Number((liveTotalSeconds / 3600).toFixed(2)),
        live_total_hhmmss: formatDuration(liveTotalSeconds),
        rejection_reason: row.user_rejection_reason || null,
        checklist: row.checklist ? JSON.parse(row.checklist) : []
      });
    } else {
      const existing = merged.get(key);
      // Merge numeric totals by taking the max to avoid accidental truncation
      existing.total_duration = Math.max(existing.total_duration || 0, storedDuration);
      existing.live_total_seconds = Math.max(existing.live_total_seconds || 0, liveTotalSeconds);
      existing.live_total_hours = Number((existing.live_total_seconds / 3600).toFixed(2));
      existing.live_total_hhmmss = formatDuration(existing.live_total_seconds);
      if (!existing.started_at && row.user_started_at) existing.started_at = new Date(row.user_started_at).toISOString();
      if (!existing.live_timer && liveTimerRaw) existing.live_timer = liveTimerRaw.toISOString();
      if (!existing.completed_at && row.user_completed_at) existing.completed_at = new Date(row.user_completed_at).toISOString();
      if (!existing.rejection_reason && row.user_rejection_reason) existing.rejection_reason = row.user_rejection_reason;
      if (!existing.name && row.name) existing.name = row.name;
      if (!existing.email && row.email) existing.email = row.email;
      if (!existing.role && row.role) existing.role = row.role;
      existing.readOnly = existing.readOnly || Number(row.is_read_only || 0) === 1;
      // Merge checklist arrays deduplicating items by JSON representation
      try {
        const existingChecklist = Array.isArray(existing.checklist) ? existing.checklist : [];
        const rowChecklist = row.checklist ? JSON.parse(row.checklist) : [];
        const mergedChecklist = [...existingChecklist];
        for (const item of rowChecklist) {
          if (!mergedChecklist.find((x) => JSON.stringify(x) === JSON.stringify(item))) mergedChecklist.push(item);
        }
        existing.checklist = mergedChecklist;
      } catch (e) {
        // ignore parse errors and keep existing checklist
      }
      merged.set(key, existing);
    }
  }

  return Array.from(merged.values());
}

async function canReadTenantTask(task, req) {
  if (!task || !req || !req.user) return false;
  if (canManageTenantTasks(req.user.role) || isAuditRole(req.user.role)) return true;

  if (req.viewerMappedClientId && task.client_id && String(req.viewerMappedClientId) === String(task.client_id)) {
    return true;
  }

  const hasTenantId = await hasColumn('task_assignments', 'tenant_id');
  let sql = 'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?';
  const params = [task.id, req.user._id];
  if (hasTenantId) {
    sql += ' AND tenant_id = ?';
    params.push(task.tenant_id ?? req.user.tenant_id);
  }
  sql += ' LIMIT 1';
  const rows = await q(sql, params);
  return Array.isArray(rows) && rows.length > 0;
}

async function canWriteTenantTask(task, req) {
  if (!task || !req || !req.user) return false;
  if (canManageTenantTasks(req.user.role)) return true;
  if (!isEmployeeRole(req.user.role)) return false;
  if (normalizeTaskLifecycleStatus(task.status || task.stage || 'PENDING') === 'APPROVED') return false;

  // Restrict only requester when their reassignment request is pending.
  const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');
  const pendingRows = await q(
    `SELECT id FROM task_resign_requests
     WHERE task_id = ? AND requested_by = ? AND status = 'PENDING'
     ${hasReassignmentTenantId ? 'AND tenant_id = ?' : ''}
     LIMIT 1`,
    hasReassignmentTenantId ? [task.id, req.user._id, task.tenant_id ?? req.user.tenant_id] : [task.id, req.user._id]
  );
  if (Array.isArray(pendingRows) && pendingRows.length > 0) return false;

  const hasTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasReadOnly = await hasColumn('task_assignments', 'is_read_only');
  let sql = 'SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?';
  const params = [task.id, req.user._id];

  if (hasTenantId) {
    sql += ' AND tenant_id = ?';
    params.push(task.tenant_id ?? req.user.tenant_id);
  }
  if (hasReadOnly) {
    sql += ' AND (is_read_only IS NULL OR is_read_only != 1)';
  }
  sql += ' LIMIT 1';

  const rows = await q(sql, params);
  return Array.isArray(rows) && rows.length > 0;
}

async function syncTenantTaskAssignments(connection, taskId, tenantId, assigneeIds, options = {}) {
  // mode: 'replace' (default) = delete all existing and reinsert (used at task creation)
  //       'addOnly' = only insert new assignees, preserve existing ones and their status/checklists
  const mode = options.mode || 'replace';

  const hasTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasReadOnly = await hasColumn('task_assignments', 'is_read_only');

  let newAssigneeIds = assigneeIds;

  if (mode === 'replace') {
    await qConn(
      connection,
      `DELETE FROM task_assignments WHERE task_id = ?${hasTenantId ? ' AND tenant_id = ?' : ''}`,
      hasTenantId ? [taskId, tenantId] : [taskId]
    );
  } else {
    // Determine which are truly new (not yet assigned)
    const existingRows = await qConn(
      connection,
      `SELECT user_id FROM task_assignments WHERE task_id = ?${hasTenantId ? ' AND tenant_id = ?' : ''}`,
      hasTenantId ? [taskId, tenantId] : [taskId]
    );
    const existingSet = new Set((existingRows || []).map((r) => String(r.user_id)));
    newAssigneeIds = assigneeIds.filter((id) => !existingSet.has(String(id)));
  }

  // Insert assignments (replace = all; addOnly = only new)
  const idsToInsert = mode === 'replace' ? assigneeIds : newAssigneeIds;
  for (const assigneeId of idsToInsert) {
    const columns = ['task_id', 'user_id'];
    const placeholders = ['?', '?'];
    const values = [taskId, assigneeId];

    if (hasReadOnly) {
      columns.push('is_read_only');
      placeholders.push('?');
      values.push(0);
    }
    if (hasTenantId) {
      columns.push('tenant_id');
      placeholders.push('?');
      values.push(tenantId);
    }

    if (mode === 'replace') {
      await qConn(
        connection,
        `INSERT INTO task_assignments (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values
      );
    } else {
      await qConn(
        connection,
        `INSERT IGNORE INTO task_assignments (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
        values
      );
    }
  }

  // Initialize task_assignment_status for all inserted assignees
  await ensureTaskAssignmentStatusTable();
  for (const assigneeId of idsToInsert) {
    await qConn(
      connection,
      `INSERT IGNORE INTO task_assignment_status (task_id, user_id, tenant_id, status) VALUES (?, ?, ?, 'PENDING')`,
      [taskId, assigneeId, tenantId]
    );
  }

  // Copy checklist template + dynamically added items to each new assignee
  if (newAssigneeIds.length > 0) {
    await ensureUserChecklistProgressTable();
    const checklistSubtaskIds = await loadTaskChecklistSubtaskIds(connection, taskId);
    for (const assigneeId of newAssigneeIds) {
      for (const subtaskId of checklistSubtaskIds) {
        await qConn(
          connection,
          `INSERT IGNORE INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status) VALUES (?, ?, ?, ?, 'PENDING')`,
          [taskId, assigneeId, subtaskId, tenantId]
        );
      }
    }
  }
}

async function loadTenantTaskForResponse(taskId, tenantId, req = null) {
  const hasTenantId = await hasColumn('tasks', 'tenant_id');
  const hasClientPublic = await hasColumn('clients', 'public_id');
  const hasProjectPublic = await hasColumn('projects', 'public_id');

  const rows = await q(
    `
      SELECT t.*,
             c.name AS client_name,
             ${hasClientPublic ? 'c.public_id' : 'NULL'} AS client_public_id,
             p.name AS project_name,
             ${hasProjectPublic ? 'p.public_id' : 'NULL'} AS project_public_id
      FROM tasks t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.id = ?${hasTenantId ? ' AND t.tenant_id = ?' : ''}
      LIMIT 1
    `,
    hasTenantId ? [taskId, tenantId] : [taskId]
  );

  if (!rows || rows.length === 0) return null;
  const assignees = await loadTaskAssignmentsForTenant(taskId, tenantId);

  // Attach per-user checklist progress to each assignee
  assignees.forEach((assignee) => {
    const checklist = assignee.checklist || [];
    const total = checklist.length;
    const done = checklist.filter((item) => item.completed === true).length;
    assignee.checklist_progress = { total, completed: done, percent: total > 0 ? Math.round((done / total) * 100) : 0 };
  });

  const formatted = formatTenantTask(rows[0], assignees, tenantId);
  return req ? filterTaskResponseForRole(formatted, req) : formatted;
}

async function sendTenantTaskNotifications(userIds, title, message, type, entityId, tenantId) {
  if (!Array.isArray(userIds) || userIds.length === 0) return;
  try {
    await NotificationService.createAndSend(userIds, title, message, type, 'task', entityId, tenantId);
  } catch (error) {
    logger.warn(`Task notification skipped: ${error.message}`);
  }
}

async function listTenantTasks(req, res) {
  const tenantId = assertTenantId(req);
  const page = parsePositiveInt(req.query.page, 1);
  const limit = Math.min(parsePositiveInt(req.query.limit, 20), 100);
  const offset = (page - 1) * limit;
  const filters = { ...req.query };

  if (req.path === '/gettaskss' && !filters.assignee_id && filters.userId) {
    filters.assignee_id = filters.userId;
  }

  const hasTaskTenantId = await hasColumn('tasks', 'tenant_id');
  const hasTaskDeleted = await hasColumn('tasks', 'isDeleted');
  const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
  const where = ['1 = 1'];
  const params = [];

  if (hasTaskTenantId) {
    where.push('t.tenant_id = ?');
    params.push(tenantId);
  }

  if (hasTaskDeleted && !(filters.includeDeleted === '1' || filters.includeDeleted === 'true')) {
    where.push('(t.isDeleted IS NULL OR t.isDeleted != 1)');
  }

  const projectRef = filters.project_id || filters.projectId || filters.projectPublicId;
  let project = null;
  if (projectRef) {
    project = await resolveTenantProject(projectRef, tenantId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    where.push('t.project_id = ?');
    params.push(project.id);
  }

  const clientRef = filters.client_id || filters.clientId;
  if (clientRef) {
    const client = await resolveTenantClient(clientRef, tenantId);
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
    where.push('t.client_id = ?');
    params.push(client.id);
  }

  if (filters.status) {
    const requestedStatuses = String(filters.status)
      .split(',')
      .map((item) => normalizeTaskLifecycleStatus(item))
      .filter(Boolean);

    if (requestedStatuses.length > 0) {
      where.push(`UPPER(REPLACE(REPLACE(COALESCE(t.status, ''), ' ', '_'), '-', '_')) IN (${requestedStatuses.map(() => '?').join(', ')})`);
      params.push(...requestedStatuses);
    }
  }

  if (filters.search) {
    where.push('(t.title LIKE ? OR t.description LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  if (req.viewerMappedClientId) {
    where.push('t.client_id = ?');
    params.push(req.viewerMappedClientId);
  } else if (isEmployeeRole(req.user.role)) {
    where.push(`EXISTS (
      SELECT 1
      FROM task_assignments ta_scope
      WHERE ta_scope.task_id = t.id
        AND ta_scope.user_id = ?
        ${hasAssignmentTenantId ? 'AND ta_scope.tenant_id = ?' : ''}
    )`);
    params.push(req.user._id);
    if (hasAssignmentTenantId) params.push(tenantId);
  } else if (isClientLikeRole(req.user.role) && !canManageTenantTasks(req.user.role) && !isAuditRole(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Clients do not have task list access without a mapped client scope' });
  }

  const assigneeRef = filters.assignee_id || filters.assigneeId;
  if (assigneeRef && !isClientLikeRole(req.user.role)) {
    const assignee = await resolveTenantUser(assigneeRef, tenantId);
    if (!assignee) return res.status(404).json({ success: false, error: 'Assignee not found' });
    where.push(`EXISTS (
      SELECT 1
      FROM task_assignments ta_filter
      WHERE ta_filter.task_id = t.id
        AND ta_filter.user_id = ?
        ${hasAssignmentTenantId ? 'AND ta_filter.tenant_id = ?' : ''}
    )`);
    params.push(assignee._id);
    if (hasAssignmentTenantId) params.push(tenantId);
  }

  const whereSql = where.join(' AND ');
  const countRows = await q(`SELECT COUNT(*) AS total FROM tasks t WHERE ${whereSql}`, params);
  const total = Number((countRows && countRows[0] && countRows[0].total) || 0);

  const hasClientPublic = await hasColumn('clients', 'public_id');
  const hasProjectPublic = await hasColumn('projects', 'public_id');

  const dataRows = await q(
    `
      SELECT t.*,
             c.name AS client_name,
             ${hasClientPublic ? 'c.public_id' : 'NULL'} AS client_public_id,
             p.name AS project_name,
             ${hasProjectPublic ? 'p.public_id' : 'NULL'} AS project_public_id
      FROM tasks t
      LEFT JOIN clients c ON c.id = t.client_id
      LEFT JOIN projects p ON p.id = t.project_id
      WHERE ${whereSql}
      ORDER BY COALESCE(t.updatedAt, t.createdAt) DESC, t.id DESC
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );

  if (isEmployeeRole(req.user.role)) {
    const employeeTasks = await Promise.all(
      (dataRows || []).map((row) => loadTenantTaskEnvelope(row.id, tenantId, req))
    );
    const tasks = employeeTasks.filter(Boolean);
    const meta = {
      page,
      limit,
      total,
      totalPages: limit > 0 ? Math.ceil(total / limit) : 0
    };

    const wantKanban = req.query && (req.query.kanban === '1' || req.query.kanban === 'true' || req.query.kanban === 'yes');
    const kanban = { TODO: [], INPROGRESS: [], ONHOLD: [], REVIEW: [], COMPLETED: [] };
    tasks.forEach((t) => {
      const s = normalizeTaskLifecycleStatus(t.status || t.stage || 'PENDING');
      const minimal = minimalKanbanTask(t);
      switch (s) {
        case 'IN_PROGRESS':
          kanban.INPROGRESS.push(minimal); break;
        case 'ON_HOLD':
          kanban.ONHOLD.push(minimal); break;
        case 'REVIEW':
          kanban.REVIEW.push(minimal); break;
        case 'COMPLETED':
          kanban.COMPLETED.push(minimal); break;
        case 'PENDING':
        case 'TO_DO':
        default:
          kanban.TODO.push(minimal); break;
      }
    });

    // Include `kanban` ONLY for EMPLOYEE role
    let response = { success: true, data: tasks, meta };
    if (req.user.role === "EMPLOYEE") {
        response.kanban = kanban;
    }
    return res.json(response);
  }

  const taskIds = (dataRows || []).map((row) => row.id);
  const assignments = taskIds.length
    ? await q(
      `
        SELECT ta.task_id, COALESCE(ta.is_read_only, 0) AS is_read_only,
               u._id, u.public_id, u.name, u.email, u.role
               ,COALESCE(tas.status, 'PENDING') AS user_status
               ,tas.started_at AS user_started_at
               ,tas.live_timer AS user_live_timer
               ,tas.completed_at AS user_completed_at
               ,tas.total_duration AS user_total_duration
               ,tas.rejection_reason AS user_rejection_reason
        FROM task_assignments ta
        JOIN users u ON u._id = ta.user_id
        LEFT JOIN task_assignment_status tas ON tas.task_id = ta.task_id AND tas.user_id = ta.user_id
        WHERE ta.task_id IN (?)${hasAssignmentTenantId ? ' AND ta.tenant_id = ?' : ''}
        ORDER BY u.name ASC
      `,
      hasAssignmentTenantId ? [taskIds, tenantId] : [taskIds]
    )
    : [];

  const assignmentMap = {};
  const assignmentQueryTime = Date.now();
  (assignments || []).forEach((row) => {
    const key = String(row.task_id);
    if (!assignmentMap[key]) assignmentMap[key] = [];
    const storedDuration = Number(row.user_total_duration || 0);
    const liveTimerRaw = row.user_live_timer ? new Date(row.user_live_timer) : null;
    const assigneeStatus = normalizeTaskLifecycleStatus(row.user_status || 'PENDING');
    let liveTotalSeconds = storedDuration;
    if (assigneeStatus === 'IN_PROGRESS' && liveTimerRaw) {
      const elapsed = Math.max(0, Math.floor((assignmentQueryTime - liveTimerRaw.getTime()) / 1000));
      liveTotalSeconds = storedDuration + elapsed;
    }
    const assigneeDisplayStatus = assigneeStatus === 'APPROVED' ? 'COMPLETED' : assigneeStatus;

    // Deduplicate by user within each task and merge timer/status fields when duplicates exist
    const userKey = String(row._id);
    const existingIndex = assignmentMap[key].findIndex((a) => String(a.internalId) === userKey);
    const newAssignee = {
      id: row.public_id || String(row._id),
      internalId: userKey,
      name: row.name || null,
      email: row.email || null,
      role: row.role || null,
      readOnly: Number(row.is_read_only || 0) === 1,
      status: assigneeDisplayStatus,
      started_at: row.user_started_at ? new Date(row.user_started_at).toISOString() : null,
      live_timer: liveTimerRaw ? liveTimerRaw.toISOString() : null,
      completed_at: row.user_completed_at ? new Date(row.user_completed_at).toISOString() : null,
      total_duration: storedDuration,
      live_total_seconds: liveTotalSeconds,
      live_total_hours: Number((liveTotalSeconds / 3600).toFixed(2)),
      live_total_hhmmss: formatDuration(liveTotalSeconds),
      rejection_reason: row.user_rejection_reason || null
    };

    if (existingIndex === -1) {
      assignmentMap[key].push(newAssignee);
    } else {
      const existing = assignmentMap[key][existingIndex];
      existing.total_duration = Math.max(existing.total_duration || 0, storedDuration);
      existing.live_total_seconds = Math.max(existing.live_total_seconds || 0, liveTotalSeconds);
      existing.live_total_hours = Number((existing.live_total_seconds / 3600).toFixed(2));
      existing.live_total_hhmmss = formatDuration(existing.live_total_seconds);
      if (!existing.started_at && newAssignee.started_at) existing.started_at = newAssignee.started_at;
      if (!existing.live_timer && newAssignee.live_timer) existing.live_timer = newAssignee.live_timer;
      if (!existing.completed_at && newAssignee.completed_at) existing.completed_at = newAssignee.completed_at;
      if (!existing.rejection_reason && newAssignee.rejection_reason) existing.rejection_reason = newAssignee.rejection_reason;
      if (!existing.name && newAssignee.name) existing.name = newAssignee.name;
      if (!existing.email && newAssignee.email) existing.email = newAssignee.email;
      if (!existing.role && newAssignee.role) existing.role = newAssignee.role;
      existing.readOnly = existing.readOnly || newAssignee.readOnly;
      // Prefer more advanced status when merging
      const statusPriority = { 'IN_PROGRESS': 4, 'ON_HOLD': 3, 'REVIEW': 2, 'PENDING': 1, 'TODO': 1, 'COMPLETED': 5, 'APPROVED': 5, 'REJECTED': 1 };
      existing.status = (statusPriority[newAssignee.status] || 0) > (statusPriority[existing.status] || 0) ? newAssignee.status : existing.status;
    }
  });

  const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');

  const reassignmentRows = taskIds.length
    ? await q(
      `
        SELECT r.task_id,
               r.id,
               r.status,
               r.requested_by,
               r.reason,
               r.requested_at,
               r.responded_at,
               r.responded_by,
               requester.name AS requester_name,
               requester.public_id AS requester_public_id,
               responder.name AS responder_name,
               responder.public_id AS responder_public_id
        FROM task_resign_requests r
        LEFT JOIN users requester ON requester._id = r.requested_by
        LEFT JOIN users responder ON responder._id = r.responded_by
        WHERE r.task_id IN (?)
          ${hasReassignmentTenantId ? 'AND r.tenant_id = ?' : ''}
        ORDER BY r.task_id ASC, r.requested_at DESC, r.id DESC
      `,
      hasReassignmentTenantId ? [taskIds, tenantId] : [taskIds]
    )
    : [];

  const latestReassignmentByTask = {};
  const pendingReassignmentByTask = {};
  const pendingByRequesterTask = {};
  (reassignmentRows || []).forEach((row) => {
    const taskKey = String(row.task_id);
    if (!latestReassignmentByTask[taskKey]) {
      latestReassignmentByTask[taskKey] = row;
    }
    if (String(row.status || '').toUpperCase() === 'PENDING') {
      pendingReassignmentByTask[taskKey] = true;
      if (String(row.requested_by) === String(req.user._id)) {
        pendingByRequesterTask[taskKey] = true;
      }
    }
  });

  // Compute can_request_closure for the project if filtered by project
  let canRequestClosure = false;
  if (projectRef && project) {
    const nonCompletedTasks = await q(
      `SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND tenant_id = ? AND UPPER(status) != 'COMPLETED' ${hasTaskDeleted ? 'AND (isDeleted IS NULL OR isDeleted != 1)' : ''}`,
      [project.id, tenantId]
    );
    const nonCompletedCount = Number(nonCompletedTasks[0].count);
    canRequestClosure = nonCompletedCount === 0 && ['Manager', 'Admin', 'SuperAdmin'].includes(req.user.role);
  }

  const shapedTasks = (dataRows || []).map((row) => {
    const taskKey = String(row.id);
    const latestRequest = latestReassignmentByTask[taskKey] || null;
    const hasPending = Boolean(pendingReassignmentByTask[taskKey]);
    const isLockedForUser = Boolean(pendingByRequesterTask[taskKey]);
    const reassignmentDetails = {
      is_locked: isLockedForUser,
      is_locked_for_user: isLockedForUser,
      has_pending: hasPending,
      request_status: latestRequest ? normalizeReassignmentRequestStatus(latestRequest.status) : null,
      request_id: latestRequest ? latestRequest.id : null,
      requested_by: latestRequest ? (latestRequest.requester_public_id || String(latestRequest.requested_by || '')) : null,
      requested_by_internal_id: latestRequest ? latestRequest.requested_by : null,
      requester_name: latestRequest ? (latestRequest.requester_name || null) : null,
      reason: latestRequest ? (latestRequest.reason || null) : null,
      requested_at: latestRequest && latestRequest.requested_at ? new Date(latestRequest.requested_at).toISOString() : null,
      responded_by: latestRequest ? (latestRequest.responder_public_id || (latestRequest.responded_by != null ? String(latestRequest.responded_by) : null)) : null,
      responder_name: latestRequest ? (latestRequest.responder_name || null) : null,
      responded_at: latestRequest && latestRequest.responded_at ? new Date(latestRequest.responded_at).toISOString() : null
    };
    const permissions = buildReassignmentPermissions(req, reassignmentDetails);

    const shapedTask = filterTaskResponseForRole(
      formatTenantTask(row, assignmentMap[taskKey] || [], tenantId),
      req
    );

    return {
      ...shapedTask,
      is_locked: isLockedForUser,
      is_locked_for_user: isLockedForUser,
      has_pending: hasPending,
      request_status: latestRequest ? normalizeReassignmentRequestStatus(latestRequest.status) : null,
      request_id: latestRequest ? latestRequest.id : null,
      lock: {
        is_locked: isLockedForUser,
        locked_for: isLockedForUser ? 'REQUESTER_ONLY' : null
      },
      reassignment: reassignmentDetails,
      permissions: {
        ...permissions,
        can_request_closure: canRequestClosure
      }
    };
  });

  const meta = {
    page,
    limit,
    total,
    totalPages: limit > 0 ? Math.ceil(total / limit) : 0
  };

  const wantKanban = req.query && (req.query.kanban === '1' || req.query.kanban === 'true' || req.query.kanban === 'yes');
  const kanban = { TODO: [], INPROGRESS: [], ONHOLD: [], REVIEW: [], COMPLETED: [] };
  shapedTasks.forEach((t) => {
    const s = normalizeTaskLifecycleStatus(t.status || t.stage || 'PENDING');
    const minimal = minimalKanbanTask(t);
    switch (s) {
      case 'IN_PROGRESS':
        kanban.INPROGRESS.push(minimal); break;
      case 'ON_HOLD':
        kanban.ONHOLD.push(minimal); break;
      case 'REVIEW':
        kanban.REVIEW.push(minimal); break;
      case 'COMPLETED':
        kanban.COMPLETED.push(minimal); break;
      case 'PENDING':
      case 'TO_DO':
      default:
        kanban.TODO.push(minimal); break;
    }
  });

  // Include `kanban` ONLY for EMPLOYEE role
  const messages = canRequestClosure ? ["All tasks completed"] : [];
  let response = { success: true, data: shapedTasks, meta, messages };
  if (req.user.role === "EMPLOYEE") {
      response.kanban = kanban;
  }
  return res.json(response);
}

async function selectedTenantTaskDetails(req, res) {
  const tenantId = assertTenantId(req);
  const taskIds = Array.isArray(req.body.taskIds || req.body.task_ids) ? (req.body.taskIds || req.body.task_ids) : [];
  if (taskIds.length === 0) {
    return res.status(400).json(errorResponse.badRequest('Task IDs array is required', 'INVALID_INPUT', null, 'taskIds'));
  }

  const details = [];
  const seen = new Set();

  for (const taskId of taskIds) {
    const task = await resolveTenantTask(taskId, tenantId);
    if (!task) continue;
    if (seen.has(String(task.id))) continue;
    if (!await canReadTenantTask(task, req)) continue;
    seen.add(String(task.id));
    const loaded = await loadTenantTaskEnvelope(task.id, tenantId, req);
    if (loaded) details.push(loaded);
  }

  return res.json({
    success: true,
    data: details,
    meta: { count: details.length }
  });
}

async function createTenantTask(req, res) {
  const tenantId = assertTenantId(req);
  const title = String(req.body.title || '').trim();
  const description = req.body.description || null;
  const priority = normalizeTaskPriority(req.body.priority);
  const requestedStatus = normalizeTaskLifecycleStatus(req.body.status || req.body.stage || 'PENDING');
  const assigneeRefs = parseTaskAssigneeRefs(req.body);
  const dueDate = req.body.taskDate || req.body.dueDate || null;
  const timeAlloted = req.body.time_alloted ?? req.body.timeAlloted ?? req.body.estimatedHours ?? null;
  const projectRef = req.body.project_id || req.body.projectId || req.body.projectPublicId || null;
  const clientRef = req.body.client_id || req.body.clientId || null;

  if (!title) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }

  if (!['PENDING', 'IN_PROGRESS'].includes(requestedStatus)) {
    return res.status(400).json({ success: false, error: 'Only PENDING or IN_PROGRESS are supported on task creation' });
  }

  if (assigneeRefs.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one assignee is required' });
  }

  const project = projectRef ? await resolveTenantProject(projectRef, tenantId) : null;
  if (projectRef && !project) {
    return res.status(404).json({ success: false, error: 'Project not found' });
  }
  if (project) {
    await ensureProjectOpen(project.id);
  }

  let client = clientRef ? await resolveTenantClient(clientRef, tenantId) : null;
  if (clientRef && !client) {
    return res.status(404).json({ success: false, error: 'Client not found' });
  }
  if (!client && project && project.client_id) {
    client = await resolveTenantClient(project.client_id, tenantId);
  }
  if (!client) {
    return res.status(400).json({ success: false, error: 'client_id or a project with a valid client is required' });
  }
  if (project && client && String(project.client_id) !== String(client.id)) {
    return res.status(400).json({ success: false, error: 'client_id does not belong to the selected project' });
  }

  const assignees = await resolveTenantUsers(assigneeRefs, tenantId);
  const assigneeIds = assignees.map((item) => item._id);
  const taskPublicId = buildTaskPublicId();
  const now = new Date();
  const nowSql = toMySQLDate(now);

  const connection = await getConnectionAsync();
  try {
    await beginTransactionAsync(connection);

    const taskColumns = ['public_id', 'title', 'description', 'priority', 'stage', 'status', 'taskDate', 'time_alloted', 'createdAt', 'updatedAt', 'client_id'];
    const taskValues = [
      taskPublicId,
      title,
      description,
      priority,
      taskStageToDb(requestedStatus),
      taskStatusToDb(requestedStatus),
      toMySQLDate(dueDate),
      timeAlloted,
      nowSql,
      nowSql,
      client.id
    ];

    if (await hasColumn('tasks', 'estimated_hours')) {
      taskColumns.push('estimated_hours');
      taskValues.push(timeAlloted);
    }
    if (await hasColumn('tasks', 'project_id')) {
      taskColumns.push('project_id');
      taskValues.push(project ? project.id : null);
    }
    if (project && await hasColumn('tasks', 'project_public_id')) {
      taskColumns.push('project_public_id');
      taskValues.push(project.public_id || null);
    }
    if (await hasColumn('tasks', 'tenant_id')) {
      taskColumns.push('tenant_id');
      taskValues.push(tenantId);
    }
    if (await hasColumn('tasks', 'assigned_to')) {
      taskColumns.push('assigned_to');
      taskValues.push(JSON.stringify(assigneeIds));
    }
    if (requestedStatus === 'IN_PROGRESS' && await hasColumn('tasks', 'started_at')) {
      taskColumns.push('started_at');
      taskValues.push(nowSql);
    }
    if (requestedStatus === 'IN_PROGRESS' && await hasColumn('tasks', 'live_timer')) {
      taskColumns.push('live_timer');
      taskValues.push(nowSql);
    }

    const taskResult = await qConn(
      connection,
      `INSERT INTO tasks (${taskColumns.join(', ')}) VALUES (${taskColumns.map(() => '?').join(', ')})`,
      taskValues
    );

    const taskId = taskResult.insertId;
    // Assign all users and set their status to match the task status
    await syncTenantTaskAssignments(connection, taskId, tenantId, assigneeIds);
    // Force all assignee statuses to match the task status
    await ensureTaskAssignmentStatusTable();
    await qConn(
      connection,
      `UPDATE task_assignment_status SET status = ? WHERE task_id = ? AND tenant_id = ?`,
      [requestedStatus, taskId, tenantId]
    );

    if (project && project.status === 'PLANNING') {
      await qConn(connection, 'UPDATE projects SET status = ? WHERE id = ? AND tenant_id = ?', ['ACTIVE', project.id, tenantId]);
    }

    if (requestedStatus === 'IN_PROGRESS') {
      await ensureTaskTimeLogsTable();
      try {
        await qConn(
          connection,
          'INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp) VALUES (?, ?, \'event\', ?, ?)',
          [taskId, req.user._id, 'start', nowSql]
        );
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }
    }

    await commitTransactionAsync(connection);

    await sendTenantTaskNotifications(
      assigneeIds,
      'Task Assigned',
      `You have been assigned to task "${title}"`,
      'TASK_ASSIGNED',
      taskPublicId,
      tenantId
    );

    const taskResponse = await loadTenantTaskEnvelope(taskId, tenantId, req);
    return res.status(201).json({
      success: true,
      message: 'Task created successfully',
      data: taskResponse
    });
  } catch (error) {
    await rollbackTransactionAsync(connection);
    throw error;
  } finally {
    connection.release();
  }
}

async function updateTenantTask(req, res) {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId, { includeDeleted: true });
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  if (task.project_id) {
    await ensureProjectOpen(task.project_id);
  }

  const hasAssigneePayload = ['assigned_to', 'assignedTo', 'assignees', 'assignee_ids', 'assigneeIds', 'userIds']
    .some((key) => Object.prototype.hasOwnProperty.call(req.body, key));
  const assigneeRefs = hasAssigneePayload ? parseTaskAssigneeRefs(req.body) : [];
  if (hasAssigneePayload && assigneeRefs.length === 0) {
    return res.status(400).json({ success: false, error: 'At least one assignee is required' });
  }

  const assignees = hasAssigneePayload ? await resolveTenantUsers(assigneeRefs, tenantId) : [];
  const assigneeIds = assignees.map((item) => item._id);
  const taskUpdates = [];
  const values = [];
  const taskHasTenantId = await hasColumn('tasks', 'tenant_id');
  const taskHasEstimatedHours = await hasColumn('tasks', 'estimated_hours');
  const taskHasAssignedTo = await hasColumn('tasks', 'assigned_to');
  const taskHasUpdatedAt = await hasColumn('tasks', 'updatedAt');
  const taskHasProjectId = await hasColumn('tasks', 'project_id');
  const taskHasProjectPublicId = await hasColumn('tasks', 'project_public_id');

  if (Object.prototype.hasOwnProperty.call(req.body, 'title')) {
    taskUpdates.push('title = ?');
    values.push(String(req.body.title || '').trim());
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'description')) {
    taskUpdates.push('description = ?');
    values.push(req.body.description || null);
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'priority')) {
    taskUpdates.push('priority = ?');
    values.push(normalizeTaskPriority(req.body.priority));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'taskDate') || Object.prototype.hasOwnProperty.call(req.body, 'dueDate')) {
    taskUpdates.push('taskDate = ?');
    values.push(toMySQLDate(req.body.taskDate || req.body.dueDate || null));
  }
  if (Object.prototype.hasOwnProperty.call(req.body, 'time_alloted') ||
      Object.prototype.hasOwnProperty.call(req.body, 'timeAlloted') ||
      Object.prototype.hasOwnProperty.call(req.body, 'estimatedHours')) {
    const timeAlloted = req.body.time_alloted ?? req.body.timeAlloted ?? req.body.estimatedHours ?? null;
    taskUpdates.push('time_alloted = ?');
    values.push(timeAlloted);
    if (taskHasEstimatedHours) {
      taskUpdates.push('estimated_hours = ?');
      values.push(timeAlloted);
    }
  }

  const requestedStatus = req.body.status || req.body.stage;
  if (requestedStatus !== undefined) {
    const normalizedStatus = normalizeTaskLifecycleStatus(requestedStatus);
    taskUpdates.push('status = ?');
    values.push(taskStatusToDb(normalizedStatus));
    taskUpdates.push('stage = ?');
    values.push(taskStageToDb(normalizedStatus));
  }

  const projectRef = req.body.project_id || req.body.projectId || req.body.projectPublicId;
  let project = null;
  if (projectRef !== undefined && projectRef !== null && projectRef !== '') {
    project = await resolveTenantProject(projectRef, tenantId);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    await ensureProjectOpen(project.id);
    if (taskHasProjectId) {
      taskUpdates.push('project_id = ?');
      values.push(project.id);
    }
    if (taskHasProjectPublicId) {
      taskUpdates.push('project_public_id = ?');
      values.push(project.public_id || null);
    }
  }

  const clientRef = req.body.client_id || req.body.clientId;
  let client = null;
  if (clientRef !== undefined && clientRef !== null && clientRef !== '') {
    client = await resolveTenantClient(clientRef, tenantId);
    if (!client) return res.status(404).json({ success: false, error: 'Client not found' });
  } else if (project && project.client_id) {
    client = await resolveTenantClient(project.client_id, tenantId);
  }
  if (client) {
    taskUpdates.push('client_id = ?');
    values.push(client.id);
  }

  if (hasAssigneePayload && taskHasAssignedTo) {
    taskUpdates.push('assigned_to = ?');
    values.push(JSON.stringify(assigneeIds));
  }

  if (taskHasUpdatedAt) {
    taskUpdates.push('updatedAt = ?');
    values.push(toMySQLDate(new Date()));
  }

  if (taskUpdates.length === 0 && !hasAssigneePayload) {
    return res.status(400).json({ success: false, error: 'No fields to update' });
  }

  const connection = await getConnectionAsync();
  try {
    await beginTransactionAsync(connection);

    if (taskUpdates.length > 0) {
      await qConn(
        connection,
        `UPDATE tasks SET ${taskUpdates.join(', ')} WHERE id = ?${taskHasTenantId ? ' AND tenant_id = ?' : ''}`,
        taskHasTenantId ? [...values, task.id, tenantId] : [...values, task.id]
      );
    }


    if (hasAssigneePayload) {
      // addOnly: preserve existing assignees' status/checklists; only add new users
      await syncTenantTaskAssignments(connection, task.id, tenantId, assigneeIds, { mode: 'addOnly' });
    }

    // Always force all assignee statuses to match the main task status if status is being updated
    if (requestedStatus !== undefined) {
      await ensureTaskAssignmentStatusTable();
      await qConn(
        connection,
        `UPDATE task_assignment_status SET status = ? WHERE task_id = ? AND tenant_id = ?`,
        [normalizeTaskLifecycleStatus(requestedStatus), task.id, tenantId]
      );
    }

    await commitTransactionAsync(connection);

    if (hasAssigneePayload) {
      await sendTenantTaskNotifications(
        assigneeIds,
        'Task Reassigned',
        `Task "${req.body.title || task.title}" has updated assignees`,
        'TASK_REASSIGNED',
        task.public_id || String(task.id),
        tenantId
      );
    }

    const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
    return res.json({
      success: true,
      message: 'Task updated successfully',
      data: taskResponse
    });
  } catch (error) {
    await rollbackTransactionAsync(connection);
    throw error;
  } finally {
    connection.release();
  }
}

async function applyTenantTaskStatus(req, res, statusOverride) {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId);
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const requestedStatus = normalizeTaskLifecycleStatus(statusOverride || req.body.status || req.body.action);
  const comments = (req.body.comments || req.body.comment || req.body.reason || '').trim();
  const managementAction = requestedStatus === 'APPROVED' || requestedStatus === 'REJECTED';

  if (!requestedStatus) {
    return res.status(400).json({ success: false, error: 'status is required' });
  }

  await ensureTaskAssignmentReviewColumns();

  // ── LOCK CHECK: Block non-management actions if task is locked ──────────────
  if (!managementAction) {
    // Restrict only requester when their reassignment request is pending.
    const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');
    const pendingRows = await new Promise((resolve, reject) =>
      db.query(
        `SELECT id FROM task_resign_requests
         WHERE task_id = ? AND requested_by = ? AND status = "PENDING"
         ${hasReassignmentTenantId ? 'AND tenant_id = ?' : ''}
         LIMIT 1`,
        hasReassignmentTenantId ? [task.id, req.user._id, tenantId] : [task.id, req.user._id],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      )
    );
    const isLockedForUser = pendingRows.length > 0;

    if (isLockedForUser) {
      return res.status(423).json({
        success: false,
        error: 'You already requested reassignment. Action restricted.',
        is_locked_for_user: true,
        has_pending_request: true,
        code: 'TASK_LOCKED_FOR_REQUESTER',
        lock: {
          is_locked: true,
          locked_for: 'REQUESTER_ONLY'
        }
      });
    }
  }

  if (managementAction && !canManageTenantTasks(req.user.role)) {
    return res.status(403).json({ success: false, error: 'Only tenant admins and managers can approve or reject tasks' });
  }

  if (!managementAction && !await canWriteTenantTask(task, req)) {
    return res.status(403).json({ success: false, error: 'You do not have permission to update this task' });
  }

  if (requestedStatus === 'REJECTED' && !comments) {
    return res.status(400).json({ success: false, error: 'Comments are required when rejecting a task' });
  }

  await ensureTaskTimeLogsTable();
  await ensureTaskAssignmentStatusTable();

  const now = new Date();
  const nowSql = toMySQLDate(now);
  const taskHasTenantId = await hasColumn('tasks', 'tenant_id');
  const taskHasUpdatedAt = await hasColumn('tasks', 'updatedAt');
  const taskHasStartedAt = await hasColumn('tasks', 'started_at');
  const taskHasLiveTimer = await hasColumn('tasks', 'live_timer');
  const taskHasCompletedAt = await hasColumn('tasks', 'completed_at');
  const taskHasTotalDuration = await hasColumn('tasks', 'total_duration');
  const taskHasApprovedBy = await hasColumn('tasks', 'approved_by');
  const taskHasApprovedAt = await hasColumn('tasks', 'approved_at');
  const taskHasRejectionReason = await hasColumn('tasks', 'rejection_reason');
  const taskHasRejectedBy = await hasColumn('tasks', 'rejected_by');
  const taskHasRejectedAt = await hasColumn('tasks', 'rejected_at');
  const assignmentHasReadOnly = await hasColumn('task_assignments', 'is_read_only');
  const taskAssignees = await loadTaskAssignmentsForTenant(task.id, tenantId);
  const recipientIds = [...new Set(taskAssignees.map((item) => Number(item.internalId)).filter(Boolean))];

  // ─── MANAGEMENT ACTIONS (approve / reject): operate on global task status ────
  if (managementAction) {
    const writableAssignees = (taskAssignees || []).filter((assignee) => !assignee.readOnly);
    const writableStatuses = writableAssignees.map((assignee) => normalizeTaskLifecycleStatus(assignee.status || 'PENDING'));
    const allCompleted = writableStatuses.length > 0 && writableStatuses.every((status) => status === 'COMPLETED' || status === 'APPROVED');
    const anyCompleted = writableStatuses.some((status) => status === 'COMPLETED' || status === 'APPROVED');
    const approvalRule = normalizeApprovalRule(
      req.body.approval_rule ||
      req.body.approvalRule ||
      req.query.approval_rule ||
      req.query.approvalRule ||
      req.headers['x-approval-rule'] ||
      process.env.TASK_APPROVAL_RULE
    );

    if (requestedStatus === 'APPROVED') {
      const canApprove = approvalRule === 'ANY_COMPLETED' ? anyCompleted : allCompleted;
      if (!canApprove) {
        return res.status(400).json({
          success: false,
          error: approvalRule === 'ANY_COMPLETED'
            ? 'At least one assignee must complete work before approval'
            : 'All assignees must complete work before approval'
        });
      }
    }

    const connection = await getConnectionAsync();
    try {
      await beginTransactionAsync(connection);

      const taskUpdates = ['status = ?', 'stage = ?'];
      const updateValues = [taskStatusToDb(requestedStatus), taskStageToDb(requestedStatus)];

      if (taskHasUpdatedAt) { taskUpdates.push('updatedAt = ?'); updateValues.push(nowSql); }

      if (requestedStatus === 'APPROVED') {
        if (taskHasApprovedBy) { taskUpdates.push('approved_by = ?'); updateValues.push(req.user._id); }
        if (taskHasApprovedAt) { taskUpdates.push('approved_at = ?'); updateValues.push(nowSql); }
        if (taskHasRejectionReason) taskUpdates.push('rejection_reason = NULL');
        if (taskHasRejectedBy) taskUpdates.push('rejected_by = NULL');
        if (taskHasRejectedAt) taskUpdates.push('rejected_at = NULL');

        // Mark all assignment statuses as COMPLETED (changed from APPROVED as per requirement)
        await qConn(
          connection,
          `UPDATE task_assignment_status
           SET status = 'COMPLETED',
               approved_at = ?,
               review_requested = 0,
               review_requested_at = NULL,
               last_review_reminder_at = NULL,
               updated_at = NOW()
           WHERE task_id = ?`,
          [nowSql, task.id]
        );
      }

      if (requestedStatus === 'REJECTED') {
        if (taskHasRejectionReason) { taskUpdates.push('rejection_reason = ?'); updateValues.push(comments); }
        if (taskHasRejectedBy) { taskUpdates.push('rejected_by = ?'); updateValues.push(req.user._id); }
        if (taskHasRejectedAt) { taskUpdates.push('rejected_at = ?'); updateValues.push(nowSql); }
        if (taskHasApprovedBy) taskUpdates.push('approved_by = NULL');
        if (taskHasApprovedAt) taskUpdates.push('approved_at = NULL');

        // Reset writable assignment statuses back to IN_PROGRESS so assignees can re-work.
        await qConn(
          connection,
          `UPDATE task_assignment_status tas
           INNER JOIN task_assignments ta ON ta.task_id = tas.task_id AND ta.user_id = tas.user_id
           SET tas.status = 'IN_PROGRESS',
               tas.rejection_reason = ?,
               tas.rejected_at = ?,
               tas.review_requested = 0,
               tas.review_requested_at = NULL,
               tas.last_review_reminder_at = NULL,
               tas.approved_at = NULL,
               tas.updated_at = NOW()
           WHERE tas.task_id = ?${assignmentHasReadOnly ? ' AND (ta.is_read_only IS NULL OR ta.is_read_only != 1)' : ''}`,
          [comments, nowSql, task.id]
        );
      }

      await qConn(
        connection,
        `UPDATE tasks SET ${taskUpdates.join(', ')} WHERE id = ?${taskHasTenantId ? ' AND tenant_id = ?' : ''}`,
        taskHasTenantId ? [...updateValues, task.id, tenantId] : [...updateValues, task.id]
      );

      await commitTransactionAsync(connection);
    } catch (error) {
      await rollbackTransactionAsync(connection);
      throw error;
    } finally {
      connection.release();
    }

    await sendTenantTaskNotifications(
      recipientIds,
      'Task Status Updated',
      `Task "${task.title}" has been ${requestedStatus === 'APPROVED' ? 'approved' : 'rejected'}`,
      'TASK_STATUS_CHANGED',
      task.public_id || String(task.id),
      tenantId
    );

    const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
    return res.json({ success: true, message: `Task ${requestedStatus === 'APPROVED' ? 'approved' : 'rejected'}`, data: taskResponse });
  }

  // ─── EMPLOYEE ACTIONS: operate on per-user assignment status ─────────────────
  // Resolve the requesting user's current assignment status
  const userAssignment = taskAssignees.find((a) => String(a.internalId) === String(req.user._id));
  if (!userAssignment) {
    return res.status(403).json({ success: false, error: 'You are not assigned to this task' });
  }

  const currentUserStatus = normalizeTaskLifecycleStatus(userAssignment.status || 'PENDING');
  const allowedUserTransitions = {
    PENDING: ['TODO', 'IN_PROGRESS'],
    IN_PROGRESS: ['ON_HOLD', 'REVIEW'],
    ON_HOLD: ['IN_PROGRESS'],
    REVIEW: ['IN_PROGRESS'],
    COMPLETED: [],
    APPROVED: [],
    REJECTED: ['IN_PROGRESS'],
    TODO: ['IN_PROGRESS']
  };
  const nextUserStatuses = allowedUserTransitions[currentUserStatus] || [];

  // If the requested status equals the current user assignment status, treat as no-op and return current task envelope
  if (requestedStatus === currentUserStatus) {
    const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
    return res.json({ success: true, message: 'Status unchanged', data: taskResponse });
  }

  if (requestedStatus === 'COMPLETED' || requestedStatus === 'APPROVED') {
    return res.status(400).json({
      success: false,
      error: 'Employees cannot move tasks directly to COMPLETED or APPROVED. Move the task to REVIEW and wait for manager approval.',
      code: 'TASK_FLOW_RESTRICTED',
      allowed_flow: 'TODO -> IN_PROGRESS -> ON_HOLD -> IN_PROGRESS -> REVIEW -> (Manager APPROVES) -> COMPLETED'
    });
  }

  if (!nextUserStatuses.includes(requestedStatus)) {
    return res.status(400).json({
      success: false,
      error: `Invalid transition from ${currentUserStatus} to ${requestedStatus}. Allowed next states: ${nextUserStatuses.join(', ') || 'None'}`,
      code: 'INVALID_TASK_FLOW_TRANSITION',
      allowed_next_states: nextUserStatuses,
      required_flow: 'TODO -> IN_PROGRESS -> ON_HOLD -> IN_PROGRESS -> REVIEW -> (Manager APPROVES) -> COMPLETED'
    });
  }

  const connection = await getConnectionAsync();
  try {
    await beginTransactionAsync(connection);
    logger.info('[TASK REVIEW DEBUG] Status change request payload: ' + JSON.stringify({
      taskId: task.id,
      taskPublicId: task.public_id || null,
      requestedStatus,
      userId: req.user._id,
      role: req.user.role,
      tenantId,
      comment: comments || null
    }));

    // Build per-user assignment status update
    const assignUpdates = ['status = ?', 'updated_at = NOW()'];
    const assignmentStatusValue = requestedStatus === 'REVIEW' ? 'IN_REVIEW' : requestedStatus;
    const assignValues = [assignmentStatusValue];
    await qConn(
      connection,
      `INSERT IGNORE INTO task_assignment_status (task_id, user_id, tenant_id, status, total_duration)
       VALUES (?, ?, ?, ?, ?)`,
      [task.id, req.user._id, tenantId, currentUserStatus, Number(userAssignment.total_duration || 0)]
    );

    const statusRows = await qConn(
      connection,
      'SELECT live_timer, total_duration FROM task_assignment_status WHERE task_id = ? AND user_id = ? LIMIT 1',
      [task.id, req.user._id]
    );
    const currentAssignmentState = statusRows && statusRows.length ? statusRows[0] : null;
    const activeLiveTimer = currentAssignmentState && currentAssignmentState.live_timer
      ? new Date(currentAssignmentState.live_timer)
      : (userAssignment && userAssignment.live_timer ? new Date(userAssignment.live_timer) : null);

    if (requestedStatus === 'IN_PROGRESS') {
      assignUpdates.push('started_at = COALESCE(started_at, ?)');
      assignValues.push(nowSql);
      // Only set live_timer if it is not already running for this assignment
      assignUpdates.push('live_timer = COALESCE(live_timer, ?)');
      assignValues.push(nowSql);
      assignUpdates.push('review_requested = 0');
      assignUpdates.push('review_requested_at = NULL');
      assignUpdates.push('last_review_reminder_at = NULL');
      if (currentUserStatus === 'REJECTED') {
        assignUpdates.push('completed_at = NULL');
        assignUpdates.push('rejected_at = NULL');
        assignUpdates.push('rejection_reason = NULL');
      }
      const [lastActionRow] = await qConn(
        connection,
        'SELECT action FROM task_time_entries WHERE task_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 1',
        [task.id, req.user._id]
      );
      const expectedAction = currentUserStatus === 'ON_HOLD' ? 'resume' : 'start';
      if (!activeLiveTimer || !lastActionRow || String(lastActionRow.action || '').toLowerCase() !== expectedAction) {
        try {
          await qConn(
            connection,
            'INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp) VALUES (?, ?, \'event\', ?, ?)',
            [task.id, req.user._id, expectedAction, nowSql]
          );
        } catch (e) {
          const msg = (e && e.message) || '';
          if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
            logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
          } else {
            throw e;
          }
        }
      }
    }

    if (requestedStatus === 'ON_HOLD' || requestedStatus === 'COMPLETED') {
      let duration = 0;
      // Consume elapsed time from live_timer if it is set.
      const lastLive = activeLiveTimer;
      if (lastLive && !Number.isNaN(lastLive.getTime())) {
        duration = Math.max(0, Math.floor((now.getTime() - lastLive.getTime()) / 1000));
      }
      // Accumulate into per-assignment total_duration and clear live_timer
      assignUpdates.push('total_duration = COALESCE(total_duration, 0) + ?');
      assignValues.push(duration);
      assignUpdates.push('live_timer = NULL');
      assignUpdates.push('review_requested = 0');
      assignUpdates.push('review_requested_at = NULL');
      assignUpdates.push('last_review_reminder_at = NULL');

      if (requestedStatus === 'COMPLETED') {
        assignUpdates.push('completed_at = ?');
        assignValues.push(nowSql);
      }
      if (lastLive) {
        try {
          await qConn(
            connection,
            'INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds) VALUES (?, ?, \'event\', ?, ?, ?)',
            [task.id, req.user._id, requestedStatus === 'COMPLETED' ? 'complete' : 'pause', nowSql, duration]
          );
        } catch (e) {
          const msg = (e && e.message) || '';
          if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
            logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
          } else {
            throw e;
          }
        }
      }
    }

    if (requestedStatus === 'REVIEW') {
      let duration = 0;
      const lastLive = activeLiveTimer;
      if (lastLive && !Number.isNaN(lastLive.getTime())) {
        duration = Math.max(0, Math.floor((now.getTime() - lastLive.getTime()) / 1000));
      }
      assignUpdates.push('total_duration = COALESCE(total_duration, 0) + ?');
      assignValues.push(duration);
      assignUpdates.push('live_timer = NULL');
      assignUpdates.push('review_requested = 1');
      assignUpdates.push('review_requested_at = ?');
      assignValues.push(nowSql);
      assignUpdates.push('last_review_reminder_at = NULL');
      if (lastLive) {
        try {
          await qConn(
            connection,
            'INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds) VALUES (?, ?, \'event\', ?, ?, ?)',
            [task.id, req.user._id, 'review', nowSql, duration]
          );
        } catch (e) {
          const msg = (e && e.message) || '';
          if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
            logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
          } else {
            throw e;
          }
        }
      }
    }

    if (requestedStatus === 'TODO') {
      assignUpdates.push('started_at = NULL');
      assignUpdates.push('live_timer = NULL');
      assignUpdates.push('completed_at = NULL');
      assignUpdates.push('total_duration = 0');
      assignUpdates.push('review_requested = 0');
      assignUpdates.push('review_requested_at = NULL');
      assignUpdates.push('last_review_reminder_at = NULL');
      try {
        await qConn(
          connection,
          'INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp) VALUES (?, ?, \'event\', ?, ?)',
          [task.id, req.user._id, 'reset', nowSql]
        );
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }
    }

    const assignmentUpdateResult = await qConn(
      connection,
      `UPDATE task_assignment_status SET ${assignUpdates.join(', ')} WHERE task_id = ? AND user_id = ?`,
      [...assignValues, task.id, req.user._id]
    );
    logger.info('[TASK REVIEW DEBUG] Assignment update result: ' + JSON.stringify({
      affectedRows: assignmentUpdateResult && assignmentUpdateResult.affectedRows,
      changedRows: assignmentUpdateResult && assignmentUpdateResult.changedRows,
      assignmentStatusValue
    }));

    // Handle workflow request for REVIEW status
    let workflowMessage = null;
    let workflowData = {};
    if (requestedStatus === 'REVIEW') {
      try {
        const transitionResult = await workflowService.requestTransition({
          tenantId,
          entityType: 'TASK',
          entityId: task.id,
          toState: 'REVIEW',
          userId: req.user._id,
          role: req.user.role,
          projectId: task.project_id,
          meta: { reason: comments || 'Employee requesting task review', comment: comments || null },
          connection
        });
        logger.info('[TASK REVIEW DEBUG] Workflow insert result: ' + JSON.stringify({
          requestId: transitionResult && transitionResult.requestId,
          workflowId: transitionResult && transitionResult.workflowId,
          created: Boolean(transitionResult && (transitionResult.requestId || transitionResult.workflowId))
        }));
        if (transitionResult && transitionResult.requestId) {
          workflowMessage = 'Review requested — sent for manager approval';
          workflowData = { requestId: transitionResult.requestId, workflowId: transitionResult.workflowId || null };
        }
      } catch (workflowError) {
        logger.error('[TASK REVIEW DEBUG] Workflow request failed for REVIEW status:', workflowError.message);
        throw workflowError;
      }
    }

    // ── Also keep global task fields in sync for backward-compat timers ─────────
    const globalTaskUpdates = [];
    const globalValues = [];
    if (taskHasUpdatedAt) { globalTaskUpdates.push('updatedAt = ?'); globalValues.push(nowSql); }

    const allStatuses = taskAssignees
      .filter((a) => !a.readOnly)
      .map((a) => String(a.internalId) === String(req.user._id) ? requestedStatus : normalizeTaskLifecycleStatus(a.status || 'PENDING'));

    const allDone = allStatuses.length > 0 && allStatuses.every((s) => s === 'COMPLETED');
    // Task lifecycle now lives at assignment level; only keep updatedAt in sync on tasks.

    if (globalTaskUpdates.length > 0) {
      await qConn(
        connection,
        `UPDATE tasks SET ${globalTaskUpdates.join(', ')} WHERE id = ?${taskHasTenantId ? ' AND tenant_id = ?' : ''}`,
        taskHasTenantId ? [...globalValues, task.id, tenantId] : [...globalValues, task.id]
      );
    }

    await commitTransactionAsync(connection);

    if (requestedStatus === 'REVIEW') {
      await NotificationService.createAndSendToRoles(
        ['Manager', 'Admin'],
        'Review Requested',
        `Employee ${req.user.name || 'A user'} has requested review for task "${task.title}"`,
        'TASK_REVIEW_REQUESTED',
        'task',
        task.public_id || String(task.id),
        tenantId
      );
      await taskWorkflowAutomationService.sendReviewRequestNotification({
        task,
        requester: req.user,
        tenantId
      }).catch((error) => {
        logger.warn(`Review request email workflow failed for task=${task.id}: ${error.message}`);
      });
    }

    await sendTenantTaskNotifications(
      recipientIds,
      'Task Status Updated',
      `Task "${task.title}" — ${req.user.name || 'A user'} moved to ${taskStatusToDb(requestedStatus)}`,
      'TASK_STATUS_CHANGED',
      task.public_id || String(task.id),
      tenantId
    );

    if (allDone) {
      await NotificationService.createAndSendToRoles(
        ['Manager', 'Admin'],
        'Task Ready For Review',
        `All assignees on task "${task.title}" have completed their work. It is awaiting review.`,
        'TASK_REVIEW_REQUESTED',
        'task',
        task.public_id || String(task.id),
        tenantId
      );
    }

    const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
    const responseMessage = workflowMessage || `Your status on this task moved to ${taskStatusToDb(requestedStatus)}`;
    const responseData = { ...taskResponse };
    if (Object.keys(workflowData).length > 0) {
      responseData.workflow = workflowData;
    }
    return res.json({
      success: true,
      message: responseMessage,
      data: responseData
    });
  } catch (error) {
    await rollbackTransactionAsync(connection);
    throw error;
  } finally {
    connection.release();
  }
}

async function getTenantTaskTimeline(req, res) {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId, { includeDeleted: true });
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  if (!await canReadTenantTask(task, req)) {
    return res.status(403).json({ success: false, error: 'You do not have access to this task timeline' });
  }

  await ensureTaskTimeLogsTable();
  await ensureTaskActivitiesTable();

  const logSql = isEmployeeRole(req.user.role)
    ? 'SELECT id, user_id, action, timestamp, duration_seconds AS duration FROM task_time_entries WHERE task_id = ? AND user_id = ? ORDER BY timestamp DESC'
    : 'SELECT id, user_id, action, timestamp, duration_seconds AS duration FROM task_time_entries WHERE task_id = ? ORDER BY timestamp DESC';
  const logParams = isEmployeeRole(req.user.role) ? [task.id, req.user._id] : [task.id];
  const logs = await q(logSql, logParams);
  const activities = await q(
    'SELECT id, task_id, user_id, type, activity_text AS activity, created_at AS createdAt FROM task_logs WHERE task_id = ? ORDER BY created_at DESC',
    [task.id]
  );

  return res.json({
    success: true,
    data: {
      taskId: task.public_id || String(task.id),
      logs,
      activities
    }
  });
}

async function getTenantReassignmentCandidates(req, res) {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId, { includeDeleted: true });
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  if (!await canReadTenantTask(task, req)) {
    return res.status(403).json({ success: false, error: 'You do not have access to this task' });
  }

  const users = await loadEligibleReassignmentCandidates(task, tenantId);
  return res.json({
    success: true,
    data: (users || []).map((user) => ({
      id: user.public_id || String(user._id),
      internalId: String(user._id),
      public_id: user.public_id || null,
      name: user.name || null,
      email: user.email || null,
      phone: user.phone || null,
      title: user.title || null,
      role: user.role || null,
      departmentPublicId: user.department_public_id || null,
      departmentName: user.department_name || null
    })),
    meta: {
      count: Array.isArray(users) ? users.length : 0
    }
  });
}

async function getTenantTaskDropdown(req, res) {
  const tenantId = assertTenantId(req);
  const hasTaskTenantId = await hasColumn('tasks', 'tenant_id');
  const hasTaskDeleted = await hasColumn('tasks', 'isDeleted');
  const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
  const where = ['1 = 1'];
  const params = [];

  if (hasTaskTenantId) {
    where.push('t.tenant_id = ?');
    params.push(tenantId);
  }
  if (hasTaskDeleted) {
    where.push('(t.isDeleted IS NULL OR t.isDeleted != 1)');
  }
  if (req.viewerMappedClientId) {
    where.push('t.client_id = ?');
    params.push(req.viewerMappedClientId);
  } else if (isEmployeeRole(req.user.role)) {
    where.push(`EXISTS (
      SELECT 1 FROM task_assignments ta
      WHERE ta.task_id = t.id
        AND ta.user_id = ?
        ${hasAssignmentTenantId ? 'AND ta.tenant_id = ?' : ''}
    )`);
    params.push(req.user._id);
    if (hasAssignmentTenantId) params.push(tenantId);
  }

  const rows = await q(
    `SELECT t.id, t.public_id, t.title FROM tasks t WHERE ${where.join(' AND ')} ORDER BY t.title ASC`,
    params
  );

  return res.status(200).json((rows || []).map((row) => ({
    id: row.public_id || String(row.id),
    internalId: String(row.id),
    title: row.title
  })));
}

async function getTenantTaskHourDropdown(req, res) {
  const tenantId = assertTenantId(req);
  let requestedUserId = req.query.user_id || req.query.userId || req.user._id;

  if (!canManageTenantTasks(req.user.role)) {
    requestedUserId = req.user._id;
  }

  const resolvedUser = await resolveTenantUser(requestedUserId, tenantId);
  if (!resolvedUser) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
  const hasTaskTenantId = await hasColumn('tasks', 'tenant_id');
  const hasTaskDeleted = await hasColumn('tasks', 'isDeleted');
  const rows = await q(
    `
      SELECT t.id, t.public_id, t.title
      FROM tasks t
      JOIN task_assignments ta ON ta.task_id = t.id
      WHERE ta.user_id = ?
        ${hasAssignmentTenantId ? 'AND ta.tenant_id = ?' : ''}
        ${hasTaskTenantId ? 'AND t.tenant_id = ?' : ''}
        ${hasTaskDeleted ? 'AND (t.isDeleted IS NULL OR t.isDeleted != 1)' : ''}
      ORDER BY t.title ASC
    `,
    hasAssignmentTenantId && hasTaskTenantId
      ? [resolvedUser._id, tenantId, tenantId]
      : hasAssignmentTenantId
        ? [resolvedUser._id, tenantId]
        : hasTaskTenantId
          ? [resolvedUser._id, tenantId]
          : [resolvedUser._id]
  );

  return res.status(200).json((rows || []).map((row) => ({
    id: row.public_id || String(row.id),
    internalId: String(row.id),
    title: row.title
  })));
}

async function deleteTenantTask(req, res) {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId, { includeDeleted: true });
  if (!task) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const hasTaskTenantId = await hasColumn('tasks', 'tenant_id');
  const hasTaskDeleted = await hasColumn('tasks', 'isDeleted');
  const hasTaskUpdatedAt = await hasColumn('tasks', 'updatedAt');
  const connection = await getConnectionAsync();
  await ensureTaskActivitiesTable();

  try {
    await beginTransactionAsync(connection);

    if (hasTaskDeleted) {
      await qConn(
        connection,
        `UPDATE tasks SET isDeleted = 1${hasTaskUpdatedAt ? ', updatedAt = ?' : ''} WHERE id = ?${hasTaskTenantId ? ' AND tenant_id = ?' : ''}`,
        hasTaskTenantId
          ? (hasTaskUpdatedAt ? [toMySQLDate(new Date()), task.id, tenantId] : [task.id, tenantId])
          : (hasTaskUpdatedAt ? [toMySQLDate(new Date()), task.id] : [task.id])
      );
    } else {
      const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
      await qConn(
        connection,
        `DELETE FROM task_assignments WHERE task_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}`,
        hasAssignmentTenantId ? [task.id, tenantId] : [task.id]
      );
      await qConn(connection, 'DELETE FROM subtasks WHERE task_id = ?', [task.id]);
      await qConn(connection, 'DELETE FROM task_time_entries WHERE task_id = ?', [task.id]);
      await qConn(connection, 'DELETE FROM task_logs WHERE task_id = ?', [task.id]);
      await qConn(connection, 'DELETE FROM task_time_entries WHERE task_id = ?', [task.id]);
      await qConn(
        connection,
        `DELETE FROM tasks WHERE id = ?${hasTaskTenantId ? ' AND tenant_id = ?' : ''}`,
        hasTaskTenantId ? [task.id, tenantId] : [task.id]
      );
    }

    await commitTransactionAsync(connection);
    return res.json({
      success: true,
      message: hasTaskDeleted ? 'Task archived successfully' : 'Task deleted successfully'
    });
  } catch (error) {
    await rollbackTransactionAsync(connection);
    throw error;
  } finally {
    connection.release();
  }
}

const hasColumn = (table, column) => new Promise((resolve) => {
  db.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
    (err, rows) => {
      if (err) return resolve(false);
      return resolve(Array.isArray(rows) && rows.length > 0);
    }
  );
});

async function ensureProjectOpen(projectId) {
  if (!projectId) return;
  try {
    const rows = await q('SELECT status FROM projects WHERE id = ? LIMIT 1', [projectId]);
    if (!rows || rows.length === 0) return; // no project found - upstream validations will handle
    const st = rows[0].status;
    const statusUpper = st ? String(st).toUpperCase() : '';
    if (statusUpper === 'CLOSED' || statusUpper === 'PENDING_FINAL_APPROVAL') {
      const err = new Error('Project is closed or pending final approval. Tasks are locked and cannot be modified.');
      err.status = 403;
      throw err;
    }
  } catch (e) {
    throw e;
  }
}

// Multi-user assignment is supported — no single-active-task restriction applies.
// This stub is retained for backward compatibility but always returns false.
async function assigneeHasActiveTask(userId, excludeTaskId = null) {
  return false;
}

const q = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, results) => {
    if (err) reject(err);
    else resolve(results);
  });
});

// Safe email send: validate, ensure recipient exists in users table, send and log failures.
async function safeSendEmailForTask(taskId, recipientEmail, emailPayload) {
  try {
    if (!recipientEmail || typeof recipientEmail !== 'string') return false;
    const email = recipientEmail.trim();
    // basic email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) return false;

    // ensure email belongs to a user in DB
    const rows = await q('SELECT _id FROM users WHERE email = ? LIMIT 1', [email]);
    if (!rows || rows.length === 0) {
      logger.warn(`Skipping email for task=${taskId}, recipient=${email} (not found in users table)`);
      return false;
    }

    // attempt send
    try {
      await emailService.sendEmail(Object.assign({ to: email }, emailPayload));
      return true;
    } catch (sendErr) {
      logger.error(`Email send failed for task=${taskId}, recipient=${email}: ${sendErr && sendErr.message}`);
      return false;
    }
  } catch (err) {
    logger.error(`Email validation/send error for task=${taskId}, recipient=${recipientEmail}: ${err && err.message}`);
    return false;
  }
}

async function ensureTaskTimeLogsTable() {
  try {
    const tableExists = await q(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = DATABASE() 
      AND table_name = 'task_time_entries'
    `);

    if (tableExists[0].count === 0) {
      await q(`
        CREATE TABLE task_time_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          task_id INT NOT NULL,
          user_id INT NOT NULL,
          action ENUM('start', 'pause', 'resume', 'complete', 'reassign') NOT NULL,
          timestamp DATETIME NOT NULL,
          duration INT NULL,
          INDEX idx_task_time_logs_task_id (task_id),
          INDEX idx_task_time_logs_timestamp (timestamp)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
      logger.info('Created task_time_entries table');
    }
  } catch (e) {
    logger.warn('Failed to ensure task_time_entries table: ' + e.message);
  }
}

async function ensureTaskActivitiesTable() {
  try {
    // Try to access the table to check if it's corrupted (e.g. "doesn't exist in engine")
    await q('SELECT 1 FROM task_logs LIMIT 1');
  } catch (e) {
    // If table doesn't exist or is corrupted (error 1146 or 1932), recreate it
    if (e.message.includes("doesn't exist") || e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1932) {
      try {
        await q('DROP TABLE IF EXISTS task_logs');
        await q(`
          CREATE TABLE task_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            task_id INT NOT NULL,
            user_id INT NULL,
            type VARCHAR(50) NULL,
            activity_text TEXT NULL,
            status_action VARCHAR(50) NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_task_activities_task_id (task_id),
            INDEX idx_task_activities_created_at (created_at)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('Created/Recreated task_logs table');
      } catch (createError) {
        logger.warn('Failed to ensure task_logs table: ' + createError.message);
      }
    } else {
      logger.warn('Unexpected error checking task_logs table: ' + e.message);
    }
  }
}

// Per-user task status tracking (each assignee has an independent lifecycle)
async function ensureTaskAssignmentStatusTable() {
  try {
    await q('SELECT 1 FROM task_assignment_status LIMIT 1');
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
      try {
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
          )
        `);
        logger.info('Created task_assignment_status table');
      } catch (createErr) {
        logger.warn('Failed to create task_assignment_status table: ' + createErr.message);
      }
    }
  }
}

async function ensureTaskAssignmentReviewColumns() {
  if (!await hasColumn('task_assignment_status', 'review_requested')) {
    await q('ALTER TABLE task_assignment_status ADD COLUMN review_requested TINYINT(1) NOT NULL DEFAULT 0');
  }
  if (!await hasColumn('task_assignment_status', 'review_requested_at')) {
    await q('ALTER TABLE task_assignment_status ADD COLUMN review_requested_at DATETIME NULL');
  }
  if (!await hasColumn('task_assignment_status', 'last_review_reminder_at')) {
    await q('ALTER TABLE task_assignment_status ADD COLUMN last_review_reminder_at DATETIME NULL');
  }
}

// Per-user checklist progress (completion is isolated per assignee)
async function ensureUserChecklistProgressTable() {
  try {
    await q('SELECT 1 FROM user_checklist_progress LIMIT 1');
  } catch (e) {
    if (e.code === 'ER_NO_SUCH_TABLE' || e.errno === 1146 || (e.message && e.message.includes("doesn't exist"))) {
      try {
        await q(`
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
        logger.info('Created user_checklist_progress table');
      } catch (createErr) {
        logger.warn('Failed to create user_checklist_progress table: ' + createErr.message);
      }
    }
  }
}

async function canEditTask(taskId, user) {

  if (user.role === 'Admin' || user.role === 'Manager') return true;

  const hasReadOnlyColumn = await hasColumn('task_assignments', 'is_read_only');
  const selectColumns = hasReadOnlyColumn ? 'user_id, is_read_only' : 'user_id';
  const [assignment] = await q(`SELECT ${selectColumns} FROM task_assignments WHERE task_id = ? AND user_id = ?`, [taskId, user._id]);
  if (!assignment) return false;

  if (hasReadOnlyColumn && assignment.is_read_only) return false;

  const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');
  const pendingRows = await q(
    `SELECT id FROM task_resign_requests
     WHERE task_id = ? AND requested_by = ? AND status = 'PENDING'
     ${hasReassignmentTenantId ? 'AND tenant_id = ?' : ''}
     LIMIT 1`,
    hasReassignmentTenantId ? [taskId, user._id, user.tenant_id || null] : [taskId, user._id]
  );
  if (Array.isArray(pendingRows) && pendingRows.length > 0) return false;

  return true;
}

const getLastAction = async (taskId, userId) => {
  const rows = await q('SELECT action FROM task_time_entries WHERE task_id = ? AND user_id = ? ORDER BY timestamp DESC LIMIT 1', [taskId, userId]);
  return rows.length > 0 ? rows[0].action : null;
};

router.use(tenantMiddleware);



router.post('/selected-details', requireRole(['Admin', 'Manager', 'Employee']), asyncHandler(selectedTenantTaskDetails));

router.post('/createjson', [
  check('title').notEmpty().withMessage('title is required'),
  check('taskDate').optional().isISO8601().withMessage('taskDate must be ISO8601'),
  check('assigned_to').optional(),
  validateRequest,
  ruleEngine('task_creation'),
  requireRole(['Admin', 'Manager'])
], asyncHandler(createTenantTask));

router.post('/', [
  check('title').notEmpty().withMessage('title is required'),
  check('taskDate').optional().isISO8601().withMessage('taskDate must be ISO8601'),
  validateRequest,
  ruleEngine('task_creation'),
  requireRole(['Admin', 'Manager'])
], asyncHandler(createTenantTask));

router.get('/taskdropdown', asyncHandler(getTenantTaskDropdown));
router.get('/taskdropdownfortaskHrs', asyncHandler(getTenantTaskHourDropdown));
router.get('/gettaskss', asyncHandler(listTenantTasks));
router.get('/', asyncHandler(listTenantTasks));

// GET /:id/comments - accessible by Admin, Manager, Employee
router.get('/:id/comments', requireRole(['Admin', 'Manager', 'Employee']), asyncHandler(async (req, res) => {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  if (!await canReadTenantTask(task, req)) return res.status(403).json({ success: false, error: 'Not authorized to view comments for this task' });

  await ensureTaskCommentsTable();

  const comments = await q(`
    SELECT tc.id, tc.task_id, tc.comment, tc.created_at AS createdAt,
           u.public_id AS user_public_id, u.name AS user_name, u.role AS user_role
    FROM task_comments tc
    JOIN users u ON tc.user_id = u._id
    WHERE tc.task_id = ?
    ORDER BY tc.created_at ASC
  `, [task.id]);

  res.json({ success: true, data: comments });
}));

// POST /:id/comments - accessible by Admin, Manager
router.post('/:id/comments', requireRole(['Admin', 'Manager']), asyncHandler(async (req, res) => {
  const tenantId = assertTenantId(req);
  const task = await resolveTenantTask(req.params.id, tenantId);
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

  const { comment } = req.body;
  if (!comment || typeof comment !== 'string' || !comment.trim()) {
    return res.status(400).json({ success: false, error: 'Comment content is required' });
  }

  await ensureTaskCommentsTable();

  const result = await q(`
    INSERT INTO task_comments (task_id, user_id, comment, created_at)
    VALUES (?, ?, ?, NOW())
  `, [task.id, req.user._id, comment.trim()]);

  try {
    await ensureTaskActivitiesTable();
    await q(`
      INSERT INTO task_logs (task_id, user_id, type, activity_text, created_at)
      VALUES (?, ?, ?, ?, NOW())
    `, [task.id, req.user._id, 'Commented', `${req.user.name} added a comment: "${comment.trim().substring(0, 50)}${comment.trim().length > 50 ? '...' : ''}"`]);
  } catch (logErr) {
    logger.warn('Failed to log comment activity: ' + logErr.message);
  }

  emitTaskUpdatedEvent(task.public_id, tenantId, { action: 'comment_added' });

  const [newComment] = await q(`
    SELECT tc.id, tc.task_id, tc.comment, tc.created_at AS createdAt,
           u.public_id AS user_public_id, u.name AS user_name, u.role AS user_role
    FROM task_comments tc
    JOIN users u ON tc.user_id = u._id
    WHERE tc.id = ?
  `, [result.insertId]);

  res.status(201).json({ success: true, data: newComment });
}));

router.put('/updatetask/:id', taskLockCheckMiddleware, requireRole(['Admin', 'Manager']), asyncHandler(updateTenantTask));
router.put('/:id', taskLockCheckMiddleware, requireRole(['Admin', 'Manager']), asyncHandler(updateTenantTask));

router.patch('/:id/status', taskLockCheckMiddleware, ruleEngine('task_status_update'), asyncHandler((req, res) => applyTenantTaskStatus(req, res)));
router.post('/:id/complete', taskLockCheckMiddleware, asyncHandler((req, res) => applyTenantTaskStatus(req, res, 'COMPLETED')));
router.post('/:id/approve', requireRole(['Admin', 'Manager']), asyncHandler((req, res) => applyTenantTaskStatus(req, res, 'APPROVED')));
router.post('/:id/reject', requireRole(['Admin', 'Manager']), asyncHandler((req, res) => applyTenantTaskStatus(req, res, 'REJECTED')));
router.post('/:id/start', taskLockCheckMiddleware, asyncHandler((req, res) => applyTenantTaskStatus(req, res, 'IN_PROGRESS')));
router.post('/:id/pause', taskLockCheckMiddleware, asyncHandler((req, res) => applyTenantTaskStatus(req, res, 'ON_HOLD')));
router.post('/:id/resume', taskLockCheckMiddleware, asyncHandler((req, res) => applyTenantTaskStatus(req, res, 'IN_PROGRESS')));
router.post('/:id/request-review', requireRole(['Employee']), asyncHandler(async (req, res) => applyTenantTaskStatus(req, res, 'REVIEW')));
router.get('/:id/reassign-candidates', requireRole(['Admin', 'Manager']), asyncHandler(getTenantReassignmentCandidates));
router.get('/:id/timeline', asyncHandler(getTenantTaskTimeline));
router.delete('/:id', taskLockCheckMiddleware, ruleEngine('task_delete'), requireRole(['Admin', 'Manager']), asyncHandler(deleteTenantTask));

router.post('/selected-details', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const taskIds = req.body.taskIds || req.body.task_ids || [];
    if (!Array.isArray(taskIds) || taskIds.length === 0) return res.status(400).json(errorResponse.badRequest('Task IDs array is required', 'INVALID_INPUT', null, 'taskIds'));

    const numericIds = taskIds.filter(id => /^\d+$/.test(String(id))).map(Number);
    const publicIds = taskIds.filter(id => !/^\d+$/.test(String(id)));
    const allIds = [...numericIds, ...publicIds];
    if (allIds.length === 0) return res.status(400).json(errorResponse.badRequest('No valid task IDs provided', 'INVALID_INPUT'));
    const subtaskCreatorColumnExists = await hasColumn('subtasks', 'created_by');

    let internalIds = numericIds;
    if (publicIds.length > 0) {
      const publicToInternal = await new Promise((resolve, reject) => db.query('SELECT id FROM tasks WHERE public_id IN (?)', [publicIds], (e, r) => e ? reject(e) : resolve(r)));
      internalIds = [...internalIds, ...publicToInternal.map(row => row.id)];
    }
    const whereClause = 'WHERE t.id IN (?)';
    const queryParams = [internalIds];

    let optionalSelect = '';
    try {
      const cols = [];
      if (await hasColumn('tasks', 'started_at')) cols.push('t.started_at');
      if (await hasColumn('tasks', 'live_timer')) cols.push('t.live_timer');
      if (await hasColumn('tasks', 'total_duration')) cols.push('t.total_duration');
      if (await hasColumn('tasks', 'completed_at')) cols.push('t.completed_at');
      if (await hasColumn('tasks', 'approved_by')) cols.push('t.approved_by');
      if (await hasColumn('tasks', 'approved_at')) cols.push('t.approved_at');
      if (await hasColumn('tasks', 'rejection_reason')) cols.push('t.rejection_reason');
      if (await hasColumn('tasks', 'rejected_by')) cols.push('t.rejected_by');
      if (await hasColumn('tasks', 'rejected_at')) cols.push('t.rejected_at');
      if (cols.length) optionalSelect = ', ' + cols.join(', ');
    } catch (e) { }

    const sql = `
      SELECT
        t.id AS task_internal_id,
        ANY_VALUE(t.public_id) AS task_id,
        ANY_VALUE(t.title) AS title,
        ANY_VALUE(t.description) AS description,
        ANY_VALUE(t.stage) AS stage,
        ANY_VALUE(t.taskDate) AS taskDate,
        ANY_VALUE(t.priority) AS priority,
        ANY_VALUE(t.time_alloted) AS time_alloted,
        ANY_VALUE(t.estimated_hours) AS estimated_hours,
        ANY_VALUE(t.status) AS status,
        ANY_VALUE(t.createdAt) AS createdAt,
        ANY_VALUE(t.updatedAt) AS updatedAt${optionalSelect},
        MIN(c.id) AS client_id,
        MIN(c.name) AS client_name,
        MIN(ap.name) AS approved_by_name,
        MIN(ap.public_id) AS approved_by_public_id,
        MIN(rj.name) AS rejected_by_name,
        MIN(rj.public_id) AS rejected_by_public_id,
        GROUP_CONCAT(DISTINCT u._id) AS assigned_user_ids,
        GROUP_CONCAT(DISTINCT u.public_id) AS assigned_user_public_ids,
        GROUP_CONCAT(DISTINCT u.name) AS assigned_user_names,
        GROUP_CONCAT(DISTINCT COALESCE(ta.is_read_only, 0)) AS assigned_user_read_only
      FROM tasks t
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN users ap ON t.approved_by = ap._id
      LEFT JOIN users rj ON t.rejected_by = rj._id
      LEFT JOIN task_assignments ta ON ta.task_id = t.id
      LEFT JOIN users u ON u._id = ta.user_id
      ${whereClause}
      GROUP BY t.id
      ORDER BY t.createdAt DESC
    `;

    db.query(sql, queryParams, async (err, rows) => {
      if (err) {
        logger.error('selected-details fetch error: ' + (err && err.message));
        return res.status(500).json({ success: false, error: err.message });
      }

      const creatorSelect = subtaskCreatorColumnExists
        ? ', creator._id AS creator_internal_id, creator.public_id AS creator_public_id, creator.name AS creator_name'
        : '';
      const creatorJoin = subtaskCreatorColumnExists ? 'LEFT JOIN users creator ON creator._id = s.created_by' : '';
      const subtaskQuery = `
        SELECT s.*${creatorSelect}
        FROM subtasks s
        ${creatorJoin}
        WHERE s.task_id IN (?)
        ORDER BY s.created_at ASC
      `;
      const subtasks = await new Promise((resolve, reject) => db.query(
        subtaskQuery,
        [internalIds], (e, r) => e ? reject(e) : resolve(r)
      ));

      const activities = await new Promise((resolve, reject) => db.query(
        `SELECT ta.task_id, ta.type, ta.activity_text AS activity, ta.created_at AS createdAt, u._id AS user_id, u.public_id AS user_public_id, u.name AS user_name
         FROM task_logs ta
         LEFT JOIN users u ON ta.user_id = u._id
         WHERE ta.task_id IN (?)
         ORDER BY ta.created_at DESC`,
        [internalIds], (e, r) => e ? reject(e) : resolve(r)
      ));

      const hours = await new Promise((resolve, reject) => db.query(
        'SELECT task_id, SUM(hours) AS total_hours FROM task_time_entries WHERE task_id IN (?) GROUP BY task_id',
        [internalIds], (e, r) => e ? reject(e) : resolve(r)
      ));

      let files = [];
      try {
        files = await new Promise((resolve, reject) => db.query(
          `SELECT id, task_id, file_url, file_name, file_type, uploaded_at FROM task_documents WHERE task_id IN (?) AND is_active = 1 ORDER BY uploaded_at DESC`,
          [internalIds], (e, r) => e ? reject(e) : resolve(r)
        ));
      } catch (fileErr) {

        files = [];
      }

      const filesMap = {};
      (files || []).forEach(f => {
        if (!f || f.task_id === undefined || f.task_id === null) return;
        const k = String(f.task_id);
        if (!filesMap[k]) filesMap[k] = [];
        filesMap[k].push({ id: f.id != null ? String(f.id) : null, url: f.file_url || null, name: f.file_name || null, type: f.file_type || null, uploadedAt: f.uploaded_at ? new Date(f.uploaded_at).toISOString() : null });
      });

      const checklistMap = {};
      (subtasks || []).forEach((s) => {
        if (!s) return;
        const rawTaskId = (s.task_id !== undefined && s.task_id !== null) ? s.task_id
          : (s.task_id !== undefined && s.task_id !== null) ? s.task_id
            : (s.taskId !== undefined && s.taskId !== null) ? s.taskId
              : (s.task !== undefined && s.task !== null) ? s.task
                : null;
        if (rawTaskId === null) return;
        const key = String(rawTaskId);
        if (!checklistMap[key]) checklistMap[key] = [];
        const checklistItem = {
          id: s.id != null ? String(s.id) : null,
          title: s.title || null,
          description: s.description || null,
          status: s.status || null,
          tag: s.tag || null,
          dueDate: (s.due_date || s.dueDate) ? new Date(s.due_date || s.dueDate).toISOString() : null,
          estimatedHours: (s.estimated_hours != null) ? Number(s.estimated_hours) : (s.estimatedHours != null ? Number(s.estimatedHours) : null),
          completedAt: (s.completed_at || s.completedAt) ? new Date(s.completed_at || s.completedAt).toISOString() : null,
          createdAt: (s.created_at || s.createdAt) ? new Date(s.created_at || s.createdAt).toISOString() : null,
          updatedAt: (s.updated_at || s.updatedAt) ? new Date(s.updated_at || s.updatedAt).toISOString() : null
        };
        if (subtaskCreatorColumnExists) {
          const creatorInternalId = s.creator_internal_id != null ? String(s.creator_internal_id) : (s.created_by != null ? String(s.created_by) : null);
          const creatorPublicId = s.creator_public_id || null;
          const creatorName = s.creator_name || null;
          if (creatorInternalId || creatorPublicId || creatorName) {
            checklistItem.user = {
              id: creatorPublicId || creatorInternalId || null,
              internalId: creatorInternalId,
              name: creatorName
            };
          } else {
            checklistItem.user = null;
          }
        }
        checklistMap[key].push(checklistItem);
      });

      const activitiesMap = {};
      (activities || []).forEach(activity => {
        if (!activity || activity.task_id === undefined || activity.task_id === null) return;
        const key = String(activity.task_id);
        if (!activitiesMap[key]) activitiesMap[key] = [];
        const userInfo = activity.user_id
          ? {
            id: activity.user_public_id || String(activity.user_id),
            internalId: String(activity.user_id),
            name: activity.user_name || null
          }
          : null;
        activitiesMap[key].push({
          type: activity.type || null,
          activity: activity.activity || null,
          createdAt: activity.createdAt ? new Date(activity.createdAt).toISOString() : null,
          user: userInfo
        });
      });

      const hoursMap = {};
      (hours || []).forEach(h => { hoursMap[String(h.task_id)] = Number(h.total_hours || 0); });

      const tasks = (rows || []).map(r => {
        const assignedIds = r.assigned_user_ids ? String(r.assigned_user_ids).split(',') : [];
        const assignedPublic = r.assigned_user_public_ids ? String(r.assigned_user_public_ids).split(',') : [];
        const assignedNames = r.assigned_user_names ? String(r.assigned_user_names).split(',') : [];
        const assignedReadOnly = r.assigned_user_read_only ? String(r.assigned_user_read_only).split(',') : [];

        const assignedUsers = assignedIds.map((uid, i) => ({
          id: assignedPublic[i] || uid,
          internalId: String(uid),
          name: assignedNames[i] || null,
          readOnly: assignedReadOnly[i] === '1' || assignedReadOnly[i] === 'true'
        }));
        const key = String(r.task_internal_id || r.task_id);
        return {
          id: String(r.task_internal_id),
          title: r.title || null,
          description: r.description || null,
          stage: r.stage || null,
          taskDate: r.taskDate ? new Date(r.taskDate).toISOString() : null,
          day: r.taskDate ? (new Date(r.taskDate).toISOString().split('T')[0]) : null,
          dayName: r.taskDate ? dayjs(r.taskDate).format('ddd') : null,
          priority: r.priority || null,
          timeAlloted: r.time_alloted != null ? Number(r.time_alloted) : null,
          estimatedHours: r.estimated_hours != null ? Number(r.estimated_hours) : (r.time_alloted != null ? Number(r.time_alloted) : null),
          status: r.status || null,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
          updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
          client: r.client_id ? { id: String(r.client_id), name: r.client_name } : null,
          assignedUsers,
          checklist: checklistMap[key] || checklistMap[String(r.task_id)] || checklistMap[String(r.task_internal_id)] || [],
          activities: activitiesMap[key] || activitiesMap[String(r.task_id)] || activitiesMap[String(r.task_internal_id)] || [],
          files: filesMap[key] || filesMap[String(r.task_id)] || filesMap[String(r.task_internal_id)] || [],
          totalHours: hoursMap[key] != null ? hoursMap[key] : 0,
          started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
          live_timer: r.live_timer ? new Date(r.live_timer).toISOString() : null,
          total_time_seconds: (r.total_duration != null) ? Number(r.total_duration) : (hoursMap[key] != null ? Number(hoursMap[key]) * 3600 : 0),
          total_time_hours: Number(((r.total_duration != null ? Number(r.total_duration) : (hoursMap[key] != null ? Number(hoursMap[key]) * 3600 : 0)) / 3600).toFixed(2)),
          total_time_hhmmss: (() => {
            try {
              const total = (r.total_duration != null) ? Number(r.total_duration) : (hoursMap[key] != null ? Number(hoursMap[key]) * 3600 : 0);
              const hh = String(Math.floor(total / 3600)).padStart(2, '0');
              const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
              const ss = String(total % 60).padStart(2, '0');
              return `${hh}:${mm}:${ss}`;
            } catch (e) { return '00:00:00'; }
          })(),
          completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
          approved_by: r.approved_by_name ? {
            id: r.approved_by_public_id,
            name: r.approved_by_name
          } : null,
          approved_at: r.approved_at ? new Date(r.approved_at).toISOString() : null,
          rejection: r.rejection_reason ? {
            reason: r.rejection_reason,
            rejected_by: r.rejected_by_name ? {
              id: r.rejected_by_public_id,
              name: r.rejected_by_name
            } : null,
            rejected_at: r.rejected_at ? new Date(r.rejected_at).toISOString() : null
          } : null,
          summary: (() => {
            try {
              const now = new Date();
              const est = r.taskDate ? new Date(r.taskDate) : null;
              if (!est) return {};
              return { dueStatus: est < now ? 'Overdue' : 'On Time', dueDate: est.toISOString() };
            } catch (e) { return {}; }
          })()
        };
      });

      return res.json({ success: true, data: tasks, meta: { count: tasks.length } });
    });
  } catch (e) {
    logger.error('Error in selected-details endpoint: ' + (e && e.message));
    return res.status(500).json({ success: false, error: e && e.message });
  }
});

async function createJsonHandler(req, res) {
  try {
    const {
      assigned_to,
      assignedTo,
      priority,
      stage,
      taskDate,
      dueDate,
      title,
      description,
      time_alloted,
      estimatedHours,
      client_id,
      projectId,
      projectPublicId,
    } = req.body;

    let finalAssigned = assigned_to;
    if ((!Array.isArray(finalAssigned) || finalAssigned.length === 0) && assignedTo) {
      if (Array.isArray(assignedTo)) finalAssigned = assignedTo;
      else if (typeof assignedTo === 'string') finalAssigned = assignedTo.split(',').map(s => s.trim()).filter(Boolean);
    }

    const finalTaskDate = taskDate || dueDate || null;
    const finalTimeAlloted = time_alloted || estimatedHours || null;

    let finalClientId = client_id || null;

    const createdAt = new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000).toISOString();
    const updatedAt = createdAt;

    const normalizedStage = stage || 'TODO';

    const priorityNorm = priority ? String(priority).toUpperCase() : 'MEDIUM';

    if (!title) {
      return res.status(400).send("Missing required field: title");
    }

    // Multi-user assignment: at least one assignee is required.
    if (!finalAssigned || (Array.isArray(finalAssigned) && finalAssigned.length === 0) || (!Array.isArray(finalAssigned) && !finalAssigned)) {
      return res.status(400).send('assigned_to must contain at least one user ID');
    }

    if (!Array.isArray(finalAssigned)) {
      finalAssigned = [finalAssigned];
    }

    db.getConnection((err, connection) => {
      if (err) {
        logger.error('Database connection error:', err);
        return res.status(500).send("Database connection error");
      }

      let finalProjectId = null;
      let finalProjectPublicId = null;
      if (projectId) {
        if (/^\d+$/.test(String(projectId))) {
          finalProjectId = Number(projectId);
        } else {
          finalProjectPublicId = projectId;
        }
      }
      if (projectPublicId) {
        finalProjectPublicId = projectPublicId;
      }

      const resolveProjectAndClient = (cb) => {
        if (finalClientId && !finalProjectId && !finalProjectPublicId) return cb(null, finalClientId);
        if (!finalProjectId && !finalProjectPublicId) return cb(new Error('missing_client_and_project'));

        logger.info('Resolving project details:', { finalProjectId, finalProjectPublicId });

        const q = `SELECT id, public_id, client_id FROM projects WHERE id = ? OR public_id = ? LIMIT 1`;
        connection.query(q, [finalProjectId || null, finalProjectPublicId || null], (qErr, rows) => {
          if (qErr) {
            logger.error('Error resolving project:', qErr);
            return cb(qErr);
          }
          logger.debug('Project resolution result:', rows);
          if (!rows || rows.length === 0) return cb(new Error('project_not_found'));
          finalProjectId = rows[0].id;
          finalProjectPublicId = rows[0].public_id;
          finalClientId = finalClientId || rows[0].client_id;
          return cb(null, finalClientId);
        });
      };

      resolveProjectAndClient((resolveErr, resolvedCid) => {
        if (resolveErr) {
          connection.release();
          logger.error('Client resolution error:', resolveErr);
          return res.status(400).send('Missing required fields: client_id or valid projectId/projectPublicId');
        }
        finalClientId = resolvedCid;

        logger.debug('Resolved values:', {
          finalClientId,
          finalProjectId,
          finalProjectPublicId,
          finalAssigned,
          title,
          normalizedStage,
          priorityNorm,
          finalTaskDate,
          finalTimeAlloted
        });

        connection.beginTransaction((err) => {
          if (err) {
            connection.release();
            logger.error('Transaction error:', err);
            return res.status(500).send("Error starting transaction");
          }

          const checkHighPriorityQuery = `
            SELECT COUNT(*) as highPriorityCount FROM tasks 
            WHERE client_id = ? AND priority = 'HIGH'
          `;

          connection.query(checkHighPriorityQuery, [finalClientId], (checkErr, checkResults) => {
            if (checkErr) {
              logger.error('Error checking high priority tasks:', checkErr);
              return connection.rollback(() => {
                connection.release();
                return res.status(500).send("Error checking existing tasks");
              });
            }

            const highPriorityCount = checkResults[0]?.highPriorityCount || 0;
            let finalPriority = priorityNorm;
            let adjustedTaskDate = finalTaskDate;

            logger.debug('High priority check:', { highPriorityCount, finalPriority, finalTaskDate });

            if (priorityNorm === "HIGH" && highPriorityCount > 0) {

              const getExistingQuery = `
                SELECT priority as existingPriority, taskDate as existingTaskDate 
                FROM tasks 
                WHERE client_id = ? AND priority = 'HIGH' LIMIT 1
              `;
              connection.query(getExistingQuery, [finalClientId], (getErr, getResults) => {
                if (getErr) {
                  logger.error('Error getting existing task details:', getErr);
                  return connection.rollback(() => {
                    connection.release();
                    return res.status(500).send("Error checking existing tasks");
                  });
                }

                if (getResults.length > 0) {
                  const existingTaskDate = new Date(getResults[0].existingTaskDate);
                  const currentDate = new Date();
                  const daysDifference = Math.ceil((existingTaskDate - currentDate) / (1000 * 60 * 60 * 24));

                  let dateAdjustmentDays = 0;
                  if (getResults[0].existingPriority === "LOW") {
                    dateAdjustmentDays = Math.ceil(daysDifference * 1.5);
                  } else if (getResults[0].existingPriority === "MEDIUM") {
                    dateAdjustmentDays = Math.ceil(daysDifference * 1.2);
                  }

                  adjustedTaskDate = new Date(existingTaskDate);
                  adjustedTaskDate.setDate(adjustedTaskDate.getDate() + dateAdjustmentDays);

                  const updateExistingTaskQuery = `
                    UPDATE tasks 
                    SET priority = 'MEDIUM', updatedAt = ?, taskDate = ?
                    WHERE client_id = ? AND priority = 'HIGH'
                  `;

                  connection.query(updateExistingTaskQuery, [toMySQLDate(updatedAt), toMySQLDate(adjustedTaskDate), finalClientId], (updateErr) => {
                    if (updateErr) {
                      logger.error('Error updating existing tasks:', updateErr);
                      return connection.rollback(() => {
                        connection.release();
                        return res.status(500).send("Error managing task priorities");
                      });
                    }

                    logger.info('Continuing task creation with adjusted date');
                    continueTaskCreation(req, connection, {
                      ...req.body,
                      assigned_to: finalAssigned,
                      stage: normalizedStage,
                      taskDate: adjustedTaskDate.toISOString(),
                      time_alloted: finalTimeAlloted,
                      estimated_hours: finalTimeAlloted,
                      client_id: finalClientId,
                      projectId: finalProjectId,
                      projectPublicId: finalProjectPublicId
                    }, createdAt, updatedAt, "HIGH", res);
                  });
                }
              });
            } else {
              logger.info('Continuing task creation without priority adjustment');
              continueTaskCreation(req, connection, {
                ...req.body,
                assigned_to: finalAssigned,
                stage: normalizedStage,
                taskDate: adjustedTaskDate,
                time_alloted: finalTimeAlloted,
                estimated_hours: finalTimeAlloted,
                client_id: finalClientId,
                projectId: finalProjectId,
                projectPublicId: finalProjectPublicId
              }, createdAt, updatedAt, finalPriority, res);
            }
          });
        });
      });
    });
  } catch (error) {
    logger.error('Error in task creation process:', error);
    return res.status(500).json(errorResponse.serverError('Error in task creation process', 'TASK_CREATION_ERROR', { details: error.message }));
  }
}

async function continueTaskCreation(req, connection, body, createdAt, updatedAt, finalPriority, res) {
  const {
    assigned_to,
    stage,
    taskDate,
    title,
    description,
    time_alloted,
    client_id,
    projectId,
    projectPublicId,
    estimated_hours,
    status,
  } = body;

  const checkColumn = (col) => new Promise((resolve) => {
    connection.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = ?", [col], (err, rows) => {
      if (err) {
        logger.error(`Error checking column ${col}:`, err);
        return resolve(false);
      }
      const exists = Array.isArray(rows) && rows.length > 0;
      return resolve(exists);
    });
  });

  try {

    const publicId = crypto.randomBytes(8).toString('hex');

    const cols = ['title', 'description', 'stage', 'taskDate', 'priority', 'createdAt', 'updatedAt', 'time_alloted', 'estimated_hours', 'status', 'client_id', 'public_id', 'project_id', 'project_public_id'];
    const placeholders = cols.map(() => '?');
    const mysqlTaskDate = toMySQLDate(taskDate);
    const mysqlCreatedAt = toMySQLDate(createdAt);
    const mysqlUpdatedAt = toMySQLDate(updatedAt);
    const values = [title, description, stage, mysqlTaskDate, finalPriority, mysqlCreatedAt, mysqlUpdatedAt, time_alloted, estimated_hours || time_alloted || null, 'Pending', client_id, publicId, projectId ? projectId : null, projectPublicId ? projectPublicId : null];

    logger.debug('Final INSERT columns:', cols);
    logger.debug('Final INSERT values:', values);

    const insertTaskQuery = `INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;

    const executeTaskCreation = async (resolve, reject) => {
      let resolvedUserIds = []; // Declare at function scope
      let resolvedPublicIds = []; // Declare at function scope

      connection.query(insertTaskQuery, values, async (err, result) => {
        if (err) {
          logger.error('Error inserting task:', err);
          return connection.rollback(() => {
            connection.release();
            reject(new Error("Error inserting task: " + err.message));
          });
        }

        const taskId = result.insertId;
        logger.info('Task inserted with ID:', taskId);

        try {
          const dayStr = taskDate ? (new Date(taskDate).toISOString().split('T')[0]) : null;
          if (dayStr) {
            if (await checkColumn('task_day')) {
              await new Promise((res2, rej2) => connection.query('UPDATE tasks SET task_day = ? WHERE id = ?', [dayStr, taskId], (e) => e ? rej2(e) : res2()));
            } else if (await checkColumn('day')) {
              await new Promise((res2, rej2) => connection.query('UPDATE tasks SET day = ? WHERE id = ?', [dayStr, taskId], (e) => e ? rej2(e) : res2()));
            }
          }
        } catch (e) {
          logger.error('Failed to persist day column for task:', e && e.message);
        }

        if (!taskId || !Array.isArray(assigned_to) || assigned_to.length === 0) {
          return connection.rollback(() => {
            connection.release();
            reject(new Error("Invalid task assignment data"));
          });
        }

        const rawAssigned = Array.isArray(assigned_to) ? assigned_to.slice() : [];
        const numericIds = rawAssigned.filter(v => String(v).match(/^\d+$/)).map(v => Number(v));
        const publicIds = rawAssigned.filter(v => !String(v).match(/^\d+$/));

        logger.debug('Resolving user assignments:', { numericIds, publicIds, rawAssigned });

        const resolveQueries = [];
        const resolveParams = [];
        if (publicIds.length > 0) {
          resolveQueries.push(`SELECT _id, public_id FROM users WHERE public_id IN (?)`);
          resolveParams.push([publicIds]);
        }
        if (numericIds.length > 0) {
          resolveQueries.push(`SELECT _id, public_id FROM users WHERE _id IN (?)`);
          resolveParams.push([numericIds]);
        }

        if (resolveQueries.length === 0) {
          return connection.rollback(() => {
            connection.release();
            reject(new Error("No assigned users provided or invalid format"));
          });
        }

        const runResolveQuery = async (idx) => {
          if (idx >= resolveQueries.length) {

            resolvedUserIds = Array.from(new Set(resolvedUserIds));

            logger.debug('Resolved user IDs:', resolvedUserIds);

            if (resolvedUserIds.length === 0) {
              return connection.rollback(() => {
                connection.release();
                reject(new Error("Assigned users not found"));
              });
            }

            // Multi-user assignment: no active-task restriction — managers can freely assign
            // multiple users to a single task.
            const taskAssignments = resolvedUserIds.map((userId) => [taskId, userId]);
            const insertTaskAssignmentsQuery = `INSERT INTO task_assignments (task_id, user_id) VALUES ${taskAssignments.map(() => "(?, ?)").join(", ")}`;
            const flattenedValues = taskAssignments.flat();

            logger.debug('Inserting task assignments:', { taskAssignments });

            connection.query(insertTaskAssignmentsQuery, flattenedValues, (err) => {
              if (err) {
                logger.error('Error inserting task assignments:', err);
                return connection.rollback(() => {
                  connection.release();
                  reject(new Error("Error inserting task assignments: " + err.message));
                });
              }

              const assignedBy = (req.user && req.user.name) || 'System';
              const link = `${(process.env.FRONTEND_URL || process.env.BASE_URL || '')}/tasks/${taskId}`;
              const projectName = null;
              const priority = finalPriority;
              const taskDateVal = taskDate || null;
              const descriptionVal = description || null;

              logger.info('Preparing to send emails to users:', resolvedPublicIds);

              const sendEmails = emailService.sendTaskAssignmentEmails;

              sendEmails({
                finalAssigned: resolvedPublicIds,
                taskTitle: title,
                taskId,
                priority,
                taskDate: taskDateVal,
                description: descriptionVal,
                projectName,
                projectPublicId: projectPublicId || null,
                assignedBy,
                taskLink: link,
                connection
              }).catch(emailError => {
                logger.error('Email sending failed:', emailError);
              });

              connection.commit((err) => {
                if (err) {
                  logger.error('Commit error:', err);
                  return connection.rollback(() => {
                    connection.release();
                    reject(new Error("Error committing transaction: " + err.message));
                  });
                }

                connection.release();
                logger.info('Transaction committed successfully');
                resolve({
                  taskId,
                  publicId,
                  message: "Task created and assignments completed successfully",
                  assignedUsers: rawAssigned,
                  projectId: projectId,
                  projectPublicId: projectPublicId
                });
              });
            });
            return;
          }

          logger.debug(`Running resolve query ${idx}:`, resolveQueries[idx], resolveParams[idx]);

          connection.query(resolveQueries[idx], resolveParams[idx], (err, rows) => {
            if (err) {
              logger.error('Error resolving users:', err);
              return connection.rollback(() => {
                connection.release();
                reject(new Error("Error resolving assigned users: " + err.message));
              });
            }
            logger.debug(`Resolved ${rows?.length} users`);
            if (Array.isArray(rows) && rows.length > 0) {
              for (const r of rows) {
                resolvedUserIds.push(r._id);
                resolvedPublicIds.push(r.public_id);
              }
            }
            runResolveQuery(idx + 1).catch((err) => {
              logger.error('runResolveQuery failed:', err);
              return connection.rollback(() => {
                connection.release();
                reject(err);
              });
            });
          });
        };

        runResolveQuery(0).catch((err) => {
          logger.error('runResolveQuery failed:', err);
          return connection.rollback(() => {
            connection.release();
            reject(err);
          });
        });
      });
    };

    return new Promise((resolve, reject) => {
      executeTaskCreation(resolve, reject);
    })
      .then(async (result) => {
        logger.info('Task creation successful:', result);

        if (result.assignedUsers && result.assignedUsers.length > 0) {
          await NotificationService.createAndSend(
            result.assignedUsers.map(u => typeof u === 'object' ? u.internalId || u.id : u),
            'Task Assigned',
            `You have been assigned a new task: ${body.title}`,
            'TASK_ASSIGNED',
            'task',
            result.publicId
          );
        }

        await NotificationService.createAndSendToRoles(['Manager', 'Admin'],
          'New Task Created',
          `A new task "${body.title}" has been created`,
          'TASK_CREATED',
          'task',
          result.publicId,
          req.user.tenant_id
        );

        try {
          const auditController = require('./auditController');
          auditController.log({
            user_id: req.user._id,
            tenant_id: req.user.tenant_id,
            action: 'CREATE_TASK',
            entity: 'Task',
            entity_id: result.publicId,
            details: { title: body.title, projectId: result.projectId, assignedTo: result.assignedUsers }
          });
        } catch (auditErr) {
          logger.warn('Failed to log create_task audit:', auditErr);
        }

        if (projectId) {
          try {

            const updateProjectStatus = () => {
              return new Promise((resolve, reject) => {
                const checkStatusQuery = 'SELECT status FROM projects WHERE id = ?';
                db.query(checkStatusQuery, [projectId], (err, rows) => {
                  if (err) {
                    logger.error('Error checking project status:', err);
                    return resolve(); // Don't fail the task creation
                  }

                  if (rows && rows.length > 0 && (rows[0].status === 'Planning' || rows[0].status === 'IN_PROGRESS')) {
                    const updateQuery = 'UPDATE projects SET status = ? WHERE id = ?';
                    db.query(updateQuery, ['ACTIVE', projectId], (updateErr) => {
                      if (updateErr) {
                        logger.error('Error updating project status to ACTIVE:', updateErr);
                      } else {
                        logger.info(`Project ${projectId} status updated from ${rows[0].status} to ACTIVE`);
                      }
                      resolve();
                    });
                  } else {
                    resolve();
                  }
                });
              });
            };

            await updateProjectStatus();
          } catch (e) {
            logger.error('Failed to update project status:', e && e.message);

          }
        }

        let summary = {};
        try {
          const now = new Date();
          let estDate = null;
          let estHours = null;
          if (body.taskDate) estDate = new Date(body.taskDate);
          if (body.estimated_hours != null) estHours = Number(body.estimated_hours);
          else if (body.time_alloted != null) estHours = Number(body.time_alloted);

          if (estDate) {
            summary.dueStatus = estDate < now ? 'Overdue' : 'On Time';
            summary.dueDate = estDate.toISOString();
          }
          if (estHours != null) {
            summary.estimatedHours = estHours;
          }
        } catch (e) {
          summary.error = 'Could not calculate summary';
        }
        try {
          if (req.user && req.user.tenant_id) {
            const templates = await workflowService.listTemplates(req.user.tenant_id);
            const tpl = (templates || []).find(t => String(t.trigger_event).toUpperCase() === 'TASK_CREATED');
            if (tpl) {
              await workflowService.createInstance({ tenant_id: req.user.tenant_id, template_id: tpl.id, entity_type: 'TASK', entity_id: String(result.taskId), created_by: (req.user && req.user._id) || null });
            }
          }
        } catch (e) {
          logger.error('Workflow trigger failed (non-fatal):', e && e.message);
        }

        res.status(201).json({
          message: "Task created and assignments completed successfully",
          ...result,
          summary
        });
      })
      .catch((error) => {
        logger.error('Task creation failed:', error);
        return res.status(500).json(errorResponse.serverError('Task creation failed', 'TASK_CREATION_ERROR', { details: error.message }));
      });

  } catch (error) {
    logger.error('Error in continueTaskCreation:', error);
    return connection.rollback(() => {
      connection.release();
      res.status(500).json(errorResponse.serverError('Error in task creation process', 'TASK_CREATION_ERROR', { details: error.message }));
    });
  }
}

// NOTE: These routes were previously handled by the legacy `createJsonHandler`.
// They are now served by the modern multi-user `createTenantTask` handler
// registered above (~line 1515). Duplicate registrations removed to avoid confusion.
// router.post('/createjson', ...) → handled by createTenantTask at line ~1522
// router.post('/', ...)          → handled by createTenantTask at line ~1524

router.get("/taskdropdown", async (req, res) => {
  try {
    const query = "SELECT id, title FROM tasks";
    db.query(query, (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Failed to fetch tasks" });
      }
      if (!Array.isArray(results)) {
        return res
          .status(500)
          .json({ error: "Unexpected query result format" });
      }
      res.status(200).json(results);
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const projectParam = req.query.project_id || req.query.projectId || req.query.projectPublicId || req.body && (req.body.project_id || req.body.project_public_id || req.body.projectPublicId);
    if (!projectParam) return res.status(400).json(errorResponse.badRequest('project_id or projectPublicId query parameter required', 'MISSING_PARAMETER', null, 'projectId'));

    const tasksHasProjectId = await hasColumn('tasks', 'project_id');
    const tasksHasProjectPublicId = await hasColumn('tasks', 'project_public_id');
    const hasIsDeleted = await hasColumn('tasks', 'isDeleted');
    const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';

    let optionalSelect = '';
    try {
      const cols = [];
      if (await hasColumn('tasks', 'started_at')) cols.push('t.started_at');
      if (await hasColumn('tasks', 'live_timer')) cols.push('t.live_timer');
      if (await hasColumn('tasks', 'total_duration')) cols.push('t.total_duration');
      if (await hasColumn('tasks', 'completed_at')) cols.push('t.completed_at');
      if (await hasColumn('tasks', 'approved_by')) cols.push('t.approved_by');
      if (await hasColumn('tasks', 'approved_at')) cols.push('t.approved_at');
      if (await hasColumn('tasks', 'rejection_reason')) cols.push('t.rejection_reason');
      if (await hasColumn('tasks', 'rejected_by')) cols.push('t.rejected_by');
      if (await hasColumn('tasks', 'rejected_at')) cols.push('t.rejected_at');
      if (cols.length) optionalSelect = ', ' + cols.join(', ');
    } catch (e) { }

    let resolvedProjectId = projectParam;
    let projectPublicIdToUse = null;

    if (!/^\d+$/.test(String(projectParam))) {

      projectPublicIdToUse = projectParam;
      try {
        const projRows = await new Promise((resolve, reject) => db.query('SELECT id, public_id FROM projects WHERE public_id = ? LIMIT 1', [projectParam], (err, r) => err ? reject(err) : resolve(r)));
        if (!projRows || projRows.length === 0) return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND', null));
        resolvedProjectId = projRows[0].id;
      } catch (err) {
        logger.error('Error resolving project public_id: ' + (err && err.message));
        return res.status(500).json(errorResponse.serverError('Failed resolving project ID', 'PROJECT_RESOLUTION_ERROR'));
      }
    } else {
      resolvedProjectId = Number(projectParam);
    }

    try {
      await ensureProjectOpen(resolvedProjectId);
    } catch (err) {
      return res.status(err.status || 403).json({ success: false, message: err.message });
    }

    let sql;
    let params = [];

    if (tasksHasProjectId) {

      if (tasksHasProjectPublicId) {
        if (!projectPublicIdToUse) {
          try {
            const hasPub = await hasColumn('projects', 'public_id');
            const r = await new Promise((resolve, reject) => db.query(`SELECT ${hasPub ? 'public_id' : 'id AS public_id'} FROM projects WHERE id = ? LIMIT 1`, [resolvedProjectId], (err, rr) => err ? reject(err) : resolve(rr)));
            if (r && r.length > 0) projectPublicIdToUse = r[0].public_id;
          } catch (err) {
          }
        }

        sql = `
        SELECT
          t.id AS task_internal_id,
          t.public_id AS task_id,
          t.title,
          t.description,
          t.stage,
          t.taskDate,
          t.priority,
          t.time_alloted,
          t.estimated_hours,
          t.status,
          t.createdAt,
          t.updatedAt${optionalSelect},
          MIN(c.id) AS client_id,
          MIN(c.name) AS client_name,
          MIN(ap.name) AS approved_by_name,
          MIN(ap.public_id) AS approved_by_public_id,
          MIN(rj.name) AS rejected_by_name,
          MIN(rj.public_id) AS rejected_by_public_id,
          GROUP_CONCAT(DISTINCT u._id) AS assigned_user_ids,
          GROUP_CONCAT(DISTINCT u.public_id) AS assigned_user_public_ids,
          GROUP_CONCAT(DISTINCT u.name) AS assigned_user_names
        FROM tasks t
        LEFT JOIN clients c ON t.client_id = c.id
        LEFT JOIN users ap ON t.approved_by = ap._id
        LEFT JOIN users rj ON t.rejected_by = rj._id
        LEFT JOIN task_assignments ta ON ta.task_id = t.id
        LEFT JOIN users u ON u._id = ta.user_id
        WHERE (t.project_id = ?${projectPublicIdToUse ? ' OR t.project_public_id = ?' : ''}) ${hasIsDeleted && !includeDeleted ? 'AND t.isDeleted != 1' : ''}
        GROUP BY t.id
        ORDER BY t.createdAt DESC
      `;
        params = projectPublicIdToUse ? [resolvedProjectId, projectPublicIdToUse] : [resolvedProjectId];
      } else {
        sql = `
        SELECT
          t.id AS task_internal_id,
          t.public_id AS task_id,
          t.title,
          t.description,
          t.stage,
          t.taskDate,
          t.priority,
          t.time_alloted,
          t.estimated_hours,
          t.status,
          t.createdAt,
          t.updatedAt${optionalSelect},
          c.id AS client_id,
          c.name AS client_name,
          ap.name AS approved_by_name,
          ap.public_id AS approved_by_public_id,
          rj.name AS rejected_by_name,
          rj.public_id AS rejected_by_public_id,
          GROUP_CONCAT(DISTINCT u._id) AS assigned_user_ids,
          GROUP_CONCAT(DISTINCT u.public_id) AS assigned_user_public_ids,
          GROUP_CONCAT(DISTINCT u.name) AS assigned_user_names
        FROM tasks t
        LEFT JOIN clients c ON t.client_id = c.id
        LEFT JOIN users ap ON t.approved_by = ap._id
        LEFT JOIN users rj ON t.rejected_by = rj._id
        LEFT JOIN task_assignments ta ON ta.task_id = t.id
        LEFT JOIN users u ON u._id = ta.user_id
        WHERE t.project_id = ? ${hasIsDeleted && !includeDeleted ? 'AND t.isDeleted != 1' : ''}
        GROUP BY t.id
        ORDER BY t.createdAt DESC
      `;
        params = [resolvedProjectId];
      }
    } else if (tasksHasProjectPublicId) {
      let projectPublicIdToUse = projectParam;
      if (/^\d+$/.test(String(projectParam))) {
        try {
          const hasPub = await hasColumn('projects', 'public_id');
          const r = await new Promise((resolve, reject) => db.query(`SELECT ${hasPub ? 'public_id' : 'id AS public_id'} FROM projects WHERE id = ? LIMIT 1`, [projectParam], (err, rr) => err ? reject(err) : resolve(rr)));
          if (!r || r.length === 0) return res.status(404).json({ success: false, error: 'Project not found' });
          projectPublicIdToUse = r[0].public_id;
        } catch (err) {
          logger.error('Error resolving project id->public_id: ' + (err && err.message));
          return res.status(500).json({ success: false, error: 'Failed resolving project public id' });
        }
      }

      sql = `
        SELECT
          t.id AS task_internal_id,
          t.public_id AS task_id,
          t.title,
          t.description,
          t.stage,
          t.taskDate,
          t.priority,
          t.time_alloted,
          t.estimated_hours,
          t.status,
          t.createdAt,
          t.updatedAt${optionalSelect},
          MIN(c.id) AS client_id,
          MIN(c.name) AS client_name,
          MIN(ap.name) AS approved_by_name,
          MIN(ap.public_id) AS approved_by_public_id,
          MIN(rj.name) AS rejected_by_name,
          MIN(rj.public_id) AS rejected_by_public_id,
          GROUP_CONCAT(DISTINCT u._id) AS assigned_user_ids,
          GROUP_CONCAT(DISTINCT u.public_id) AS assigned_user_public_ids,
          GROUP_CONCAT(DISTINCT u.name) AS assigned_user_names
        FROM tasks t
        LEFT JOIN clients c ON t.client_id = c.id
        LEFT JOIN users ap ON t.approved_by = ap._id
        LEFT JOIN users rj ON t.rejected_by = rj._id
        LEFT JOIN task_assignments ta ON ta.task_id = t.id
        LEFT JOIN users u ON u._id = ta.user_id
        WHERE t.project_public_id = ? ${hasIsDeleted && !includeDeleted ? 'AND t.isDeleted != 1' : ''}
        GROUP BY t.id
        ORDER BY t.createdAt DESC
      `;
      params = [projectPublicIdToUse];
    } else {

      return res.status(500).json({ success: false, error: 'Cannot filter tasks by project: tasks table has no project_id or project_public_id column' });
    }

    db.query(sql, params, (err, rows) => {
      if (err) {
        logger.error('Fetch project tasks error: ' + err.message);
        return res.status(500).json({ success: false, error: err.message });
      }

      const tasks = (rows || []).map(r => {
        const assignedIds = r.assigned_user_ids ? String(r.assigned_user_ids).split(',') : [];
        const assignedPublic = r.assigned_user_public_ids ? String(r.assigned_user_public_ids).split(',') : [];
        const assignedNames = r.assigned_user_names ? String(r.assigned_user_names).split(',') : [];

        const assignedUsers = assignedIds.map((uid, i) => ({
          id: assignedPublic[i] || uid,
          internalId: String(uid),
          name: assignedNames[i] || null
        }));

        const totalSecs = r.total_duration != null ? Number(r.total_duration) : 0;
        const hh = String(Math.floor(totalSecs / 3600)).padStart(2, '0');
        const mm = String(Math.floor((totalSecs % 3600) / 60)).padStart(2, '0');
        const ss = String(totalSecs % 60).padStart(2, '0');
        const humanDuration = `${hh}:${mm}:${ss}`;

        return {
          id: r.task_id ? String(r.task_id) : String(r.task_internal_id),
          title: r.title || null,
          description: r.description || null,
          stage: r.stage || null,
          taskDate: r.taskDate ? new Date(r.taskDate).toISOString() : null,
          day: r.taskDate ? (new Date(r.taskDate).toISOString().split('T')[0]) : null,
          dayName: r.taskDate ? dayjs(r.taskDate).format('ddd') : null,
          priority: r.priority || null,
          timeAlloted: r.time_alloted != null ? Number(r.time_alloted) : null,
          estimatedHours: r.estimated_hours != null ? Number(r.estimated_hours) : (r.time_alloted != null ? Number(r.time_alloted) : null),
          status: r.status || null,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
          updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
          client: r.client_id ? { id: r.client_id, name: r.client_name } : null,
          assignedUsers,
          started_at: r.started_at ? new Date(r.started_at).toISOString() : null,
          live_timer: r.live_timer ? new Date(r.live_timer).toISOString() : null,
          total_time_seconds: totalSecs,
          total_time_hours: Number((totalSecs / 3600).toFixed(2)),
          total_time_hhmmss: humanDuration,
          completed_at: r.completed_at ? new Date(r.completed_at).toISOString() : null,
          approved_by: r.approved_by_name ? {
            id: r.approved_by_public_id,
            name: r.approved_by_name
          } : null,
          approved_at: r.approved_at ? new Date(r.approved_at).toISOString() : null,
          rejection: r.rejection_reason ? {
            reason: r.rejection_reason,
            rejected_by: r.rejected_by_name ? {
              id: r.rejected_by_public_id,
              name: r.rejected_by_name
            } : null,
            rejected_at: r.rejected_at ? new Date(r.rejected_at).toISOString() : null
          } : null,
          summary: (() => {
            try {
              const now = new Date();
              const est = r.taskDate ? new Date(r.taskDate) : null;
              if (!est) return {};
              return { dueStatus: est < now ? 'Overdue' : 'On Time', dueDate: est.toISOString() };
            } catch (e) { return {}; }
          })()
        };
      });

      return res.json({ success: true, data: tasks, meta: { count: tasks.length } });
    });
  } catch (e) {
    logger.error('Error in project tasks endpoint: ' + (e && e.message));
    return res.status(500).json({ success: false, error: e.message });
  }
});


router.put('/:id', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  const { id: taskId } = req.params;
  let {
    stage, title, priority, description, client_id, projectId, projectPublicId,
    taskDate, time_alloted, estimatedHours, timeAlloted, assigned_to, handleResignationRequestId
  } = req.body;

  // Normalize time_alloted (could come as time_alloted, timeAlloted, or estimatedHours)
  const finalTimeAlloted = time_alloted || timeAlloted || estimatedHours;

  logger.info(`[PUT /tasks/:id] Updating task: taskId=${taskId}`);

  try {
    // Resolve projectId if it's a public string ID instead of a numeric internal ID
    if (projectId && !/^\d+$/.test(String(projectId))) {
      projectPublicId = projectId;
      projectId = undefined;
    }

    if (projectPublicId && !projectId) {
      const projRows = await q('SELECT id FROM projects WHERE public_id = ? LIMIT 1', [projectPublicId]);
      if (projRows.length > 0) {
        projectId = projRows[0].id;
      } else {
        return res.status(400).json(errorResponse.badRequest('Invalid projectId format or project not found', 'INVALID_PROJECT_ID'));
      }
    }

    const taskRow = await q('SELECT id FROM tasks WHERE public_id = ? OR id = ?', [taskId, taskId]);
    if (taskRow.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const internalTaskId = taskRow[0].id;

    try {
      const projRows = await q('SELECT project_id FROM tasks WHERE id = ? LIMIT 1', [internalTaskId]);
      const projId = projRows && projRows[0] ? projRows[0].project_id : null;
      await ensureProjectOpen(projId);
    } catch (err) {
      return res.status(err.status || 403).json({ success: false, error: err.message });
    }

    db.getConnection((err, connection) => {
      if (err) {
        logger.error(`DB connection error: ${err}`);
        return res.status(500).json(errorResponse.serverError('Database connection failed', 'DB_CONNECTION_ERROR'));
      }

      (async () => {
        try {
          // Check if user has permission to edit this task
          const userCanEdit = await canEditTask(internalTaskId, req.user);
          if (!userCanEdit) {
            connection.release();
            return res.status(403).json(errorResponse.forbidden('You do not have permission to edit this task', 'ACCESS_DENIED'));
          }

          let reassignmentRequest = null;
          let oldAssigneeEmail = null;
          let oldAssigneeName = 'Previous Assignee';

          if (handleResignationRequestId) {

            const requestRows = await new Promise((resolve, reject) =>
              connection.query(
                'SELECT requested_by FROM task_resign_requests WHERE id = ? AND status = "APPROVED"',
                [handleResignationRequestId],
                (e, r) => e ? reject(e) : resolve(r)
              )
            );

            if (requestRows.length > 0) {
              const requestedById = requestRows[0].requested_by;

              const userRows = await new Promise((resolve, reject) =>
                connection.query(
                  'SELECT _id, name, email FROM users WHERE _id = ?',
                  [requestedById],
                  (e, r) => e ? reject(e) : resolve(r)
                )
              );

              if (userRows.length > 0) {
                reassignmentRequest = userRows[0];
                oldAssigneeEmail = userRows[0].email;
                oldAssigneeName = userRows[0].name || 'Previous Assignee';
              }
            }
          }

          const updates = [];
          const values = [];

          if (stage !== undefined) { updates.push('stage = ?'); values.push(stage); }
          if (title !== undefined) { updates.push('title = ?'); values.push(title); }
          if (priority !== undefined) { updates.push('priority = ?'); values.push(priority); }
          if (description !== undefined) { updates.push('description = ?'); values.push(description); }
          if (client_id !== undefined) { updates.push('client_id = ?'); values.push(client_id); }
          if (taskDate !== undefined) { updates.push('taskDate = ?'); values.push(toMySQLDate(taskDate)); }
          if (finalTimeAlloted !== undefined) { updates.push('time_alloted = ?'); values.push(finalTimeAlloted); }

          // Only update project fields if they exist as columns
          if (projectId !== undefined && await hasColumn('tasks', 'project_id')) { updates.push('project_id = ?'); values.push(projectId); }
          if (projectPublicId !== undefined && await hasColumn('tasks', 'project_public_id')) { updates.push('project_public_id = ?'); values.push(projectPublicId); }

          updates.push('updatedAt = ?');
          values.push(toMySQLDate(new Date()));
          values.push(internalTaskId);

          if (updates.length === 1) {
            connection.release();
            return res.status(400).json(errorResponse.badRequest('No fields to update', 'NO_FIELDS_PROVIDED'));
          }

          const updateTaskQuery = `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`;
          connection.query(updateTaskQuery, values, async (err, result) => {
            if (err) {
              connection.release();
              logger.error(`Error updating task: ${err.message}`, { err, query: updateTaskQuery });
              return res.status(500).json(errorResponse.databaseError('Database update failed', 'DB_UPDATE_ERROR', { details: err.message, code: err.code }));
            }

            if (result.affectedRows === 0) {
              connection.release();
              return res.status(404).json({ success: false, message: 'Task not found' });
            }

            let reassigned = false;
            let finalAssignedUserIds = [];
            let emailStatus = null;

            try {
              if (Array.isArray(assigned_to) && assigned_to.length > 0) {

                if (assigned_to.length !== 1) {
                  connection.release();
                  return res.status(400).json({ success: false, error: 'Tasks must have exactly one assignee (single-user ownership)' });
                }

                const currentAssignees = await new Promise((resolve, reject) =>
                  connection.query('SELECT user_id FROM task_assignments WHERE task_id = ?',
                    [internalTaskId], (e, r) => e ? reject(e) : resolve(r))
                );
                const currentUserIds = currentAssignees.map(r => String(r.user_id));

                const numericIds = assigned_to.filter(v => /^\d+$/.test(String(v))).map(String);
                const publicIds = assigned_to.filter(v => !/^\d+$/.test(String(v))).map(String);
                let newUserIds = [...numericIds];

                if (publicIds.length > 0) {
                  const rows = await new Promise((resolve, reject) =>
                    connection.query('SELECT _id FROM users WHERE public_id IN (?)',
                      [publicIds], (e, r) => e ? reject(e) : resolve(r))
                  );
                  rows.forEach(r => { if (r && r._id) newUserIds.push(String(r._id)); });
                }
                newUserIds = Array.from(new Set(newUserIds));

                if (newUserIds.length !== 1) {
                  connection.release();
                  return res.status(400).json({ success: false, error: 'Invalid assignee data' });
                }

                const newAssigneeId = newUserIds[0];
                const hasActiveForNew = await assigneeHasActiveTask(newAssigneeId, internalTaskId);
                if (hasActiveForNew) {
                  connection.release();
                  return res.status(400).json(errorResponse.assignmentError('The selected assignee already has an active task and cannot be reassigned another until it is completed', 'ASSIGNEE_ALREADY_ASSIGNED', { userId: newAssigneeId }));
                }

                await new Promise((resolve, reject) =>
                  connection.query('DELETE FROM task_assignments WHERE task_id = ?', [internalTaskId], (e) => e ? reject(e) : resolve())
                );

                await new Promise((resolve, reject) =>
                  connection.query(
                    'INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)',
                    [internalTaskId, newAssigneeId], (e) => e ? reject(e) : resolve()
                  )
                );

                // Initialize per-user assignment status and copy checklist for new assignee
                try {
                  await ensureTaskAssignmentStatusTable();
                  await q(
                    `INSERT IGNORE INTO task_assignment_status (task_id, user_id, tenant_id, status) VALUES (?, ?, ?, 'PENDING')`,
                    [internalTaskId, newAssigneeId, req.user.tenant_id || null]
                  );
                  await ensureUserChecklistProgressTable();
                  const _hasDelCol = await hasColumn('subtasks', 'isDeleted');
                  const _delFilter = _hasDelCol ? 'AND (isDeleted IS NULL OR isDeleted != 1)' : '';
                  const subtasksForReassign = await q(
                    `SELECT id FROM subtasks WHERE task_id = ? ${_delFilter}`,
                    [internalTaskId]
                  );
                  for (const subtask of (subtasksForReassign || [])) {
                    await q(
                      `INSERT IGNORE INTO user_checklist_progress (task_id, user_id, subtask_id, tenant_id, status) VALUES (?, ?, ?, ?, 'PENDING')`,
                      [internalTaskId, newAssigneeId, subtask.id, req.user.tenant_id || null]
                    );
                  }
                } catch (initErr) {
                  logger.warn('Could not initialize per-user data for reassigned user: ' + initErr.message);
                }

                const previousAssignees = currentUserIds.filter(id => id !== newAssigneeId);
                if (previousAssignees.length > 0) {
                  for (const prevId of previousAssignees) {
                    await new Promise((resolve, reject) =>
                      connection.query(
                        'INSERT INTO task_assignments (task_id, user_id, is_read_only) VALUES (?, ?, 1)',
                        [internalTaskId, prevId], (e) => e ? reject(e) : resolve()
                      )
                    );
                  }
                }

                reassigned = true;
                finalAssignedUserIds = [newAssigneeId];
              }

              const fetchSql = `
                SELECT t.id,
                  ANY_VALUE(t.public_id) AS public_id,
                  ANY_VALUE(t.title) AS title,
                  ANY_VALUE(t.description) AS description,
                  ANY_VALUE(t.stage) AS stage,
                  ANY_VALUE(t.taskDate) AS taskDate,
                  ANY_VALUE(t.priority) AS priority,
                  ANY_VALUE(t.status) AS status,
                  ANY_VALUE(t.time_alloted) AS time_alloted,
                  ANY_VALUE(t.total_duration) AS total_duration,
                  ANY_VALUE(t.started_at) AS started_at,
                  ANY_VALUE(t.live_timer) AS live_timer,
                  ANY_VALUE(t.completed_at) AS completed_at,
                  ANY_VALUE(t.createdAt) AS createdAt,
                  ANY_VALUE(t.updatedAt) AS updatedAt,
                  c.name AS client_name,
                  GROUP_CONCAT(DISTINCT u._id) AS assigned_user_ids,
                  GROUP_CONCAT(DISTINCT u.public_id) AS assigned_user_public_ids,
                  GROUP_CONCAT(DISTINCT u.name) AS assigned_user_names,
                  GROUP_CONCAT(DISTINCT u.email) AS assigned_user_emails
                FROM tasks t
                LEFT JOIN clients c ON t.client_id = c.id
                LEFT JOIN task_assignments ta ON ta.task_id = t.id
                LEFT JOIN users u ON u._id = ta.user_id
                WHERE t.id = ? GROUP BY t.id LIMIT 1
              `;

              const rows = await new Promise((resolve, reject) =>
                connection.query(fetchSql, [internalTaskId], (e, r) => e ? reject(e) : resolve(r))
              );

              const taskObj = rows.length > 0 ? {
                id: rows[0].public_id || String(rows[0].id),
                title: rows[0].title,
                description: rows[0].description,
                stage: rows[0].stage,
                taskDate: rows[0].taskDate ? new Date(rows[0].taskDate).toISOString() : null,
                day: rows[0].taskDate ? (new Date(rows[0].taskDate).toISOString().split('T')[0]) : null,
                dayName: rows[0].taskDate ? dayjs(rows[0].taskDate).format('ddd') : null,
                priority: rows[0].priority,
                timeAlloted: rows[0].time_alloted ? Number(rows[0].time_alloted) : null,
                client: rows[0].client_id ? { id: String(rows[0].client_id), name: rows[0].client_name } : null,
                assignedUsers: (rows[0].assigned_user_ids?.split(',') || []).map((uid, i) => ({
                  id: rows[0].assigned_user_public_ids?.split(',')[i] || uid,
                  internalId: String(uid),
                  name: rows[0].assigned_user_names?.split(',')[i] || null,
                  email: rows[0].assigned_user_emails?.split(',')[i] || null
                }))
              } : { taskId };

              try {
                const dayStr = rows[0].taskDate ? (new Date(rows[0].taskDate).toISOString().split('T')[0]) : null;
                if (dayStr) {
                  if (await hasColumn('tasks', 'task_day')) {
                    await new Promise((res2, rej2) => connection.query('UPDATE tasks SET task_day = ? WHERE id = ?', [dayStr, internalTaskId], (e) => e ? rej2(e) : res2()));
                  }
                  if (await hasColumn('tasks', 'day')) {
                    await new Promise((res2, rej2) => connection.query('UPDATE tasks SET day = ? WHERE id = ?', [dayStr, internalTaskId], (e) => e ? rej2(e) : res2()));
                  }
                }
              } catch (e) { logger.warn('Failed to persist day column on update: ' + (e && e.message)); }

              if (reassigned && Array.isArray(taskObj.assignedUsers)) {
                try {
                  const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || '';
                  const taskLink = `${baseUrl}/tasks/${taskId}`;

                  const requesterId = req.user?._id ? String(req.user._id) : null;
                  const newAssignees = taskObj.assignedUsers.filter(u => u.internalId !== requesterId);

                  // send only to new assignees and the old assignee, and only if the email exists in users table
                  let anySent = false;
                  for (const user of newAssignees) {
                    const payload = emailService.taskReassignmentApprovedTemplate({
                      taskTitle: taskObj.title,
                      taskId,
                      oldAssignee: oldAssigneeName,
                      newAssignee: user.name,
                      taskLink
                    });
                    const sent = await safeSendEmailForTask(taskId, user.email, payload);
                    anySent = anySent || !!sent;
                  }

                  const oldPayload = emailService.taskReassignmentOldAssigneeTemplate({
                    taskTitle: taskObj.title,
                    newAssignees: newAssignees.map(u => u.name).join(', '),
                    taskLink
                  });
                  const oldSent = await safeSendEmailForTask(taskId, oldAssigneeEmail, oldPayload);
                  anySent = anySent || !!oldSent;

                  emailStatus = anySent ? { sent: true } : { sent: false };
                } catch (mailErr) {
                  logger.error(`Email failed for task=${taskId}: ${mailErr && mailErr.message}`);
                }
              }

              try {
                const auditController = require('./auditController');
                auditController.log({
                  user_id: req.user._id,
                  tenant_id: req.user.tenant_id,
                  action: 'UPDATE_TASK',
                  entity: 'Task',
                  entity_id: String(taskId),
                  details: { title: taskObj.title, updates: req.body }
                });
              } catch (auditErr) {
                logger.warn('Failed to log update_task audit:', auditErr);
              }

              connection.release();

              res.status(200).json({
                success: true,
                message: 'Task updated successfully',
                data: taskObj,
                emailStatus,
                reassigned,
                assignedToCount: finalAssignedUserIds.length
              });

            } catch (e) {
              connection.release();
              logger.error(`Post-update failed: ${e.message}`);
              res.status(500).json({ success: false, error: 'Post-update failed', details: e.message });
            }
          });

        } catch (error) {
          connection.release();
          logger.error(`Setup error: ${error.message}`);
          res.status(500).json({ success: false, error: 'Setup failed', details: error.message });
        }
      })();

    });

  } catch (error) {
    logger.error(`Unexpected error: ${error.message}`);
    res.status(500).json({ success: false, error: 'Server error', details: error.message });
  }
});
router.patch('/:taskId/reassign/:userId', ruleEngine('task_reassign'), requireRole(['Manager', 'Admin']), async (req, res) => {
  let { taskId, userId } = req.params;
  let { approve, newAssigneeId } = req.body;
  try {
    if (!/^\d+$/.test(taskId)) {
      const tRows = await q('SELECT id FROM tasks WHERE public_id = ?', [taskId]);
      if (tRows.length) taskId = tRows[0].id;
    }
    if (!/^\d+$/.test(userId)) {
      const uRows = await q('SELECT _id FROM users WHERE public_id = ?', [userId]);
      if (uRows.length) userId = uRows[0]._id;
    }
    if (newAssigneeId && !/^\d+$/.test(newAssigneeId)) {
      const uRows = await q('SELECT _id FROM users WHERE public_id = ?', [newAssigneeId]);
      if (uRows.length) newAssigneeId = uRows[0]._id;
    }

    if (approve) {

      await q('UPDATE task_assignments SET is_read_only = 1 WHERE task_id = ? AND user_id = ?', [taskId, userId]);
      if (newAssigneeId) {
        const exists = await q('SELECT 1 FROM task_assignments WHERE task_id = ? AND user_id = ?', [taskId, newAssigneeId]);
        if (!exists.length) {
          const hasActive = await assigneeHasActiveTask(newAssigneeId);
          if (hasActive) return res.status(400).json(errorResponse.assignmentError('The selected assignee already has an active task and cannot be assigned another until it is completed', 'ASSIGNEE_ALREADY_ASSIGNED', { userId: newUserIds[0] }));
          await q('INSERT INTO task_assignments (task_id, user_id, is_read_only) VALUES (?, ?, 0)', [taskId, newAssigneeId]);
        }
      }

      const [[oldUser], [newUser], [task]] = await Promise.all([
        q('SELECT name, email FROM users WHERE _id = ?', [userId]),
        newAssigneeId ? q('SELECT name, email FROM users WHERE _id = ?', [newAssigneeId]) : [{}],
        q('SELECT title FROM tasks WHERE id = ?', [taskId])
      ]);
      const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || '';
      const taskLink = `${baseUrl}/tasks/${taskId}`;

      if (newUser && newUser.email) {
        try {
          await safeSendEmailForTask(taskId, newUser.email, emailService.taskReassignmentApprovedTemplate({
            taskTitle: task?.title || '',
            oldAssignee: oldUser?.name || '',
            newAssignee: newUser?.name || '',
            taskLink
          }));
        } catch (e) {
          logger.error(`Failed to queue email to new assignee for task=${taskId}: ${e && e.message}`);
        }
      }

      if (oldUser && oldUser.email) {
        try {
          await safeSendEmailForTask(taskId, oldUser.email, emailService.taskReassignmentOldAssigneeTemplate({
            taskTitle: task?.title || '',
            newAssignee: newUser?.name || '',
            taskLink
          }));
        } catch (e) {
          logger.error(`Failed to queue email to old assignee for task=${taskId}: ${e && e.message}`);
        }
      }
      return res.json({ success: true });
    } else {

      await q('UPDATE task_assignments SET status = ?, is_read_only = 0 WHERE task_id = ? AND user_id = ?', ['ACTIVE', taskId, userId]);

      const [[oldUser], [task]] = await Promise.all([
        q('SELECT name, email FROM users WHERE _id = ?', [userId]),
        q('SELECT title FROM tasks WHERE id = ?', [taskId])
      ]);
      const baseUrl = process.env.FRONTEND_URL || process.env.BASE_URL || '';
      const taskLink = `${baseUrl}/tasks/${taskId}`;
      if (oldUser && oldUser.email) {
        try {
          await safeSendEmailForTask(taskId, oldUser.email, emailService.taskReassignmentRejectedTemplate({
            taskTitle: task?.title || '',
            taskLink
          }));
        } catch (e) {
          logger.error(`Failed to queue rejection email for task=${taskId}, recipient=${oldUser.email}: ${e && e.message}`);
        }
      }
      return res.json({ success: true });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



router.patch('/:id/status', ruleEngine('task_status_update'), requireRole(['Employee']), async (req, res) => {
  try {
    await ensureTaskTimeLogsTable();
    return applyTenantTaskStatus(req, res);

    const { id } = req.params;
    const { status, projectId, taskId } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, message: 'Status is required' });
    }

    if (!projectId) {
      return res.status(400).json({ success: false, message: 'projectId is required' });
    }

    if (!taskId) {
      return res.status(400).json({ success: false, message: 'taskId is required' });
    }

    const validStatuses = ['PENDING', 'To Do', 'In Progress', 'On Hold', 'Review', 'Completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    let resolvedTaskId = req.params.id;
    if (isNaN(id)) {
      const taskRows = await q('SELECT id FROM tasks WHERE public_id = ? LIMIT 1', [id]);
      if (!taskRows || taskRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }
      resolvedTaskId = taskRows[0].id;
    }

    let resolvedProjectId = req.body.projectId;
    if (isNaN(projectId)) {

      const projectRows = await q('SELECT id FROM projects WHERE public_id = ? LIMIT 1', [projectId]);
      if (!projectRows || projectRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Project not found' });
      }
      resolvedProjectId = projectRows[0].id;
    }

    const hasReadOnlyColumn = await hasColumn('task_assignments', 'is_read_only');
    const selectColumns = hasReadOnlyColumn ? 't.*, ta.user_id, ta.is_read_only, p.public_id as project_public_id' : 't.*, ta.user_id, p.public_id as project_public_id';
    const readOnlyCondition = hasReadOnlyColumn ? ' AND (ta.is_read_only IS NULL OR ta.is_read_only != 1)' : '';
    const taskQuery = `
      SELECT ${selectColumns}
      FROM tasks t
      JOIN task_assignments ta ON t.id = ta.task_id
      LEFT JOIN projects p ON t.project_id = p.id
      WHERE t.id = ? AND ta.user_id = ? AND t.project_id = ?${readOnlyCondition}
      LIMIT 1
    `;
    const tasks = await q(taskQuery, [resolvedTaskId, req.user._id, resolvedProjectId]);

    if (!tasks || tasks.length === 0) {
      return res.status(404).json({ success: false, message: 'Task not found, not assigned to you with full access, or does not belong to the specified project' });
    }

    try {
      await ensureProjectOpen(resolvedProjectId);
    } catch (err) {
      return res.status(err.status || 403).json({ success: false, message: err.message });
    }

    const task = tasks[0];
    const currentStatusStr = task.status || task.stage || 'PENDING';

    const normalizedCurrent = currentStatusStr.toUpperCase();
    const normalizedTarget = status.toUpperCase();


    const allowedTransitions = {
      'PENDING': ['TO DO', 'IN PROGRESS'],
      'TO DO': ['IN PROGRESS'],
      'IN PROGRESS': ['ON HOLD', 'REVIEW'],
      'ON HOLD': ['IN PROGRESS'],
      'REVIEW': ['IN PROGRESS'],  // Allow employee to move back from REVIEW to IN PROGRESS
      'COMPLETED': []
    };

    const allowedNext = allowedTransitions[normalizedCurrent] || [];
    if (!allowedNext.includes(normalizedTarget)) {
      return res.status(400).json({
        success: false,
        message: `Invalid transition from '${currentStatusStr}' to '${status}'. Allowed: ${allowedNext.join(', ')}`
      });
    }

    let workflowMessage = null;
    let workflowData = {};

    if (normalizedTarget === 'REVIEW') {
      const tenantId = req.tenantId || (req.user && req.user.tenant_id) || null;
      if (tenantId === null || tenantId === undefined) {
        return res.status(400).json({ success: false, error: 'Tenant context is required' });
      }
      logger.debug(`[DEBUG] Requesting transition for tenantId: ${tenantId}, task: ${resolvedTaskId}`);
      const transitionResult = await workflowService.requestTransition({
        tenantId,
        entityType: 'TASK',
        entityId: resolvedTaskId,
        toState: 'COMPLETED',
        userId: req.user._id,
        role: req.user.role,
        projectId: resolvedProjectId,
        meta: { reason: 'Employee requesting task completion' }
      });

      if (transitionResult && transitionResult.requestId) {
        workflowMessage = 'Review requested — sent for manager approval';
        workflowData = { requestId: transitionResult.requestId };
      } else {
        if (transitionResult && transitionResult.taskStatus === 'COMPLETED') {
          await q('UPDATE tasks SET status = ?, updatedAt = NOW() WHERE id = ?', ['Completed', resolvedTaskId]);
          return res.json({ success: true, message: 'Task completed directly', data: { status: 'Completed' } });
        }
      }
    }

    await q('UPDATE tasks SET status = ?, updatedAt = NOW() WHERE id = ?', [status, resolvedTaskId]);

    const now = new Date();
    if ((normalizedTarget === 'REVIEW' || normalizedTarget === 'COMPLETED' || normalizedTarget === 'ON HOLD') && normalizedCurrent === 'IN PROGRESS') {
      const lastLog = await q('SELECT timestamp FROM task_time_entries WHERE task_id = ? AND (action = ? OR action = ?) ORDER BY timestamp DESC LIMIT 1', [resolvedTaskId, 'start', 'resume']);
      let duration = 0;
      if (lastLog.length > 0) {
        duration = Math.floor((now - new Date(lastLog[0].timestamp)) / 1000);
      }

      const action = normalizedTarget === 'REVIEW' ? 'pause' : (normalizedTarget === 'COMPLETED' ? 'complete' : 'pause');
      try {
        await q('INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds) VALUES (?, ?, \'event\', ?, ?, ?)',
          [resolvedTaskId, req.user._id, action, now, duration]);
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }

      const timerUpdate = normalizedTarget === 'COMPLETED'
        ? 'completed_at = ?, total_duration = COALESCE(total_duration, 0) + ?, live_timer = NULL'
        : 'total_duration = COALESCE(total_duration, 0) + ?, live_timer = NULL';
      const params = normalizedTarget === 'COMPLETED' ? [now, duration, resolvedTaskId] : [duration, resolvedTaskId];

      await q(`UPDATE tasks SET ${timerUpdate} WHERE id = ?`, params);
    }
    else if (normalizedTarget === 'IN PROGRESS' && normalizedCurrent !== 'IN PROGRESS') {

      const action = (normalizedCurrent === 'ON HOLD') ? 'resume' : 'start';
      if (action === 'start') {
        await q('UPDATE tasks SET started_at = ?, live_timer = ? WHERE id = ?', [now, now, resolvedTaskId]);
      } else {
        await q('UPDATE tasks SET live_timer = ? WHERE id = ?', [now, resolvedTaskId]);
      }
      try {
        await q('INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp) VALUES (?, ?, \'event\', ?, ?)',
          [resolvedTaskId, req.user._id, action, now]);
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }
    }

    const updatedTask = await q('SELECT * FROM tasks WHERE id = ? LIMIT 1', [resolvedTaskId]);
    const t = updatedTask[0] || {};
    const totalSeconds = Number(t.total_duration || 0);
    const totalHoursFloat = totalSeconds / 3600;
    const hh = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    const humanDuration = `${hh}:${mm}:${ss}`;

    const projectIdForAgg = task.project_id || resolvedProjectId;
    let projectHours = 0;
    if (projectIdForAgg) {
      const ph = await q('SELECT SUM(total_duration) as totalHours FROM tasks WHERE project_id = ?', [projectIdForAgg]);
      projectHours = Number((ph && ph[0] && ph[0].totalHours) || 0);

      try {
        const projHasTotalSec = await hasColumn('projects', 'total_hours_seconds');
        if (projHasTotalSec) {
          await q('UPDATE projects SET total_hours_seconds = ? WHERE id = ?', [projectHours, projectIdForAgg]);
        }
        const projHasTotalHours = await hasColumn('projects', 'total_hours');
        if (projHasTotalHours) {
          await q('UPDATE projects SET total_hours = ? WHERE id = ?', [Number((projectHours / 3600).toFixed(2)), projectIdForAgg]);
        }
      } catch (persistErr) {
        logger.warn('Failed to persist project hours:', persistErr && persistErr.message);
      }
    }

    await NotificationService.createAndSend(
      [req.user._id],
      'Task Status Changed',
      `Task status updated to ${status}: ${task.title}`,
      'TASK_STATUS_CHANGED',
      'task',
      task.public_id
    );

    await NotificationService.createAndSendToRoles(['Manager'],
      'Task Status Updated',
      `Task "${task.title}" status changed to ${status}`,
      'TASK_STATUS_CHANGED',
      'task',
      task.public_id,
      req.user.tenant_id
    );

    res.json({
      success: true,
      message: normalizedTarget === 'REVIEW'
        ? `Task "${task.title}" has been moved to Review and sent to the manager for final approval.`
        : (normalizedTarget === 'COMPLETED' ? `Task "${task.title}" marked as Completed.` : `Task status updated to ${status}`),
      data: {
        projectId: task.project_public_id || resolvedProjectId,
        taskId: task.public_id,
        status: t.status,
        total_time_seconds: totalSeconds,
        total_time_hours: Number(totalHoursFloat.toFixed(2)),
        total_time_hhmmss: humanDuration,
        started_at: t.started_at,
        completed_at: t.completed_at,
        live_timer: t.live_timer,
        task: {
          id: t.id,
          public_id: t.public_id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          stage: t.stage,
          status: t.status,
          taskDate: t.taskDate,
          day: t.taskDate ? (new Date(t.taskDate).toISOString().split('T')[0]) : null,
          dayName: t.taskDate ? dayjs(t.taskDate).format('ddd') : null,
        },

        project_total_time_seconds: projectHours,
        project_total_time_hours: Number((projectHours / 3600).toFixed(2))
      }
    });
  } catch (e) {
    logger.error('Update task status error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.delete('/:id', ruleEngine('task_delete'), requireRole(['Admin', 'Manager']), (req, res) => {
  const { id: taskId } = req.params;

  logger.info(`[DELETE /tasks/:id] Deleting task: taskId=${taskId}`);

  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'DB connection error' });
    }

    (async () => {
      try {

        const findTaskSql = 'SELECT id FROM tasks WHERE id = ? OR public_id = ?';
        const taskResult = await new Promise((resolve, reject) => {
          connection.query(findTaskSql, [taskId, taskId], (qErr, qRes) => {
            if (qErr) reject(qErr);
            else resolve(qRes);
          });
        });

        if (!taskResult || taskResult.length === 0) {
          connection.release();
          return res.status(404).json({ success: false, error: 'Task not found' });
        }

        const internalTaskId = taskResult[0].id;

        connection.beginTransaction((err) => {
          if (err) {
            connection.release();
            return res.status(500).json({ success: false, error: 'Transaction error' });
          }

          const tasksToRun = [
            { sql: 'DELETE FROM task_assignments WHERE task_id = ?', params: [internalTaskId] },
            { sql: 'DELETE FROM task_assignments WHERE task_id = ?', params: [internalTaskId] },
            { sql: 'DELETE FROM subtasks WHERE task_id = ?', params: [internalTaskId] },
            { sql: 'DELETE FROM task_time_entries WHERE task_id = ?', params: [internalTaskId] },
            { sql: 'DELETE FROM task_logs WHERE task_id = ?', params: [internalTaskId] },
            { sql: 'DELETE FROM tasks WHERE id = ?', params: [internalTaskId] },
          ];

          const runStep = (idx) => {
            if (idx >= tasksToRun.length) {
              connection.commit((err) => {
                if (err) {
                  return connection.rollback(() => {
                    connection.release();
                    return res.status(500).json({ success: false, error: 'Commit error' });
                  });
                }
                connection.release();
                logger.info(`Task deleted successfully: taskId=${taskId}`);
                return res.status(200).json({ success: true, message: 'Task deleted successfully' });
              });
              return;
            }

            const step = tasksToRun[idx];
            connection.query(step.sql, step.params, (qErr, qRes) => {
              if (qErr) {
                return connection.rollback(() => {
                  connection.release();
                  return res.status(500).json({ success: false, error: 'Delete failed', details: qErr.message });
                });
              }
              runStep(idx + 1);
            });
          };

          runStep(0);
        });
      } catch (e) {
        connection.release();
        return res.status(500).json({ success: false, error: 'Unexpected error', details: e && e.message });
      }
    })();
  });
});

router.get("/taskdropdownfortaskHrs", async (req, res) => {
  try {
    const userId = req.query.user_id;
    const query = `
      SELECT t.id, t.title 
      FROM tasks t
      JOIN task_assignments ta ON t.id = ta.task_id
      WHERE ta.user_id = ?
    `;

    db.query(query, [userId], (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Failed to fetch tasks" });
      }
      if (!Array.isArray(results)) {
        return res
          .status(500)
          .json({ error: "Unexpected query result format" });
      }
      res.status(200).json(results);
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch tasks" });
  }
});

router.get("/gettaskss", (req, res) => {
  const user = req.user;
  const role = user && user.role;

  const filterUserParam = req.query.userId;

  const buildAndRun = async (resolvedUserId) => {
    let query = `
      SELECT 
          t.id AS task_id, 
          c.name AS client_name,
          t.title, 
          t.description,
          t.stage, 
          t.taskDate, 
          t.priority, 
          t.createdAt, 
          t.updatedAt, 
          t.status,
          t.rejection_reason,
          t.rejected_at,
          u._id AS user_id, 
          u.name AS user_name, 
          u.role AS user_role,
          rj.name AS rejected_by_name,
          rj.public_id AS rejected_by_public_id
      FROM 
          tasks t
      LEFT JOIN 
          task_assignments ta ON t.id = ta.task_id
      LEFT JOIN 
          users u ON ta.user_id = u._id
      LEFT JOIN 
          clients c ON t.client_id = c.id
      LEFT JOIN
          users rj ON t.rejected_by = rj._id
    `;

    if (role === 'Employee') {
      query += ` WHERE t.id IN (
          SELECT task_id FROM task_assignments WHERE user_id = ?
      )`;
    }

    if (resolvedUserId && role !== 'Employee') {
      if (query.includes('WHERE')) {
        query = query.replace(/ORDER BY[\s\S]*$/m, '');
        query += ` AND t.id IN (SELECT task_id FROM task_assignments WHERE user_id = ?)`;
      } else {
        query += ` WHERE t.id IN (SELECT task_id FROM task_assignments WHERE user_id = ?)`;
      }
    }
    query += ` 
    ORDER BY 
      CASE t.priority
        WHEN 'HIGH' THEN 
          CASE t.stage
            WHEN 'TODO' THEN 1
            WHEN 'IN_PROGRESS' THEN 2
            WHEN 'COMPLETED' THEN 3
            ELSE 4
          END
        WHEN 'MEDIUM' THEN 
          CASE t.stage
            WHEN 'TODO' THEN 5
            WHEN 'IN_PROGRESS' THEN 6
            WHEN 'COMPLETED' THEN 7
            ELSE 8
          END
        WHEN 'LOW' THEN 
          CASE t.stage
            WHEN 'TODO' THEN 9
            WHEN 'IN_PROGRESS' THEN 10
            WHEN 'COMPLETED' THEN 11
            ELSE 12
          END
        ELSE 13
      END,
      t.createdAt ASC;
    `;

    try {
      const hasIsDeletedList = await hasColumn('tasks', 'isDeleted');
      const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
      if (hasIsDeletedList && !includeDeleted) {
        if (query.includes('WHERE')) {
          query = query.replace(/ORDER BY[\s\S]*$/m, '');
          query += ` AND t.isDeleted != 1 `;
        } else {
          query = query.replace(/ORDER BY[\s\S]*$/m, '');
          query += ` WHERE t.isDeleted != 1 `;
        }

        query += ` ORDER BY 
      CASE t.priority
        WHEN 'HIGH' THEN 
          CASE t.stage
            WHEN 'TODO' THEN 1
            WHEN 'IN_PROGRESS' THEN 2
            WHEN 'COMPLETED' THEN 3
            ELSE 4
          END
        WHEN 'MEDIUM' THEN 
          CASE t.stage
            WHEN 'TODO' THEN 5
            WHEN 'IN_PROGRESS' THEN 6
            WHEN 'COMPLETED' THEN 7
            ELSE 8
          END
        WHEN 'LOW' THEN 
          CASE t.stage
            WHEN 'TODO' THEN 9
            WHEN 'IN_PROGRESS' THEN 10
            WHEN 'COMPLETED' THEN 11
            ELSE 12
          END
        ELSE 13
      END,
      t.createdAt ASC;`;
      }
    } catch (err) {

    }

    const queryParams = role === 'Employee' ? [resolvedUserId] : (resolvedUserId ? [resolvedUserId] : []);

    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).send("Error fetching tasks");
      }

      const tasks = {};
      results.forEach((row) => {
        if (!tasks[row.task_id]) {
          tasks[row.task_id] = {
            task_id: row.task_id,
            client_name: row.client_name,
            title: row.title,
            description: row.description,
            stage: row.stage,
            status: row.status,
            rejection: row.rejection_reason ? {
              reason: row.rejection_reason,
              rejectedBy: row.rejected_by_name || 'Manager',
              rejectedAt: row.rejected_at,
              id: row.rejected_by_public_id
            } : null,
            taskDate: row.taskDate,
            day: row.taskDate ? (new Date(row.taskDate).toISOString().split('T')[0]) : null,
            dayName: row.taskDate ? dayjs(row.taskDate).format('ddd') : null,
            priority: row.priority,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            assigned_users: [],
          };
        }

        if (row.user_id) {
          tasks[row.task_id].assigned_users.push({
            user_id: row.user_id,
            user_name: row.user_name,
            user_role: row.user_role,
          });
        }
      });

      try {
        const userIds = new Set();
        Object.values(tasks).forEach(t => t.assigned_users.forEach(u => { if (u.user_id) userIds.add(u.user_id); }));
        if (userIds.size > 0) {
          const idsArr = Array.from(userIds);
          db.query('SELECT _id, public_id FROM users WHERE _id IN (?)', [idsArr], (errU, rowsU) => {
            if (!errU && Array.isArray(rowsU)) {
              const map = {};
              rowsU.forEach(r => { if (r && r._id) map[r._id] = r.public_id || r._id; });
              Object.values(tasks).forEach(t => {
                t.assigned_users = t.assigned_users.map(u => ({ user_id: map[u.user_id] || u.user_id, user_name: u.user_name, user_role: u.user_role }));
              });
            }

            const sortedTasks = Object.values(tasks).sort((a, b) => {
              const priorityOrder = { HIGH: 1, MEDIUM: 2, LOW: 3 };
              const stageOrder = { TODO: 1, IN_PROGRESS: 2, COMPLETED: 3 };

              if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
                return priorityOrder[a.priority] - priorityOrder[b.priority];
              }

              if (stageOrder[a.stage] !== stageOrder[b.stage]) {
                return stageOrder[a.stage] - stageOrder[b.stage];
              }

              return new Date(a.createdAt) - new Date(b.createdAt);
            });

            res.status(200).json(sortedTasks);
          });
          return;
        }
      } catch (e) {

      }

      const sortedTasks = Object.values(tasks).sort((a, b) => {
        const priorityOrder = { HIGH: 1, MEDIUM: 2, LOW: 3 };
        const stageOrder = { TODO: 1, IN_PROGRESS: 2, COMPLETED: 3 };

        if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        }

        if (stageOrder[a.stage] !== stageOrder[b.stage]) {
          return stageOrder[a.stage] - stageOrder[b.stage];
        }

        return new Date(a.createdAt) - new Date(b.createdAt);
      });

      res.status(200).json(sortedTasks);
    });
  };

  if (filterUserParam) {
    const isNumeric = /^\d+$/.test(String(filterUserParam));
    if (isNumeric) {
      buildAndRun(filterUserParam);
      return;
    }

    db.query('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [filterUserParam], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error resolving userId', error: err.message });
      if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found for provided userId' });
      const resolved = rows[0]._id;
      buildAndRun(resolved);
    });
    return;
  }

  const currentUserInternal = user && user._id;
  buildAndRun(currentUserInternal);
});

router.get("/gettasks", (req, res) => {
  const authUser = req.user;
  const role = authUser && authUser.role;

  const filterUserParam = req.query.userId;

  const buildAndRun = async (resolvedUserId) => {
    let query = `
          SELECT 
              t.id AS task_id, 
              c.name AS client_name,
              t.title, 
              t.stage, 
              t.taskDate, 
              t.priority, 
              t.createdAt, 
              t.updatedAt, 
              t.status,
              t.rejection_reason,
              t.rejected_at,
              u._id AS user_id, 
              u.name AS user_name, 
              u.role AS user_role,
              rj.name AS rejected_by_name,
              rj.public_id AS rejected_by_public_id
          FROM 
              tasks t
          LEFT JOIN 
              task_assignments ta ON t.id = ta.task_id
          LEFT JOIN 
              users u ON ta.user_id = u._id
          LEFT JOIN 
            clients c ON t.client_id = c.id
          LEFT JOIN
            users rj ON t.rejected_by = rj._id
    `;

    if (role === 'Employee') {
      query = `
      SELECT 
         t.id AS task_id, c.name AS client_name, t.title, t.stage, t.taskDate, t.priority, t.createdAt, t.updatedAt, t.status, 
         t.rejection_reason, t.rejected_at,
         u._id AS user_id, u.name AS user_name, u.role AS user_role, rj.name AS rejected_by_name, rj.public_id AS rejected_by_public_id
      FROM tasks t
      JOIN task_assignments ta ON t.id = ta.task_id
      LEFT JOIN users u ON ta.user_id = u._id
      LEFT JOIN clients c ON t.client_id = c.id
      LEFT JOIN users rj ON t.rejected_by = rj._id
      WHERE ta.user_id = ?
      ORDER BY t.createdAt
    `;
    }

    if (resolvedUserId && role !== 'Employee') {

      query = query.replace(/ORDER BY[\s\S]*$/m, '');
      query += ` WHERE t.id IN (SELECT task_id FROM task_assignments WHERE user_id = ?)`;
      query += ` ORDER BY t.createdAt`;
    }

    try {
      const hasIsDeletedList = await hasColumn('tasks', 'isDeleted');
      const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
      if (hasIsDeletedList && !includeDeleted) {
        if (query.includes('WHERE')) {
          query = query.replace(/ORDER BY[\s\S]*$/m, '');
          query += ` AND t.isDeleted != 1 `;
        } else {
          query = query.replace(/ORDER BY[\s\S]*$/m, '');
          query += ` WHERE t.isDeleted != 1 `;
        }
        query += ` ORDER BY t.createdAt`;
      }
    } catch (err) { }

    const params = role === 'Employee' ? [resolvedUserId] : (resolvedUserId ? [resolvedUserId] : []);

    db.query(query, params, (err, results) => {
      if (err) {
        return res.status(500).send("Error fetching tasks");
      }

      const tasks = {};
      results.forEach((row) => {
        if (!tasks[row.task_id]) {
          tasks[row.task_id] = {
            task_id: row.task_id,
            client_name: row.client_name,
            title: row.title,
            stage: row.stage,
            status: row.status,
            rejection: row.rejection_reason ? {
              reason: row.rejection_reason,
              rejectedBy: row.rejected_by_name || 'Manager',
              rejectedAt: row.rejected_at,
              id: row.rejected_by_public_id
            } : null,
            taskDate: row.taskDate,
            day: row.taskDate ? (new Date(row.taskDate).toISOString().split('T')[0]) : null,
            dayName: row.taskDate ? dayjs(row.taskDate).format('ddd') : null,
            priority: row.priority,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            assigned_users: [],
          };
        }

        if (row.user_id) {
          tasks[row.task_id].assigned_users.push({
            user_id: row.user_id,
            user_name: row.user_name,
            user_role: row.user_role,
          });
        }
      });

      try {
        const userIds = new Set();
        Object.values(tasks).forEach(t => t.assigned_users.forEach(u => { if (u.user_id) userIds.add(u.user_id); }));
        if (userIds.size > 0) {
          const idsArr = Array.from(userIds);
          db.query('SELECT _id, public_id FROM users WHERE _id IN (?)', [idsArr], (errU, rowsU) => {
            if (!errU && Array.isArray(rowsU)) {
              const map = {};
              rowsU.forEach(r => { if (r && r._id) map[r._id] = r.public_id || r._id; });
              Object.values(tasks).forEach(t => {
                t.assigned_users = t.assigned_users.map(u => ({ user_id: map[u.user_id] || u.user_id, user_name: u.user_name, user_role: u.user_role }));
              });
            }
            return res.status(200).json(Object.values(tasks));
          });
          return;
        }
      } catch (e) {

      }

      res.status(200).json(Object.values(tasks));
    });
  };

  if (filterUserParam) {
    const isNumeric = /^\d+$/.test(String(filterUserParam));
    if (isNumeric) { buildAndRun(filterUserParam); return; }
    db.query('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [filterUserParam], (err, rows) => {
      if (err) return res.status(500).json({ message: 'DB error resolving userId', error: err.message });
      if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found for provided userId' });
      buildAndRun(rows[0]._id);
    });
    return;
  }

  const currentUserInternal = authUser && authUser._id;
  buildAndRun(currentUserInternal);
});

// Convenience alias: allow GET /:id where id can be public_id or internal id
// List all reassign requests (manager) — placed before the catch-all `/:id` route
// router.get('/reassign-requests', requireRole(['Manager']), async (req, res) => {
//   try {
//     const [requests] = await new Promise((resolve, reject) =>
//       db.query(`
//         SELECT r.*, t.title AS task_title, t.public_id AS task_public_id, u.name AS requester_name, u.email AS requester_email, u.public_id AS requester_public_id,
//                t.status AS task_status, t.taskDate, t.priority, t.project_id,
//                (SELECT u2.public_id FROM users u2 JOIN task_assignments ta2 ON ta2.user_id = u2._id WHERE ta2.task_id = t.id AND (ta2.is_read_only IS NULL OR ta2.is_read_only != 1) LIMIT 1) AS current_assignee_public_id,
//                (SELECT u2.name FROM users u2 JOIN task_assignments ta2 ON ta2.user_id = u2._id WHERE ta2.task_id = t.id AND (ta2.is_read_only IS NULL OR ta2.is_read_only != 1) LIMIT 1) AS current_assignee_name,
//                (SELECT u2.email FROM users u2 JOIN task_assignments ta2 ON ta2.user_id = u2._id WHERE ta2.task_id = t.id AND (ta2.is_read_only IS NULL OR ta2.is_read_only != 1) LIMIT 1) AS current_assignee_email
//         FROM task_resign_requests r
//         JOIN tasks t ON r.task_id = t.id
//         JOIN users u ON r.requested_by = u._id
//         ORDER BY r.requested_at DESC
//       `, [], (err, rows) => err ? reject(err) : resolve([rows]))
//     );
//     res.json({ success: true, requests });
//   } catch (error) {
//     res.status(500).json({ success: false, error: error.message });
//   }
// });

router.get('/reassign-requests', requireRole(['Manager']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const isAdmin = isTenantAdminRole(req.user && req.user.role);
    const currentUserInternalId = req.user && req.user._id;

    // Build SQL to return reassignment requests. Non-admin managers should only see
    // requests for projects they manage. Admins/Super Admins see all.
    let baseSql = `
      SELECT r.*, t.title AS task_title, t.public_id AS task_public_id, u.name AS requester_name, u.email AS requester_email, u.public_id AS requester_public_id,
             t.status AS task_status, t.taskDate, t.priority, t.project_id,
             (SELECT u2.public_id FROM users u2 JOIN task_assignments ta2 ON ta2.user_id = u2._id WHERE ta2.task_id = t.id AND (ta2.is_read_only IS NULL OR ta2.is_read_only != 1) LIMIT 1) AS current_assignee_public_id,
             (SELECT u2.name FROM users u2 JOIN task_assignments ta2 ON ta2.user_id = u2._id WHERE ta2.task_id = t.id AND (ta2.is_read_only IS NULL OR ta2.is_read_only != 1) LIMIT 1) AS current_assignee_name,
             (SELECT u2.email FROM users u2 JOIN task_assignments ta2 ON ta2.user_id = u2._id WHERE ta2.task_id = t.id AND (ta2.is_read_only IS NULL OR ta2.is_read_only != 1) LIMIT 1) AS current_assignee_email
      FROM task_resign_requests r
      JOIN tasks t ON r.task_id = t.id
      JOIN users u ON r.requested_by = u._id
    `;

    const params = [];

    if (!isAdmin) {
      // Restrict to projects where current user is the project manager
      baseSql += ' JOIN projects p ON p.id = t.project_id';
      baseSql += ' WHERE p.project_manager_id = ?';
      params.push(currentUserInternalId);
    }

    baseSql += ' ORDER BY r.requested_at DESC';

    const [requests] = await new Promise((resolve, reject) =>
      db.query(baseSql, params, (err, rows) => err ? reject(err) : resolve([rows]))
    );

    res.json({ success: true, requests });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


router.get('/:id', asyncHandler(async (req, res) => {
  const tenantId = assertTenantId(req);
  const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
  const task = await resolveTenantTask(req.params.id, tenantId, { includeDeleted });
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  if (!await canReadTenantTask(task, req)) return res.status(403).json({ success: false, error: 'Forbidden' });

  const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
  return res.status(200).json({ success: true, data: taskResponse });
}));

// Existing handler kept for backward-compatibility
router.get("/gettaskbyId/:task_id", asyncHandler(async (req, res) => {
  const tenantId = assertTenantId(req);
  const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
  const task = await resolveTenantTask(req.params.task_id, tenantId, { includeDeleted });
  if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
  if (!await canReadTenantTask(task, req)) return res.status(403).json({ success: false, error: 'Forbidden' });

  const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
  return res.status(200).json({ success: true, data: taskResponse });
}));

router.delete("/deltask/:task_id", requireRole(['Admin', 'Manager']), (req, res) => {
  const { task_id } = req.params;

  db.getConnection((err, connection) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'DB connection error' });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return res.status(500).json({ success: false, message: 'Transaction error' });
      }

      const tasksToRun = [
        { sql: 'DELETE FROM task_assignments WHERE task_id = ?', params: [task_id] },
        { sql: 'DELETE FROM task_assignments WHERE task_id = ?', params: [task_id] },
        { sql: 'DELETE FROM subtasks WHERE task_id = ?', params: [task_id] },
        { sql: 'DELETE FROM task_time_entries WHERE task_id = ?', params: [task_id] },
        { sql: 'DELETE FROM task_logs WHERE task_id = ?', params: [task_id] },
        { sql: 'DELETE FROM tasks WHERE id = ?', params: [task_id] },
      ];

      const runStep = (idx) => {
        if (idx >= tasksToRun.length) {
          connection.commit((err) => {
            if (err) {
              return connection.rollback(() => {
                connection.release();
                return res.status(500).json({ success: false, message: 'Commit error' });
              });
            }
            connection.release();
            return res.status(200).json({ success: true, message: 'Task and related data deleted successfully' });
          });
          return;
        }

        const step = tasksToRun[idx];
        connection.query(step.sql, step.params, (qErr, qRes) => {
          if (qErr) {
            return connection.rollback(() => {
              connection.release();
              return res.status(500).json({ success: false, message: 'Delete failed', error: qErr.message });
            });
          }
          runStep(idx + 1);
        });
      };

      runStep(0);
    });
  });
});

router.post("/createsub/:task_id", requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  const { task_id } = req.params;
  const { title, due_date, tag } = req.body;
  const createdAt = new Date();
  const updatedAt = createdAt;

  if (!title || !due_date || !tag) {
    logger.warn(`Invalid input provided for task_id: ${task_id}`);
    return res.status(400).send({ success: false, message: "Invalid input" });
  }

  try {
    // Only enforce read-only checks for non-admin/manager users
    if (req.user && req.user.role !== 'Admin' && req.user.role !== 'Manager') {
      const assignRows = await q('SELECT is_read_only FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1', [task_id, req.user._id]);
      if (!assignRows || assignRows.length === 0) return res.status(403).json({ success: false, message: 'Not assigned' });
      const isRO = assignRows[0] && (assignRows[0].is_read_only === 1 || String(assignRows[0].is_read_only) === '1');
      if (isRO) return res.status(403).json({ success: false, message: 'Read-only users cannot modify checklist' });
    }

    const insertSubTaskQuery = `
      INSERT INTO subtasks (task_id, title, due_date, tag, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`;

    const result = await new Promise((resolve, reject) => db.query(
      insertSubTaskQuery,
      [task_id, title, due_date, tag, toMySQLDate(createdAt), toMySQLDate(updatedAt)],
      (err, results) => err ? reject(err) : resolve(results)
    ));

    logger.info(`Subtask created successfully for task_id: ${task_id}, subtask_id: ${result.insertId}`);
    return res.status(201).json({
      success: true,
      message: "Subtask created successfully",
      data: {
        id: result.insertId,
        task_id,
        title,
        due_date,
        tag,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    });
  } catch (err) {
    logger.error(`Error inserting subtask for task_id: ${task_id} - ${err && err.message}`);
    return res.status(500).send({ success: false, message: "Database error", error: err && err.message });
  }
});

router.get("/getsubtasks/:task_id", (req, res) => {
  const { task_id } = req.params;
  const getsubtasks = `SELECT title, due_date, tag FROM subtasks WHERE task_id = ? ORDER BY id ASC`;
  try {
    db.query(getsubtasks, [task_id], (err, results) => {
      if (err) {
        logger.error('Error fetching subtasks: ' + (err && err.message));
        return res.status(500).send({ auth: false, message: 'Database error' });
      }
      res.status(201).json(results);
    });
  } catch (err) {
    logger.error('Unexpected error fetching subtasks: ' + (err && err.message));
    res.status(500).json({ error: 'Server error' });
  }
});

router.get("/total-working-hours/:task_id", async (req, res) => {
  try {
    const { task_id } = req.params;

    const query = `
 SELECT SUM(hours) AS total_hours
      FROM task_time_entries
      WHERE task_id = ?
    `;

    db.query(query, [task_id], (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Failed to execute query" });
      }

      if (!Array.isArray(results) || results.length === 0) {
        return res
          .status(404)
          .json({ error: "No working hours found for this task" });
      }

      const totalWorkingHours = results[0].total_hours;

      res.status(200).json({ total_working_hours: totalWorkingHours });
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to calculate total working hours" });
  }
});

router.post("/working-hours", requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const { task_id, date, start_time, end_time } = req.body;

    if (!task_id || !date || !start_time || !end_time) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const workingDate = new Date(date).toISOString().split("T")[0];

    // Only enforce read-only checks for non-admin/manager users
    if (req.user && req.user.role !== 'Admin' && req.user.role !== 'Manager') {
      const assignRows = await q('SELECT is_read_only FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1', [task_id, req.user._id]);
      if (!assignRows || assignRows.length === 0) return res.status(403).json({ success: false, message: 'Not assigned' });
      const isRO = assignRows[0] && (assignRows[0].is_read_only === 1 || String(assignRows[0].is_read_only) === '1');
      if (isRO) return res.status(403).json({ success: false, message: 'Read-only users cannot add working hours' });
    }

    // Convert start and end times to proper datetimes to calculate duration in seconds
    const startDt = new Date(`${workingDate}T${start_time}`);
    const endDt = new Date(`${workingDate}T${end_time}`);
    let durationSeconds = 0;
    if (!isNaN(startDt) && !isNaN(endDt)) {
      durationSeconds = Math.floor((endDt - startDt) / 1000);
      if (durationSeconds < 0) durationSeconds = 0;
    }

    const query = `
      INSERT INTO timelogs (user_id, task_id, start_time, end_time, duration_seconds, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    const userIdVal = (req.user && req.user._id) ? req.user._id : null;
    const values = [userIdVal, task_id, startDt, endDt, durationSeconds, "Manual working hours entry"];

    await q(query, values);

    res.status(201).json({ message: "Working hours added successfully" });
  } catch (error) {
    logger.error("Failed to add working hours: " + error.message);
    res.status(500).json({ error: "Failed to add working hours" });
  }
});

router.get("/report", async (req, res) => {
  try {
    const { task_name, start_date, end_date } = req.query;

    if (!task_name || !start_date || !end_date) {
      return res
        .status(400)
        .json({ error: "Missing required query parameters" });
    }
    const query = `
      SELECT 
        t.id,
        t.title AS task_title, 
        th.date, 
        th.hours
      FROM 
        task_time_entries th
      JOIN 
        tasks t ON t.id = th.task_id 
      WHERE 
        t.title = ? 
        AND th.date BETWEEN ? AND ?
      ORDER BY 
        th.date;
    `;

    db.query(query, [task_name, start_date, end_date], (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Failed to execute query" });
      }

      if (!Array.isArray(results) || results.length === 0) {
        return res
          .status(404)
          .json({ message: "No records found for the given parameters" });
      }

      res.status(200).json(results);
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch report" });
  }
});

router.post("/taskhours", requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  const { encryptedData } = req.body;

  if (!encryptedData) {
    return res.status(400).json({ error: "Missing encrypted data" });
  }

  try {
    const secret = "secretKeysecretK";
    const bytes = CryptoJS.AES.decrypt(encryptedData, secret);
    const decryptedData = JSON.parse(bytes.toString(CryptoJS.enc.Utf8));
    if (!decryptedData) {
      return res.status(400).json({ error: "Decryption failed" });
    }

    const { taskId, userId, date, hours } = decryptedData;

    if (!taskId || !userId || !date || !hours) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      // Only allow non-admin/manager users if they are assigned and not read-only
      if (req.user && req.user.role !== 'Admin' && req.user.role !== 'Manager') {
        if (String(req.user._id) !== String(userId)) return res.status(403).json({ success: false, error: 'Not authorized' });
        const assignRows = await q('SELECT is_read_only FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1', [taskId, userId]);
        if (!assignRows || assignRows.length === 0) return res.status(403).json({ success: false, error: 'Not assigned' });
        const isRO = assignRows[0] && (assignRows[0].is_read_only === 1 || String(assignRows[0].is_read_only) === '1');
        if (isRO) return res.status(403).json({ success: false, error: 'Read-only users cannot record hours' });
      }

      const query = `
        INSERT INTO task_time_entries (task_id, user_id, entry_type, date, hours)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE hours = VALUES(hours), updated_at = CURRENT_TIMESTAMP
      `;

      await q(query, [taskId, userId, date, hours]);
      return res.status(200).json({ message: "Hours saved successfully" });
    } catch (err) {
      return res.status(500).json({ error: "Failed to save hours" });
    }
  } catch (error) {
    res.status(500).json({ error: "Failed to process request" });
  }
});

router.put("/updatetask/:id", requireRole(['Admin', 'Manager']), async (req, res) => {
  const { id: taskId } = req.params;
  const {
    stage,
    title,
    priority,
    description,
    client_id,
    taskDate,
    time_alloted,
    assigned_to,
  } = req.body;

  logger.info(`Updating task: taskId=${taskId}`);

  try {
    const updateTaskQuery = `
      UPDATE tasks
      SET
        stage = ?,
        title = ?,
        priority = ?,
        description = ?,
        client_id = ?,
        taskDate = ?,
        time_alloted = ?,
        updatedAt = ?
      WHERE id = ?
    `;

    db.query(
      updateTaskQuery,
      [stage, title, priority, description, client_id, toMySQLDate(taskDate), time_alloted, toMySQLDate(new Date()), taskId],
      async (err, result) => {
        if (err) {
          logger.error(`Error updating task: ${err.message}`);
          return res.status(500).json({ success: false, error: 'Database update error' });
        }

        if (result.affectedRows === 0) {
          return res.status(404).json({ success: false, error: 'Task not found' });
        }

        if (Array.isArray(assigned_to)) {

          if (assigned_to.length > 1) {
            return res.status(400).json({ success: false, error: 'Tasks must have exactly one assignee (single-user ownership)' });
          }
          const deleteQuery = `DELETE FROM task_assignments WHERE task_id = ?`;

          await new Promise((resolve, reject) => db.query(deleteQuery, [taskId], (delErr) => delErr ? reject(delErr) : resolve()));

          if (assigned_to.length === 1) {
            const candidate = assigned_to[0];
            const candidateId = String(candidate);
            const hasActive = await assigneeHasActiveTask(candidateId);
            if (hasActive) {
              return res.status(400).json(errorResponse.assignmentError('The selected assignee already has an active task and cannot be assigned another until it is completed', 'ASSIGNEE_ALREADY_ASSIGNED', { userId: newAssigneeIds[0] }));
            }
            const insertQuery = `INSERT INTO task_assignments (task_id, user_id) VALUES (?, ?)`;
            try {
              await new Promise((resolve, reject) => db.query(insertQuery, [taskId, candidateId], (insErr) => insErr ? reject(insErr) : resolve()));
            } catch (insErr) {
              logger.error(`Error assigning user: ${insErr.message}`);
            }
          }
        }

        logger.info(`Task status updated successfully: taskId=${taskId}, newStage=${stage}`);

        const assignedUsersQuery = `
          SELECT u.email, u.name 
          FROM users u
          JOIN task_assignments ta ON u._id = ta.user_id
          WHERE ta.task_id = ?
        `;

        db.query(assignedUsersQuery, [taskId], async (err, userResults) => {
          if (err) {
            logger.error(`Error fetching assigned user emails: taskId=${taskId}, error=${err.message}`);
            return res.status(500).json({
              success: false,
              error: 'Error fetching assigned user emails',
              details: err.message,
            });
          }

          const emails = userResults.map((user) => user.email);
          const userNames = userResults.map((user) => user.name);

          if (emails.length === 0) {
            logger.info(`No users assigned for taskId=${taskId}`);
            return res.status(200).json({
              success: true,
              message: 'Task status updated successfully',
              data: {
                taskId,
                newStage: stage,
              },
            });
          }

          logger.info(`Sending email notifications for taskId=${taskId} to users: ${emails.join(', ')}`);

          try {
            const tpl = emailService.taskStatusTemplate({ taskId, stage, userNames });
            await emailService.sendEmail({ to: emails, subject: tpl.subject, text: tpl.text, html: tpl.html });
            logger.info(`Email notifications (status update) sent (or logged) for taskId=${taskId}`);
            res.status(200).json({
              success: true,
              message: 'Task status updated successfully and notifications sent',
              data: {
                taskId,
                newStage: stage,
                notifiedUsers: userNames,
              },
            });
          } catch (mailError) {
            logger.error(`Error sending email notifications: taskId=${taskId}, error=${mailError && mailError.message}`);
            res.status(200).json({
              success: true,
              message: 'Task status updated, but email notifications failed',
              data: {
                taskId,
                newStage: stage,
                notifiedUsers: userNames,
              },
              error: mailError && mailError.message,
            });
          }
        });
      }
    );
  } catch (error) {
    logger.error(`Unexpected error updating task status: taskId=${taskId}, error=${error.message}`);
    res.status(500).json({
      success: false,
      error: 'Unexpected server error',
      details: error.message,
    });
  }
});

router.get("/fetchtaskhours", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: "Missing required parameters" });
  }
  try {
    const query = `
      SELECT t.id AS task_id, t.title AS task_title, th.date, th.hours
      FROM tasks t
      LEFT JOIN task_time_entries th ON t.id = th.task_id
      WHERE th.user_id = ?
      ORDER BY th.date;
    `;

    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res.status(500).json({ error: "Failed to execute query" });
      }

      if (!Array.isArray(results) || results.length === 0) {
        return res
          .status(404)
          .json({ message: "No records found for the given parameters" });
      }
      res.status(200).json(results);
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch task hours" });
  }
});

router.post("/taskdetail/Postactivity", async (req, res) => {
  const { task_id, user_id, type, activity } = req.body;

  logger.info(`Received POST request to add task activity: task_id=${task_id}, user_id=${user_id}`);

  const sql = `
    INSERT INTO audit_logs (actor_id, tenant_id, action, entity, entity_id, details, module)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  try {
    // enforce assignment and read-only checks for non-admin/manager
    if (req.user && req.user.role !== 'Admin' && req.user.role !== 'Manager') {
      if (String(req.user._id) !== String(user_id)) return res.status(403).json({ success: false, error: 'Not authorized' });
      const assignRows = await q('SELECT is_read_only FROM task_assignments WHERE task_id = ? AND user_id = ? LIMIT 1', [task_id, user_id]);
      if (!assignRows || assignRows.length === 0) return res.status(403).json({ success: false, error: 'Not assigned' });
      const isRO = assignRows[0] && (assignRows[0].is_read_only === 1 || String(assignRows[0].is_read_only) === '1');
      if (isRO) return res.status(403).json({ success: false, error: 'Read-only users cannot add activities' });
    }

    const result = await new Promise((resolve, reject) => db.query(sql, [user_id, req.tenantId, type, 'task', task_id, activity, 'tasks'], (err, r) => err ? reject(err) : resolve(r)));
    logger.info(`Task activity added successfully: task_id=${task_id}, user_id=${user_id}, activity_id=${result.insertId}`);
    return res.status(201).json({ message: "Task activity added successfully.", id: result.insertId });
  } catch (err) {
    logger.error(`Error adding task activity: ${err && err.message}`);
    return res.status(500).json({ error: "Failed to add task activity." });
  }
});

router.get("/taskdetail/getactivity/:id", async (req, res) => {
  try {
    const { id } = req.params; // Extract the task_id from the URL params

    const sql = `
      SELECT 
        ta.type, 
        ta.activity_text AS activity, 
        ta.created_at AS createdAt, 
        u.name AS user_name
      FROM task_logs ta
      INNER JOIN users u ON ta.user_id = u._id
      WHERE ta.task_id = ?
      ORDER BY ta.created_at DESC
    `;

    db.query(sql, [id], (err, result) => {
      if (err) {
        return res
          .status(500)
          .json({ error: "Failed to fetch task activities." });
      }

      res.status(200).json(result);
    });
  } catch (error) {
    res.status(500).json({ error: "An unexpected error occurred." });
  }
});

//taskss 

router.post('/:id/request-reassignment', requireRole(['Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const task = await resolveTenantTask(req.params.id, tenantId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });

    await ensureProjectOpen(task.project_id);
    await ensureTaskReassignmentSchema();
    await ensureTaskAssignmentStatusTable();
    await ensureTaskTimeLogsTable();
    await ensureTaskActivitiesTable();

    const employee = req.user;
    const reason = String(req.body.reason || '').trim() || null;
    const hasRequestTenantId = await hasColumn('task_resign_requests', 'tenant_id');
    const hasAssignmentTenantId = await hasColumn('task_assignments', 'tenant_id');
    const hasAssignmentReadOnly = await hasColumn('task_assignments', 'is_read_only');

    const pendingRows = await q(
      `SELECT id FROM task_resign_requests
       WHERE task_id = ? AND requested_by = ? AND status = 'PENDING'
       ${hasRequestTenantId ? 'AND tenant_id = ?' : ''}
       LIMIT 1`,
      hasRequestTenantId ? [task.id, employee._id, tenantId] : [task.id, employee._id]
    );
    if (pendingRows.length > 0) {
      return res.status(409).json({ success: false, error: 'Pending request exists' });
    }

    const assignmentRows = await q(
      `SELECT user_id${hasAssignmentReadOnly ? ', is_read_only' : ''} FROM task_assignments
       WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}`,
      hasAssignmentTenantId ? [task.id, employee._id, tenantId] : [task.id, employee._id]
    );
    if (!assignmentRows.length) {
      return res.status(403).json({ success: false, error: 'You are not assigned to this task' });
    }
    if (hasAssignmentReadOnly && (assignmentRows[0].is_read_only === 1 || String(assignmentRows[0].is_read_only) === '1')) {
      return res.status(403).json({ success: false, error: 'Read-only users cannot request reassignment' });
    }

    await q(
      `INSERT IGNORE INTO task_assignment_status (task_id, user_id, tenant_id, status)
       VALUES (?, ?, ?, 'PENDING')`,
      [task.id, employee._id, tenantId]
    );

    const currentStateRows = await q(
      `SELECT status, started_at, live_timer, completed_at, total_duration, rejection_reason
       FROM task_assignment_status
       WHERE task_id = ? AND user_id = ?
       LIMIT 1`,
      [task.id, employee._id]
    );
    const currentState = currentStateRows[0] || {};
    const previousStatus = normalizeTaskLifecycleStatus(currentState.status || 'PENDING');
    const now = new Date();
    const nowSql = toMySQLDate(now);
    const liveTimer = currentState.live_timer ? new Date(currentState.live_timer) : null;
    const elapsed = previousStatus === 'IN_PROGRESS' && liveTimer && !Number.isNaN(liveTimer.getTime())
      ? Math.max(0, Math.floor((now.getTime() - liveTimer.getTime()) / 1000))
      : 0;
    const accumulatedDuration = Number(currentState.total_duration || 0) + elapsed;

    let manager = null;
    const projectManagerRows = task.project_id
      ? await q(
        `SELECT u._id, u.public_id, u.name, u.email
         FROM projects p
         JOIN users u ON u._id = p.project_manager_id
         WHERE p.id = ? AND u.role = 'Manager' AND u.isActive = 1
         LIMIT 1`,
        [task.project_id]
      )
      : [];
    if (projectManagerRows.length) {
      manager = projectManagerRows[0];
    }
    if (!manager) {
      const fallbackManagerRows = await q(
        `SELECT _id, public_id, name, email
         FROM users
         WHERE role IN ('Manager', 'Admin') AND isActive = 1${await hasColumn('users', 'tenant_id') ? ' AND tenant_id = ?' : ''}
         ORDER BY FIELD(role, 'Manager', 'Admin'), name ASC
         LIMIT 1`,
        await hasColumn('users', 'tenant_id') ? [tenantId] : []
      );
      manager = fallbackManagerRows[0] || null;
    }

    const connection = await getConnectionAsync();
    let requestId = null;
    try {
      await beginTransactionAsync(connection);

      const requestColumns = ['task_id', 'requested_by', 'reason', 'status'];
      const requestValues = [task.id, employee._id, reason, 'PENDING'];
      if (hasRequestTenantId) {
        requestColumns.push('tenant_id');
        requestValues.push(tenantId);
      }
      if (await hasColumn('task_resign_requests', 'previous_status')) {
        requestColumns.push('previous_status');
        requestValues.push(previousStatus);
      }
      if (await hasColumn('task_resign_requests', 'previous_started_at')) {
        requestColumns.push('previous_started_at');
        requestValues.push(toMySQLDate(currentState.started_at));
      }
      if (await hasColumn('task_resign_requests', 'previous_completed_at')) {
        requestColumns.push('previous_completed_at');
        requestValues.push(toMySQLDate(currentState.completed_at));
      }
      if (await hasColumn('task_resign_requests', 'previous_total_duration')) {
        requestColumns.push('previous_total_duration');
        requestValues.push(accumulatedDuration);
      }
      if (await hasColumn('task_resign_requests', 'previous_rejection_reason')) {
        requestColumns.push('previous_rejection_reason');
        requestValues.push(currentState.rejection_reason || null);
      }

      const insertResult = await qConn(
        connection,
        `INSERT INTO task_resign_requests (${requestColumns.join(', ')})
         VALUES (${requestColumns.map(() => '?').join(', ')})`,
        requestValues
      );
      requestId = insertResult.insertId;

      await qConn(
        connection,
        `INSERT INTO task_assignment_status (
           task_id, user_id, tenant_id, status, started_at, live_timer, completed_at, total_duration, rejection_reason
         ) VALUES (?, ?, ?, 'ON_HOLD', ?, NULL, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           status = 'ON_HOLD',
           started_at = VALUES(started_at),
           live_timer = NULL,
           completed_at = VALUES(completed_at),
           total_duration = VALUES(total_duration),
           rejection_reason = VALUES(rejection_reason),
           updated_at = NOW()`,
        [
          task.id,
          employee._id,
          tenantId,
          toMySQLDate(currentState.started_at),
          toMySQLDate(currentState.completed_at),
          accumulatedDuration,
          currentState.rejection_reason || null
        ]
      );

      if (previousStatus === 'IN_PROGRESS' && elapsed > 0) {
        await qConn(
          connection,
          'INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds) VALUES (?, ?, \'event\', ?, ?, ?)',
          [task.id, employee._id, 'pause', nowSql, elapsed]
        );
      }

      if (hasAssignmentReadOnly) {
        await qConn(
          connection,
          `UPDATE task_assignments
           SET is_read_only = 1
           WHERE task_id = ? AND user_id = ?${hasAssignmentTenantId ? ' AND tenant_id = ?' : ''}`,
          hasAssignmentTenantId ? [task.id, employee._id, tenantId] : [task.id, employee._id]
        );
      }

      try {
        await qConn(
          connection,
          'INSERT INTO audit_logs (actor_id, tenant_id, action, entity, entity_id, details, module) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [employee._id, req.tenantId, 'REASSIGNMENT_REQUESTED', 'task', task.id, `Reassignment requested: ${reason || 'No reason provided'}`, 'tasks']
        );
      } catch (e) {
        const msg = (e && e.message) || '';
        if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
          logger.warn('[audit_logs] Data truncated warning swallowed: ' + msg);
        } else {
          throw e;
        }
      }

      await commitTransactionAsync(connection);
    } catch (error) {
      await rollbackTransactionAsync(connection);
      throw error;
    } finally {
      connection.release();
    }

    if (manager && manager.email) {
      try {
        const taskLink = `${(process.env.FRONTEND_URL || process.env.BASE_URL || '')}/tasks/${task.public_id || task.id}`;
        const template = emailService.taskReassignmentRequestTemplate({
          taskTitle: task.title,
          requesterName: employee.name,
          reason: reason || 'None provided',
          taskLink
        });
        await safeSendEmailForTask(task.id, manager.email, template);
      } catch (error) {
        logger.error(`Failed to send reassignment request email for task=${task.id}: ${error.message}`);
      }
    }

    const taskResponse = await loadTenantTaskEnvelope(task.id, tenantId, req);
    emitTaskUpdatedEvent(task.public_id || task.id, tenantId, {
      action: 'REASSIGNMENT_REQUESTED',
      reassignment: taskResponse ? taskResponse.reassignment : null
    });

    return res.json({
      success: true,
      message: 'Reassignment requested. Only the requester is restricted while the request is pending.',
      data: taskResponse,
      request_id: requestId,
      manager_id: manager ? (manager.public_id || String(manager._id)) : null
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/:taskId/reassign-requests/:requestId/:action(approve|reject)', requireRole(['Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const requestId = Number(req.params.requestId);
    const action = normalizeReassignmentRequestStatus(req.params.action);

    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid reassignment request id' });
    }

    if (!action || (action !== 'APPROVED' && action !== 'REJECTED')) {
      return res.status(400).json({ success: false, error: 'Invalid action (approve|reject)' });
    }

    const task = await resolveTenantTask(req.params.taskId, tenantId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (!await canReadTenantTask(task, req)) {
      return res.status(403).json({ success: false, error: 'You do not have access to this task' });
    }

    await ensureProjectOpen(task.project_id);
    return res.json(await reviewTenantTaskReassignment(task, requestId, action, req, tenantId));
  } catch (error) {
    logger.error('Manager reassignment review error:', error);
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

router.get('/:id/reassign-requests', requireRole(['Employee', 'Manager', 'Admin']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const task = await resolveTenantTask(req.params.id, tenantId);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    if (!await canReadTenantTask(task, req)) {
      return res.status(403).json({ success: false, error: 'You do not have access to this task' });
    }

    const requests = await loadTenantTaskReassignmentRequests(task.id, tenantId);
    const state = await loadTaskReassignmentState(task.id, tenantId, req);

    return res.json({
      success: true,
      request: requests[0] || null,
      requests,
      has_pending: state.has_pending,
      is_locked: state.is_locked,
      is_locked_for_user: state.is_locked_for_user,
      lock: {
        is_locked: state.is_locked,
        locked_for: state.is_locked ? 'REQUESTER_ONLY' : null
      },
      lock_info: state,
      reassignment: state
    });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

router.post('/:id/start', requireRole(['Employee']), async (req, res) => {
  try {
    await ensureTaskTimeLogsTable();

    const { id } = req.params;
    const userId = req.user._id;

    const task = await q('SELECT id, public_id, status FROM tasks WHERE id = ? OR public_id = ?', [id, id]);
    if (task.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    const taskId = task[0].id;
    const publicId = task[0].public_id;
    const currentStatus = task[0].status;

    // Restrict only requester with pending reassignment.
    const pendingRows = await q(
      `SELECT id FROM task_resign_requests WHERE task_id = ? AND requested_by = ? AND status = 'PENDING' LIMIT 1`,
      [taskId, userId]
    );
    const isLockedForUser = Array.isArray(pendingRows) && pendingRows.length > 0;
    if (isLockedForUser) {
      return res.status(423).json({
        success: false,
        error: 'You already requested reassignment. Action restricted.',
        is_locked_for_user: true,
        has_pending: true,
        request_status: 'PENDING',
        code: 'TASK_LOCKED_FOR_REQUESTER',
        lock: {
          is_locked: true,
          locked_for: 'REQUESTER_ONLY'
        }
      });
    }

    const normalizedStatus = currentStatus?.toUpperCase().trim();

    if (normalizedStatus === 'IN PROGRESS') {
      return res.json({ success: true, message: 'Task already in progress' });
    }
    if (normalizedStatus !== 'TO DO' && normalizedStatus !== 'PENDING') {
      return res.status(400).json({
        success: false,
        error: `Cannot start task with status '${currentStatus}'. Only 'TO DO' or 'PENDING' tasks can be started.`
      });
    }

    const assignment = await q('SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?', [taskId, userId]);
    if (assignment.length === 0) return res.status(403).json({ success: false, error: 'Not assigned' });
    // Enforce read-only flag: assigned users with is_read_only must not start the task
    try {
      const assn = assignment[0];
      const isRO = (assn && (assn.is_read_only === 1 || String(assn.is_read_only) === '1')) || (assn && (assn.isReadOnly === 1 || String(assn.isReadOnly) === '1'));
      if (isRO) return res.status(403).json({ success: false, error: 'Read-only users cannot modify task status' });
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }
    const now = new Date();
    try {
      await q('INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp) VALUES (?, ?, \'event\', ?, ?)', [taskId, userId, 'start', now]);
    } catch (e) {
      const msg = (e && e.message) || '';
      if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
        logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
      } else {
        throw e;
      }
    }
    await q('UPDATE tasks SET status = "In Progress", started_at = ?, live_timer = ? WHERE id = ?', [now, now, taskId]);

    await NotificationService.createAndSend(
      [userId],
      'Task Started',
      `You started working on task: ${publicId}`,
      'TASK_STARTED',
      'task',
      publicId
    );

    res.json({
      success: true,
      message: '✅ Started',
      data: { taskId: publicId, status: 'In Progress', started_at: now.toISOString() }
    });
  } catch (e) {
    logger.error('Start error:', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/pause', requireRole(['Employee']), async (req, res) => {
  try {
    await ensureTaskTimeLogsTable();

    const { id } = req.params;
    const userId = req.user._id;

    const task = await q('SELECT id, public_id, status, is_locked FROM tasks WHERE id = ? OR public_id = ?', [id, id]);
    if (task.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    const taskId = task[0].id;
    const publicId = task[0].public_id;

    // Restrict only requester with pending reassignment.
    const [lockCheck] = await q(
      `SELECT trr.id FROM task_resign_requests trr WHERE trr.task_id = ? AND trr.requested_by = ? AND trr.status = 'PENDING' LIMIT 1`,
      [taskId, userId]
    );
    if (lockCheck) {
      return res.status(423).json({
        success: false,
        error: 'You already requested reassignment. Action restricted.',
        is_locked_for_user: true,
        has_pending: true,
        request_status: 'PENDING',
        code: 'TASK_LOCKED_FOR_REQUESTER',
        lock: { is_locked: true, locked_for: 'REQUESTER_ONLY' }
      });
    }

    const normalizedStatus = task[0].status?.toUpperCase().trim();
    if (normalizedStatus !== 'IN PROGRESS') {
      return res.status(400).json({ success: false, error: `Cannot pause '${task[0].status}'. Only 'IN PROGRESS'.` });
    }

    const assignment = await q('SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?', [taskId, userId]);
    if (assignment.length === 0) return res.status(403).json({ success: false, error: 'Not assigned' });
    // Enforce read-only flag for pause
    try {
      const assn = assignment[0];
      const isRO = (assn && (assn.is_read_only === 1 || String(assn.is_read_only) === '1')) || (assn && (assn.isReadOnly === 1 || String(assn.isReadOnly) === '1'));
      if (isRO) return res.status(403).json({ success: false, error: 'Read-only users cannot modify task status' });
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }

    const now = new Date();
    const lastLog = await q('SELECT timestamp FROM task_time_entries WHERE task_id = ? AND action IN ("start", "resume") ORDER BY timestamp DESC LIMIT 1', [taskId]);
    let duration = lastLog.length > 0 ? Math.floor((now - new Date(lastLog[0].timestamp)) / 1000) : 0;

    try {
      await q('INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp, duration_seconds) VALUES (?, ?, \'event\', ?, ?, ?)', [taskId, userId, 'pause', now, duration]);
    } catch (e) {
      const msg = (e && e.message) || '';
      if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
        logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
      } else {
        throw e;
      }
    }
    await q('UPDATE tasks SET status = "On Hold", total_duration = COALESCE(total_duration, 0) + ?, live_timer = NULL WHERE id = ?', [duration, taskId]);

    await NotificationService.createAndSend(
      [userId],
      'Task Paused',
      `You paused task: ${publicId}`,
      'TASK_PAUSED',
      'task',
      publicId
    );

    res.json({ success: true, message: '⏸️ Paused', data: { taskId: publicId, status: 'On Hold' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/:id/resume', requireRole(['Employee']), async (req, res) => {
  try {
    await ensureTaskTimeLogsTable();

    const { id } = req.params;
    const userId = req.user._id;

    const task = await q('SELECT id, public_id, status, is_locked FROM tasks WHERE id = ? OR public_id = ?', [id, id]);
    if (task.length === 0) return res.status(404).json({ success: false, error: 'Task not found' });
    const taskId = task[0].id;

    // Restrict only requester with pending reassignment.
    const [lockCheck] = await q(
      `SELECT trr.id FROM task_resign_requests trr WHERE trr.task_id = ? AND trr.requested_by = ? AND trr.status = 'PENDING' LIMIT 1`,
      [taskId, userId]
    );
    if (lockCheck) {
      return res.status(423).json({
        success: false,
        error: 'You already requested reassignment. Action restricted.',
        is_locked_for_user: true,
        has_pending: true,
        request_status: 'PENDING',
        code: 'TASK_LOCKED_FOR_REQUESTER',
        lock: { is_locked: true, locked_for: 'REQUESTER_ONLY' }
      });
    }

    const normalizedStatus = task[0].status?.toUpperCase().trim();
    if (normalizedStatus !== 'ON HOLD') {
      return res.status(400).json({ success: false, error: `Cannot resume '${task[0].status}'. Only 'ON HOLD'.` });
    }

    const assignment = await q('SELECT * FROM task_assignments WHERE task_id = ? AND user_id = ?', [taskId, userId]);
    if (assignment.length === 0) return res.status(403).json({ success: false, error: 'Not assigned' });
    // Enforce read-only flag for resume
    try {
      const assn = assignment[0];
      const isRO = (assn && (assn.is_read_only === 1 || String(assn.is_read_only) === '1')) || (assn && (assn.isReadOnly === 1 || String(assn.isReadOnly) === '1'));
      if (isRO) return res.status(403).json({ success: false, error: 'Read-only users cannot modify task status' });
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }

    const now = new Date();
    try {
      await q('INSERT INTO task_time_entries (task_id, user_id, entry_type, action, timestamp) VALUES (?, ?, \'event\', ?, ?)', [taskId, userId, 'resume', now]);
    } catch (e) {
      const msg = (e && e.message) || '';
      if (msg.includes('WARN_DATA_TRUNCATED') || msg.includes('Data truncated')) {
        logger.warn('[task_time_entries] Data truncated warning swallowed: ' + msg);
      } else {
        throw e;
      }
    }
    await q('UPDATE tasks SET status = "In Progress", updatedAt = NOW() WHERE id = ?', [taskId]);

    await NotificationService.createAndSend(
      [userId],
      'Task Resumed',
      `Task resumed: ${task[0].public_id}`,
      'TASK_RESUMED',
      'task',
      task[0].public_id
    );

    res.json({ success: true, message: '▶️ Resumed', data: { status: 'In Progress' } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});


router.get('/:id/timeline', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    await ensureTaskTimeLogsTable();
    await ensureTaskActivitiesTable();

    let id = req.params.id;
    if (req.headers['x-task-public-id']) id = req.headers['x-task-public-id'];

    const taskResult = await q('SELECT id FROM tasks WHERE id = ? OR public_id = CAST(? AS CHAR)', [id, id]);
    if (!taskResult?.length) return res.status(404).json({ success: false, error: 'Task not found' });

    const taskId = taskResult[0].id;
    const logs = await q('SELECT id, task_id, user_id, entry_type, action, timestamp, duration_seconds AS duration, date, created_at, updated_at FROM task_time_entries WHERE task_id = ? ORDER BY timestamp DESC', [taskId]);
    const activities = await q('SELECT id, task_id, user_id, type, activity_text AS activity, status_action, created_at FROM task_logs WHERE task_id = ? ORDER BY created_at DESC', [taskId]);

    res.json({ success: true, data: { logs, activities } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Multi-user task assignment
router.post('/:taskId/assign-users', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { userIds } = req.body;
    const tenantId = req.tenantId;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, error: 'userIds array required' });
    }

    // Verify task exists and belongs to tenant
    const task = await q('SELECT id FROM tasks WHERE public_id = ? AND tenant_id = ?', [taskId, tenantId]);
    if (!task.length) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }

    // Insert assignments
    const values = userIds.map(userId => [taskId, userId]);
    await q('INSERT INTO task_assignments (task_id, user_id) VALUES ? ON DUPLICATE KEY UPDATE updated_at = NOW()', [values]);

    res.json({ success: true, message: 'Users assigned to task' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Update user-specific task status
router.put('/:taskId/users/:userId/status', async (req, res) => {
  // DISABLED: Per-user status updates are not allowed. All status changes must go through the main task update API.
  return res.status(403).json({ success: false, error: 'Per-user status updates are not allowed. Use the main task update API.' });
});

// Update checklist per user
router.put('/:taskId/users/:userId/checklist', async (req, res) => {
  try {
    const { taskId, userId } = req.params;
    const { checklist } = req.body;
    const tenantId = req.tenantId;

    // Verify assignment exists (support user_id as _id or public_id)
    const assignment = await q(`
      SELECT ta.id FROM task_assignments ta
      JOIN tasks t ON ta.task_id = t.id
      JOIN users u ON u._id = ta.user_id
      WHERE t.public_id = ? AND (u._id = ? OR u.public_id = ?) AND t.tenant_id = ?
    `, [taskId, userId, userId, tenantId]);
    if (!assignment.length) {
      return res.status(404).json({ success: false, error: 'Assignment not found' });
    }

    // Use internal task id for update to avoid type mismatch
    const taskInternalId = assignment[0].id ? assignment[0].task_id : null;
    // If assignment[0] only has id, fetch task id from tasks table
    let updateTaskId = null;
    if (assignment[0] && assignment[0].id) {
      // Find the task id for this assignment
      const taskRow = await q('SELECT ta.task_id FROM task_assignments ta WHERE ta.id = ?', [assignment[0].id]);
      updateTaskId = taskRow && taskRow[0] ? taskRow[0].task_id : null;
    }
    if (!updateTaskId) {
      return res.status(404).json({ success: false, error: 'Assignment not found (task id missing)'});
    }
    // Resolve userId to internal _id if needed
    let resolvedUserId = userId;
    if (typeof userId === 'string' && !/^[0-9]+$/.test(userId)) {
      const userRow = await q('SELECT _id FROM users WHERE public_id = ?', [userId]);
      if (!userRow.length) {
        return res.status(404).json({ success: false, error: 'User not found'});
      }
      resolvedUserId = userRow[0]._id;
    }
    await q('UPDATE task_assignments SET checklist = ?, updated_at = NOW() WHERE task_id = ? AND user_id = ?', [JSON.stringify(checklist), updateTaskId, resolvedUserId]);

    // Fetch the updated checklist to return in response
    const updatedRow = await q('SELECT checklist FROM task_assignments WHERE task_id = ? AND user_id = ?', [updateTaskId, resolvedUserId]);
    const updatedChecklist = updatedRow.length && updatedRow[0].checklist ? JSON.parse(updatedRow[0].checklist) : [];

    res.json({ success: true, message: 'Checklist updated', data: { checklist: updatedChecklist } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Get task assignments
router.get('/:taskId/assignments', async (req, res) => {
  try {
    const { taskId } = req.params;
    const tenantId = req.tenantId;

    const assignments = await q(`
      SELECT ta.*, u.name, u.email
      FROM task_assignments ta
      JOIN users u ON ta.user_id = u._id
      JOIN tasks t ON ta.task_id = t.public_id
      WHERE ta.task_id = ? AND t.tenant_id = ?
    `, [taskId, tenantId]);

    res.json({ success: true, data: assignments });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ─── Task Comments ────────────────────────────────────────────────────────────

// Ensure task_comments table exists with correct schema
async function ensureTaskCommentsTable() {
  try {
    // Create if not exists
    await q(`
      CREATE TABLE IF NOT EXISTS task_comments (
        id          INT NOT NULL AUTO_INCREMENT,
        task_id     INT NOT NULL,
        user_id     INT NOT NULL,
        comment     TEXT NOT NULL,
        tenant_id   INT NULL,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } catch (e) {
    // Table might already exist with wrong schema — try to fix it
    try {
      // Check if id column has AUTO_INCREMENT
      const cols = await q(`SHOW COLUMNS FROM task_comments WHERE Field = 'id'`);
      const idCol = cols && cols[0];
      if (idCol && !String(idCol.Extra || '').includes('auto_increment')) {
        // Drop and recreate since AUTO_INCREMENT can't easily be added after the fact without PK
        await q(`DROP TABLE IF EXISTS task_comments`);
        await q(`
          CREATE TABLE task_comments (
            id          INT NOT NULL AUTO_INCREMENT,
            task_id     INT NOT NULL,
            user_id     INT NOT NULL,
            comment     TEXT NOT NULL,
            tenant_id   INT NULL,
            created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        logger.info('task_comments table recreated with correct AUTO_INCREMENT schema');
      }
    } catch (fixErr) {
      logger.warn('ensureTaskCommentsTable fix attempt: ' + fixErr.message);
    }
  }
}

// GET /api/tasks/:id/comments
router.get('/:id/comments', async (req, res) => {
  try {
    await ensureTaskCommentsTable();
    const tenantId = req.tenantId;
    const { id: taskPublicId } = req.params;

    // Resolve task internal id from public_id
    const taskRows = await q(
      'SELECT id FROM tasks WHERE public_id = ? AND tenant_id = ? LIMIT 1',
      [taskPublicId, tenantId]
    );
    if (!taskRows || taskRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const taskId = taskRows[0].id;

    const comments = await q(
      `SELECT tc.id, tc.comment, tc.created_at AS createdAt,
              u.name AS user_name, u.role AS user_role, u.public_id AS user_public_id
       FROM task_comments tc
       JOIN users u ON u._id = tc.user_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId]
    );

    res.json({ success: true, data: comments || [] });
  } catch (e) {
    logger.error('GET task comments error: ' + e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/tasks/:id/comments
router.post('/:id/comments', async (req, res) => {
  try {
    await ensureTaskCommentsTable();
    const tenantId = req.tenantId;
    const { id: taskPublicId } = req.params;
    const { comment } = req.body || {};

    if (!comment || !String(comment).trim()) {
      return res.status(400).json({ success: false, error: 'Comment text is required' });
    }

    // Only Admin and Manager can post comments
    const userRole = normalizeTaskRole(req.user && req.user.role ? req.user.role : '');
    if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN' && userRole !== 'MANAGER') {
      return res.status(403).json({ success: false, error: 'Only Admins and Managers can post comments' });
    }

    // Resolve task internal id
    const taskRows = await q(
      'SELECT id FROM tasks WHERE public_id = ? AND tenant_id = ? LIMIT 1',
      [taskPublicId, tenantId]
    );
    if (!taskRows || taskRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const taskId = taskRows[0].id;

    // Resolve user internal id
    const userId = req.user._id;

    const result = await q(
      'INSERT INTO task_comments (task_id, user_id, comment, tenant_id) VALUES (?, ?, ?, ?)',
      [taskId, userId, String(comment).trim(), tenantId]
    );

    const newCommentId = result.insertId;

    // Fetch the newly created comment with user info
    const newRows = await q(
      `SELECT tc.id, tc.comment, tc.created_at AS createdAt,
              u.name AS user_name, u.role AS user_role, u.public_id AS user_public_id
       FROM task_comments tc
       JOIN users u ON u._id = tc.user_id
       WHERE tc.id = ? LIMIT 1`,
      [newCommentId]
    );

    const newComment = newRows && newRows[0] ? newRows[0] : {
      id: newCommentId,
      comment: String(comment).trim(),
      createdAt: new Date().toISOString(),
      user_name: req.user.name || 'Unknown',
      user_role: req.user.role || '',
      user_public_id: req.user.public_id || req.user.id || null
    };

    res.json({ success: true, data: newComment });
  } catch (e) {
    logger.error('POST task comment error: ' + e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/tasks/:id/comments/:commentId
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { id: taskPublicId, commentId } = req.params;

    // Resolve task internal id
    const taskRows = await q(
      'SELECT id FROM tasks WHERE public_id = ? AND tenant_id = ? LIMIT 1',
      [taskPublicId, tenantId]
    );
    if (!taskRows || taskRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    const taskId = taskRows[0].id;

    // Only Admin can delete comments
    const userRole = normalizeTaskRole(req.user && req.user.role ? req.user.role : '');
    if (userRole !== 'ADMIN' && userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ success: false, error: 'Only Admins can delete comments' });
    }

    // Verify comment exists and belongs to this task
    const commentRows = await q(
      'SELECT id FROM task_comments WHERE id = ? AND task_id = ? AND tenant_id = ? LIMIT 1',
      [commentId, taskId, tenantId]
    );
    if (!commentRows || commentRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Comment not found' });
    }

    await q('DELETE FROM task_comments WHERE id = ?', [commentId]);

    res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (e) {
    logger.error('DELETE task comment error: ' + e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
