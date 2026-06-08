const attachmentRepository = require('../repositories/attachmentRepository');
const ticketRepo = require('../../tickets/repositories/mysql');

async function uploadAttachment(file, uploadedBy) {
  // file expected: { originalname, mimetype, size, buffer }
  // In production, store buffer to object storage and save storage key
  const storageKey = `local:${Date.now()}:${file.originalname}`;
  const id = await attachmentRepository.createAttachment(file.originalname, file.mimetype, file.size, storageKey, uploadedBy);
  // optionally write to ticket_history if file attached later by controller
  return { id, filename: file.originalname, storageKey };
}

async function getAttachment(id) {
  return attachmentRepository.getAttachmentById(id);
}

async function removeAttachment(id) {
  return attachmentRepository.deleteAttachment(id);
}

module.exports = { uploadAttachment, getAttachment, removeAttachment };
