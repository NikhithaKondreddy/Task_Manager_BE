const db = require(__root + 'db');
const dayjs = require('dayjs');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

const NotificationService = require(__root + 'services/notificationService');

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

async function createOccurrence({ taskId, occurrenceDate, tenantId = null, createdBy = null }) {
  const dateStr = dayjs(occurrenceDate).format('YYYY-MM-DD');
  try {
    const insert = await query(
      'INSERT IGNORE INTO task_occurrences (task_id, occurrence_date, status, tenant_id, created_by) VALUES (?, ?, ?, ?, ?)',
      [taskId, dateStr, 'Pending', tenantId, createdBy]
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

async function markOccurrenceCompleted(occurrenceId, completedBy = null, tenantId = null) {
  try {
    const update = await query('UPDATE task_occurrences SET status = ?, completed_at = NOW() WHERE id = ?' + (tenantId ? ' AND tenant_id = ?' : ''), tenantId ? ['Completed', occurrenceId, tenantId] : ['Completed', occurrenceId]);
    return update;
  } catch (error) {
    logger.error('markOccurrenceCompleted error:', error && error.message ? error.message : error);
    throw error;
  }
}

async function attachPhotoToOccurrence(occurrenceId, storedPath, fileName, fileType, fileSize, userId, tenantId = null) {
  try {
    // Update occurrence row
    await query('UPDATE task_occurrences SET photo_path = ? WHERE id = ?' + (tenantId ? ' AND tenant_id = ?' : ''), tenantId ? [storedPath, occurrenceId, tenantId] : [storedPath, occurrenceId]);

    // Insert into files table for consistency with existing uploads
    const insertSql = `INSERT INTO files (file_url, file_name, file_type, file_size, task_id, user_id, uploaded_at, isActive, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?, NOW(), 1, ?)`;
    // Need task_id to insert into files; fetch occurrence
    const occRows = await query('SELECT task_id FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
    const taskId = (occRows && occRows[0] && occRows[0].task_id) ? occRows[0].task_id : null;
    await query(insertSql, [storedPath, fileName, fileType, fileSize, taskId, userId, tenantId]);

    // return updated occurrence
    const out = await query('SELECT * FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
    return out && out.length ? out[0] : null;
  } catch (error) {
    logger.error('attachPhotoToOccurrence error:', error && error.message ? error.message : error);
    throw error;
  }
}

module.exports = {
  createOccurrence,
  getOccurrencesForTask,
  markOccurrenceCompleted,
  attachPhotoToOccurrence
};
