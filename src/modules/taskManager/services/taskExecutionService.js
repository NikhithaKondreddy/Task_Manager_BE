const HttpError = require('../../../errors/HttpError');
const { q } = require('../utils/db');
const taskRepo = require('../repos/taskRepo');
const notify = require('./notify');
const { logTaskEvent } = require('./audit');
const storageService = require('../../../services/storageService');

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await q(`CREATE TABLE IF NOT EXISTS task_execution (
    id int NOT NULL AUTO_INCREMENT,
    task_id int NOT NULL,
    occurrence_id int DEFAULT NULL,
    employee_id int NOT NULL,
    started_at datetime DEFAULT NULL,
    paused_at datetime DEFAULT NULL,
    resumed_at datetime DEFAULT NULL,
    completed_at datetime DEFAULT NULL,
    total_duration int NOT NULL DEFAULT 0,
    sla_status enum('On Track','Warning','Breached') NOT NULL DEFAULT 'On Track',
    execution_status enum('Not Started','Running','Paused','Draft','Completed') NOT NULL DEFAULT 'Not Started',
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_task_execution_task (task_id),
    KEY idx_task_execution_occurrence (occurrence_id),
    KEY idx_task_execution_employee (employee_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await q(`CREATE TABLE IF NOT EXISTS task_execution_photos (
    id int NOT NULL AUTO_INCREMENT,
    execution_id int NOT NULL,
    image_path varchar(1024) NOT NULL,
    uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_task_execution_photos_execution (execution_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await q(`CREATE TABLE IF NOT EXISTS task_execution_remarks (
    id int NOT NULL AUTO_INCREMENT,
    execution_id int NOT NULL,
    remarks text,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_task_execution_remarks_execution (execution_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await q(`CREATE TABLE IF NOT EXISTS task_execution_checklist (
    id int NOT NULL AUTO_INCREMENT,
    execution_id int NOT NULL,
    checkpoint_name varchar(255) NOT NULL,
    description text,
    sequence int NOT NULL DEFAULT 0,
    mandatory tinyint(1) NOT NULL DEFAULT 1,
    is_completed tinyint(1) NOT NULL DEFAULT 0,
    completed_at datetime DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_task_execution_checklist_execution (execution_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  schemaReady = true;
}

async function findTask(publicId, req) {
  await ensureSchema();
  const task = await taskRepo.findByPublicId(publicId, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  if (task.task_type === 'PROJECT') {
    throw new HttpError(409, 'Project tasks do not use the execution workflow', 'PROJECT_TASK_NOT_EXECUTABLE');
  }
  if (task.assigned_to !== req.user._id) {
    throw new HttpError(403, 'You can only execute tasks assigned to you', 'AUTH_FORBIDDEN');
  }
  return task;
}

async function getOrCreateExecution({ task, occurrenceId = null, req }) {
  const params = [task.id, occurrenceId || null, req.user._id];
  const existing = await q(
    `SELECT * FROM task_execution
     WHERE task_id = ? AND (occurrence_id <=> ?) AND employee_id = ?
     ORDER BY id DESC LIMIT 1`,
    params
  );
  if (existing[0]) return existing[0];

  const result = await q(
    `INSERT INTO task_execution
      (task_id, occurrence_id, employee_id, sla_status, execution_status)
     VALUES (?, ?, ?, 'On Track', 'Not Started')`,
    params
  );
  return getExecutionById(result.insertId);
}

async function getExecutionById(id) {
  const rows = await q(`SELECT * FROM task_execution WHERE id = ?`, [id]);
  return rows[0] || null;
}

function elapsedSeconds(execution) {
  const saved = Number(execution.total_duration || 0);
  if (execution.execution_status !== 'Running' || !execution.resumed_at) return saved;
  return saved + Math.max(0, Math.floor((Date.now() - new Date(execution.resumed_at).getTime()) / 1000));
}

function uploadedImagePath(result) {
  if (!result) return null;
  if (typeof result === 'string') return result;
  return result.storagePath
    || result.storage_path
    || result.publicPath
    || result.public_path
    || result.path
    || result.url
    || result.location
    || result.Location
    || (result.key ? `/uploads/${result.key}` : null);
}

async function detail({ taskPublicId, req, occurrenceId = null }) {
  const task = await findTask(taskPublicId, req);
  const execution = await getOrCreateExecution({ task, occurrenceId, req });
  const [photos, remarks, checklist] = await Promise.all([
    q(`SELECT * FROM task_execution_photos WHERE execution_id = ? ORDER BY uploaded_at DESC`, [execution.id]),
    q(`SELECT * FROM task_execution_remarks WHERE execution_id = ? ORDER BY created_at DESC`, [execution.id]),
    q(`SELECT * FROM task_execution_checklist WHERE execution_id = ? ORDER BY sequence ASC`, [execution.id])
  ]);
  return { task, execution: { ...execution, elapsed_seconds: elapsedSeconds(execution) }, photos, remarks, checklist };
}

async function transition({ taskPublicId, req, action, occurrenceId = null }) {
  const task = await findTask(taskPublicId, req);
  const execution = await getOrCreateExecution({ task, occurrenceId, req });
  const current = execution.execution_status || 'Not Started';
  let sql;
  let params;

  if (action === 'start') {
    if (!['Not Started', 'Draft'].includes(current)) throw new HttpError(409, 'Execution already started', 'INVALID_STATE');
    sql = `UPDATE task_execution SET started_at = COALESCE(started_at, NOW()), resumed_at = NOW(), execution_status = 'Running', updated_at = NOW() WHERE id = ?`;
    params = [execution.id];
  } else if (action === 'pause') {
    if (current !== 'Running') throw new HttpError(409, 'Only running execution can be paused', 'INVALID_STATE');
    sql = `UPDATE task_execution SET paused_at = NOW(), total_duration = ?, execution_status = 'Paused', updated_at = NOW() WHERE id = ?`;
    params = [elapsedSeconds(execution), execution.id];
  } else if (action === 'resume') {
    if (current !== 'Paused') throw new HttpError(409, 'Only paused execution can be resumed', 'INVALID_STATE');
    sql = `UPDATE task_execution SET resumed_at = NOW(), execution_status = 'Running', updated_at = NOW() WHERE id = ?`;
    params = [execution.id];
  } else if (action === 'draft') {
    sql = `UPDATE task_execution SET total_duration = ?, execution_status = 'Draft', updated_at = NOW() WHERE id = ?`;
    params = [elapsedSeconds(execution), execution.id];
  } else {
    throw new HttpError(400, 'Invalid execution action', 'VALIDATION_ERROR');
  }

  await q(sql, params);
  await logTaskEvent(req, { action: `TASK_EXECUTION_${action.toUpperCase()}`, entity: 'TaskExecution', entityId: execution.id });
  return detail({ taskPublicId, req, occurrenceId });
}

async function saveRemarks({ taskPublicId, req, remarks, occurrenceId = null }) {
  const task = await findTask(taskPublicId, req);
  const execution = await getOrCreateExecution({ task, occurrenceId, req });
  await q(`INSERT INTO task_execution_remarks (execution_id, remarks) VALUES (?, ?)`, [execution.id, remarks || null]);
  return detail({ taskPublicId, req, occurrenceId });
}

async function uploadPhotos({ taskPublicId, req, files, occurrenceId = null }) {
  const task = await findTask(taskPublicId, req);
  const execution = await getOrCreateExecution({ task, occurrenceId, req });
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, 'At least one photo file is required', 'VALIDATION_ERROR');
  }
  for (const file of files || []) {
    const key = `task-manager/executions/${execution.id}/${Date.now()}_${(file.originalname || 'photo').replace(/[^a-zA-Z0-9._()-]/g, '_')}`;
    const result = await storageService.upload(file, key);
    const imagePath = uploadedImagePath(result);
    if (!imagePath) {
      throw new HttpError(500, 'Photo upload failed: storage path was not returned', 'PHOTO_STORAGE_FAILED');
    }
    await q(`INSERT INTO task_execution_photos (execution_id, image_path) VALUES (?, ?)`, [execution.id, imagePath]);
  }
  return detail({ taskPublicId, req, occurrenceId });
}

async function complete({ taskPublicId, req, remarks, files, occurrenceId = null }) {
  if (remarks) await saveRemarks({ taskPublicId, req, remarks, occurrenceId });
  if (files?.length) await uploadPhotos({ taskPublicId, req, files, occurrenceId });

  const task = await findTask(taskPublicId, req);
  const execution = await getOrCreateExecution({ task, occurrenceId, req });
  const photos = await q(`SELECT COUNT(*) AS total FROM task_execution_photos WHERE execution_id = ?`, [execution.id]);
  const checklist = await q(`SELECT COUNT(*) AS total, SUM(CASE WHEN is_completed = 1 THEN 1 ELSE 0 END) AS done FROM task_execution_checklist WHERE execution_id = ?`, [execution.id]);

  if (task.photo_required && Number(photos[0].total) === 0) {
    throw new HttpError(422, 'Photo upload is mandatory before completing this task.', 'PHOTO_REQUIRED');
  }
  if (Number(checklist[0].total) > 0 && Number(checklist[0].done || 0) !== Number(checklist[0].total)) {
    throw new HttpError(422, 'All checklist items must be completed before submitting.', 'CHECKLIST_REQUIRED');
  }

  const duration = elapsedSeconds(execution);
  await q(
    `UPDATE task_execution
     SET completed_at = NOW(), total_duration = ?, execution_status = 'Completed', updated_at = NOW()
     WHERE id = ?`,
    [duration, execution.id]
  );
  await q(`UPDATE tm_tasks SET status = 'Completed', approval_status = 'Pending', completed_at = NOW(), updated_at = NOW() WHERE id = ?`, [task.id]);
  await q(
    `INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status)
     VALUES (?, 'TASK_COMPLETION', ?, ?, 'Pending')`,
    [req.user.tenant_id, task.id, req.user._id]
  );
  if (task.assigned_by) {
    await notify.notifyCompletionSubmitted([task.assigned_by], task.title, task.public_id, req.user.name || 'Employee', req.user.tenant_id);
  }
  await logTaskEvent(req, { action: 'TASK_EXECUTION_COMPLETED', entity: 'TaskExecution', entityId: execution.id, details: { duration } });
  return detail({ taskPublicId, req, occurrenceId });
}

module.exports = { detail, transition, saveRemarks, uploadPhotos, complete };
