const { success } = require('../../../utils/response');
const taskExecutionService = require('../services/taskExecutionService');

const occurrenceId = (req) => req.body.occurrenceId || req.query.occurrenceId || null;

async function detail(req, res) {
  const result = await taskExecutionService.detail({ taskPublicId: req.params.taskId, req, occurrenceId: occurrenceId(req) });
  return success(res, result);
}

async function start(req, res) {
  const result = await taskExecutionService.transition({ taskPublicId: req.params.taskId, req, action: 'start', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Task execution started');
}

async function pause(req, res) {
  const result = await taskExecutionService.transition({ taskPublicId: req.params.taskId, req, action: 'pause', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Task execution paused');
}

async function resume(req, res) {
  const result = await taskExecutionService.transition({ taskPublicId: req.params.taskId, req, action: 'resume', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Task execution resumed');
}

async function saveDraft(req, res) {
  const result = await taskExecutionService.transition({ taskPublicId: req.params.taskId, req, action: 'draft', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Draft saved');
}

async function uploadPhoto(req, res) {
  const result = await taskExecutionService.uploadPhotos({ taskPublicId: req.params.taskId, req, files: req.files, occurrenceId: occurrenceId(req) });
  return success(res, result, 'Photo uploaded');
}

async function saveRemarks(req, res) {
  const result = await taskExecutionService.saveRemarks({ taskPublicId: req.params.taskId, req, remarks: req.body.remarks, occurrenceId: occurrenceId(req) });
  return success(res, result, 'Remarks saved');
}

async function complete(req, res) {
  const result = await taskExecutionService.complete({
    taskPublicId: req.params.taskId,
    req,
    remarks: req.body.remarks,
    files: req.files,
    occurrenceId: occurrenceId(req)
  });
  return success(res, result, 'Task submitted for approval');
}

module.exports = { detail, start, pause, resume, saveDraft, uploadPhoto, saveRemarks, complete };
