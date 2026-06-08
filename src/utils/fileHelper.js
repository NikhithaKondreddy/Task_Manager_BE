const path = require('path');
const sanitize = require('sanitize-filename');

function safeFilename(originalName) {
  if (!originalName) return `${Date.now()}`;
  const ext = path.extname(originalName) || '';
  const base = path.basename(originalName, ext);
  const clean = sanitize(base).replace(/\s+/g, '_').replace(/[^a-zA-Z0-9-_\.]/g, '');
  return `${clean}_${Date.now()}${ext}`;
}

module.exports = { safeFilename };
