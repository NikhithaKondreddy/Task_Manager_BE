const express = require('express');
const multer = require('../../../../multer');
const { requireAuth } = require('../../../middleware/roles');
const attachmentController = require('../controllers/attachmentController');

const router = express.Router();

router.post('/upload', requireAuth, multer.single('file'), attachmentController.upload);
router.get('/:attachmentId', requireAuth, attachmentController.get);
router.delete('/:attachmentId', requireAuth, attachmentController.remove);

module.exports = router;
