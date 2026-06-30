const express = require('express');
const router = express.Router();
const upload = require('../../../../multer');
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/gembaExecutionController');

router.get('/:walkId', requireRole(['Employee']), authorize('recurringActivity', 'read'), asyncHandler(controller.detail));
router.post('/:walkId/start', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.start));
router.post('/:walkId/pause', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.pause));
router.post('/:walkId/resume', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.resume));
router.post('/:walkId/draft', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.saveDraft));
router.put('/:walkId/checklist/:itemId', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.checklist));
router.post('/:walkId/photos', requireRole(['Employee']), authorize('recurringActivity', 'complete'), upload.array('photos', 10), asyncHandler(controller.uploadPhotos));
router.post('/:walkId/remarks', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.saveRemarks));
router.post('/:walkId/complete', requireRole(['Employee']), authorize('recurringActivity', 'complete'), upload.array('photos', 10), asyncHandler(controller.complete));

module.exports = router;
