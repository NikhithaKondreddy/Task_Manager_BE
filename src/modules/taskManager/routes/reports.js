const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/reportsController');

router.get('/task-summary', requireRole(['Employee']), authorize('reports', 'read'), asyncHandler(controller.taskSummary));
router.get('/employee-performance', requireRole(['Manager']), authorize('reports', 'read'), asyncHandler(controller.employeePerformance));
router.get('/completion', requireRole(['Employee']), authorize('reports', 'read'), asyncHandler(controller.completion));
router.get('/recurring', requireRole(['Manager']), authorize('reports', 'read'), asyncHandler(controller.recurring));
router.get('/gemba-walk', requireRole(['Manager']), authorize('reports', 'read'), asyncHandler(controller.gembaWalk));
router.get('/approvals', requireRole(['Manager']), authorize('reports', 'read'), asyncHandler(controller.approvals));

module.exports = router;
