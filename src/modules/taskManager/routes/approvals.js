const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/approvalsController');

router.get('/', requireRole(['Manager']), authorize('approvals', 'read'), asyncHandler(controller.list));
router.get('/:id', requireRole(['Manager']), authorize('approvals', 'read'), asyncHandler(controller.getOne));
router.post('/:id/approve', requireRole(['Manager']), authorize('approvals', 'approve'), asyncHandler(controller.approve));
router.post('/:id/reject', requireRole(['Manager']), authorize('approvals', 'reject'), asyncHandler(controller.reject));

module.exports = router;
