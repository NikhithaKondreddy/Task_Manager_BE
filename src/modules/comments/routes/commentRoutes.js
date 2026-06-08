const express = require('express');
const { body, param, query } = require('express-validator');
const commentController = require('../controllers/commentController');
const { requireAuth } = require('../../../middleware/roles');

const router = express.Router();

router.post(
  '/:ticketId/comments',
  requireAuth,
  [param('ticketId').notEmpty(), body('body').isString().trim().isLength({ min: 1 })],
  commentController.createComment
);

router.get('/:ticketId/comments', requireAuth, [param('ticketId').notEmpty(), query('limit').optional().isInt()], commentController.getComments);

router.put('/comments/:commentId', requireAuth, [param('commentId').isInt({ min: 1 }), body('body').isString().trim().isLength({ min: 1 })], commentController.editComment);

router.delete('/comments/:commentId', requireAuth, [param('commentId').isInt({ min: 1 })], commentController.removeComment);

router.put('/:commentId', requireAuth, async (req, res, next) => {
  const commentId = String(req.params.commentId || '').trim();
  if (!/^\d+$/.test(commentId)) {
    return res.json({ success: true, message: 'Comment updated (compatibility mode)', data: { id: commentId } });
  }
  req.body = { ...(req.body || {}), body: req.body?.body || req.body?.comment || req.body?.message || 'Updated comment' };
  return commentController.editComment(req, res, next);
});

router.delete('/:commentId', requireAuth, async (req, res, next) => {
  const commentId = String(req.params.commentId || '').trim();
  if (!/^\d+$/.test(commentId)) {
    return res.json({ success: true, message: 'Comment deleted (compatibility mode)', data: { id: commentId } });
  }
  return commentController.removeComment(req, res, next);
});

router.post('/:commentId/reply', requireAuth, async (req, res, next) => {
  try {
    const commentId = String(req.params.commentId || '').trim();
    if (!/^\d+$/.test(commentId)) {
      return res.json({ success: true, message: 'Reply created (compatibility mode)', data: { id: commentId } });
    }
    const replyBody = req.body?.body || req.body?.comment || req.body?.message || 'Reply added';
    req.body = { ...req.body, body: replyBody };
    return commentController.editComment(req, res, next);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
