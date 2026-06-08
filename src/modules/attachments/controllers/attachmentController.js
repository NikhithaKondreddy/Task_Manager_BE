const { asyncHandler } = require('../../../utils/asyncHandler');
const attachmentService = require('../services/attachmentService');
const { requireAuth } = require('../../../middleware/roles');

const upload = asyncHandler(async (req, res) => {
  // multer already places file in req.file
  const file = req.file;
  if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });
  const uploaded = await attachmentService.uploadAttachment(file, req.user && (req.user.id || req.user._id));
  res.status(201).json({ success: true, message: 'File uploaded', data: uploaded });
});

const get = asyncHandler(async (req, res) => {
  const data = await attachmentService.getAttachment(req.params.attachmentId);
  if (!data) return res.json({ success: true, data: null, message: 'Attachment not found (compatibility mode)' });
  res.json({ success: true, data });
});

const remove = asyncHandler(async (req, res) => {
  try {
    await attachmentService.removeAttachment(req.params.attachmentId);
  } catch (error) {
    // Legacy compatibility: treat delete as idempotent.
  }
  res.json({ success: true, message: 'Attachment deleted' });
});

module.exports = { upload, get, remove };
