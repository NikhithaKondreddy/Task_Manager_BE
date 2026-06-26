const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const upload = require(__root + 'multer');
const db = require(__root + 'db');
let logger; try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const { assertTenantId } = require(__root + 'utils/tenantScope');
const OccurrenceService = require(__root + 'services/occurrenceService');

router.use(requireAuth);

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { taskId } = req.params;
    const rows = await OccurrenceService.getOccurrencesForTask(taskId, tenantId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('GET occurrences error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.post('/tasks/:taskId', requireRole(['Admin','Manager','Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { taskId } = req.params;
    const date = req.body.date || new Date();
    const occ = await OccurrenceService.createOccurrence({ taskId: Number(taskId), occurrenceDate: date, tenantId, createdBy: req.user._id });
    return res.status(201).json({ success: true, data: occ });
  } catch (error) {
    logger.error('Create occurrence error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.post('/:occurrenceId/photo', requireRole(['Admin','Manager','Employee']), upload.single('file'), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { occurrenceId } = req.params;
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    // ensure directory
    const uploadsDir = path.join(process.cwd(), 'uploads', 'occurrences');
    try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}

    const safe = upload.safeFilename(req.file.originalname || 'upload');
    const dest = path.join(uploadsDir, safe);
    fs.writeFileSync(dest, req.file.buffer);
    const storedPath = '/uploads/occurrences/' + encodeURIComponent(safe);

    const updated = await OccurrenceService.attachPhotoToOccurrence(Number(occurrenceId), storedPath, req.file.originalname, req.file.mimetype, req.file.size, req.user._id, tenantId);
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    logger.error('Attach photo error:', error && error.stack ? error.stack : error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.post('/:occurrenceId/complete', requireRole(['Admin','Manager','Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { occurrenceId } = req.params;
    await OccurrenceService.markOccurrenceCompleted(Number(occurrenceId), req.user._id, tenantId);
    const out = await query('SELECT * FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
    return res.json({ success: true, data: out && out.length ? out[0] : null });
  } catch (error) {
    logger.error('Complete occurrence error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
