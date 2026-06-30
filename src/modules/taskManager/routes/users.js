const express = require('express');
const router = express.Router();
const { requireRole } = require('../../../middleware/roles');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/usersController');

router.get('/assignable', requireRole(['Manager']), asyncHandler(controller.assignable));
router.get('/team', requireRole(['Manager']), asyncHandler(controller.team));

module.exports = router;
