const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const taskRepo = require('../repos/taskRepo');
const recurrenceRepo = require('../repos/recurrenceRepo');
const occurrenceRepo = require('../repos/occurrenceRepo');
const gembaRepo = require('../repos/gembaRepo');
const recurrenceEngine = require('../services/recurrenceEngine');
const notify = require('../services/notify');
const { logTaskEvent } = require('../services/audit');
const { getAssigneeScope } = require('../services/scopeService');

function normalizeDaysOfWeek(daysOfWeek) {
  return Array.isArray(daysOfWeek) ? daysOfWeek.join(',') : daysOfWeek;
}

async function list(req, res) {
  const scope = await getAssigneeScope(req);
  const result = await taskRepo.list(
    req.user.tenant_id,
    req.query,
    scope ? { taskTypes: ['GEMBA_WALK'], assignedToUserIds: scope } : { taskTypes: ['GEMBA_WALK'] }
  );
  return success(res, result);
}

async function getOne(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'GEMBA_WALK') throw new HttpError(404, 'Gemba walk not found', 'NOT_FOUND');
  const recurrence = await recurrenceRepo.findByTaskId(task.id);
  const details = await gembaRepo.findByTaskId(task.id);
  const checklist = await gembaRepo.listForTask(task.id);
  const occurrenceSummary = await occurrenceRepo.listForTask(task.id, { limit: 10 });
  return success(res, { ...task, recurrence, details, checklist, occurrenceSummary });
}

async function create(req, res) {
  const {
    title, description, assignedTo, priority, allowPhoto, photoRequired, multiplePhotos,
    reminderEnabled, reminderTime, frequency, repeatEvery, daysOfWeek, dayOfMonth, startDate, endDate,
    department, area, location, checklist
  } = req.body;

  if (!title) throw new HttpError(400, 'title is required', 'VALIDATION_ERROR');
  if (!assignedTo) throw new HttpError(400, 'assignedTo is required', 'VALIDATION_ERROR');
  if (!frequency || frequency === 'None') throw new HttpError(400, 'frequency must be Daily, Weekly, or Monthly', 'VALIDATION_ERROR');
  if (!startDate) throw new HttpError(400, 'startDate is required', 'VALIDATION_ERROR');

  const task = await taskRepo.create({
    tenantId: req.user.tenant_id, taskType: 'GEMBA_WALK', title, description,
    assignedTo, assignedBy: req.user._id, priority, startDate, dueDate: null,
    allowPhoto: allowPhoto !== undefined ? allowPhoto : true,
    photoRequired: photoRequired !== undefined ? photoRequired : true,
    multiplePhotos, reminderEnabled, reminderTime, createdBy: req.user._id
  });

  const recurrence = await recurrenceRepo.create(task.id, req.user.tenant_id, {
    frequency, repeatEvery, daysOfWeek: normalizeDaysOfWeek(daysOfWeek), dayOfMonth, startDate, endDate
  });

  const details = await gembaRepo.createDetails(task.id, req.user.tenant_id, { department, area, location });
  if (Array.isArray(checklist) && checklist.length) {
    await gembaRepo.addChecklistItems(task.id, req.user.tenant_id, checklist);
  }

  await recurrenceEngine.generateInitialOccurrences(recurrence.id, 5);
  await notify.notifyTaskAssigned(assignedTo, title, task.public_id, req.user.tenant_id);
  await logTaskEvent(req, { action: 'GEMBA_WALK_CREATED', entity: 'Task', entityId: task.id, details: { department, area, location } });

  return success(res, { ...task, recurrence, details }, 'Gemba walk created', 201);
}

async function update(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'GEMBA_WALK') throw new HttpError(404, 'Gemba walk not found', 'NOT_FOUND');

  const taskFields = {};
  ['title', 'description', 'priority'].forEach((k) => { if (req.body[k] !== undefined) taskFields[k] = req.body[k]; });
  if (req.body.assignedTo !== undefined) taskFields.assigned_to = req.body.assignedTo;
  if (Object.keys(taskFields).length) await taskRepo.update(task.id, req.user.tenant_id, taskFields);

  const { q } = require('../utils/db');
  const detailFields = {};
  ['department', 'area', 'location'].forEach((k) => { if (req.body[k] !== undefined) detailFields[k] = req.body[k]; });
  if (Object.keys(detailFields).length) {
    const sets = Object.keys(detailFields).map((k) => `${k} = ?`).join(', ');
    await q(`UPDATE tm_gemba_details SET ${sets} WHERE task_id = ?`, [...Object.values(detailFields), task.id]);
  }

  await logTaskEvent(req, { action: 'GEMBA_WALK_UPDATED', entity: 'Task', entityId: task.id, details: { ...taskFields, ...detailFields } });
  const updated = await taskRepo.findById(task.id, req.user.tenant_id);
  const details = await gembaRepo.findByTaskId(task.id);
  return success(res, { ...updated, details }, 'Gemba walk updated');
}

async function remove(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'GEMBA_WALK') throw new HttpError(404, 'Gemba walk not found', 'NOT_FOUND');
  await taskRepo.softDelete(task.id, req.user.tenant_id, req.user._id);
  await logTaskEvent(req, { action: 'GEMBA_WALK_DELETED', entity: 'Task', entityId: task.id });
  return success(res, null, 'Gemba walk deleted');
}

async function listOccurrences(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'GEMBA_WALK') throw new HttpError(404, 'Gemba walk not found', 'NOT_FOUND');
  const result = await occurrenceRepo.listForTask(task.id, req.query);
  return success(res, result);
}

module.exports = { list, getOne, create, update, remove, listOccurrences };
