const multer = require("multer");
const path = require("path");
const fs = require("fs");
const fsp = require("fs").promises;
const env = require('./src/config/env');
const { safeFilename } = require('./src/utils/fileHelper');

const ensureUploadsDir = async () => {
  const dir = path.join(process.cwd(), "uploads/profiles");
  try {
    await fsp.access(dir); // FIXED: use fs.promises
  } catch {
    await fsp.mkdir(dir, { recursive: true }); // FIXED
  }
};


const storage = multer.memoryStorage();

// Set max upload size to 50MB
const MAX_SIZE = 50 * 1024 * 1024;

const allowedMimes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/rtf',
  'application/json',
  'application/xml', 'text/xml'
]);

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    const ok = allowedMimes.has(file.mimetype) || file.mimetype.startsWith('image/');
    if (!ok) return cb(new Error('File type not allowed'), false);
    return cb(null, true);
  },
});

upload.ensureUploadsDir = ensureUploadsDir;

upload.safeFilename = safeFilename;

module.exports = upload;
