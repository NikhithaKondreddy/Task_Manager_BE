const express = require('express');
const { body, param } = require('express-validator');
const engineerMappingController = require('../controllers/engineerMappingController');
const { requireTicketViewAccess, requireTicketMappingManagementAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.get('/', requireTicketViewAccess, engineerMappingController.listMappings);

router.post(
  '/',
  requireTicketMappingManagementAccess,
  [body('engineerId').optional().isString().trim(), body('engineer_id').optional().isString().trim()],
  engineerMappingController.createMapping
);

router.put(
  '/:id',
  requireTicketMappingManagementAccess,
  [param('id').isInt({ min: 1 })],
  engineerMappingController.updateMapping
);

router.delete(
  '/:id',
  requireTicketMappingManagementAccess,
  [param('id').isInt({ min: 1 })],
  engineerMappingController.deleteMapping
);

module.exports = router;
