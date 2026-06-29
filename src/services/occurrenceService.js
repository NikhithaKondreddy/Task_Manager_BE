const db = require(__root + 'db');
const dayjs = require('dayjs');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

const NotificationService = require(__root + 'services/notificationService');

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

/**
 * Task references arriving from the frontend are public_id strings (e.g. "tsk_abc123"),
 * not the internal numeric id task_occurrences.task_id actually stores. Mirrors
 * resolveTenantTask's (id = ? OR public_id = ?) pattern from Tasks.js.
 */
async function resolveTaskInternalId(identifier, tenantId = null) {
  if (identifier === undefined || identifier === null || identifier === '') return null;
  const numericId = /^\d+$/.test(String(identifier)) ? Number(identifier) : null;
  let sql = 'SELECT id FROM tasks WHERE (id = ? OR public_id = ?)';
  const params = [numericId, String(identifier)];
  if (tenantId) { sql += ' AND tenant_id = ?'; params.push(tenantId); }
  sql += ' LIMIT 1';
  const rows = await query(sql, params);
  return rows && rows.length ? rows[0].id : null;
}

function cloneChecklistTemplate(checkpoints) {
  const parsed = checkpoints
    ? (typeof checkpoints === 'string' ? JSON.parse(checkpoints) : checkpoints)
    : null;
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  // Snapshot the template so later edits to tasks.checkpoints don't retroactively
  // change a day that's already been completed.
  return parsed.map((item) => ({
    id: item.id,
    title: item.title,
    mandatory: Boolean(item.mandatory),
    status: 'PENDING',
  }));
}

async function createOccurrence({ taskId, occurrenceDate, tenantId = null, createdBy = null }) {
  const dateStr = dayjs(occurrenceDate).format('YYYY-MM-DD');
  try {
    const taskRows = await query('SELECT checkpoints FROM tasks WHERE id = ? LIMIT 1', [taskId]);
    const checklist = taskRows && taskRows[0] ? cloneChecklistTemplate(taskRows[0].checkpoints) : null;

    const insert = await query(
      'INSERT IGNORE INTO task_occurrences (task_id, occurrence_date, status, tenant_id, created_by, checklist) VALUES (?, ?, ?, ?, ?, ?)',
      [taskId, dateStr, 'Pending', tenantId, createdBy, checklist ? JSON.stringify(checklist) : null]
    );
    if (insert && insert.affectedRows && insert.affectedRows > 0) {
      const rows = await query('SELECT * FROM task_occurrences WHERE task_id = ? AND occurrence_date = ? LIMIT 1', [taskId, dateStr]);
      return rows && rows.length ? rows[0] : null;
    }
    // if not inserted, return existing
    const existing = await query('SELECT * FROM task_occurrences WHERE task_id = ? AND occurrence_date = ? LIMIT 1', [taskId, dateStr]);
    return existing && existing.length ? existing[0] : null;
  } catch (error) {
    logger.error('createOccurrence error:', error && error.message ? error.message : error);
    throw error;
  }
}

async function getOccurrencesForTask(taskId, tenantId = null) {
  try {
    const rows = await query('SELECT * FROM task_occurrences WHERE task_id = ? ORDER BY occurrence_date DESC', [taskId]);
    return rows;
  } catch (error) {
    logger.error('getOccurrencesForTask error:', error && error.message ? error.message : error);
    throw error;
  }
}

async function getOccurrenceById(occurrenceId) {
  const rows = await query('SELECT * FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
  return rows && rows.length ? rows[0] : null;
}

/**
 * Mirrors validateTaskCompletionEligibility's mandatory-checkpoint pattern in Tasks.js,
 * but scoped to a single occurrence's mandatory_photo / mandatory_checklist / mandatory_remarks.
 */
async function validateOccurrenceCompletion(occurrenceId, { remarks } = {}) {
  const occurrence = await getOccurrenceById(occurrenceId);
  if (!occurrence) return { eligible: false, error: 'Occurrence not found' };

  const taskRows = await query(
    'SELECT mandatory_photo, mandatory_checklist, mandatory_remarks FROM tasks WHERE id = ? LIMIT 1',
    [occurrence.task_id]
  );
  const task = taskRows && taskRows[0] ? taskRows[0] : {};

  if (task.mandatory_photo) {
    const photoRows = await query('SELECT COUNT(*) as count FROM files WHERE occurrence_id = ?', [occurrenceId]);
    if (!photoRows || !photoRows[0] || Number(photoRows[0].count) === 0) {
      return { eligible: false, error: 'A photo is required before this occurrence can be completed' };
    }
  }

  if (task.mandatory_checklist) {
    const checklist = occurrence.checklist
      ? (typeof occurrence.checklist === 'string' ? JSON.parse(occurrence.checklist) : occurrence.checklist)
      : null;
    if (Array.isArray(checklist) && checklist.length > 0) {
      const incompleteMandatory = checklist.filter((c) => c.mandatory && c.status !== 'COMPLETED');
      if (incompleteMandatory.length > 0) {
        return { eligible: false, error: 'All mandatory checklist items must be completed before this occurrence can be completed' };
      }
    }
  }

  if (task.mandatory_remarks) {
    const remarksValue = remarks !== undefined ? remarks : occurrence.remarks;
    if (!remarksValue || !String(remarksValue).trim()) {
      return { eligible: false, error: 'Remarks are required before this occurrence can be completed' };
    }
  }

  return { eligible: true };
}

async function updateOccurrenceChecklist(occurrenceId, checklist, tenantId = null) {
  const sql = 'UPDATE task_occurrences SET checklist = ? WHERE id = ?' + (tenantId ? ' AND tenant_id = ?' : '');
  const params = tenantId ? [JSON.stringify(checklist), occurrenceId, tenantId] : [JSON.stringify(checklist), occurrenceId];
  await query(sql, params);
  return getOccurrenceById(occurrenceId);
}

async function markOccurrenceCompleted(occurrenceId, completedBy = null, tenantId = null, { remarks, latitude, longitude, locationName } = {}) {
  try {
    const updates = ['status = ?', 'completed_at = NOW()'];
    const params = ['Completed'];
    if (remarks !== undefined) { updates.push('remarks = ?'); params.push(remarks); }
    if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
    if (locationName !== undefined) { updates.push('location_name = ?'); params.push(locationName); }

    let sql = `UPDATE task_occurrences SET ${updates.join(', ')} WHERE id = ?`;
    params.push(occurrenceId);
    if (tenantId) { sql += ' AND tenant_id = ?'; params.push(tenantId); }

    const update = await query(sql, params);

    try {
      const occurrence = await getOccurrenceById(occurrenceId);
      if (occurrence) {
        const taskRows = await query('SELECT title, public_id FROM tasks WHERE id = ? LIMIT 1', [occurrence.task_id]);
        const task = taskRows && taskRows[0] ? taskRows[0] : {};
        await NotificationService.createAndSendToRoles(
          ['Manager', 'Admin'],
          'Occurrence Completed',
          `"${task.title || 'Task'}" occurrence for ${occurrence.occurrence_date} was completed.`,
          'OCCURRENCE_COMPLETED',
          'task',
          task.public_id || String(occurrence.task_id),
          tenantId
        );
      }
    } catch (notifyError) {
      logger.warn('markOccurrenceCompleted notification error: ' + (notifyError && notifyError.message ? notifyError.message : notifyError));
    }

    return update;
  } catch (error) {
    logger.error('markOccurrenceCompleted error:', error && error.message ? error.message : error);
    throw error;
  }
}

async function attachPhotoToOccurrence(occurrenceId, storedPath, fileName, fileType, fileSize, userId, tenantId = null) {
  return attachPhotosToOccurrence(occurrenceId, [{ storedPath, fileName, fileType, fileSize }], userId, tenantId);
}

/**
 * Attaches one or more photos to an occurrence. Mirrors the loop-and-insert multi-file pattern
 * used in ClientsApi.js's upload.array handler, but inserting into the shared `files` table
 * tagged with occurrence_id (rather than a dedicated photos table).
 */
async function attachPhotosToOccurrence(occurrenceId, photos, userId, tenantId = null) {
  try {
    const occRows = await query('SELECT task_id FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
    const taskId = (occRows && occRows[0] && occRows[0].task_id) ? occRows[0].task_id : null;

    const inserted = [];
    for (const photo of photos) {
      const insertSql = `INSERT INTO files (file_url, file_name, file_type, file_size, task_id, user_id, uploaded_at, isActive, tenant_id, occurrence_id)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), 1, ?, ?)`;
      const result = await query(insertSql, [
        photo.storedPath, photo.fileName, photo.fileType, photo.fileSize, taskId, userId, tenantId, occurrenceId,
      ]);
      inserted.push({
        id: result.insertId,
        file_url: photo.storedPath,
        file_name: photo.fileName,
        file_type: photo.fileType,
        file_size: photo.fileSize,
      });
    }

    // Keep photo_path pointing at the most recent photo for backward-compatible single-photo consumers.
    if (photos.length > 0) {
      await query('UPDATE task_occurrences SET photo_path = ? WHERE id = ?', [photos[photos.length - 1].storedPath, occurrenceId]);
    }

    return { occurrence: await getOccurrenceById(occurrenceId), photos: inserted };
  } catch (error) {
    logger.error('attachPhotosToOccurrence error:', error && error.message ? error.message : error);
    throw error;
  }
}

async function getOccurrenceDetail(occurrenceId, tenantId = null) {
  const occurrence = await getOccurrenceById(occurrenceId);
  if (!occurrence) return null;

  const taskRows = await query(
    'SELECT id, public_id, title, category, recurrence FROM tasks WHERE id = ? LIMIT 1',
    [occurrence.task_id]
  );
  const task = taskRows && taskRows[0] ? taskRows[0] : null;

  const assignees = await query(
    `SELECT u.public_id, u.name, u.email FROM task_assignments ta
     JOIN users u ON u._id = ta.user_id
     WHERE ta.task_id = ?`,
    [occurrence.task_id]
  );

  const photos = await query(
    `SELECT id, file_url, file_name, file_type, file_size, uploaded_at FROM files
     WHERE occurrence_id = ? AND isActive = 1 ORDER BY uploaded_at DESC`,
    [occurrenceId]
  );

  const checklist = occurrence.checklist
    ? (typeof occurrence.checklist === 'string' ? JSON.parse(occurrence.checklist) : occurrence.checklist)
    : null;

  return {
    ...occurrence,
    checklist,
    task: task ? { id: task.public_id || String(task.id), title: task.title, category: task.category, recurrence: task.recurrence } : null,
    assignees: assignees || [],
    photos: photos || [],
  };
}

module.exports = {
  createOccurrence,
  getOccurrencesForTask,
  getOccurrenceById,
  getOccurrenceDetail,
  markOccurrenceCompleted,
  attachPhotoToOccurrence,
  attachPhotosToOccurrence,
  updateOccurrenceChecklist,
  validateOccurrenceCompletion,
  resolveTaskInternalId,
};
