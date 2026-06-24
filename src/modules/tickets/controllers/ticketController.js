const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const ticketService = require('../services/ticketService');

function normalizeUploadedFiles(files = []) {
  return files.map((file) => ({
    file_name: file.originalname,
    content_type: file.mimetype,
    size_bytes: file.size,
    buffer: file.buffer,
  }));
}

function normalizeTicketPayload(req) {
  const payload = {
    ...req.body,
  };

  if (!payload.description && payload.body) {
    payload.description = payload.body;
  }

  if (!payload.requester_name && payload.requesterName) {
    payload.requester_name = payload.requesterName;
  }

  if (!payload.requester_email && payload.requesterEmail) {
    payload.requester_email = payload.requesterEmail;
  }

  const uploadedAttachments = normalizeUploadedFiles(req.files || []);
  if (uploadedAttachments.length > 0) {
    payload.attachments = [...(Array.isArray(payload.attachments) ? payload.attachments : []), ...uploadedAttachments];
  }

  req.body = payload;
  return payload;
}

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const createTicket = asyncHandler(async (req, res) => {
  normalizeTicketPayload(req);
  assertValidRequest(req);
  const result = await ticketService.createTicket(req.body);
  res.status(result.duplicate ? 200 : 201).json({
    success: true,
    message: result.duplicate ? 'Duplicate Message-ID. Existing ticket returned.' : 'Ticket created',
    data: result.ticket,
  });
});

const listTickets = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketService.listTickets(req.query, req.user);
  const canCreateTicket = ['ADMIN', 'MANAGER', 'EMPLOYEE'].includes(String(req.user?.role || '').toUpperCase());
  res.json({
    success: true,
    message: 'Tickets fetched',
    data,
    permissions: { canCreateTicket },
  });
});

const getDashboard = asyncHandler(async (req, res) => {
  const data = await ticketService.getDashboard(req.user);
  res.json({
    success: true,
    message: 'Ticket dashboard fetched',
    data,
  });
});

const getTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketService.getTicket(req.params.id, req.user);
  res.json({
    success: true,
    message: 'Ticket fetched',
    data,
  });
});

const updateTicket = asyncHandler(async (req, res) => {
  assertValidRequest(req);

  const data = await ticketService.updateTicket(req.params.id, req.body);
  res.json({
    success: true,
    message: 'Ticket updated',
    data,
  });
});

const addComment = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const result = await ticketService.addComment(req.params.id, req.body, req.user);
  res.status(result.duplicate ? 200 : 201).json({
    success: true,
    message: result.duplicate ? 'Duplicate Message-ID. Existing ticket returned.' : 'Comment added',
    data: result.ticket,
  });
});

const getITSupportAssignees = asyncHandler(async (req, res) => {
  const assignees = await ticketService.getITSupportAssignees();
  res.json({
    success: true,
    message: 'IT Support assignees fetched',
    data: assignees,
  });
});

module.exports = {
  createTicket,
  listTickets,
  getDashboard,
  getTicket,
  updateTicket,
  addComment,
  getITSupportAssignees,
};
