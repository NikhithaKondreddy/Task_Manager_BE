const HttpError = require('../../../errors/HttpError');
const { q } = require('../utils/db');
const taskRepo = require('../repos/taskRepo');
const notify = require('./notify');
const { logTaskEvent } = require('./audit');
const storageService = require('../../../services/storageService');

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await q(`CREATE TABLE IF NOT EXISTS gemba_execution (
    id int NOT NULL AUTO_INCREMENT,
    gemba_walk_id int NOT NULL,
    occurrence_id int DEFAULT NULL,
    employee_id int NOT NULL,
    started_at datetime DEFAULT NULL,
    paused_at datetime DEFAULT NULL,
    resumed_at datetime DEFAULT NULL,
    completed_at datetime DEFAULT NULL,
    total_duration int NOT NULL DEFAULT 0,
    execution_status enum('Not Started','Running','Paused','Draft','Completed') NOT NULL DEFAULT 'Not Started',
    remarks text,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gemba_execution_walk (gemba_walk_id),
    KEY idx_gemba_execution_occurrence (occurrence_id),
    KEY idx_gemba_execution_employee (employee_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await q(`CREATE TABLE IF NOT EXISTS gemba_checklists (
    id int NOT NULL AUTO_INCREMENT,
    execution_id int NOT NULL,
    checkpoint_name varchar(255) NOT NULL,
    description text,
    sequence int NOT NULL DEFAULT 0,
    mandatory tinyint(1) NOT NULL DEFAULT 1,
    status enum('Pending','In Progress','Completed') NOT NULL DEFAULT 'Pending',
    remarks text,
    completed_at datetime DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gemba_checklists_execution (execution_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await q(`CREATE TABLE IF NOT EXISTS gemba_photos (
    id int NOT NULL AUTO_INCREMENT,
    execution_id int NOT NULL,
    checklist_id int DEFAULT NULL,
    image_path varchar(1024) NOT NULL,
    uploaded_by int DEFAULT NULL,
    uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gemba_photos_execution (execution_id),
    KEY idx_gemba_photos_checklist (checklist_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  await q(`CREATE TABLE IF NOT EXISTS gemba_history (
    id int NOT NULL AUTO_INCREMENT,
    execution_id int NOT NULL,
    action varchar(100) NOT NULL,
    remarks text,
    performed_by int DEFAULT NULL,
    created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_gemba_history_execution (execution_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci`);
  schemaReady = true;
}

async function findWalk(publicId, req) {
  await ensureSchema();
  const walk = await taskRepo.findByPublicId(publicId, req.user.tenant_id);
  if (!walk || walk.task_type !== 'GEMBA_WALK') throw new HttpError(404, 'Gemba Walk not found', 'NOT_FOUND');
  if (walk.assigned_to !== req.user._id) throw new HttpError(403, 'You can only execute assigned Gemba Walks', 'AUTH_FORBIDDEN');
  return walk;
}

async function getExecutionById(id) {
  const rows = await q(`SELECT * FROM gemba_execution WHERE id = ?`, [id]);
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

async function getOrCreateExecution({ walk, req, occurrenceId = null }) {
  const existing = await q(
    `SELECT * FROM gemba_execution WHERE gemba_walk_id = ? AND (occurrence_id <=> ?) AND employee_id = ? ORDER BY id DESC LIMIT 1`,
    [walk.id, occurrenceId || null, req.user._id]
  );
  if (existing[0]) return existing[0];
  const result = await q(
    `INSERT INTO gemba_execution (gemba_walk_id, occurrence_id, employee_id, execution_status)
     VALUES (?, ?, ?, 'Not Started')`,
    [walk.id, occurrenceId || null, req.user._id]
  );
  await q(
    `INSERT INTO gemba_checklists (execution_id, checkpoint_name, description, sequence, mandatory)
     SELECT ?, title, title, sort_order, 1 FROM tm_checklist_items WHERE task_id = ? ORDER BY sort_order`,
    [result.insertId, walk.id]
  );
  return getExecutionById(result.insertId);
}

async function detail({ walkPublicId, req, occurrenceId = null }) {
  const walk = await findWalk(walkPublicId, req);
  const execution = await getOrCreateExecution({ walk, req, occurrenceId });
  const [checklist, photos, history] = await Promise.all([
    q(`SELECT * FROM gemba_checklists WHERE execution_id = ? ORDER BY sequence`, [execution.id]),
    q(`SELECT * FROM gemba_photos WHERE execution_id = ? ORDER BY uploaded_at DESC`, [execution.id]),
    q(`SELECT * FROM gemba_history WHERE execution_id = ? ORDER BY created_at DESC`, [execution.id])
  ]);
  return { walk, execution: { ...execution, elapsed_seconds: elapsedSeconds(execution) }, checklist, photos, history };
}

async function record(req, executionId, action, remarks = null) {
  await q(
    `INSERT INTO gemba_history (execution_id, action, remarks, performed_by) VALUES (?, ?, ?, ?)`,
    [executionId, action, remarks, req.user._id]
  );
}

async function transition({ walkPublicId, req, action, occurrenceId = null }) {
  const walk = await findWalk(walkPublicId, req);
  const execution = await getOrCreateExecution({ walk, req, occurrenceId });
  const current = execution.execution_status || 'Not Started';
  let sql;
  let params;
  if (action === 'start') {
    if (!['Not Started', 'Draft'].includes(current)) throw new HttpError(409, 'Gemba Walk already started', 'INVALID_STATE');
    sql = `UPDATE gemba_execution SET started_at = COALESCE(started_at, NOW()), resumed_at = NOW(), execution_status = 'Running', updated_at = NOW() WHERE id = ?`;
    params = [execution.id];
  } else if (action === 'pause') {
    if (current !== 'Running') throw new HttpError(409, 'Only running walk can be paused', 'INVALID_STATE');
    sql = `UPDATE gemba_execution SET paused_at = NOW(), total_duration = ?, execution_status = 'Paused', updated_at = NOW() WHERE id = ?`;
    params = [elapsedSeconds(execution), execution.id];
  } else if (action === 'resume') {
    if (current !== 'Paused') throw new HttpError(409, 'Only paused walk can be resumed', 'INVALID_STATE');
    sql = `UPDATE gemba_execution SET resumed_at = NOW(), execution_status = 'Running', updated_at = NOW() WHERE id = ?`;
    params = [execution.id];
  } else if (action === 'draft') {
    sql = `UPDATE gemba_execution SET total_duration = ?, execution_status = 'Draft', updated_at = NOW() WHERE id = ?`;
    params = [elapsedSeconds(execution), execution.id];
  } else {
    throw new HttpError(400, 'Invalid Gemba execution action', 'VALIDATION_ERROR');
  }
  await q(sql, params);
  await record(req, execution.id, action.toUpperCase());
  return detail({ walkPublicId, req, occurrenceId });
}

async function updateChecklist({ walkPublicId, req, itemId, isCompleted, remarks, occurrenceId = null }) {
  const walk = await findWalk(walkPublicId, req);
  const execution = await getOrCreateExecution({ walk, req, occurrenceId });
  await q(
    `UPDATE gemba_checklists SET status = ?, remarks = ?, completed_at = ?, updated_at = NOW()
     WHERE id = ? AND execution_id = ?`,
    [isCompleted ? 'Completed' : 'Pending', remarks || null, isCompleted ? new Date() : null, itemId, execution.id]
  );
  await record(req, execution.id, 'CHECKLIST_UPDATED', remarks || null);
  return detail({ walkPublicId, req, occurrenceId });
}

async function uploadPhotos({ walkPublicId, req, files, checkpointId = null, occurrenceId = null }) {
  const walk = await findWalk(walkPublicId, req);
  const execution = await getOrCreateExecution({ walk, req, occurrenceId });
  if (!Array.isArray(files) || files.length === 0) {
    throw new HttpError(400, 'At least one photo file is required', 'VALIDATION_ERROR');
  }
  for (const file of files || []) {
    const key = `task-manager/gemba/${execution.id}/${Date.now()}_${(file.originalname || 'photo').replace(/[^a-zA-Z0-9._()-]/g, '_')}`;
    const result = await storageService.upload(file, key);
    const imagePath = uploadedImagePath(result);
    if (!imagePath) {
      throw new HttpError(500, 'Photo upload failed: storage path was not returned', 'PHOTO_STORAGE_FAILED');
    }
    await q(
      `INSERT INTO gemba_photos (execution_id, checklist_id, image_path, uploaded_by) VALUES (?, ?, ?, ?)`,
      [execution.id, checkpointId || null, imagePath, req.user._id]
    );
  }
  await record(req, execution.id, 'PHOTOS_UPLOADED');
  return detail({ walkPublicId, req, occurrenceId });
}

async function saveRemarks({ walkPublicId, req, remarks, occurrenceId = null }) {
  const walk = await findWalk(walkPublicId, req);
  const execution = await getOrCreateExecution({ walk, req, occurrenceId });
  await q(`UPDATE gemba_execution SET remarks = ?, updated_at = NOW() WHERE id = ?`, [remarks || null, execution.id]);
  await record(req, execution.id, 'REMARKS_SAVED', remarks || null);
  return detail({ walkPublicId, req, occurrenceId });
}

async function complete({ walkPublicId, req, remarks, files, occurrenceId = null }) {
  if (remarks) await saveRemarks({ walkPublicId, req, remarks, occurrenceId });
  if (files?.length) await uploadPhotos({ walkPublicId, req, files, occurrenceId });
  const walk = await findWalk(walkPublicId, req);
  const execution = await getOrCreateExecution({ walk, req, occurrenceId });
  const [photos, checklist] = await Promise.all([
    q(`SELECT COUNT(*) AS total FROM gemba_photos WHERE execution_id = ?`, [execution.id]),
    q(`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS done FROM gemba_checklists WHERE execution_id = ? AND mandatory = 1`, [execution.id])
  ]);
  if (walk.photo_required && Number(photos[0].total) === 0) {
    throw new HttpError(422, 'Photo upload is mandatory before completing this Gemba Walk.', 'PHOTO_REQUIRED');
  }
  if (Number(checklist[0].total) > 0 && Number(checklist[0].done || 0) !== Number(checklist[0].total)) {
    throw new HttpError(422, 'All Gemba checklist items must be completed before submitting.', 'CHECKLIST_REQUIRED');
  }
  const duration = elapsedSeconds(execution);
  await q(`UPDATE gemba_execution SET completed_at = NOW(), total_duration = ?, execution_status = 'Completed', updated_at = NOW() WHERE id = ?`, [duration, execution.id]);
  await q(`UPDATE tm_tasks SET status = 'Completed', approval_status = 'Pending', completed_at = NOW(), updated_at = NOW() WHERE id = ?`, [walk.id]);
  await q(`INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status) VALUES (?, 'TASK_COMPLETION', ?, ?, 'Pending')`, [req.user.tenant_id, walk.id, req.user._id]);
  if (walk.assigned_by) await notify.notifyCompletionSubmitted([walk.assigned_by], walk.title, walk.public_id, req.user.name || 'Employee', req.user.tenant_id);
  await record(req, execution.id, 'COMPLETED');
  await logTaskEvent(req, { action: 'GEMBA_EXECUTION_COMPLETED', entity: 'GembaExecution', entityId: execution.id, details: { duration } });
  return detail({ walkPublicId, req, occurrenceId });
}

module.exports = { detail, transition, updateChecklist, uploadPhotos, saveRemarks, complete };
