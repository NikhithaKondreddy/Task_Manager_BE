const express = require('express');
const router = express.Router();
const upload = require('../../../../multer');
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/taskExecutionController');

router.get('/:taskId', requireRole(['Employee']), authorize('tasks', 'read'), asyncHandler(controller.detail));
router.post('/:taskId/start', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.start));
router.post('/:taskId/pause', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.pause));
router.post('/:taskId/resume', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.resume));
router.post('/:taskId/draft', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.saveDraft));
router.post('/:taskId/photos', requireRole(['Employee']), authorize('tasks', 'update'), upload.array('photos', 5), asyncHandler(controller.uploadPhoto));
router.post('/:taskId/remarks', requireRole(['Employee']), authorize('tasks', 'update'), asyncHandler(controller.saveRemarks));
router.post('/:taskId/complete', requireRole(['Employee']), authorize('tasks', 'complete'), upload.array('photos', 5), asyncHandler(controller.complete));

module.exports = router;
