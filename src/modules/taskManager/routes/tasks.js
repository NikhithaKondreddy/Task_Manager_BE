const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/tasksController');

router.get('/', requireRole(['SuperAdmin', 'Admin', 'Manager', 'Employee']), authorize('tasks', 'read'), asyncHandler(controller.list));
router.get('/:id', requireRole(['SuperAdmin', 'Admin', 'Manager', 'Employee']), authorize('tasks', 'read'), asyncHandler(controller.getOne));
router.post('/', requireRole(['SuperAdmin', 'Admin', 'Manager']), authorize('tasks', 'create'), asyncHandler(controller.create));
router.put('/:id', requireRole(['SuperAdmin', 'Admin', 'Manager']), authorize('tasks', 'update'), asyncHandler(controller.update));
router.delete('/:id', requireRole(['SuperAdmin', 'Admin', 'Manager']), authorize('tasks', 'delete'), asyncHandler(controller.remove));
router.get('/:id/history', requireRole(['SuperAdmin', 'Admin', 'Manager', 'Employee']), authorize('audit', 'read'), asyncHandler(controller.history));
router.get('/:id/comments', requireRole(['SuperAdmin', 'Admin', 'Manager', 'Employee']), authorize('tasks', 'read'), asyncHandler(controller.listComments));
router.post('/:id/comments', requireRole(['SuperAdmin', 'Admin', 'Manager', 'Employee']), authorize('chat', 'write'), asyncHandler(controller.addComment));

module.exports = router;
