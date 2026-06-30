const HttpError = require('../../../errors/HttpError');
const { q } = require('../utils/db');
const photoService = require('./photoService');
const notify = require('./notify');
const { logTaskEvent } = require('./audit');
const { normalizeRole } = require('../../../config/rbac');
const timerService = require('./timerService');

const TABLE = { task: 'tm_tasks', occurrence: 'tm_task_occurrences' };
const APPROVAL_TYPE = { task: 'TASK_COMPLETION', occurrence: 'OCCURRENCE_COMPLETION' };

async function getEntity(kind, id, tenantId) {
  const rows = await q(`SELECT * FROM ${TABLE[kind]} WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return rows[0] || null;
}

async function getParentTask(occurrence) {
  const rows = await q(`SELECT * FROM tm_tasks WHERE id = ?`, [occurrence.task_id]);
  return rows[0] || null;
}

async function completeEntity({ req, kind, id, remarks, files }) {
  const tenantId = req.user.tenant_id;
  const entity = await getEntity(kind, id, tenantId);
  if (!entity) throw new HttpError(404, 'Not found', 'NOT_FOUND');

  const role = normalizeRole(req.user.role);
  if (role === 'EMPLOYEE' && entity.assigned_to !== req.user._id) {
    throw new HttpError(403, 'You can only complete tasks assigned to you', 'AUTH_FORBIDDEN');
  }

  if (!['Pending', 'In Progress', 'Rejected'].includes(entity.status)) {
    throw new HttpError(409, 'Task cannot be completed from its current status', 'INVALID_STATE');
  }

  const parentTask = kind === 'task' ? entity : await getParentTask(entity);
  if (!parentTask) throw new HttpError(404, 'Parent task not found', 'NOT_FOUND');

  const incomingPhotoCount = Array.isArray(files) ? files.length : 0;
  if (parentTask.photo_required) {
    const existing = await photoService.hasExistingPhoto(kind === 'task' ? id : null, kind === 'occurrence' ? id : null);
    if (incomingPhotoCount === 0 && !existing) {
      throw new HttpError(422, 'Photo upload is mandatory', 'PHOTO_REQUIRED');
    }
  }
  if (!parentTask.multiple_photos && incomingPhotoCount > 1) {
    throw new HttpError(422, 'Only one photo is allowed for this task', 'PHOTO_LIMIT_EXCEEDED');
  }

  if (incomingPhotoCount > 0) {
    await photoService.savePhotos({
      files,
      taskId: kind === 'task' ? id : null,
      occurrenceId: kind === 'occurrence' ? id : null,
      uploadedBy: req.user._id,
      tenantId
    });
  }

  const finalDuration = timerService.elapsedSeconds(entity);
  await q(
    `UPDATE ${TABLE[kind]}
     SET status = 'Completed', approval_status = 'Pending', completed_at = NOW(),
         total_duration_seconds = ?, timer_status = 'Completed',
         remarks = ?, rejection_reason = NULL, updated_at = NOW()
     WHERE id = ?`,
    [finalDuration, remarks || null, id]
  );

  const approvalInsert = await q(
    `INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status) VALUES (?, ?, ?, ?, 'Pending')`,
    [tenantId, APPROVAL_TYPE[kind], id, req.user._id]
  );

  if (parentTask.assigned_by) {
    await notify.notifyCompletionSubmitted(
      [parentTask.assigned_by],
      parentTask.title,
      parentTask.public_id,
      req.user.name || 'Employee',
      tenantId
    );
  }

  await logTaskEvent(req, {
    action: kind === 'task' ? 'TASK_COMPLETED' : 'OCCURRENCE_COMPLETED',
    entity: kind === 'task' ? 'Task' : 'TaskOccurrence',
    entityId: id,
    details: { remarks, photoCount: incomingPhotoCount }
  });

  return { approvalId: approvalInsert.insertId, status: 'Completed', approvalStatus: 'Pending' };
}

async function decideApproval({ req, approvalId, decision, reason }) {
  const tenantId = req.user.tenant_id;
  const rows = await q(`SELECT * FROM tm_approvals WHERE id = ? AND tenant_id = ?`, [approvalId, tenantId]);
  const approval = rows[0];
  if (!approval) throw new HttpError(404, 'Approval request not found', 'NOT_FOUND');
  if (approval.status !== 'Pending') throw new HttpError(409, 'Approval already decided', 'ALREADY_DECIDED');

  const kind = approval.approval_type === 'TASK_COMPLETION' ? 'task'
    : approval.approval_type === 'OCCURRENCE_COMPLETION' ? 'occurrence'
    : 'project';

  const approved = decision === 'approve';
  await q(
    `UPDATE tm_approvals SET status = ?, decided_by = ?, decided_at = NOW(), rejection_reason = ? WHERE id = ?`,
    [approved ? 'Approved' : 'Rejected', req.user._id, approved ? null : reason || null, approvalId]
  );

  if (kind === 'task' || kind === 'occurrence') {
    const entity = await getEntity(kind, approval.entity_id, tenantId);
    if (!entity) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
    const parentTask = kind === 'task' ? entity : await getParentTask(entity);

    if (approved) {
      await q(
        `UPDATE ${TABLE[kind]} SET status = 'Approved', approval_status = 'Approved', approved_by = ?, approved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [req.user._id, approval.entity_id]
      );
    } else {
      await q(
        `UPDATE ${TABLE[kind]} SET status = 'Rejected', approval_status = 'Rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?, updated_at = NOW() WHERE id = ?`,
        [req.user._id, reason || null, approval.entity_id]
      );
    }

    const recipient = entity.assigned_to;
    if (recipient) {
      if (approved) await notify.notifyApproved(recipient, parentTask.title, parentTask.public_id, tenantId);
      else await notify.notifyRejected(recipient, parentTask.title, parentTask.public_id, reason, tenantId);
    }

    await logTaskEvent(req, {
      action: approved ? 'TASK_APPROVED' : 'TASK_REJECTED',
      entity: kind === 'task' ? 'Task' : 'TaskOccurrence',
      entityId: approval.entity_id,
      details: { reason: approved ? null : reason }
    });
  } else if (kind === 'project') {
    const projectRepo = require('../repos/projectRepo');
    const project = await projectRepo.findById(approval.entity_id, tenantId);
    if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');

    if (approved) {
      await q(
        `UPDATE tm_projects SET status = 'Closed', completion_approved_by = ?, completion_approved_at = NOW(), updated_at = NOW() WHERE id = ?`,
        [req.user._id, approval.entity_id]
      );
    } else {
      await q(
        `UPDATE tm_projects SET status = 'Active', completion_requested_at = NULL, updated_at = NOW() WHERE id = ?`,
        [approval.entity_id]
      );
    }

    const memberIds = await projectRepo.getMemberUserIds(approval.entity_id);
    await notify.notifyProjectClosed(memberIds, project.name, project.public_id, approved, tenantId);

    await logTaskEvent(req, {
      action: approved ? 'PROJECT_CLOSED' : 'PROJECT_CLOSURE_REJECTED',
      entity: 'Project',
      entityId: approval.entity_id,
      details: { reason: approved ? null : reason }
    });
  }

  return { approvalId, status: approved ? 'Approved' : 'Rejected' };
}

module.exports = { completeEntity, decideApproval, getEntity, getParentTask };
