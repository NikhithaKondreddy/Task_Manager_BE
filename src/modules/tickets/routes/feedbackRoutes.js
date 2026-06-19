const express = require('express');
const { body, param } = require('express-validator');
const feedbackController = require('../controllers/feedbackController');
const {
  requireTicketViewAccess,
  requireTicketManagementAccess,
} = require('../middleware/ticketPermissions');

const router = express.Router();

router.get(
  '/',
  requireTicketViewAccess,
  feedbackController.listFeedback
);

router.post(
  '/',
  requireTicketViewAccess,
  [
    body(['ticketId', 'ticket_id']).optional().isString().trim().isLength({ min: 1 }),
    body('rating').isInt({ min: 1, max: 5 }),
    body().custom((value) => {
      if (!value.ticketId && !value.ticket_id) throw new Error('ticketId is required');
      return true;
    }),
  ],
  feedbackController.submitTicketFeedback
);

router.get(
  '/:id',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 })],
  feedbackController.getFeedback
);

router.put(
  '/:id',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 }), body('rating').optional().isInt({ min: 1, max: 5 })],
  feedbackController.updateFeedback
);

router.delete(
  '/:id',
  requireTicketManagementAccess,
  [param('id').isInt({ min: 1 })],
  feedbackController.deleteFeedback
);

module.exports = router;
