const { success } = require('../../../utils/response');
const gembaExecutionService = require('../services/gembaExecutionService');

const occurrenceId = (req) => req.body.occurrenceId || req.query.occurrenceId || null;

async function detail(req, res) {
  const result = await gembaExecutionService.detail({ walkPublicId: req.params.walkId, req, occurrenceId: occurrenceId(req) });
  return success(res, result);
}

async function start(req, res) {
  const result = await gembaExecutionService.transition({ walkPublicId: req.params.walkId, req, action: 'start', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Gemba Walk started');
}

async function pause(req, res) {
  const result = await gembaExecutionService.transition({ walkPublicId: req.params.walkId, req, action: 'pause', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Gemba Walk paused');
}

async function resume(req, res) {
  const result = await gembaExecutionService.transition({ walkPublicId: req.params.walkId, req, action: 'resume', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Gemba Walk resumed');
}

async function saveDraft(req, res) {
  const result = await gembaExecutionService.transition({ walkPublicId: req.params.walkId, req, action: 'draft', occurrenceId: occurrenceId(req) });
  return success(res, result, 'Draft saved');
}

async function checklist(req, res) {
  const result = await gembaExecutionService.updateChecklist({
    walkPublicId: req.params.walkId,
    req,
    itemId: req.params.itemId,
    isCompleted: !!req.body.isCompleted,
    remarks: req.body.remarks,
    occurrenceId: occurrenceId(req)
  });
  return success(res, result, 'Checklist updated');
}

async function uploadPhotos(req, res) {
  const result = await gembaExecutionService.uploadPhotos({
    walkPublicId: req.params.walkId,
    req,
    files: req.files,
    checkpointId: req.body.checkpointId,
    occurrenceId: occurrenceId(req)
  });
  return success(res, result, 'Photos uploaded');
}

async function saveRemarks(req, res) {
  const result = await gembaExecutionService.saveRemarks({ walkPublicId: req.params.walkId, req, remarks: req.body.remarks, occurrenceId: occurrenceId(req) });
  return success(res, result, 'Remarks saved');
}

async function complete(req, res) {
  const result = await gembaExecutionService.complete({
    walkPublicId: req.params.walkId,
    req,
    remarks: req.body.remarks,
    files: req.files,
    occurrenceId: occurrenceId(req)
  });
  return success(res, result, 'Gemba Walk submitted for approval');
}

module.exports = { detail, start, pause, resume, saveDraft, checklist, uploadPhotos, saveRemarks, complete };
