const express = require('express');
const { param } = require('express-validator');
const slaController = require('../controllers/slaController');
const { requireTicketViewAccess, requireTicketSlaManagementAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.get('/', requireTicketViewAccess, slaController.listPolicies);
router.get('/:id', requireTicketViewAccess, [param('id').isInt({ min: 1 })], slaController.getPolicy);
router.post('/', requireTicketSlaManagementAccess, slaController.createPolicy);
router.put('/:id', requireTicketSlaManagementAccess, [param('id').isInt({ min: 1 })], slaController.updatePolicy);
router.delete('/:id', requireTicketSlaManagementAccess, [param('id').isInt({ min: 1 })], slaController.deletePolicy);

module.exports = router;
