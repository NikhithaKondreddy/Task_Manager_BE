const commentRepository = require('../repositories/commentRepository');
const ticketHistoryRepo = require('../../tickets/repositories/mysql');

async function addComment(ticketId, payload, user) {
  const authorId = user && (user.id || user._id) ? (user.id || user._id) : null;
  const commentId = await commentRepository.createComment(ticketId, authorId, payload.body, payload.commentType || 'PUBLIC');
  const comment = await commentRepository.getCommentById(commentId);

  // write a simple ticket history entry (best-effort)
  try {
    await ticketHistoryRepo.query('INSERT INTO ticket_history (ticket_id, event_type, actor_id, new_value, created_at) VALUES (?, ?, ?, ?, NOW())', [ticketId, 'COMMENT_ADDED', authorId, JSON.stringify({ commentId })]);
  } catch (e) {
    // ignore history failures
  }

  return comment;
}

async function listComments(ticketId, user, opts = {}) {
  const limit = opts.limit || 50;
  const offset = opts.offset || 0;
  return commentRepository.listCommentsByTicket(ticketId, limit, offset);
}

async function updateComment(commentId, body, user) {
  // TODO: enforce ownership/permissions
  return commentRepository.updateComment(commentId, body);
}

async function deleteComment(commentId, user) {
  // TODO: enforce ownership/permissions
  return commentRepository.deleteComment(commentId);
}

module.exports = {
  addComment,
  listComments,
  updateComment,
  deleteComment,
};
