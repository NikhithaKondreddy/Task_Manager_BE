const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const approvalWorkflowService = require('../services/approvalWorkflowService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const approveTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.approveTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Ticket approved', data });
});

const rejectTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.rejectTicket(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Ticket rejected', data });
});

const approveById = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.approveById(req.user.tenant_id, req.params.approvalId, req.body, req.user);
  res.json({ success: true, message: 'Approval approved', data });
});

const rejectById = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.rejectById(req.user.tenant_id, req.params.approvalId, req.body, req.user);
  res.json({ success: true, message: 'Approval rejected', data });
});

const requestChangesById = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.requestChangesById(req.user.tenant_id, req.params.approvalId, req.body, req.user);
  res.json({ success: true, message: 'Approval changes requested', data });
});

const listApprovals = asyncHandler(async (req, res) => {
  const data = await approvalWorkflowService.listApprovals(req.user.tenant_id, req.params.ticketId);
  res.json({ success: true, message: 'Approvals fetched', data });
});

const requestApproval = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.requestApproval(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Approval requested', data });
});

const requestClosure = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.requestClosure(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Closure requested', data });
});

const approveClosure = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.approveClosure(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Closure approved', data });
});

const rejectClosure = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await approvalWorkflowService.rejectClosure(req.user.tenant_id, req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Closure rejected', data });
});

module.exports = {
  listApprovals,
  requestApproval,
  approveTicket,
  rejectTicket,
  requestClosure,
  approveClosure,
  rejectClosure,
  approveById,
  rejectById,
  requestChangesById,
};
