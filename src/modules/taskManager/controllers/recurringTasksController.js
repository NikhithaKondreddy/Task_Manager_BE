const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const taskRepo = require('../repos/taskRepo');
const recurrenceRepo = require('../repos/recurrenceRepo');
const occurrenceRepo = require('../repos/occurrenceRepo');
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
    scope ? { taskTypes: ['RECURRING'], assignedToUserIds: scope } : { taskTypes: ['RECURRING'] }
  );
  return success(res, result);
}

async function getOne(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'RECURRING') throw new HttpError(404, 'Recurring task not found', 'NOT_FOUND');
  const recurrence = await recurrenceRepo.findByTaskId(task.id);
  const occurrenceSummary = await occurrenceRepo.listForTask(task.id, { limit: 10 });
  return success(res, { ...task, recurrence, occurrenceSummary });
}

async function create(req, res) {
  const {
    title, description, assignedTo, priority, allowPhoto, photoRequired, multiplePhotos,
    reminderEnabled, reminderTime, frequency, repeatEvery, daysOfWeek, dayOfMonth, startDate, endDate
  } = req.body;

  if (!title) throw new HttpError(400, 'title is required', 'VALIDATION_ERROR');
  if (!assignedTo) throw new HttpError(400, 'assignedTo is required', 'VALIDATION_ERROR');
  if (!frequency || frequency === 'None') throw new HttpError(400, 'frequency must be Daily, Weekly, or Monthly', 'VALIDATION_ERROR');
  if (!startDate) throw new HttpError(400, 'startDate is required', 'VALIDATION_ERROR');

  const task = await taskRepo.create({
    tenantId: req.user.tenant_id, taskType: 'RECURRING', title, description,
    assignedTo, assignedBy: req.user._id, priority, startDate, dueDate: null,
    allowPhoto, photoRequired, multiplePhotos, reminderEnabled, reminderTime, createdBy: req.user._id
  });

  const recurrence = await recurrenceRepo.create(task.id, req.user.tenant_id, {
    frequency, repeatEvery, daysOfWeek: normalizeDaysOfWeek(daysOfWeek), dayOfMonth, startDate, endDate
  });

  await recurrenceEngine.generateInitialOccurrences(recurrence.id, 5);
  await notify.notifyTaskAssigned(assignedTo, title, task.public_id, req.user.tenant_id);
  await logTaskEvent(req, { action: 'RECURRING_TASK_CREATED', entity: 'Task', entityId: task.id, details: { frequency } });

  return success(res, { ...task, recurrence }, 'Recurring task created', 201);
}

async function update(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'RECURRING') throw new HttpError(404, 'Recurring task not found', 'NOT_FOUND');

  const taskFields = {};
  ['title', 'description', 'priority'].forEach((k) => { if (req.body[k] !== undefined) taskFields[k] = req.body[k]; });
  if (req.body.assignedTo !== undefined) taskFields.assigned_to = req.body.assignedTo;
  if (Object.keys(taskFields).length) await taskRepo.update(task.id, req.user.tenant_id, taskFields);

  const recurrenceFields = {};
  if (req.body.frequency !== undefined) recurrenceFields.frequency = req.body.frequency;
  if (req.body.repeatEvery !== undefined) recurrenceFields.repeat_every = req.body.repeatEvery;
  if (req.body.daysOfWeek !== undefined) recurrenceFields.days_of_week = normalizeDaysOfWeek(req.body.daysOfWeek);
  if (req.body.dayOfMonth !== undefined) recurrenceFields.day_of_month = req.body.dayOfMonth;
  if (req.body.endDate !== undefined) recurrenceFields.end_date = req.body.endDate;
  if (Object.keys(recurrenceFields).length) {
    const recurrence = await recurrenceRepo.findByTaskId(task.id);
    if (recurrence) await recurrenceRepo.update(recurrence.id, recurrenceFields);
  }

  await logTaskEvent(req, {
    action: 'RECURRING_TASK_UPDATED', entity: 'Task', entityId: task.id,
    details: { ...taskFields, ...recurrenceFields }
  });
  const updated = await taskRepo.findById(task.id, req.user.tenant_id);
  return success(res, updated, 'Recurring task updated');
}

async function remove(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'RECURRING') throw new HttpError(404, 'Recurring task not found', 'NOT_FOUND');
  await taskRepo.softDelete(task.id, req.user.tenant_id, req.user._id);
  await logTaskEvent(req, { action: 'RECURRING_TASK_DELETED', entity: 'Task', entityId: task.id });
  return success(res, null, 'Recurring task deleted');
}

async function listOccurrences(req, res) {
  const task = await taskRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!task || task.task_type !== 'RECURRING') throw new HttpError(404, 'Recurring task not found', 'NOT_FOUND');
  const result = await occurrenceRepo.listForTask(task.id, req.query);
  return success(res, result);
}

module.exports = { list, getOne, create, update, remove, listOccurrences };
