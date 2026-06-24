const crypto = require('crypto');
const fs = require('fs').promises;
const path = require('path');
const sanitize = require('sanitize-filename');

const storageRoot = process.env.SUPPORT_ATTACHMENT_DIR ||
  path.join(process.cwd(), 'uploads', 'support-tickets');

function getAttachmentBuffer(attachment) {
  if (attachment.buffer) return Buffer.isBuffer(attachment.buffer) ? attachment.buffer : Buffer.from(attachment.buffer);

  const content = attachment.content_base64 || attachment.contentBytes || attachment.content;
  if (!content) return null;

  if (Buffer.isBuffer(content)) return content;

  const text = String(content);
  const base64 = text.includes('base64,') ? text.split('base64,').pop() : text;
  return Buffer.from(base64, 'base64');
}

async function saveAttachment(attachment, context) {
  const ticketPublicId = context.ticketPublicId || 'unassigned';
  const originalName = attachment.file_name || attachment.filename || attachment.name || 'attachment';
  const safeName = sanitize(originalName) || 'attachment';
  const buffer = getAttachmentBuffer(attachment);

  if (!buffer || buffer.length === 0) {
    return {
      file_name: safeName,
      content_type: attachment.content_type || attachment.contentType || 'application/octet-stream',
      size_bytes: Number(attachment.size_bytes || attachment.size || 0),
      storage_path: attachment.storage_path || attachment.path || '',
      checksum_sha256: attachment.checksum_sha256 || null,
      content_id: attachment.content_id || attachment.contentId || null,
      is_inline: Boolean(attachment.is_inline || attachment.isInline),
    };
  }

  const ticketDir = path.join(storageRoot, ticketPublicId);
  await fs.mkdir(ticketDir, { recursive: true });

  const storedName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`;
  const storedPath = path.join(ticketDir, storedName);
  await fs.writeFile(storedPath, buffer);

  return {
    file_name: safeName,
    content_type: attachment.content_type || attachment.contentType || 'application/octet-stream',
    size_bytes: Number(attachment.size_bytes || attachment.size || buffer.length),
    storage_path: path.relative(process.cwd(), storedPath).replace(/\\/g, '/'),
    checksum_sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    content_id: attachment.content_id || attachment.contentId || null,
    is_inline: Boolean(attachment.is_inline || attachment.isInline),
  };
}

module.exports = {
  saveAttachment,
};
