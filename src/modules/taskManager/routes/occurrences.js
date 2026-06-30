const express = require('express');
const router = express.Router();
const upload = require('../../../../multer');
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/occurrencesController');

router.get('/:id', requireRole(['Employee']), authorize('recurringActivity', 'read'), asyncHandler(controller.getOne));
router.post('/:id/complete', requireRole(['Employee']), authorize('recurringActivity', 'complete'), upload.array('photos', 5), asyncHandler(controller.complete));
router.get('/:id/checklist', requireRole(['Employee']), authorize('recurringActivity', 'read'), asyncHandler(controller.listChecklist));
router.put('/:id/checklist/:itemId', requireRole(['Employee']), authorize('recurringActivity', 'complete'), asyncHandler(controller.toggleChecklistItem));

module.exports = router;
