const db = require(__root + "db");
const express = require('express');
const multer = require('multer');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const router = express.Router();
const path = require('path');
const fs = require('fs');

let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../../logger'); } catch (e2) { logger = console; } }

const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const RULES = require(__root + 'rules/ruleCodes');
const { assertTenantId } = require(__root + 'utils/tenantScope');

require('dotenv').config();

const hasColumn = (table, column) => new Promise((resolve) => {
  db.query(
    "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column],
    (err, rows) => {
      if (err) return resolve(false);
      return resolve(Array.isArray(rows) && rows.length > 0);
    }
  );
});

router.use(requireAuth);

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const storage = multer.memoryStorage();
const isSupportedPhoto = (file) => {
  const type = String(file?.mimetype || '').toLowerCase();
  const name = String(file?.originalname || '').toLowerCase();
  return ['image/jpeg', 'image/jpg', 'image/png'].includes(type) || /\.(jpe?g|png)$/.test(name);
};
const upload = multer({ storage });

router.post('/upload', ruleEngine(RULES.UPLOAD_CREATE), requireRole(['Admin','Manager','Employee']), upload.single('file'), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { taskId, userId } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    if (!isSupportedPhoto(req.file)) return res.status(400).json({ error: 'Only JPG, JPEG, and PNG photos are supported' });
    if (!taskId || !userId) return res.status(400).json({ error: 'Task ID and User ID are required' });

    const hasTaskDeleted = await hasColumn('tasks', 'isDeleted');
    // Validate task exists and belongs to the active tenant
    const taskRows = await new Promise((resolve, reject) => {
      db.query(`SELECT id FROM tasks WHERE id = ? AND tenant_id = ? ${hasTaskDeleted ? 'AND (isDeleted IS NULL OR isDeleted != 1)' : ''} LIMIT 1`, [taskId, tenantId], (err, rows) => err ? reject(err) : resolve(rows));
    });
    if (!taskRows || taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found or does not belong to active tenant' });
    }

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
      const sql = `INSERT INTO files (file_url, file_name, file_type, file_size, task_id, user_id, uploaded_at, isActive, tenant_id) VALUES (?, ?, ?, ?, ?, ?, NOW(), 1, ?)`;
      const params = [storedPath, req.file.originalname, req.file.mimetype, req.file.size, taskId, resolvedUserId, tenantId];
      db.query(sql, params, (err, results) => {
        if (err) {
          logger.error('Database Error:', err);
          return res.status(500).json({ error: 'Failed to save file details to the database' });
        }
        return res.status(201).json({ message: 'File uploaded successfully', fileUrl, fileId: results.insertId });
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
  const tenantId = assertTenantId(req);
  const { id } = req.params;
  try {
    const hasTaskDeleted = await hasColumn('tasks', 'isDeleted');
    const taskRows = await new Promise((resolve, reject) => {
      db.query(`SELECT id FROM tasks WHERE id = ? AND tenant_id = ? ${hasTaskDeleted ? 'AND (isDeleted IS NULL OR isDeleted != 1)' : ''} LIMIT 1`, [id, tenantId], (err, rows) => err ? reject(err) : resolve(rows));
    });
    if (!taskRows || taskRows.length === 0) {
      return res.status(404).json({ error: 'Task not found or access denied' });
    }

    const baseQuery = `
      SELECT 
        f.id, f.file_url, f.file_name, f.file_type, f.file_size, f.uploaded_at, f.isActive, 
        t.id AS task_id, t.title AS task_name, 
        u._id AS user_id, u.name AS user_name
      FROM files f
      LEFT JOIN tasks t ON f.task_id = t.id
      LEFT JOIN users u ON f.user_id = u._id
      WHERE t.id = ? AND f.isActive = 1 AND f.tenant_id = ?
      ORDER BY f.uploaded_at DESC
    `;

    const filterUserParam = req.query.userId;

    const runQuery = (resolvedUserId) => {
      let sql = baseQuery;
      const params = [id, tenantId];
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
        if (!results || results.length === 0) return res.status(201).json({ message: 'Please upload a File', data: [] });

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

router.delete('/:fileId', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { fileId } = req.params;

    db.query('SELECT * FROM files WHERE id = ? AND tenant_id = ? AND isActive = 1 LIMIT 1', [fileId, tenantId], async (err, rows) => {
      if (err) {
        logger.error('Database Error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'File not found or access denied' });
      }
      const file = rows[0];

      const isOwner = String(file.user_id) === String(req.user._id);
      const isPrivileged = ['Admin', 'Manager'].includes(req.user.role);
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({ error: 'You do not have permission to delete this file' });
      }

      if (file.file_url && file.file_url.startsWith('/uploads/')) {
        const relPath = decodeURIComponent(file.file_url.replace(/^\/uploads\//, ''));
        const fullPath = path.join(process.cwd(), 'uploads', relPath);
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
        } catch (fsErr) {
          logger.warn(`Failed to delete local file from disk: ${fullPath} - ${fsErr.message}`);
        }
      }

      db.query('DELETE FROM files WHERE id = ? AND tenant_id = ?', [fileId, tenantId], (delErr) => {
        if (delErr) {
          logger.error('Database Error on file delete:', delErr);
          return res.status(500).json({ error: 'Failed to delete file from database' });
        }
        return res.status(200).json({ success: true, message: 'File deleted successfully' });
      });
    });
  } catch (error) {
    logger.error('Error deleting file:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.put('/:fileId/replace', requireRole(['Admin', 'Manager', 'Employee']), upload.single('file'), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { fileId } = req.params;

    if (!req.file) return res.status(400).json({ error: 'No replacement file uploaded' });

    db.query('SELECT * FROM files WHERE id = ? AND tenant_id = ? AND isActive = 1 LIMIT 1', [fileId, tenantId], async (err, rows) => {
      if (err) {
        logger.error('Database Error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!rows || rows.length === 0) {
        return res.status(404).json({ error: 'File not found or access denied' });
      }
      const existingFile = rows[0];

      const isOwner = String(existingFile.user_id) === String(req.user._id);
      const isPrivileged = ['Admin', 'Manager'].includes(req.user.role);
      if (!isOwner && !isPrivileged) {
        return res.status(403).json({ error: 'You do not have permission to replace this file' });
      }

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

      if (existingFile.file_url && existingFile.file_url.startsWith('/uploads/')) {
        const oldRel = decodeURIComponent(existingFile.file_url.replace(/^\/uploads\//, ''));
        const oldPath = path.join(process.cwd(), 'uploads', oldRel);
        try {
          if (fs.existsSync(oldPath)) {
            fs.unlinkSync(oldPath);
          }
        } catch (fsErr) {
          logger.warn(`Failed to delete old file: ${oldPath} - ${fsErr.message}`);
        }
      }

      const sql = `UPDATE files SET file_url = ?, file_name = ?, file_type = ?, file_size = ?, uploaded_at = NOW() WHERE id = ? AND tenant_id = ?`;
      const params = [storedPath, req.file.originalname, req.file.mimetype, req.file.size, fileId, tenantId];
      db.query(sql, params, (upErr) => {
        if (upErr) {
          logger.error('Database Error:', upErr);
          return res.status(500).json({ error: 'Failed to update file details in database' });
        }
        return res.status(200).json({ message: 'File replaced successfully', fileUrl });
      });
    });
  } catch (error) {
    logger.error('Error replacing file:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;



