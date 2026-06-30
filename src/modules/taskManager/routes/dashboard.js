const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/dashboardController');

router.get('/admin', requireRole(['Admin']), authorize('dashboard', 'read'), asyncHandler(controller.admin));
router.get('/manager', requireRole(['Manager']), authorize('dashboard', 'read'), asyncHandler(controller.manager));
router.get('/employee', requireRole(['Employee']), authorize('dashboard', 'read'), asyncHandler(controller.employee));

module.exports = router;
