const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const photoRepo = require('../repos/photoRepo');
const photoService = require('../services/photoService');
const taskRepo = require('../repos/taskRepo');
const { logTaskEvent } = require('../services/audit');

async function listMine(req, res) {
  const { parsePagination } = require('../utils/db');
  const { limit, offset } = parsePagination(req.query);
  const photos = await photoRepo.listForUser(req.user._id, req.user.tenant_id, { limit, offset });
  return success(res, photos);
}

async function upload(req, res) {
  if (!req.body.taskId) throw new HttpError(400, 'taskId is required', 'VALIDATION_ERROR');
  const task = await taskRepo.findByPublicId(req.body.taskId, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  if (!req.files || !req.files.length) throw new HttpError(400, 'At least one photo file is required', 'VALIDATION_ERROR');

  const saved = await photoService.savePhotos({
    files: req.files,
    taskId: task.id,
    uploadedBy: req.user._id,
    tenantId: req.user.tenant_id,
    caption: req.body.caption || null
  });

  await logTaskEvent(req, { action: 'PHOTO_UPLOADED', entity: 'Task', entityId: task.id, details: { count: saved.length } });
  return success(res, saved, 'Photo(s) uploaded', 201);
}

async function remove(req, res) {
  const photo = await photoRepo.remove(req.params.id, req.user.tenant_id);
  if (!photo) throw new HttpError(404, 'Photo not found', 'NOT_FOUND');
  await logTaskEvent(req, { action: 'PHOTO_DELETED', entity: 'Task', entityId: photo.task_id || photo.occurrence_id });
  return success(res, null, 'Photo deleted');
}

module.exports = { listMine, upload, remove };
