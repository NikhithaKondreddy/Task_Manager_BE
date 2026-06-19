const { asyncHandler } = require('../../../utils/asyncHandler');
const feedbackService = require('../services/feedbackService');

const listFeedback = asyncHandler(async (req, res) => {
  const data = await feedbackService.listFeedback(req.user, req.query);
  res.json({ success: true, message: 'Feedback fetched', data });
});

const getFeedback = asyncHandler(async (req, res) => {
  const data = await feedbackService.getFeedbackById(req.user, req.params.id);
  res.json({ success: true, message: 'Feedback fetched', data });
});

const getTicketFeedback = asyncHandler(async (req, res) => {
  const data = await feedbackService.getFeedbackForTicket(req.params.ticketId, req.user);
  res.json({ success: true, message: 'Ticket feedback fetched', data });
});

const submitTicketFeedback = asyncHandler(async (req, res) => {
  const data = await feedbackService.submitFeedback(req.params.ticketId || req.body.ticketId || req.body.ticket_id, req.body, req.user);
  res.status(201).json({ success: true, message: 'Feedback submitted', data });
});

const updateFeedback = asyncHandler(async (req, res) => {
  const data = await feedbackService.updateFeedback(req.params.id, req.body, req.user);
  res.json({ success: true, message: 'Feedback updated', data });
});

const deleteFeedback = asyncHandler(async (req, res) => {
  const data = await feedbackService.deleteFeedback(req.params.id, req.user);
  res.json({ success: true, message: 'Feedback deleted', data });
});

module.exports = {
  listFeedback,
  getFeedback,
  getTicketFeedback,
  submitTicketFeedback,
  updateFeedback,
  deleteFeedback,
};
