const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/projectsController');

router.get('/', requireRole(['Employee']), authorize('projects', 'read'), asyncHandler(controller.list));
router.get('/:id', requireRole(['Employee']), authorize('projects', 'read'), asyncHandler(controller.getOne));
router.post('/', requireRole(['Manager']), authorize('projects', 'create'), asyncHandler(controller.create));
router.put('/:id', requireRole(['Manager']), authorize('projects', 'update'), asyncHandler(controller.update));
router.delete('/:id', requireRole(['Admin']), authorize('projects', 'delete'), asyncHandler(controller.remove));
router.post('/:id/members', requireRole(['Manager']), authorize('projects', 'update'), asyncHandler(controller.addMember));
router.delete('/:id/members/:userId', requireRole(['Manager']), authorize('projects', 'update'), asyncHandler(controller.removeMember));
router.post('/:id/request-closure', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.requestClosure));

module.exports = router;
