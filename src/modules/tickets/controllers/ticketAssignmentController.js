const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const ticketAssignmentService = require('../services/ticketAssignmentService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const assignTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketAssignmentService.assignTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user, 'ASSIGN');
  res.json({ success: true, message: 'Ticket assigned', data });
});

const reassignTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketAssignmentService.assignTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user, 'REASSIGN');
  res.json({ success: true, message: 'Ticket reassigned', data });
});

const unassignTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketAssignmentService.unassignTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Ticket unassigned', data });
});

const acceptTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketAssignmentService.acceptTicket(req.user.tenant_id, req.params.ticketId, req.user);
  res.json({ success: true, message: 'Ticket accepted', data });
});

const rejectTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketAssignmentService.rejectTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Ticket rejected', data });
});

module.exports = {
  assignTicket,
  reassignTicket,
  unassignTicket,
  acceptTicket,
  rejectTicket,
};
