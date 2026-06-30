const db = require(__root + 'db');
const dayjs = require('dayjs');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

const NotificationService = require(__root + 'services/notificationService');

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

const columnCache = new Map();

async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  const rows = await query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  const exists = Array.isArray(rows) && rows.length > 0;
  columnCache.set(key, exists);
  return exists;
}

async function getTaskOccurrenceColumns() {
  const columnNames = [
    'tenant_id',
    'created_by',
    'checklist',
    'completed_at',
    'remarks',
    'latitude',
    'longitude',
    'location_name',
    'photo_path'
  ];
  const entries = await Promise.all(
    columnNames.map(async (column) => [column, await hasColumn('task_occurrences', column)])
  );
  return Object.fromEntries(entries);
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
    const occurrenceColumns = await getTaskOccurrenceColumns();
    const columns = ['task_id', 'occurrence_date', 'status'];
    const values = [taskId, dateStr, 'Pending'];

    if (occurrenceColumns.tenant_id) {
      columns.push('tenant_id');
      values.push(tenantId);
    }
    if (occurrenceColumns.created_by) {
      columns.push('created_by');
      values.push(createdBy);
    }
    if (occurrenceColumns.checklist) {
      columns.push('checklist');
      values.push(checklist ? JSON.stringify(checklist) : null);
    }

    const insert = await query(
      `INSERT IGNORE INTO task_occurrences (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      values
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
    `SELECT
       ${await hasColumn('tasks', 'mandatory_photo') ? 'mandatory_photo' : '0 AS mandatory_photo'},
       ${await hasColumn('tasks', 'mandatory_checklist') ? 'mandatory_checklist' : '0 AS mandatory_checklist'},
       ${await hasColumn('tasks', 'mandatory_remarks') ? 'mandatory_remarks' : '0 AS mandatory_remarks'}
     FROM tasks WHERE id = ? LIMIT 1`,
    [occurrence.task_id]
  );
  const task = taskRows && taskRows[0] ? taskRows[0] : {};

  if (task.mandatory_photo) {
    if (!await hasColumn('files', 'occurrence_id')) {
      return { eligible: false, error: 'Photo upload storage is not ready. Please run database bootstrap/migrations.' };
    }
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
  if (!await hasColumn('task_occurrences', 'checklist')) {
    return getOccurrenceById(occurrenceId);
  }
  const hasTenantId = await hasColumn('task_occurrences', 'tenant_id');
  const sql = 'UPDATE task_occurrences SET checklist = ? WHERE id = ?' + (tenantId && hasTenantId ? ' AND tenant_id = ?' : '');
  const params = tenantId && hasTenantId ? [JSON.stringify(checklist), occurrenceId, tenantId] : [JSON.stringify(checklist), occurrenceId];
  await query(sql, params);
  return getOccurrenceById(occurrenceId);
}

async function markOccurrenceCompleted(occurrenceId, completedBy = null, tenantId = null, { remarks, latitude, longitude, locationName } = {}) {
  try {
    const occurrenceColumns = await getTaskOccurrenceColumns();
    const updates = ['status = ?'];
    const params = ['Completed'];
    if (occurrenceColumns.completed_at) updates.push('completed_at = NOW()');
    if (remarks !== undefined && occurrenceColumns.remarks) { updates.push('remarks = ?'); params.push(remarks); }
    if (latitude !== undefined && occurrenceColumns.latitude) { updates.push('latitude = ?'); params.push(latitude); }
    if (longitude !== undefined && occurrenceColumns.longitude) { updates.push('longitude = ?'); params.push(longitude); }
    if (locationName !== undefined && occurrenceColumns.location_name) { updates.push('location_name = ?'); params.push(locationName); }

    let sql = `UPDATE task_occurrences SET ${updates.join(', ')} WHERE id = ?`;
    params.push(occurrenceId);
    if (tenantId && occurrenceColumns.tenant_id) { sql += ' AND tenant_id = ?'; params.push(tenantId); }

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
    const filesHasOccurrenceId = await hasColumn('files', 'occurrence_id');
    const occRows = await query('SELECT task_id FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
    const taskId = (occRows && occRows[0] && occRows[0].task_id) ? occRows[0].task_id : null;

    const inserted = [];
    for (const photo of photos) {
      const fileColumns = ['file_url', 'file_name', 'file_type', 'file_size', 'task_id', 'user_id', 'uploaded_at', 'isActive', 'tenant_id'];
      const fileValues = [photo.storedPath, photo.fileName, photo.fileType, photo.fileSize, taskId, userId, new Date(), 1, tenantId];
      if (filesHasOccurrenceId) {
        fileColumns.push('occurrence_id');
        fileValues.push(occurrenceId);
      }
      const insertSql = `INSERT INTO files (${fileColumns.join(', ')}) VALUES (${fileColumns.map(() => '?').join(', ')})`;
      const result = await query(insertSql, fileValues);
      inserted.push({
        id: result.insertId,
        file_url: photo.storedPath,
        file_name: photo.fileName,
        file_type: photo.fileType,
        file_size: photo.fileSize,
      });
    }

    // Keep photo_path pointing at the most recent photo for backward-compatible single-photo consumers.
    if (photos.length > 0 && await hasColumn('task_occurrences', 'photo_path')) {
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

  const photos = await hasColumn('files', 'occurrence_id')
    ? await query(
      `SELECT id, file_url, file_name, file_type, file_size, uploaded_at FROM files
       WHERE occurrence_id = ? AND isActive = 1 ORDER BY uploaded_at DESC`,
      [occurrenceId]
    )
    : [];

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
