const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const { normalizeRole } = require('../../../config/rbac');
const taskRepo = require('../repos/taskRepo');
const projectRepo = require('../repos/projectRepo');
const photoRepo = require('../repos/photoRepo');
const commentRepo = require('../repos/commentRepo');
const auditRepo = require('../repos/auditRepo');
const completionService = require('../services/completionService');
const notify = require('../services/notify');
const { logTaskEvent } = require('../services/audit');
const { getAssigneeScope } = require('../services/scopeService');

function assertOwnedByEmployeeIfApplicable(req, task) {
  if (normalizeRole(req.user.role) === 'EMPLOYEE' && task.assigned_to !== req.user._id) {
    throw new HttpError(403, 'You can only modify tasks assigned to you', 'AUTH_FORBIDDEN');
  }
}

async function list(req, res) {
  const scope = await getAssigneeScope(req);
  const result = await taskRepo.list(req.user.tenant_id, req.query, scope ? { assignedToUserIds: scope } : {});
  return success(res, result);
}

async function getOne(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  assertOwnedByEmployeeIfApplicable(req, task);
  const photos = await photoRepo.listForTask(task.id);
  return success(res, { ...task, photos });
}

async function create(req, res) {
  const { title, description, projectId, assignedTo, priority, startDate, dueDate,
    allowPhoto, photoRequired, multiplePhotos, reminderEnabled, reminderTime } = req.body;

  if (!title) throw new HttpError(400, 'title is required', 'VALIDATION_ERROR');
  if (!assignedTo) throw new HttpError(400, 'assignedTo is required', 'VALIDATION_ERROR');

  let resolvedProjectId = null;
  let taskType = 'INDIVIDUAL';
  if (projectId) {
    const project = await projectRepo.findByPublicId(projectId, req.user.tenant_id);
    if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');
    resolvedProjectId = project.id;
    taskType = 'PROJECT';
  }

  const task = await taskRepo.create({
    tenantId: req.user.tenant_id,
    taskType,
    title,
    description,
    projectId: resolvedProjectId,
    assignedTo,
    assignedBy: req.user._id,
    priority,
    startDate,
    dueDate,
    allowPhoto,
    photoRequired,
    multiplePhotos,
    reminderEnabled,
    reminderTime,
    createdBy: req.user._id
  });

  await notify.notifyTaskAssigned(assignedTo, task.title, task.public_id, req.user.tenant_id);
  await logTaskEvent(req, { action: 'TASK_CREATED', entity: 'Task', entityId: task.id, details: { title, taskType } });

  return success(res, task, 'Task created', 201);
}

async function update(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');

  const fields = {};
  ['title', 'description', 'priority', 'status'].forEach((k) => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  if (req.body.startDate !== undefined) fields.start_date = req.body.startDate;
  if (req.body.dueDate !== undefined) fields.due_date = req.body.dueDate;
  if (req.body.assignedTo !== undefined) fields.assigned_to = req.body.assignedTo;
  if (req.body.allowPhoto !== undefined) fields.allow_photo = req.body.allowPhoto ? 1 : 0;
  if (req.body.photoRequired !== undefined) fields.photo_required = req.body.photoRequired ? 1 : 0;
  if (req.body.multiplePhotos !== undefined) fields.multiple_photos = req.body.multiplePhotos ? 1 : 0;
  if (req.body.reminderEnabled !== undefined) fields.reminder_enabled = req.body.reminderEnabled ? 1 : 0;
  if (req.body.reminderTime !== undefined) fields.reminder_time = req.body.reminderTime;
  if (req.body.isStarred !== undefined) fields.is_starred = req.body.isStarred ? 1 : 0;

  const updated = await taskRepo.update(task.id, req.user.tenant_id, fields);

  if (fields.assigned_to && fields.assigned_to !== task.assigned_to) {
    await notify.notifyTaskAssigned(fields.assigned_to, updated.title, updated.public_id, req.user.tenant_id);
  }

  await logTaskEvent(req, { action: 'TASK_UPDATED', entity: 'Task', entityId: task.id, details: fields });
  return success(res, updated, 'Task updated');
}

async function remove(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  await taskRepo.softDelete(task.id, req.user.tenant_id, req.user._id);
  await logTaskEvent(req, { action: 'TASK_DELETED', entity: 'Task', entityId: task.id });
  return success(res, null, 'Task deleted');
}

async function start(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  assertOwnedByEmployeeIfApplicable(req, task);
  if (task.status !== 'Pending') throw new HttpError(409, 'Only pending tasks can be started', 'INVALID_STATE');
  const updated = await taskRepo.update(task.id, req.user.tenant_id, { status: 'In Progress' });
  await logTaskEvent(req, { action: 'TASK_STARTED', entity: 'Task', entityId: task.id });
  return success(res, updated, 'Task started');
}

async function complete(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  const result = await completionService.completeEntity({
    req, kind: 'task', id: task.id, remarks: req.body.remarks, files: req.files
  });
  return success(res, result, 'Task submitted for approval');
}

async function history(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  const result = await auditRepo.list(req.user.tenant_id, { entity: 'Task', entityId: task.id, ...req.query });
  return success(res, result);
}

async function addComment(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  if (!req.body.comment) throw new HttpError(400, 'comment is required', 'VALIDATION_ERROR');
  const comment = await commentRepo.add(task.id, req.user._id, req.user.tenant_id, req.body.comment);
  return success(res, comment, 'Comment added', 201);
}

async function listComments(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task) throw new HttpError(404, 'Task not found', 'NOT_FOUND');
  const comments = await commentRepo.listForTask(task.id);
  return success(res, comments);
}

module.exports = { list, getOne, create, update, remove, start, complete, history, addComment, listComments };
