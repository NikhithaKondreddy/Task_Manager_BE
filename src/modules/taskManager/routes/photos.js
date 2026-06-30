const express = require('express');
const router = express.Router();
const upload = require('../../../../multer');
const { requireRole } = require('../../../middleware/roles');
const { authorize } = require('../../../middleware/authorize');
const { asyncHandler } = require('../../../utils/asyncHandler');
const controller = require('../controllers/photosController');

router.get('/mine', requireRole(['Employee']), authorize('photos', 'read'), asyncHandler(controller.listMine));
router.post('/', requireRole(['Employee']), authorize('photos', 'upload'), upload.array('photos', 5), asyncHandler(controller.upload));
router.delete('/:id', requireRole(['Manager']), authorize('photos', 'delete'), asyncHandler(controller.remove));

module.exports = router;
