const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const ticketService = require('../services/ticketService');
const reportService = require('../services/reportService');

function normalizeUploadedFiles(files = []) {
  return files.map((file) => ({
    file_name: file.originalname,
    content_type: file.mimetype,
    size_bytes: file.size,
    buffer: file.buffer,
  }));
}

function normalizePayload(req) {
  const payload = {
    ...req.body,
  };

  if (!payload.description && payload.body) {
    payload.description = payload.body;
  }

  if (!payload.subject && payload.title) {
    payload.subject = payload.title;
  }

  if (!payload.requesterEmail && payload.requester_email) {
    payload.requesterEmail = payload.requester_email;
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

const getSession = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    message: 'Ticket session fetched',
    data: ticketService.getSession(req.user),
  });
});

const createTicket = asyncHandler(async (req, res) => {
  normalizePayload(req);
  assertValidRequest(req);
  const result = await ticketService.createTicket(req.body, req.user);
  if (result && result.duplicate) {
    return res.status(409).json({
      success: false,
      message: 'You already have an active ticket for this issue. Please track the existing ticket instead of creating a duplicate request.',
      errorCode: 'DUPLICATE_TICKET_DETECTED',
      data: result.duplicateMeta,
    });
  }

  res.status(result.ticket?.isDraft ? 200 : 201).json({
    success: true,
    message: result.ticket?.isDraft ? 'Draft saved' : 'Ticket created',
    data: result.ticket,
  });
});

const createDraft = asyncHandler(async (req, res) => {
  normalizePayload(req);
  req.body.isDraft = true;
  const result = await ticketService.createTicket(req.body, req.user);
  res.status(201).json({
    success: true,
    message: 'Draft saved',
    data: result.ticket,
  });
});

const updateDraft = asyncHandler(async (req, res) => {
  normalizePayload(req);
  const data = await ticketService.updateDraft(req.params.id, req.body, req.user);
  res.json({
    success: true,
    message: 'Draft updated',
    data,
  });
});

const listDrafts = asyncHandler(async (req, res) => {
  const data = await ticketService.listDrafts(req.user);
  res.json({
    success: true,
    message: 'Drafts fetched',
    data,
  });
});

const deleteDraft = asyncHandler(async (req, res) => {
  const data = await ticketService.deleteDraft(req.params.id, req.user);
  res.json({
    success: true,
    message: 'Draft deleted',
    data,
  });
});

const listTickets = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await ticketService.listTickets(req.query, req.user);
  res.json({
    success: true,
    message: 'Tickets fetched',
    data,
  });
});

const getDashboard = asyncHandler(async (req, res) => {
  const data = await ticketService.getDashboard(req.user, req.query);
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
  normalizePayload(req);
  assertValidRequest(req);
  const data = await ticketService.updateTicket(req.params.id, req.body, req.user);
  res.json({
    success: true,
    message: 'Ticket updated',
    data,
  });
});

const addComment = asyncHandler(async (req, res) => {
  normalizePayload(req);
  assertValidRequest(req);
  const result = await ticketService.addComment(req.params.id, req.body, req.user);
  res.status(201).json({
    success: true,
    message: 'Comment added',
    data: result.ticket,
  });
});

const listComments = asyncHandler(async (req, res) => {
  const data = await ticketService.listComments(req.params.ticketId, req.user);
  res.json({ success: true, message: 'Comments fetched', data });
});

const updateComment = asyncHandler(async (req, res) => {
  const data = await ticketService.updateComment(req.params.commentId, req.body, req.user);
  res.json({ success: true, message: 'Comment updated', data });
});

const deleteComment = asyncHandler(async (req, res) => {
  const data = await ticketService.deleteComment(req.params.commentId, req.user);
  res.json({ success: true, message: 'Comment deleted', data });
});

const listAttachments = asyncHandler(async (req, res) => {
  const data = await ticketService.listAttachments(req.params.ticketId, req.user);
  res.json({ success: true, message: 'Attachments fetched', data });
});

const addAttachment = asyncHandler(async (req, res) => {
  normalizePayload(req);
  const data = await ticketService.addAttachment(req.params.ticketId, req.body, req.user);
  res.status(201).json({ success: true, message: 'Attachment added', data });
});

const deleteAttachment = asyncHandler(async (req, res) => {
  const data = await ticketService.deleteAttachment(req.params.ticketId, req.params.attachmentId, req.user);
  res.json({ success: true, message: 'Attachment deleted', data });
});

const listWatchers = asyncHandler(async (req, res) => {
  const data = await ticketService.listWatchers(req.params.ticketId, req.user);
  res.json({ success: true, message: 'Watchers fetched', data });
});

const addWatcher = asyncHandler(async (req, res) => {
  const data = await ticketService.addWatcher(req.params.ticketId, req.body, req.user);
  res.status(201).json({ success: true, message: 'Watcher added', data });
});

const removeWatcher = asyncHandler(async (req, res) => {
  const data = await ticketService.removeWatcher(req.params.ticketId, req.params.userId, req.user);
  res.json({ success: true, message: 'Watcher removed', data });
});

const getTicketSla = asyncHandler(async (req, res) => {
  const data = await ticketService.getTicketSla(req.params.ticketId, req.user);
  res.json({ success: true, message: 'Ticket SLA fetched', data });
});

const updateTicketSla = asyncHandler(async (req, res) => {
  const data = await ticketService.updateTicketSla(req.params.ticketId, req.body, req.user);
  res.json({ success: true, message: 'Ticket SLA updated', data });
});

const setTicketStatus = asyncHandler(async (req, res) => {
  const status = req.body.status || req.params.status;
  const payload = {
    ...req.body,
    status,
  };
  const data = await ticketService.updateTicket(req.params.ticketId, payload, req.user);
  res.json({ success: true, message: 'Ticket status updated', data });
});

const resolveTicket = asyncHandler(async (req, res) => {
  normalizePayload(req);
  assertValidRequest(req);
  const resolutionNotes = req.body.resolutionNotes || req.body.resolution_notes || req.body.resolution || req.body.notes || null;
  const resolutionSummary = req.body.resolutionSummary || req.body.resolution_summary || req.body.summary || null;
  const resolutionCode = req.body.resolutionCode || req.body.resolution_code || null;
  let notes = resolutionNotes || null;
  if (resolutionCode) {
    notes = notes ? `${notes} [CODE:${String(resolutionCode)}]` : `[CODE:${String(resolutionCode)}]`;
  }
  const data = await ticketService.updateTicket(req.params.ticketId, {
    ...req.body,
    status: 'RESOLVED',
    resolutionNotes: notes,
    resolutionSummary: resolutionSummary
  }, req.user);
  res.json({ success: true, message: 'Ticket resolved', data });
});

const closeTicket = asyncHandler(async (req, res) => {
  normalizePayload(req);
  assertValidRequest(req);
  const feedback = req.body.feedback || req.body.resolutionNotes || req.body.resolution_notes || null;
  const closureRemarks = req.body.closureRemarks || req.body.closure_remarks || req.body.remarks || feedback || null;
  const data = await ticketService.updateTicket(req.params.ticketId, {
    ...req.body,
    status: 'CLOSED',
    resolutionNotes: feedback,
    closureRemarks: closureRemarks
  }, req.user);
  try {
    // stop SLA timers
    await ticketService.updateTicketSla(req.params.ticketId, { responseDueAt: null, resolutionDueAt: null, escalationDueAt: null, nextEscalationAt: null }, req.user);
  } catch (e) {
    // ignore SLA update failures
  }
  res.json({ success: true, message: 'Ticket closed', data });
});

const getITSupportAssignees = asyncHandler(async (req, res) => {
  const assignees = await ticketService.getITSupportAssignees(req.user);
  res.json({
    success: true,
    message: 'IT support assignees fetched',
    data: assignees,
  });
});

const getReport = asyncHandler(async (req, res) => {
  const payload = await reportService.buildReportPayload(req.user.tenant_id, req.params.type, req.query);

  if (payload.type === 'application/json') {
    return res.json({
      success: true,
      message: `${req.params.type} report fetched`,
      data: payload.body,
    });
  }

  res.setHeader('Content-Type', payload.type);
  res.setHeader('Content-Disposition', `attachment; filename="${payload.filename}"`);
  return res.send(payload.body);
});

module.exports = {
  getSession,
  createTicket,
  createDraft,
  updateDraft,
  listDrafts,
  deleteDraft,
  listTickets,
  getDashboard,
  getTicket,
  updateTicket,
  addComment,
  listComments,
  updateComment,
  deleteComment,
  listAttachments,
  addAttachment,
  deleteAttachment,
  listWatchers,
  addWatcher,
  removeWatcher,
  getTicketSla,
  updateTicketSla,
  setTicketStatus,
  getITSupportAssignees,
  getReport,
  resolveTicket,
  closeTicket,
};
