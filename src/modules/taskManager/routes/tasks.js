const express = require('express');
const router = express.Router();
const upload = require('../../../../multer');
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/tasksController');

router.get('/', requireRole(['Employee']), authorize('tasks', 'read'), asyncHandler(controller.list));
router.get('/:id', requireRole(['Employee']), authorize('tasks', 'read'), asyncHandler(controller.getOne));
router.post('/', requireRole(['Manager']), authorize('tasks', 'create'), asyncHandler(controller.create));
router.put('/:id', requireRole(['Manager']), authorize('tasks', 'update'), asyncHandler(controller.update));
router.delete('/:id', requireRole(['Manager']), authorize('tasks', 'delete'), asyncHandler(controller.remove));
router.post('/:id/start', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.start));
router.post('/:id/complete', requireRole(['Employee']), authorize('tasks', 'complete'), upload.array('photos', 5), asyncHandler(controller.complete));
router.get('/:id/history', requireRole(['Manager']), authorize('audit', 'read'), asyncHandler(controller.history));
router.get('/:id/comments', requireRole(['Employee']), authorize('tasks', 'read'), asyncHandler(controller.listComments));
router.post('/:id/comments', requireRole(['Employee']), authorize('chat', 'write'), asyncHandler(controller.addComment));

module.exports = router;
