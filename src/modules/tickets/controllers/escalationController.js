const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const escalationService = require('../services/escalationService');
const escalationManagementService = require('../services/escalationManagementService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const escalateTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await escalationService.escalateTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Ticket escalated', data });
});

const listEscalations = asyncHandler(async (req, res) => {
  const data = await escalationService.listEscalations(req.user.tenant_id, req.query);
  res.json({ success: true, message: 'Escalations fetched', data });
});

const getEscalation = asyncHandler(async (req, res) => {
  const data = await escalationManagementService.getEscalationById(req.user.tenant_id, req.params.id);
  if (!data) throw new HttpError(404, 'Escalation not found', 'ESCALATION_NOT_FOUND');
  res.json({ success: true, message: 'Escalation fetched', data });
});

const updateEscalation = asyncHandler(async (req, res) => {
  const data = await escalationManagementService.updateEscalation(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'Escalation updated', data });
});

const closeEscalation = asyncHandler(async (req, res) => {
  const data = await escalationManagementService.closeEscalation(req.user.tenant_id, req.params.id);
  res.json({ success: true, message: 'Escalation closed', data });
});

module.exports = {
  escalateTicket,
  listEscalations,
  getEscalation,
  updateEscalation,
  closeEscalation,
};
