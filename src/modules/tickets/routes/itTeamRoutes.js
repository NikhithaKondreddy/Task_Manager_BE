const express = require('express');
const { body, param, query } = require('express-validator');
const itTeamController = require('../controllers/itTeamController');
const { requireTicketViewAccess, requireTicketAssignAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.get(
  '/',
  requireTicketViewAccess,
  [
    query('status').optional().isString().trim(),
    query('teamLeadId').optional().isString().trim(),
  ],
  itTeamController.listTeams
);

router.get(
  '/:id',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 })],
  itTeamController.getTeam
);

router.post(
  '/',
  requireTicketAssignAccess,
  [
    body('teamName').optional().isString().trim(),
    body('team_name').optional().isString().trim(),
    body('teamLeadId').optional().isString().trim(),
    body('team_lead_id').optional().isString().trim(),
    body('status').optional().isString().trim(),
  ],
  itTeamController.createTeam
);

router.put(
  '/:id',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 })],
  itTeamController.updateTeam
);

router.delete(
  '/:id',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 })],
  itTeamController.deleteTeam
);

router.get(
  '/:id/members',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 })],
  itTeamController.listMembers
);

router.post(
  '/:id/members',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 })],
  itTeamController.addMembers
);

router.delete(
  '/:id/members/:userId',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 }), param('userId').isString().trim().isLength({ min: 1 })],
  itTeamController.removeMember
);

router.put(
  '/:id/team-lead',
  requireTicketAssignAccess,
  [param('id').isInt({ min: 1 })],
  itTeamController.updateTeamLead
);

module.exports = router;
