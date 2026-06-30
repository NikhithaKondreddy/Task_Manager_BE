const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/gembaWalksController');

router.get('/', requireRole(['Employee']), authorize('recurringActivity', 'read'), asyncHandler(controller.list));
router.get('/:id', requireRole(['Employee']), authorize('recurringActivity', 'read'), asyncHandler(controller.getOne));
router.post('/', requireRole(['Manager']), authorize('recurringActivity', 'create'), asyncHandler(controller.create));
router.put('/:id', requireRole(['Manager']), authorize('recurringActivity', 'update'), asyncHandler(controller.update));
router.delete('/:id', requireRole(['Manager']), authorize('recurringActivity', 'delete'), asyncHandler(controller.remove));
router.get('/:id/occurrences', requireRole(['Employee']), authorize('recurringActivity', 'read'), asyncHandler(controller.listOccurrences));

module.exports = router;
