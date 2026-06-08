const db = require(__root + "db");
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { ALLOWED_ATTACHMENT_MIME_TYPES } = require(__root + 'modules/tickets/constants');

let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../../logger'); } catch (e2) { logger = console; } }

const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const RULES = require(__root + 'rules/ruleCodes');

require('dotenv').config();

router.use(requireAuth);

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const storage = multer.memoryStorage();
const upload = multer({ storage });
const uploadAttachment = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    return cb(null, true);
  },
});

function buildFileUrl(req, storedPath) {
  if (!storedPath) return null;
  if (storedPath.startsWith('http://') || storedPath.startsWith('https://')) return storedPath;
  if (storedPath.startsWith('s3://')) {
    const [, bucket, key] = storedPath.match(/^s3:\/\/([^/]+)\/(.+)$/) || [];
    if (bucket && key) {
      return `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    }
  }
  const base = req.protocol + '://' + req.get('host');
  return storedPath.startsWith('/uploads/') ? base + storedPath : base + '/' + storedPath.replace(/^\//, '');
}

router.post('/', ruleEngine(RULES.UPLOAD_CREATE), requireRole(['Admin','Manager','Employee']), uploadAttachment.single('file'), async (req, res) => {
  try {
    const ticketId = req.body?.ticketId || req.body?.ticket_id || req.body?.taskId || req.body?.task_id || null;
    if (!req.file) {
      const legacyFileUrl = req.body?.fileUrl || req.body?.file_url || null;
      if (!legacyFileUrl) {
        return res.status(201).json({
          message: 'Attachment accepted (compatibility mode)',
          data: {
            id: null,
            ticketId,
            originalName: req.body?.fileName || 'legacy-upload',
            mimeType: req.body?.mimeType || 'application/octet-stream',
            fileSize: Number(req.body?.fileSize || 0),
            downloadUrl: null,
          },
        });
      }
      return res.status(201).json({
        message: 'Attachment metadata accepted',
        data: {
          id: null,
          ticketId,
          originalName: req.body?.fileName || 'legacy-upload',
          mimeType: req.body?.mimeType || 'application/octet-stream',
          fileSize: Number(req.body?.fileSize || 0),
          downloadUrl: legacyFileUrl,
        },
      });
    }
    if (!ticketId) return res.status(400).json({ error: 'ticketId is required' });

    const uniqueName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._()-]/g, '_')}`;

    let storedPath = null;
    if (process.env.AWS_S3_BUCKET_NAME) {
      const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: uniqueName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };
      await s3.send(new PutObjectCommand(uploadParams));
      storedPath = `s3://${process.env.AWS_S3_BUCKET_NAME}/${uniqueName}`;
    } else {
      const uploadsDir = path.join(process.cwd(), 'uploads');
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
      const dest = path.join(uploadsDir, uniqueName);
      fs.writeFileSync(dest, req.file.buffer);
      storedPath = '/uploads/' + encodeURIComponent(uniqueName);
    }

    const sql = `
      INSERT INTO attachments
        (ticket_id, file_name, original_name, content_type, size_bytes, storage_path, mime_type, file_size, uploaded_by, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    const params = [
      ticketId,
      uniqueName,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      storedPath,
      req.file.mimetype,
      req.file.size,
      req.user ? req.user._id : null,
    ];

    db.query(sql, params, (err, result) => {
      if (err) {
        logger.error('Database Error:', err);
        return res.status(500).json({ error: 'Failed to save attachment metadata' });
      }
      return res.status(201).json({
        message: 'Attachment uploaded successfully',
        data: {
          id: result.insertId,
          ticketId,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSize: req.file.size,
          downloadUrl: buildFileUrl(req, storedPath),
        }
      });
    });
  } catch (error) {
    logger.error('Error in attachment upload:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/:id', ruleEngine(RULES.UPLOAD_VIEW), requireRole(['Admin','Manager','Employee']), async (req, res) => {
  try {
    const sql = 'SELECT * FROM attachments WHERE id = ? LIMIT 1';
    db.query(sql, [req.params.id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch attachment' });
      if (!results || results.length === 0) {
        return db.query('SELECT * FROM files WHERE id = ? LIMIT 1', [req.params.id], (legacyErr, legacyRows) => {
          if (legacyErr) {
            if (legacyErr.code === 'ER_NO_SUCH_TABLE') return res.status(404).json({ error: 'Attachment not found' });
            return res.status(500).json({ error: 'Failed to fetch attachment' });
          }
          if (!legacyRows || legacyRows.length === 0) return res.status(404).json({ error: 'Attachment not found' });
          const legacy = legacyRows[0];
          return res.json({
            success: true,
            data: {
              id: legacy.id,
              ticketId: legacy.task_id || null,
              fileName: legacy.file_name || null,
              mimeType: legacy.file_type || null,
              fileSize: legacy.file_size || null,
              uploadedAt: legacy.uploaded_at || null,
              downloadUrl: buildFileUrl(req, legacy.file_url)
            }
          });
        });
      }
      const row = results[0];
      return res.json({
        success: true,
        data: {
          id: row.id,
          ticketId: row.ticket_id,
          fileName: row.original_name || row.file_name,
          mimeType: row.mime_type || row.content_type,
          fileSize: row.file_size || row.size_bytes,
          uploadedAt: row.uploaded_at || row.created_at,
          downloadUrl: buildFileUrl(req, row.storage_path)
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/download/:id', ruleEngine(RULES.UPLOAD_VIEW), requireRole(['Admin','Manager','Employee']), async (req, res) => {
  try {
    const sql = 'SELECT storage_path FROM attachments WHERE id = ? LIMIT 1';
    db.query(sql, [req.params.id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch attachment' });
      if (!results || results.length === 0) {
        return db.query('SELECT file_url AS storage_path FROM files WHERE id = ? LIMIT 1', [req.params.id], (legacyErr, legacyRows) => {
          if (legacyErr) {
            if (legacyErr.code === 'ER_NO_SUCH_TABLE') return res.status(404).json({ error: 'Attachment not found' });
            return res.status(500).json({ error: 'Failed to fetch attachment' });
          }
          if (!legacyRows || legacyRows.length === 0) return res.status(404).json({ error: 'Attachment not found' });
          const url = buildFileUrl(req, legacyRows[0].storage_path);
          if (url) return res.redirect(url);
          return res.status(404).json({ error: 'File not found' });
        });
      }
      const storedPath = results[0].storage_path;
      if (storedPath && storedPath.startsWith('/uploads/')) {
        const filePath = path.join(process.cwd(), 'uploads', decodeURIComponent(storedPath.replace(/^\/uploads\//, '')));
        return res.sendFile(filePath, (sendErr) => {
          if (sendErr) return res.status(404).json({ error: 'File not found' });
        });
      }
      const url = buildFileUrl(req, storedPath);
      if (url) return res.redirect(url);
      return res.status(404).json({ error: 'File not found' });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.delete('/:id', ruleEngine(RULES.UPLOAD_DELETE), requireRole(['Admin','Manager','Employee']), async (req, res) => {
  try {
    const sql = 'SELECT storage_path FROM attachments WHERE id = ? LIMIT 1';
    db.query(sql, [req.params.id], (err, results) => {
      if (err) return res.status(500).json({ error: 'Failed to fetch attachment' });
      if (!results || results.length === 0) {
        return db.query('DELETE FROM files WHERE id = ?', [req.params.id], (legacyDeleteErr) => {
          if (legacyDeleteErr && legacyDeleteErr.code !== 'ER_NO_SUCH_TABLE') {
            return res.status(500).json({ error: 'Failed to delete attachment' });
          }
          return res.json({ success: true, message: 'Attachment deleted' });
        });
      }
      const storedPath = results[0].storage_path;

      db.query('DELETE FROM attachments WHERE id = ?', [req.params.id], (deleteErr) => {
        if (deleteErr) return res.status(500).json({ error: 'Failed to delete attachment' });

        if (storedPath && storedPath.startsWith('/uploads/')) {
          const filePath = path.join(process.cwd(), 'uploads', decodeURIComponent(storedPath.replace(/^\/uploads\//, '')));
          try { fs.unlinkSync(filePath); } catch (e) {}
        }
        return res.json({ success: true, message: 'Attachment deleted' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.post('/upload', ruleEngine(RULES.UPLOAD_CREATE), requireRole(['Admin','Manager','Employee']), upload.single('file'), async (req, res) => {
  try {
    const { taskId, userId } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!taskId || !userId) return res.status(400).json({ error: 'Task ID and User ID are required' });

    const uniqueName = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._()-]/g, '_')}`;

    let fileUrl = null;
    let storedPath = null;

    if (process.env.AWS_S3_BUCKET_NAME) {
      const uploadParams = {
        Bucket: process.env.AWS_S3_BUCKET_NAME,
        Key: uniqueName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      };
      await s3.send(new PutObjectCommand(uploadParams));
      fileUrl = `https://${process.env.AWS_S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${uniqueName}`;
      storedPath = `s3://${process.env.AWS_S3_BUCKET_NAME}/${uniqueName}`;
    } else {

      const uploadsDir = path.join(process.cwd(), 'uploads');
      try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}
      const dest = path.join(uploadsDir, uniqueName);
      fs.writeFileSync(dest, req.file.buffer);
      storedPath = '/uploads/' + encodeURIComponent(uniqueName);
      fileUrl = `${req.protocol}://${req.get('host')}${storedPath}`;
    }

    const doInsert = (resolvedUserId) => {
      const sql = `INSERT INTO files (file_url, file_name, file_type, file_size, task_id, user_id, uploaded_at, isActive) VALUES (?, ?, ?, ?, ?, ?, NOW(), 1)`;
      const params = [storedPath, req.file.originalname, req.file.mimetype, req.file.size, taskId, resolvedUserId];
      db.query(sql, params, (err) => {
        if (err) {
          logger.error('Database Error:', err);
          return res.status(500).json({ error: 'Failed to save file details to the database' });
        }
        return res.status(201).json({ message: 'File uploaded successfully', fileUrl });
      });
    };

    if (!/^\d+$/.test(String(userId))) {

      db.query('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [userId], (uErr, uRows) => {
        if (uErr) {
          logger.error('User lookup error:', uErr);
          return res.status(500).json({ error: 'Failed to resolve userId' });
        }
        if (!uRows || uRows.length === 0) return res.status(400).json({ error: 'Invalid userId' });
        doInsert(uRows[0]._id);
      });
    } else {
      doInsert(userId);
    }
  } catch (error) {
    logger.error('Error in file upload process:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/getuploads/:id', ruleEngine(RULES.UPLOAD_VIEW), requireRole(['Admin','Manager','Employee']), async (req, res) => {
  const { id } = req.params;
  try {
    const baseQuery = `
      SELECT 
        f.id, f.file_url, f.file_name, f.file_type, f.file_size, f.uploaded_at, f.isActive, 
        t.id AS task_id, t.title AS task_name, 
        u._id AS user_id, u.name AS user_name
      FROM files f
      LEFT JOIN tasks t ON f.task_id = t.id
      LEFT JOIN users u ON f.user_id = u._id
      WHERE t.id = ?
      ORDER BY f.uploaded_at DESC
    `;

    const filterUserParam = req.query.userId;

    const runQuery = (resolvedUserId) => {
      let sql = baseQuery;
      const params = [id];
      if (resolvedUserId) {
        sql = sql.replace(/ORDER BY[\s\S]*$/m, '');
        sql += ' AND f.user_id = ? ORDER BY f.uploaded_at DESC';
        params.push(resolvedUserId);
      }
      db.query(sql, params, (err, results) => {
        if (err) {
          logger.error('Database Error:', err);
          return res.status(500).json({ error: 'Failed to fetch the file upload from database' });
        }
        if (!results || results.length === 0) return res.status(201).json({ message: 'Please upload a File' });

        try {
          const userIds = Array.from(new Set(results.map(r => r.user_id).filter(Boolean)));
          if (userIds.length === 0) return res.status(200).json({ message: 'File upload fetched successfully', data: results });
          db.query('SELECT _id, public_id FROM users WHERE _id IN (?)', [userIds], (uErr, uRows) => {
            if (uErr || !Array.isArray(uRows)) return res.status(200).json({ message: 'File upload fetched successfully', data: results });
            const map = {};
            uRows.forEach(u => { map[u._id] = u.public_id || u._id; });
            const base = req.protocol + '://' + req.get('host');
            const out = results.map(r => {
              const rec = { ...r, user_id: map[r.user_id] || r.user_id };
              try {
                if (rec.file_url && String(rec.file_url).startsWith('/uploads/')) {
                  const rel = String(rec.file_url).replace(/^\/uploads\//, '');
                  const parts = rel.split('/').map(p => encodeURIComponent(p));
                  rec.file_url = base + '/uploads/' + parts.join('/');
                }
              } catch (e) {}
              return rec;
            });
            return res.status(200).json({ message: 'File upload fetched successfully', data: out });
          });
        } catch (e) {
          return res.status(200).json({ message: 'File upload fetched successfully', data: results });
        }
      });
    };

    if (filterUserParam) {
      const isNumeric = /^\d+$/.test(String(filterUserParam));
      if (isNumeric) { runQuery(filterUserParam); return; }
      db.query('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [filterUserParam], (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error resolving userId' });
        if (!rows || rows.length === 0) return res.status(404).json({ message: 'User not found for provided userId' });
        runQuery(rows[0]._id);
      });
      return;
    }

    runQuery(null);
  } catch (error) {
    logger.error('Error fetching file upload:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;



