const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/auditLogsController');

router.get('/', requireRole(['Manager']), authorize('audit', 'read'), asyncHandler(controller.list));

module.exports = router;
