const express = require('express');
const { body, param, query } = require('express-validator');
const upload = require('../../../multer');
const ticketController = require('../controllers/ticketController');
const {
  requireTicketViewAccess,
  requireTicketManagementAccess,
  requireTicketCommentAccess,
} = require('../middleware/ticketPermissions');

const router = express.Router();

function normalizeCreateTicketRequest(req, res, next) {
  if (!req.body.description && req.body.body) {
    req.body.description = req.body.body;
  }

  if (!req.body.requester_name && req.body.requesterName) {
    req.body.requester_name = req.body.requesterName;
  }

  if (!req.body.requester_email && req.body.requesterEmail) {
    req.body.requester_email = req.body.requesterEmail;
  }

  next();
}

router.post(
  '/',
  upload.any(),
  normalizeCreateTicketRequest,
  requireTicketViewAccess,
  [
    body('title').optional().isString().trim().isLength({ min: 1 }),
    body(['description', 'body']).optional().isString().trim(),
    body(['requester_email', 'requesterEmail']).optional().isEmail().normalizeEmail(),
    body(['requester_name', 'requesterName']).optional().isString().trim(),
    body().custom((value, { req }) => {
      const requesterEmail = req.body.requester_email || req.body.requesterEmail;
      if (!requesterEmail) {
        throw new Error('requester_email is required');
      }
      return true;
    }),
    body('status').optional().isIn(['Open', 'In Progress', 'Closed', 'open', 'in progress', 'closed']),
    body('priority').optional().isIn(['Low', 'Medium', 'High', 'low', 'medium', 'high']),
    body('assigned_queue').optional().isString().trim(),
    body('assigned_to').optional({ nullable: true }).isInt(),
    body('source_message_id').optional().isString().trim(),
    body('message_id').optional().isString().trim(),
    body('attachments').optional().isArray(),
  ],
  ticketController.createTicket
);

router.get(
  '/dashboard',
  requireTicketViewAccess,
  ticketController.getDashboard
);

router.get(
  '/',
  requireTicketViewAccess,
  [
    query('status').optional().isIn(['Open', 'In Progress', 'Closed']),
    query('priority').optional().isIn(['Low', 'Medium', 'High']),
    query('requester_email').optional().isEmail(),
    query('assigned_to').optional().isInt(),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  ticketController.listTickets
);

router.get(
  '/:id',
  requireTicketViewAccess,
  [param('id').isString().trim().isLength({ min: 1 })],
  ticketController.getTicket
);

router.put(
  '/:id',
  requireTicketManagementAccess,
  [
    param('id').isString().trim().isLength({ min: 1 }),
    body('status').optional().isIn(['Open', 'In Progress', 'Closed', 'open', 'in progress', 'closed']),
    body('priority').optional().isIn(['Low', 'Medium', 'High', 'low', 'medium', 'high']),
    body('assigned_user_id').optional({ nullable: true }).isInt(),
    body('assigned_to').optional({ nullable: true }).isInt(),
    body().custom((value, { req }) => {
      const allowedKeys = ['status', 'priority', 'assigned_to', 'assigned_user_id'];
      const invalidKeys = Object.keys(req.body || {}).filter((key) => !allowedKeys.includes(key));
      if (invalidKeys.length > 0) {
        throw new Error(`Only status, assigned_to and priority can be updated`);
      }
      return true;
    }),
  ],
  ticketController.updateTicket
);

router.post(
  '/:id/comments',
  requireTicketCommentAccess,
  [
    param('id').isString().trim().isLength({ min: 1 }),
    body(['body', 'comment', 'message']).optional().isString().trim().isLength({ min: 1 }),
    body().custom((value, { req }) => {
      if (!req.body.body && !req.body.comment && !req.body.message) {
        throw new Error('Comment body is required');
      }
      return true;
    }),
    body('author_email').optional().isEmail().normalizeEmail(),
    body('author_name').optional().isString().trim(),
    body('source_message_id').optional().isString().trim(),
    body('message_id').optional().isString().trim(),
    body('attachments').optional().isArray(),
  ],
  ticketController.addComment
);

// Get available IT Support users for assignment
router.get(
  '/assignees/it-support',
  requireTicketViewAccess,
  ticketController.getITSupportAssignees
);

module.exports = router;
