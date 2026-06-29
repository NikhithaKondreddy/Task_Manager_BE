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

const isSupportedPhoto = (file) => {
  const type = String(file?.mimetype || '').toLowerCase();
  const name = String(file?.originalname || '').toLowerCase();
  return ['image/jpeg', 'image/jpg', 'image/png'].includes(type) || /\.(jpe?g|png)$/.test(name);
};

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const internalTaskId = await OccurrenceService.resolveTaskInternalId(req.params.taskId, tenantId);
    if (!internalTaskId) return res.status(404).json({ success: false, error: 'Task not found' });
    const rows = await OccurrenceService.getOccurrencesForTask(internalTaskId, tenantId);
    return res.json({ success: true, data: rows });
  } catch (error) {
    logger.error('GET occurrences error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.post('/tasks/:taskId', requireRole(['Admin','Manager','Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const internalTaskId = await OccurrenceService.resolveTaskInternalId(req.params.taskId, tenantId);
    if (!internalTaskId) return res.status(404).json({ success: false, error: 'Task not found' });
    const date = req.body.date || new Date();
    const occ = await OccurrenceService.createOccurrence({ taskId: internalTaskId, occurrenceDate: date, tenantId, createdBy: req.user._id });
    return res.status(201).json({ success: true, data: occ });
  } catch (error) {
    logger.error('Create occurrence error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Single enriched occurrence - used for Manager review (task title, assignees, checklist, photos)
router.get('/:occurrenceId', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { occurrenceId } = req.params;
    const detail = await OccurrenceService.getOccurrenceDetail(Number(occurrenceId), tenantId);
    if (!detail) return res.status(404).json({ success: false, error: 'Occurrence not found' });
    return res.json({ success: true, data: detail });
  } catch (error) {
    logger.error('Get occurrence detail error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

router.put('/:occurrenceId/checklist', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { occurrenceId } = req.params;
    const checklist = Array.isArray(req.body.checklist) ? req.body.checklist : [];
    const updated = await OccurrenceService.updateOccurrenceChecklist(Number(occurrenceId), checklist, tenantId);
    return res.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Update occurrence checklist error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// Accepts multiple photos in one request (field name "files", up to 10).
router.post('/:occurrenceId/photo', requireRole(['Admin','Manager','Employee']), upload.array('files', 10), async (req, res) => {
  try {
    const tenantId = assertTenantId(req);
    const { occurrenceId } = req.params;
    if (!req.files || req.files.length === 0) return res.status(400).json({ success: false, error: 'No file uploaded' });
    if (req.files.some((file) => !isSupportedPhoto(file))) {
      return res.status(400).json({ success: false, error: 'Only JPG, JPEG, and PNG photos are supported' });
    }

    const uploadsDir = path.join(process.cwd(), 'uploads', 'occurrences');
    try { fs.mkdirSync(uploadsDir, { recursive: true }); } catch (e) {}

    const photos = req.files.map((file) => {
      const safe = upload.safeFilename(file.originalname || 'upload');
      const dest = path.join(uploadsDir, safe);
      fs.writeFileSync(dest, file.buffer);
      return {
        storedPath: '/uploads/occurrences/' + encodeURIComponent(safe),
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
      };
    });

    const updated = await OccurrenceService.attachPhotosToOccurrence(Number(occurrenceId), photos, req.user._id, tenantId);
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
    const { remarks, latitude, longitude, locationName } = req.body || {};

    const eligibility = await OccurrenceService.validateOccurrenceCompletion(Number(occurrenceId), { remarks });
    if (!eligibility.eligible) {
      return res.status(400).json({ success: false, error: eligibility.error });
    }

    await OccurrenceService.markOccurrenceCompleted(Number(occurrenceId), req.user._id, tenantId, { remarks, latitude, longitude, locationName });
    const out = await query('SELECT * FROM task_occurrences WHERE id = ? LIMIT 1', [occurrenceId]);
    return res.json({ success: true, data: out && out.length ? out[0] : null });
  } catch (error) {
    logger.error('Complete occurrence error:', error);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
