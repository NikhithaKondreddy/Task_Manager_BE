const storageService = require('../../../services/storageService');
const { q } = require('../utils/db');

/**
 * Persists uploaded files (req.files from multer memory storage) for a
 * task or occurrence, both via storageService and a tm_task_photos row.
 */
async function savePhotos({ files, taskId = null, occurrenceId = null, uploadedBy, tenantId, caption = null }) {
  if (!Array.isArray(files) || files.length === 0) return [];

  const saved = [];
  for (const file of files) {
    const keyPrefix = taskId ? `task-manager/tasks/${taskId}` : `task-manager/occurrences/${occurrenceId}`;
    const key = `${keyPrefix}/${Date.now()}_${(file.originalname || 'photo').replace(/[^a-zA-Z0-9._()-]/g, '_')}`;
    const result = await storageService.upload(file, key);

    const insert = await q(
      `INSERT INTO tm_task_photos
        (task_id, occurrence_id, tenant_id, uploaded_by, storage_path, storage_provider, file_name, file_size, mime_type, caption)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        occurrenceId,
        tenantId,
        uploadedBy,
        result.storagePath,
        result.provider,
        file.originalname || null,
        file.size || null,
        file.mimetype || null,
        caption
      ]
    );
    saved.push({ id: insert.insertId, storagePath: result.storagePath, provider: result.provider });
  }
  return saved;
}

async function hasExistingPhoto(taskId, occurrenceId) {
  const rows = await q(
    `SELECT id FROM tm_task_photos WHERE ${taskId ? 'task_id = ?' : 'occurrence_id = ?'} LIMIT 1`,
    [taskId || occurrenceId]
  );
  return rows.length > 0;
}

module.exports = { savePhotos, hasExistingPhoto };
