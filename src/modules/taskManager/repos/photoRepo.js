const storageService = require('../../../services/storageService');
const { q } = require('../utils/db');

async function listForTask(taskId) {
  return q(`SELECT * FROM tm_task_photos WHERE task_id = ? ORDER BY created_at DESC`, [taskId]);
}

async function listForOccurrence(occurrenceId) {
  return q(`SELECT * FROM tm_task_photos WHERE occurrence_id = ? ORDER BY created_at DESC`, [occurrenceId]);
}

async function listForUser(userId, tenantId, { limit = 20, offset = 0 } = {}) {
  return q(
    `SELECT ph.*, t.title AS task_title, t.public_id AS task_public_id FROM tm_task_photos ph
     LEFT JOIN tm_tasks t ON t.id = ph.task_id
     WHERE ph.uploaded_by = ? AND ph.tenant_id = ?
     ORDER BY ph.created_at DESC LIMIT ? OFFSET ?`,
    [userId, tenantId, limit, offset]
  );
}

async function findById(id, tenantId) {
  const rows = await q(`SELECT * FROM tm_task_photos WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return rows[0] || null;
}

async function remove(id, tenantId) {
  const photo = await findById(id, tenantId);
  if (!photo) return null;
  await storageService.deleteFile(photo.storage_path).catch(() => {});
  await q(`DELETE FROM tm_task_photos WHERE id = ?`, [id]);
  return photo;
}

module.exports = { listForTask, listForOccurrence, listForUser, findById, remove };
