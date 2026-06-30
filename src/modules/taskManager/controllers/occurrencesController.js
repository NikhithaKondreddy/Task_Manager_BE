const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const { normalizeRole } = require('../../../config/rbac');
const occurrenceRepo = require('../repos/occurrenceRepo');
const photoRepo = require('../repos/photoRepo');
const gembaRepo = require('../repos/gembaRepo');
const completionService = require('../services/completionService');
const timerService = require('../services/timerService');
const { logTaskEvent } = require('../services/audit');

function assertOwnedByEmployeeIfApplicable(req, occurrence) {
  if (normalizeRole(req.user.role) === 'EMPLOYEE' && occurrence.assigned_to !== req.user._id) {
    throw new HttpError(403, 'You can only access occurrences assigned to you', 'AUTH_FORBIDDEN');
  }
}

async function getOne(req, res) {
  const occurrence = await occurrenceRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!occurrence) throw new HttpError(404, 'Occurrence not found', 'NOT_FOUND');
  assertOwnedByEmployeeIfApplicable(req, occurrence);
  const photos = await photoRepo.listForOccurrence(occurrence.id);
  const checklist = await gembaRepo.listForOccurrence(occurrence.id);
  return success(res, { ...occurrence, elapsed_seconds: timerService.elapsedSeconds(occurrence), photos, checklist });
}

async function complete(req, res) {
  const occurrence = await occurrenceRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!occurrence) throw new HttpError(404, 'Occurrence not found', 'NOT_FOUND');
  const result = await completionService.completeEntity({
    req, kind: 'occurrence', id: occurrence.id, remarks: req.body.remarks, files: req.files
  });
  return success(res, result, 'Occurrence submitted for approval');
}

async function timerAction(req, res) {
  const occurrence = await occurrenceRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!occurrence) throw new HttpError(404, 'Occurrence not found', 'NOT_FOUND');
  const result = await timerService.transition({
    req,
    kind: 'occurrence',
    id: occurrence.id,
    action: req.params.action
  });
  return success(res, result, `Timer ${req.params.action.toLowerCase()}ed`);
}

async function listChecklist(req, res) {
  const occurrence = await occurrenceRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!occurrence) throw new HttpError(404, 'Occurrence not found', 'NOT_FOUND');
  const checklist = await gembaRepo.listForOccurrence(occurrence.id);
  return success(res, checklist);
}

async function toggleChecklistItem(req, res) {
  const occurrence = await occurrenceRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!occurrence) throw new HttpError(404, 'Occurrence not found', 'NOT_FOUND');
  if (req.body.isCompleted === undefined) throw new HttpError(400, 'isCompleted is required', 'VALIDATION_ERROR');
  await gembaRepo.toggleItem(req.params.itemId, req.body.isCompleted);
  await logTaskEvent(req, {
    action: 'CHECKLIST_ITEM_TOGGLED', entity: 'TaskOccurrence', entityId: occurrence.id,
    details: { itemId: req.params.itemId, isCompleted: req.body.isCompleted }
  });
  const checklist = await gembaRepo.listForOccurrence(occurrence.id);
  return success(res, checklist, 'Checklist updated');
}

module.exports = { getOne, complete, timerAction, listChecklist, toggleChecklistItem };
