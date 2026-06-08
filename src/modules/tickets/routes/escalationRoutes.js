const express = require('express');
const { param } = require('express-validator');
const escalationController = require('../controllers/escalationController');
const { requireTicketViewAccess, requireTicketAssignAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.get(
  '/:id',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 })],
  escalationController.getEscalation
);

router.put(
  '/:id',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 })],
  escalationController.updateEscalation
);

router.post(
  '/:id/close',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 })],
  escalationController.closeEscalation
);

module.exports = router;
