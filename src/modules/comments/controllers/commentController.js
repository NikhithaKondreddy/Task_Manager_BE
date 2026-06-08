const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const commentService = require('../services/commentService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const createComment = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const comment = await commentService.addComment(req.params.ticketId, req.body, req.user);
  res.status(201).json({ success: true, message: 'Comment created', data: comment });
});

const getComments = asyncHandler(async (req, res) => {
  const data = await commentService.listComments(req.params.ticketId, req.user, { limit: req.query.limit, offset: req.query.offset });
  res.json({ success: true, message: 'Comments fetched', data });
});

const editComment = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await commentService.updateComment(req.params.commentId, req.body.body, req.user);
  res.json({ success: true, message: 'Comment updated', data });
});

const removeComment = asyncHandler(async (req, res) => {
  const data = await commentService.deleteComment(req.params.commentId, req.user);
  res.json({ success: true, message: 'Comment deleted', data });
});

module.exports = {
  createComment,
  getComments,
  editComment,
  removeComment,
};
