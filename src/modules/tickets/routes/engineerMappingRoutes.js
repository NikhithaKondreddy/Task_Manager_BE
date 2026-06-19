const express = require('express');
const { body, param } = require('express-validator');
const engineerMappingController = require('../controllers/engineerMappingController');
const { requireTicketViewAccess, requireTicketMappingManagementAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.get('/', requireTicketViewAccess, engineerMappingController.listMappings);

router.post(
  '/',
  requireTicketMappingManagementAccess,
  [
    body('engineerId').optional().custom((val) => {
      if (val !== undefined && val !== null && val !== '') return true;
      throw new Error('engineerId must not be empty');
    }),
    body('engineer_id').optional().custom((val) => {
      if (val !== undefined && val !== null && val !== '') return true;
      throw new Error('engineer_id must not be empty');
    }),
  ],
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
