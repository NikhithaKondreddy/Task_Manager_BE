const db = require(__root + 'db');
const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { gatherManagerProjects } = require('./managerController');
const errorResponse = require(__root + 'utils/errorResponse');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mime = require('mime-types');
const NotificationService = require('../services/notificationService');
let env;
try { env = require(__root + 'config/env'); } catch (e) { env = require('../config/env'); }

const uploadsRoot = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });
// Use the shared Multer config (memoryStorage, 50MB limit)
const upload = require('../../multer');
const { authorize } = require(__root + 'middleware/authorize');
const { loadSettings, saveSettings } = require(__root + 'services/settingsService');
const { assertTenantId } = require(__root + 'utils/tenantScope');

function saveBase64ToUploads(base64data, filename) {
  try {
    if (!base64data || !filename) return null;
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    let targetName = filename;
    const targetPath = () => path.join(uploadsDir, targetName);
    if (fs.existsSync(targetPath())) {
      const ts = Date.now();
      const ext = path.extname(filename);
      const base = path.basename(filename, ext);
      targetName = `${base}_${ts}${ext}`;
    }
    const matched = base64data.match(/^data:(.*);base64,(.*)$/);
    const b64 = matched ? matched[2] : base64data;
    const buffer = Buffer.from(b64, 'base64');
    fs.writeFileSync(targetPath(), buffer);
    return `${env.BASE_URL || env.FRONTEND_URL}/uploads/${encodeURIComponent(targetName)}`;
  } catch (e) {
    logger.debug('Failed to save base64 file: ' + (e && e.message));
    return null;
  }
}
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const RULES = require(__root + 'rules/ruleCodes');

const emailService = require(__root + 'utils/emailService');
require('dotenv').config();

router.use(requireAuth);
const clientViewer = require(__root + 'middleware/clientViewer');

router.use(clientViewer);

function guessMimeType(filename) {
  if (!filename) return null;

  const m = mime.lookup(filename);
  if (m) return m;
  const ext = (path.extname(filename) || '').toLowerCase().replace('.', '');
  const map = {
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    txt: 'text/plain',
    csv: 'text/csv',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    zip: 'application/zip',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return map[ext] || null;
}

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function isEmptyValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === 'number') return value === 0;
  const str = String(value).trim();
  return str === '' || str === '0';
}

async function resolveUserId(value) {
  if (isEmptyValue(value)) return null;
  const raw = String(value).trim();
  const tenantId = arguments.length > 1 ? arguments[1] : null;
  if (/^\d+$/.test(raw)) {
    const rows = tenantId !== null
      ? await q('SELECT _id FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1', [Number(raw), tenantId]).catch(() => [])
      : await q('SELECT _id FROM users WHERE _id = ? LIMIT 1', [Number(raw)]).catch(() => []);
    return Array.isArray(rows) && rows.length ? rows[0]._id : null;
  }
  const rows = tenantId !== null
    ? await q('SELECT _id FROM users WHERE public_id = ? AND tenant_id = ? LIMIT 1', [raw, tenantId]).catch(() => [])
    : await q('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [raw]).catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0]._id : null;
}

const columnCache = {};
async function hasColumn(table, column) {
  const key = `${table}::${column}`;
  if (columnCache[key] !== undefined) return columnCache[key];
  try {
    const rows = await q("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column]);
    const ok = Array.isArray(rows) && rows.length > 0;
    columnCache[key] = ok;
    return ok;
  } catch (e) {
    columnCache[key] = false;
    return false;
  }
}

async function tableExists(tableName) {
  const rows = await q("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [tableName]);
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureClientTables() {
  try {
    // client_contacts: include tenant_id; alter existing table to add tenant_id if missing
    if (!await tableExists('client_contacts')) {
      await q("CREATE TABLE IF NOT EXISTS client_contacts (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT DEFAULT NULL, client_id INT NOT NULL, name VARCHAR(255) NOT NULL, email VARCHAR(255), phone VARCHAR(50), designation VARCHAR(255), is_primary TINYINT(1) DEFAULT 0, created_at DATETIME DEFAULT NOW()) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } else {
      if (!await hasColumn('client_contacts', 'tenant_id')) {
        await q('ALTER TABLE client_contacts ADD COLUMN tenant_id INT DEFAULT NULL');
      }
    }

    // client_activity_logs: include tenant_id; alter if missing
    if (!await tableExists('client_activity_logs')) {
      await q("CREATE TABLE IF NOT EXISTS client_activity_logs (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT DEFAULT NULL, client_id INT NOT NULL, actor_id INT, action VARCHAR(255), details TEXT, created_at DATETIME DEFAULT NOW()) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } else {
      if (!await hasColumn('client_activity_logs', 'tenant_id')) {
        await q('ALTER TABLE client_activity_logs ADD COLUMN tenant_id INT DEFAULT NULL');
      }
    }

    // client_viewers: include tenant_id; alter if missing
    if (!await tableExists('client_viewers')) {
      await q("CREATE TABLE IF NOT EXISTS client_viewers (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT DEFAULT NULL, client_id INT NOT NULL, user_id INT NOT NULL, created_at DATETIME DEFAULT NOW(), UNIQUE KEY uniq_client_user (client_id, user_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    } else {
      if (!await hasColumn('client_viewers', 'tenant_id')) {
        await q('ALTER TABLE client_viewers ADD COLUMN tenant_id INT DEFAULT NULL');
      }
    }
  } catch (e) {
    logger.warn('Failed to ensure client supporting tables: ' + e.message);
  }
}

function resolveTenantId(req) {
  return assertTenantId(req);
}

async function resolveClientForTenant(idOrRef, tenantId, includeArchived = false) {
  const hasPublicId = await hasColumn('clients', 'public_id');
  const hasDeleted = await hasColumn('clients', 'isDeleted');
  const conditions = [];
  const params = [tenantId];

  if (/^\d+$/.test(String(idOrRef))) {
    conditions.push('id = ?');
    params.push(Number(idOrRef));
  }

  if (hasPublicId) {
    conditions.push('public_id = ?');
    params.push(String(idOrRef));
  }

  conditions.push('ref = ?');
  params.push(String(idOrRef));

  let sql = `SELECT * FROM clients WHERE tenant_id = ? AND (${conditions.join(' OR ')})`;
  if (hasDeleted && !includeArchived) sql += ' AND COALESCE(isDeleted, 0) != 1';
  sql += ' LIMIT 1';

  const rows = await q(sql, params).catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

router.post('/', upload.array('documents', 10), ruleEngine(RULES.CLIENT_CREATE), requireRole('Admin'), authorize('clients', 'create'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    await ensureClientTables();
    const {
      name, company, billingAddress, officeAddress, gstNumber, taxId, industry,
      notes, status = 'Active', managerId, manager_id: managerIdSnake, managerPublicId, manager_public_id, contacts = [], enableClientPortal = false,
      createViewer = false, email, phone, district, pincode, state, documents = []
    } = req.body;

    const inputs = [managerId, managerIdSnake, managerPublicId, manager_public_id];
    const managerInput = inputs.find(v => !isEmptyValue(v)) || null;
    let resolvedManagerId = null;
    if (!isEmptyValue(managerInput)) {
      resolvedManagerId = await resolveUserId(managerInput, tenantId);
      if (resolvedManagerId === null) {
        return res.status(404).json(errorResponse.notFound('Manager not found', 'NOT_FOUND'));
      }
    }

    if (!name || !company) {
      return res.status(400).json(errorResponse.badRequest('name and company required', 'BAD_REQUEST'));
    }

    const hasIsDeleted = await hasColumn('clients', 'isDeleted');
    const dupSql = hasIsDeleted
      ? 'SELECT id FROM clients WHERE tenant_id = ? AND name = ? AND isDeleted != 1 LIMIT 1'
      : 'SELECT id FROM clients WHERE tenant_id = ? AND name = ? LIMIT 1';
    const dup = await q(dupSql, [tenantId, name]);
    if (Array.isArray(dup) && dup.length > 0) {
      return res.status(409).json(errorResponse.conflict('Client with that name already exists', 'CONFLICT'));
    }

    const compInit = (company || '').substring(0, 3).toUpperCase() || name.substring(0, 3).toUpperCase();
    const last = await q('SELECT ref FROM clients WHERE tenant_id = ? AND ref LIKE ? ORDER BY ref DESC LIMIT 1', [tenantId, `${compInit}%`]);
    let seq = '0001';
    if (Array.isArray(last) && last.length > 0) {
      const lastn = parseInt(last[0].ref.slice(-4) || '0', 10) || 0;
      seq = (lastn + 1).toString().padStart(4, '0');
    }
    const ref = `${compInit}${seq}`;

    const fullInsertSql = `
      INSERT INTO clients (tenant_id, ref, name, company, billing_address, office_address, gst_number,
      tax_id, industry, notes, status, manager_id, email, phone, created_at, isDeleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), 0)
    `;
    const fullParams = [
      tenantId, ref, name, company, billingAddress || null, officeAddress || null,
      gstNumber || null, taxId || null, industry || null, notes || null,
      status, resolvedManagerId, email || null, phone || null
    ];

    let clientId;
    try {
      const result = await q(fullInsertSql, fullParams);
      clientId = result.insertId;
    } catch (e) {
      if (e && e.code === 'ER_BAD_FIELD_ERROR') {
        const fallback = await q('INSERT INTO clients (tenant_id, ref, name, company) VALUES (?, ?, ?, ?)', [tenantId, ref, name, company]);
        clientId = fallback.insertId;
        logger.debug('Full client insert failed; used minimal fallback insert.');
        try {
          await q(`
            UPDATE clients SET billing_address = ?, office_address = ?, gst_number = ?,
            tax_id = ?, industry = ?, notes = ?, manager_id = ?, email = ?, phone = ?
            WHERE id = ?
          `, [billingAddress || null, officeAddress || null, gstNumber || null, taxId || null,
          industry || null, notes || null, resolvedManagerId, email || null, phone || null, clientId]);
        } catch (u) { }
      } else {
        throw e;
      }
    }

    if (Array.isArray(contacts) && contacts.length > 0) {
      for (const c of contacts) {
        await q(`
          INSERT INTO client_contacts (tenant_id, client_id, name, email, phone, designation, is_primary, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        `, [tenantId, clientId, c.name, c.email || null, c.phone || null, c.designation || null, c.is_primary ? 1 : 0]);
      }
    }

    if (Array.isArray(contacts) && contacts.length > 0) {
      const bcrypt = require('bcryptjs');
      for (const c of contacts) {
        try {
          if (!c || !c.email) continue;
          const emailAddr = String(c.email).trim();

          const exists = await q('SELECT _id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1', [emailAddr, tenantId]).catch(() => []);
          if (Array.isArray(exists) && exists.length > 0) {
            const existingId = exists[0]._id;

            try { await q('INSERT IGNORE INTO client_viewers (tenant_id, client_id, user_id, created_at) VALUES (?, ?, ?, NOW())', [tenantId, clientId, existingId]); } catch (e) { }
            continue;
          }

          const tempPassword = crypto.randomBytes(6).toString('hex');
          const hashed = await bcrypt.hash(tempPassword, 10);
          const publicId = crypto.randomBytes(8).toString('hex');
          const displayName = c.name || `${company} Contact`;

          const insertSql = `INSERT INTO users (tenant_id, public_id, name, email, password, role, title, isActive, is_active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`;
          const r = await q(insertSql, [tenantId, publicId, displayName, emailAddr, hashed, 'Client-Viewer', 'Client Viewer', 1]);
          const newUserId = r && r.insertId ? r.insertId : null;
          if (newUserId) {
            try { await q('INSERT INTO client_viewers (tenant_id, client_id, user_id, created_at) VALUES (?, ?, ?, NOW())', [tenantId, clientId, newUserId]); } catch (e) { }

            try {
              if (await hasColumn('clients', 'user_id')) {

                if (c.is_primary) {
                  await q('UPDATE clients SET user_id = ? WHERE id = ?', [newUserId, clientId]).catch(() => { });
                } else {
                  await q('UPDATE clients SET user_id = COALESCE(user_id, ?) WHERE id = ?', [newUserId, clientId]).catch(() => { });
                }
              }
            } catch (e) {
              logger.debug('Failed updating clients.user_id: ' + (e && e.message));
            }

            try {
              const setupLink = `${env.FRONTEND_URL || env.BASE_URL}/auth/setup?uid=${publicId}`;
              const tpl = emailService.welcomeTemplate({ name: displayName, email: emailAddr, role: 'Client-Viewer', title: 'Client Portal Access', tempPassword, createdBy: 'System Admin', createdAt: new Date(), setupLink, userId: emailAddr });
              await emailService.sendEmail({ to: emailAddr, subject: tpl.subject, text: tpl.text, html: tpl.html });
            } catch (e) {
              logger.warn('Failed sending credentials to contact ' + emailAddr + ': ' + (e && e.message));
            }
          }
        } catch (e) {
          logger.debug('Failed creating user for contact: ' + (e && e.message));
        }
      }
    }

    try {
      const optionalCols = [];
      const optionalParams = [];
      if (district && await hasColumn('clients', 'district')) {
        optionalCols.push('district = ?'); optionalParams.push(district);
      }
      if (pincode && await hasColumn('clients', 'pincode')) {
        optionalCols.push('pincode = ?'); optionalParams.push(pincode);
      }
      if (state && await hasColumn('clients', 'state')) {
        optionalCols.push('state = ?'); optionalParams.push(state);
      }
      if (optionalCols.length > 0) {
        optionalParams.push(clientId);
        await q(`UPDATE clients SET ${optionalCols.join(', ')} WHERE id = ?`, optionalParams);
      }
    } catch (e) {
      logger.debug('Optional client fields update skipped: ' + e.message);
    }

    const attachedDocuments = [];
    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const storedPath = '/uploads/' + encodeURIComponent(file.filename);
          const fileType = mime.lookup(file.originalname) || file.mimetype || null;
          const documentId = crypto.randomBytes(12).toString('hex');
          const r = await q(`
            INSERT INTO documents (documentId, entityType, entityId, uploadedBy, storageProvider, filePath, encrypted, createdAt, updatedAt, fileName, mimeType, clientId, tenant_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)
          `, [documentId, 'CLIENT', clientId, req.user._id, 'local', storedPath, 0, file.originalname, fileType, clientId, tenantId]);
          attachedDocuments.push({ id: documentId, file_url: storedPath, file_name: file.originalname, file_type: fileType });
        } catch (e) {
          logger.debug('Failed to attach document for client ' + clientId + ': ' + (e && e.message));
        }
      }
    }

    if (Array.isArray(documents) && documents.length > 0) {
      for (const d of documents) {
        if (!d) continue;
        const fileName = d.file_name || d.fileName || null;
        if (!fileName) continue;
        const fileUrlCandidate = d.file_url || d.fileUrl || null;

        let storedPath = null;

        try {

          if (fileUrlCandidate && typeof fileUrlCandidate === 'string' && fileUrlCandidate.startsWith('/uploads/')) {
            storedPath = fileUrlCandidate;
          }

          else if (fileUrlCandidate && typeof fileUrlCandidate === 'string' && fileUrlCandidate.startsWith('data:')) {

            const safeName = fileName.replace(/[^a-zA-Z0-9._()-]/g, '_');
            const savedUrl = saveBase64ToUploads(fileUrlCandidate, safeName);
            if (savedUrl) {
              const parsed = savedUrl.replace(/^(?:https?:\/\/[^\/]+)?/, '');
              storedPath = parsed.startsWith('/') ? parsed : '/' + parsed;
            }
          }

          else if (fileUrlCandidate && typeof fileUrlCandidate === 'string' && (fileUrlCandidate.startsWith('blob:') || /^https?:\/\//i.test(fileUrlCandidate))) {
            logger.debug('Skipping external/blob document reference for client ' + clientId + ': ' + String(fileUrlCandidate).slice(0, 200));
            storedPath = null;
          }

          else {
            const uploadsDir = path.join(__dirname, '..', 'uploads');
            const candidate = path.join(uploadsDir, fileName);
            if (fs.existsSync(candidate)) storedPath = '/uploads/' + encodeURIComponent(fileName);
          }

          if (!storedPath) continue; // nothing saved for this entry; skip inserting a DB row

          const fileType = d.file_type || d.fileType || mime.lookup(fileName) || null;
          const documentId = crypto.randomBytes(12).toString('hex');
          const r = await q(`
            INSERT INTO documents (documentId, entityType, entityId, uploadedBy, storageProvider, filePath, encrypted, createdAt, updatedAt, fileName, mimeType, clientId, tenant_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)
          `, [documentId, 'CLIENT', clientId, d.uploaded_by || d.uploadedBy || req.user._id, 'local', storedPath, 0, fileName, fileType, clientId, tenantId]);
          attachedDocuments.push({ id: documentId, file_url: storedPath, file_name: fileName, file_type: fileType });
        } catch (e) {
          logger.debug('Failed to attach document for client ' + clientId + ': ' + (e && e.message));
        }
      }
    }

    let primaryContactEmail = null;
    let primaryContactName = null;
    if (Array.isArray(contacts) && contacts.length > 0) {
      for (const c of contacts) {
        if (c && c.is_primary && c.email) {
          primaryContactEmail = c.email;
          primaryContactName = c.name || null;
          break;
        }
      }
    }
    if (!primaryContactEmail && email) primaryContactEmail = email;

    let viewerInfo = null;

    if ((createViewer || enableClientPortal) && (primaryContactEmail || email)) {
      const userEmail = primaryContactEmail || email;
      logger.info('Creating user for client', clientId, 'email:', userEmail);

      const tempPassword = crypto.randomBytes(6).toString('hex');
      const publicId = crypto.randomBytes(8).toString('hex');

      try {
        const bcrypt = require('bcryptjs');
        const hashed = await new Promise((resolve, reject) => {
          bcrypt.hash(tempPassword, 10, (err, hash) => (err ? reject(err) : resolve(hash)));
        });

        const roleToInsert = enableClientPortal ? 'Client-Viewer' : 'Client-Viewer';
        const displayName = enableClientPortal ? (primaryContactName || name) : `${name} (Viewer)`;

        const insertUserSql = `
      INSERT INTO users (tenant_id, public_id, name, email, password, role, title, isActive, is_active, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())
    `;
        const userRes = await q(insertUserSql, [tenantId, publicId, displayName, userEmail, hashed, roleToInsert, 'Client Viewer', 1]);
        const newUserId = userRes.insertId;

        try {
          await q('INSERT INTO client_viewers (tenant_id, client_id, user_id, created_at) VALUES (?, ?, ?, NOW())', [tenantId, clientId, newUserId]);
        } catch (e) {

        }

        try {
          if (await hasColumn('clients', 'user_id')) {
            await q('UPDATE clients SET user_id = ? WHERE id = ?', [newUserId, clientId]).catch(() => { });
          }
        } catch (e) {
          logger.debug('Failed to set clients.user_id for portal user: ' + (e && e.message));
        }

        const setupLink = `${env.FRONTEND_URL || env.BASE_URL}/auth/setup?uid=${publicId}`;
        const userTemplate = emailService.welcomeTemplate({
          name: displayName,
          email: userEmail,
          role: roleToInsert,
          title: enableClientPortal ? `Client - ${company}` : 'Client Portal Access',
          tempPassword,
          createdBy: 'System Admin',
          createdAt: new Date(),
          setupLink,
          userId: userEmail
        });

        await emailService.sendEmail({ to: userEmail, subject: userTemplate.subject, text: userTemplate.text, html: userTemplate.html });

        viewerInfo = { publicId, userId: newUserId, role: roleToInsert };
        logger.info('✅ Client/user credentials sent:', publicId);
      } catch (e) {
        logger.error('User creation failed:', e && e.message);
      }
    }

    let clientCredentials = null;
    if (primaryContactEmail || email) {
      const clientEmail = primaryContactEmail || email;
      const clientPortalLink = `${env.FRONTEND_URL || env.BASE_URL}/client-portal/${ref}`;

      try {
        const existing = await q('SELECT _id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1', [clientEmail, tenantId]).catch(() => []);
        if (!existing || existing.length === 0) {
          const bcrypt = require('bcryptjs');
          const clientTempPassword = crypto.randomBytes(6).toString('hex');
          const hashed = await new Promise((resolve, reject) => bcrypt.hash(clientTempPassword, 10, (err, hash) => (err ? reject(err) : resolve(hash))));
          const publicIdForClient = crypto.randomBytes(8).toString('hex');
          const displayNameForClient = primaryContactName || name || `Client ${ref}`;

          const ins = await q(`INSERT INTO users (tenant_id, public_id, name, email, password, role, title, isActive, is_active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`, [tenantId, publicIdForClient, displayNameForClient, clientEmail, hashed, 'Client-Viewer', 'Client Viewer', 1]).catch((e) => { throw e; });
          const newUid = ins && ins.insertId ? ins.insertId : null;
          if (newUid) {

            try { await q('INSERT INTO client_viewers (tenant_id, client_id, user_id, created_at) VALUES (?, ?, ?, NOW())', [tenantId, clientId, newUid]).catch(() => { }); } catch (e) { }
            try { if (await hasColumn('clients', 'user_id')) await q('UPDATE clients SET user_id = ? WHERE id = ?', [newUid, clientId]).catch(() => { }); } catch (e) { logger.debug('Failed setting clients.user_id for client email user: ' + (e && e.message)); }
            clientCredentials = { email: clientEmail, tempPassword: clientTempPassword, publicId: publicIdForClient, userId: newUid };
          }
        }
      } catch (e) {
        logger.debug('Failed ensuring client user exists: ' + (e && e.message));
      }

      const clientTempPasswordToUse = clientCredentials ? clientCredentials.tempPassword : null;
      const clientTemplate = emailService.welcomeTemplate({
        name: primaryContactName || name,
        email: clientEmail,
        role: 'Client',
        title: `Client - ${company}`,
        tempPassword: clientTempPasswordToUse,
        createdBy: 'System Admin',
        createdAt: new Date(),
        setupLink: clientPortalLink,
        userId: clientEmail
      });

      try {
        await emailService.sendEmail({ to: clientEmail, subject: clientTemplate.subject, text: clientTemplate.text, html: clientTemplate.html });
        logger.info('✅ Client welcome sent:', clientEmail);
      } catch (e) {
        logger.warn('Client welcome failed:', e.message);
      }
    }

    await q(`
      INSERT INTO client_activity_logs (tenant_id, client_id, actor_id, action, details, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `, [tenantId, clientId, req.user && req.user._id ? req.user._id : null, 'create',
      JSON.stringify({ createdBy: req.user ? req.user.id : null })]);

    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id,
        tenant_id: tenantId,
        action: 'CREATE_CLIENT',
        entity: 'Client',
        entity_id: String(clientId),
        details: { name, company, ref, managerId: resolvedManagerId }
      });
    } catch (auditErr) {
      logger.warn('Failed to log create_client audit:', auditErr.message);
    }

    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin'], 'Client Added', `New client "${name}" has been added`, 'CLIENT_ADDED', 'client', clientId, tenantId);
      } catch (notifErr) {
        logger.error('Client creation notification error:', notifErr);
      }
    })();

    let managerName = null;
    let managerPublicIdStr = null;
    if (resolvedManagerId) {
      try {
        const mgrRows = await q('SELECT name, public_id FROM users WHERE _id = ? AND tenant_id = ? LIMIT 1', [resolvedManagerId, tenantId]);
        if (mgrRows && mgrRows.length) {
          managerName = mgrRows[0].name;
          managerPublicIdStr = mgrRows[0].public_id;
        }
      } catch (e) { }
    }

    return res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: {
        id: clientId,
        ref,
        name,
        company,
        email: primaryContactEmail || email || null,
        phone,
        status,
        manager_id: resolvedManagerId,
        managerId: resolvedManagerId,
        manager_name: managerName,
        manager_public_id: managerPublicIdStr,
        documentsCount: attachedDocuments.length,
        contactsCount: (Array.isArray(contacts) ? contacts.length : 0),
        viewerInfo: viewerInfo || null,
        clientCredentials: clientCredentials ? { email: clientCredentials.email, publicId: clientCredentials.publicId } : null
      }
    });

  } catch (e) {
    logger.error('Error creating client: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/', ruleEngine(RULES.CLIENT_VIEW), requireRole(['Admin', 'Manager', 'Client-Viewer']), authorize('clients', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const page = parseInt(req.query.page || '1', 10); const perPage = Math.min(parseInt(req.query.perPage || '25', 10), 200);
    const search = req.query.search || null; const status = req.query.status || null; const includeDeleted = req.query.includeDeleted === '1' || req.query.includeDeleted === 'true';
    let where = ['clients.tenant_id = ?']; let params = [tenantId];

    if (req.user && req.user.role === 'Client-Viewer') {
      if (!req.viewerClientId) return res.status(403).json(errorResponse.forbidden('Viewer not mapped to a client', 'FORBIDDEN'));
      const viewerClient = await resolveClientForTenant(req.viewerClientId, tenantId, true);
      if (!viewerClient) return res.status(403).json(errorResponse.forbidden('Viewer not mapped to this tenant', 'FORBIDDEN'));
      where.push('clients.id = ?'); params.push(viewerClient.id);
    }
    const hasIsDeletedList = await hasColumn('clients', 'isDeleted');
    const hasStatus = await hasColumn('clients', 'status');
    const hasManager = await hasColumn('clients', 'manager_id');
    const hasCreatedAt = await hasColumn('clients', 'created_at');

    if (!includeDeleted && hasIsDeletedList) { where.push('isDeleted != 1'); }
    if (status && hasStatus) { where.push('status = ?'); params.push(status); }
    if (search) { where.push('(name LIKE ? OR company LIKE ? OR ref LIKE ?)'); params.push('%' + search + '%', '%' + search + '%', '%' + search + '%'); }

    const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';
    const countSql = `SELECT COUNT(*) as c FROM clients ${whereSql}`;
    const total = (await q(countSql, params))[0].c || 0;
    const offset = (page - 1) * perPage;

    const selectCols = ['clients.id', 'clients.ref', 'clients.name', 'clients.company'];
    if (hasStatus) selectCols.push('clients.status');
    if (hasManager) {
      selectCols.push('clients.manager_id');

      selectCols.push(`(SELECT public_id FROM users WHERE tenant_id = clients.tenant_id AND (_id = clients.manager_id OR public_id = clients.manager_id) LIMIT 1) AS manager_public_id`);
      selectCols.push(`(SELECT name FROM users WHERE tenant_id = clients.tenant_id AND (_id = clients.manager_id OR public_id = clients.manager_id) LIMIT 1) AS manager_name`);
    }
    if (hasCreatedAt) selectCols.push('clients.created_at');

    let joinClause = '';
    const hasClientContacts = await tableExists('client_contacts');
    const clientContactsUseTenant = hasClientContacts && await hasColumn('client_contacts', 'tenant_id');
    const hasEmailCol = await hasColumn('clients', 'email');
    const hasPhoneCol = await hasColumn('clients', 'phone');
    if (hasClientContacts) {
      joinClause = ` LEFT JOIN (SELECT client_id, email, phone${clientContactsUseTenant ? ', tenant_id' : ''} FROM client_contacts WHERE is_primary = 1) pc ON pc.client_id = clients.id ${clientContactsUseTenant ? 'AND pc.tenant_id = clients.tenant_id' : ''} `;
      if (!hasEmailCol) selectCols.push('pc.email AS email');
      else selectCols.push('clients.email');
      if (!hasPhoneCol) selectCols.push('pc.phone AS phone');
      else selectCols.push('clients.phone');
    } else {
      if (hasEmailCol) selectCols.push('clients.email');
      if (hasPhoneCol) selectCols.push('clients.phone');
    }

    const listSql = `SELECT ${selectCols.join(', ')} FROM clients ${joinClause} ${whereSql} ${hasCreatedAt ? 'ORDER BY clients.created_at DESC' : 'ORDER BY clients.id DESC'} LIMIT ? OFFSET ?`;
    const rows = await q(listSql, params.concat([perPage, offset]));

    let documentsByClient = {};
    if (Array.isArray(rows) && rows.length > 0) {
      const clientIds = rows.map(r => r.id).filter(id => id !== undefined && id !== null);
      if (clientIds.length > 0) {
        const docsSql = `
          SELECT documentId as id, clientId as client_id, filePath as file_url, fileName as file_name, mimeType as file_type, createdAt as uploaded_at
          FROM documents
          WHERE entityType = 'CLIENT'
          AND clientId IN (?)
          AND tenant_id = ?
          ORDER BY createdAt DESC
        `;
        const docs = await q(docsSql, [clientIds, tenantId]).catch(() => []);
        documentsByClient = Array.isArray(docs) ? docs.reduce((acc, doc) => {
          (acc[doc.client_id] = acc[doc.client_id] || []).push(doc);
          return acc;
        }, {}) : {};
      }
    }

    const enhancedRows = rows.map((r) => {
      r.documents = documentsByClient[r.id] || [];
      return r;
    });

    return res.json({ success: true, data: enhancedRows, meta: { total, page, perPage } });
  } catch (e) { logger.error('Error listing clients: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); }
});

router.get('/archived', ruleEngine(RULES.CLIENT_VIEW), requireRole(['Admin', 'Manager']), authorize('clients', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const hasDeleted = await hasColumn('clients', 'isDeleted');
    if (!hasDeleted) return res.json({ success: true, data: [], meta: { total: 0 } });

    const rows = await q(
      'SELECT id, ref, name, company, status, archived_at, archived_by, created_at FROM clients WHERE tenant_id = ? AND COALESCE(isDeleted, 0) = 1 ORDER BY COALESCE(archived_at, created_at) DESC',
      [tenantId]
    ).catch(() => []);
    return res.json({ success: true, data: rows, meta: { total: rows.length } });
  } catch (e) {
    logger.error('Error listing archived clients: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/settings', requireRole(['Admin', 'Manager', 'Employee', 'Client-Viewer']), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const settings = await loadSettings(tenantId);
    return res.json({ success: true, data: { version: '1.0.0', general: settings.general } });
  } catch (e) {
    logger.error('Error loading client settings: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.put('/settings', requireRole(['Admin']), authorize('settings', 'update'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const updates = req.body && req.body.general ? req.body.general : req.body;
    const saved = await saveSettings(tenantId, {
      site_name: updates.site_name,
      support_email: updates.support_email || updates.email_id,
      email_id: updates.email_id || updates.support_email,
      timezone: updates.timezone
    });
    return res.json({ success: true, data: { version: '1.0.0', general: saved.general } });
  } catch (e) {
    logger.error('Error saving client settings: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/:id', ruleEngine(RULES.CLIENT_VIEW), requireRole(['Admin', 'Manager', 'Client-Viewer']), authorize('clients', 'read'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const id = req.params.id;

    if (req.user && req.user.role === 'Client-Viewer') {
      if (!req.viewerClientId) return res.status(403).json(errorResponse.forbidden('Viewer not mapped to a client', 'FORBIDDEN'));
      if (String(req.viewerClientId) !== String(id)) return res.status(403).json(errorResponse.forbidden('Access denied', 'FORBIDDEN'));
    }
    const client = await resolveClientForTenant(id, tenantId, true);
    if (!client) return res.status(404).json(errorResponse.notFound('Client not found', 'NOT_FOUND'));
    const clientId = client.id;

    if ((!client.createdAt || client.createdAt === null) && client.created_at) client.createdAt = client.created_at;
    let contacts = await q(`SELECT id, name, email, phone, designation, is_primary FROM client_contacts WHERE client_id = ? ${await hasColumn('client_contacts', 'tenant_id') ? 'AND tenant_id = ?' : ''} ORDER BY is_primary DESC, id ASC`, await hasColumn('client_contacts', 'tenant_id') ? [clientId, tenantId] : [clientId]).catch(() => []);

    if ((!contacts || contacts.length === 0) && (client.email || client.phone)) {
      contacts = [{ id: null, name: null, email: client.email || null, phone: client.phone || null, designation: null, is_primary: 1 }];
    }

    try {

      if (client.manager_id === 0) client.manager_id = null;

      if (client.manager_id) {
        let mgr = await q('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND _id = ? LIMIT 1', [tenantId, client.manager_id]).catch(() => []);
        if (!mgr || mgr.length === 0) {
          mgr = await q('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND public_id = ? LIMIT 1', [tenantId, String(client.manager_id)]).catch(() => []);
        }
        if (Array.isArray(mgr) && mgr.length > 0) {
          client.manager_id = mgr[0]._id;
          client.manager_public_id = mgr[0].public_id || null;
          client.manager_name = mgr[0].name || null;
        } else {
          client.manager_public_id = client.manager_public_id || null;
          client.manager_name = client.manager_name || null;
        }
      } else if (client.manager_public_id) {

        const mgr = await q('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND public_id = ? LIMIT 1', [tenantId, client.manager_public_id]).catch(() => []);
        if (Array.isArray(mgr) && mgr.length > 0) {
          client.manager_id = mgr[0]._id;
          client.manager_public_id = mgr[0].public_id || null;
          client.manager_name = mgr[0].name || null;
        } else {
          client.manager_id = null;
          client.manager_public_id = client.manager_public_id || null;
          client.manager_name = client.manager_name || null;
        }
      } else {
        client.manager_id = null;
        client.manager_public_id = client.manager_public_id || null;
        client.manager_name = client.manager_name || null;
      }
    } catch (e) {
      client.manager_id = client.manager_id || null;
      client.manager_public_id = client.manager_public_id || null;
      client.manager_name = client.manager_name || null;
    }
    let documents = await q(`
      SELECT 
        d.documentId as id, 
        d.filePath as file_url, 
        d.fileName as file_name, 
        d.mimeType as file_type, 
        d.uploadedBy as uploaded_by, 
        d.createdAt as uploaded_at,
        'Document' as document_type,
        u.name as uploaded_by_name
      FROM documents d
      LEFT JOIN users u ON d.uploadedBy = u._id
      WHERE d.entityType = 'CLIENT' AND (d.entityId = ? OR d.clientId = ?)
      ORDER BY d.createdAt DESC
    `, [clientId, clientId]).catch(() => []);
    try {
      const base = req.protocol + '://' + req.get('host');
      documents = (documents || []).map(d => {
        try {
          if (d && d.file_url && String(d.file_url).startsWith('/uploads/')) {
            const decoded = decodeURIComponent(d.file_url);
            const rel = decoded.replace(/^\/uploads\//, '');
            const parts = rel.split('/');
            return {
              ...d,
              file_url: base + '/uploads/' + parts.map(encodeURIComponent).join('/').replace(/%2F/g, '/'),
            };
          }
        } catch (e) { }
        return d;
      });
    } catch (e) { }
    const activities = await q(`SELECT id, actor_id, action, details, created_at FROM client_activity_logs WHERE client_id = ? ${await hasColumn('client_activity_logs', 'tenant_id') ? 'AND tenant_id = ?' : ''} ORDER BY created_at DESC LIMIT 50`, await hasColumn('client_activity_logs', 'tenant_id') ? [clientId, tenantId] : [clientId]).catch(() => []);

    let projects = [];
    try {
      projects = await q(`
        SELECT 
          p.id,
          p.public_id,
          p.name,
          p.description,
          p.priority,
          p.status,
          p.start_date,
          p.end_date,
          p.budget,
          p.created_at,
          p.updated_at,
          pm.public_id as project_manager_public_id,
          pm.name as project_manager_name
        FROM projects p
        LEFT JOIN users pm ON p.project_manager_id = pm._id
        WHERE p.client_id = ? AND p.tenant_id = ? AND p.is_active = 1
        ORDER BY p.created_at DESC
      `, [clientId, tenantId]);

      // If the requester is a Manager (not admin), restrict visible projects to those
      // assigned to this manager. This enforces Manager -> Assigned Projects -> Clients mapping.
      if (req.user && String(req.user.role).toLowerCase() === 'manager') {
        try {
          const mgrProjects = await gatherManagerProjects(req);
          const mgrIds = new Set((mgrProjects || []).map(p => String(p.id)));
          const mgrPublicIds = new Set((mgrProjects || []).map(p => String(p.public_id)));
          projects = (projects || []).filter(p => (p && (p.id && mgrIds.has(String(p.id)) || (p.public_id && mgrPublicIds.has(String(p.public_id))))));
        } catch (e) {
          projects = [];
        }
      }
    } catch (e) {
      logger.debug('Failed to fetch client projects: ' + e.message);
      projects = [];
    }

    let tasks = [];
    try {
      // If projects were filtered for the manager, only include tasks for those projects.
      const projectIds = (projects || []).map(p => p.id).filter(Boolean);
      const projectPublicIds = (projects || []).map(p => p.public_id).filter(Boolean);

      if (req.user && String(req.user.role).toLowerCase() === 'manager' && (!projectIds.length && !projectPublicIds.length)) {
        // Manager has no visible projects for this client -> no tasks
        tasks = [];
      } else {
        const whereClause = (projectIds.length || projectPublicIds.length)
          ? `WHERE t.tenant_id = ? AND (${projectIds.length ? 't.project_id IN (?)' : ''}${projectIds.length && projectPublicIds.length ? ' OR ' : ''}${projectPublicIds.length ? "t.project_public_id IN (?)" : ''})`
          : 'WHERE t.tenant_id = ? AND t.client_id = ?';
        const params = (projectIds.length || projectPublicIds.length)
          ? [tenantId].concat(projectIds.length ? [projectIds] : []).concat(projectPublicIds.length ? [projectPublicIds] : [])
          : [tenantId, clientId];

        const taskRows = await q(`
          SELECT 
            t.id,
            MAX(t.public_id) as public_id,
            MAX(t.title) as title,
            MAX(t.description) as description,
            MAX(t.stage) as stage,
            MAX(t.taskDate) as taskDate,
            MAX(t.priority) as priority,
            MAX(t.status) as status,
            MAX(t.time_alloted) as time_alloted,
            MAX(t.estimated_hours) as estimated_hours,
            MAX(t.createdAt) as createdAt,
            MAX(t.updatedAt) as updatedAt,
            MAX(t.project_id) as project_id,
            MAX(t.project_public_id) as project_public_id,
            MAX(p.name) as project_name,
            MAX(p.public_id) as project_public_id_ref,
            GROUP_CONCAT(DISTINCT u._id) AS assigned_user_ids,
            GROUP_CONCAT(DISTINCT u.public_id) AS assigned_user_public_ids,
            GROUP_CONCAT(DISTINCT u.name) AS assigned_user_names
          FROM tasks t
          LEFT JOIN projects p ON t.project_id = p.id
          LEFT JOIN task_assignments ta ON ta.task_id = t.id
          LEFT JOIN users u ON u._id = ta.user_id
          ${whereClause}
          GROUP BY t.id
          ORDER BY MAX(t.createdAt) DESC
        `, params);

        tasks = (taskRows || []).map(r => {
          const assignedIds = r.assigned_user_ids ? String(r.assigned_user_ids).split(',') : [];
          const assignedPublic = r.assigned_user_public_ids ? String(r.assigned_user_public_ids).split(',') : [];
          const assignedNames = r.assigned_user_names ? String(r.assigned_user_names).split(',') : [];

          const assignedUsers = assignedIds.map((uid, i) => ({
            id: assignedPublic[i] || uid,
            internalId: String(uid),
            name: assignedNames[i] || null
          }));

          return {
            id: r.id,
            public_id: r.public_id,
            title: r.title,
            description: r.description,
            stage: r.stage,
            taskDate: r.taskDate,
            priority: r.priority,
            status: r.status,
            time_alloted: r.time_alloted,
            estimated_hours: r.estimated_hours,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
            project_id: r.project_id,
            project_public_id: r.project_public_id || r.project_public_id_ref,
            project_name: r.project_name,
            assigned_users: assignedUsers,
            subtasks: []
          };
        });

        // fetch subtasks for the returned tasks and attach
        const taskIds = tasks.map(t => t.id).filter(Boolean);
        if (taskIds.length) {
          try {
            const subs = await q(`SELECT id, COALESCE(task_id, task_id) AS task_id, COALESCE(project_id, project_Id) AS project_id, title, description, due_date, tag, status, estimated_hours, completed_at, created_at, updated_at, created_by FROM subtasks WHERE ${await hasColumn('subtasks', 'tenant_id') ? 'tenant_id = ? AND' : ''} COALESCE(task_id, task_id) IN (?)`, await hasColumn('subtasks', 'tenant_id') ? [tenantId, taskIds] : [taskIds]);
            const subMap = {};
            (subs || []).forEach(s => {
              if (!s || s.task_id === undefined || s.task_id === null) return;
              const key = String(s.task_id);
              // ensure subtask belongs to same project as its parent task
              const parentTask = tasks.find(t => String(t.id) === key);
              if (!parentTask) return;
              const subProjectId = s.project_id != null ? String(s.project_id) : null;
              if (subProjectId && String(parentTask.project_id) !== subProjectId) return;
              subMap[key] = subMap[key] || [];
              subMap[key].push({
                id: s.id,
                title: s.title || null,
                description: s.description || null,
                due_date: s.due_date || null,
                tag: s.tag || null,
                status: s.status || null,
                estimated_hours: s.estimated_hours != null ? Number(s.estimated_hours) : null,
                completed_at: s.completed_at || null,
                created_at: s.created_at || null,
                updated_at: s.updated_at || null,
                created_by: s.created_by || null
              });
            });
            tasks.forEach(t => { const key = String(t.id); if (subMap[key]) t.subtasks = subMap[key]; });
          } catch (e) {
            // ignore subtasks fetch errors
          }
        }
      }
    } catch (e) {
      logger.debug('Failed to fetch client tasks: ' + e.message);
      tasks = [];
    }

    // attach tasks to their respective projects so the client response nests tasks under each project
    try {
      const taskMap = {};
      (tasks || []).forEach(t => {
        const key = String(t.project_id || '');
        taskMap[key] = taskMap[key] || [];
        taskMap[key].push(t);
      });
      projects = (projects || []).map(p => ({ ...p, tasks: taskMap[String(p.id)] || [] }));
    } catch (e) {
      logger.debug('Failed to attach tasks to projects: ' + (e && e.message));
    }

    let projectCount = 0, taskCount = 0, completedTasks = 0, pendingTasks = 0, billableHours = null, assignedManager = null;
    try {
      const pc = await q('SELECT COUNT(*) as c FROM projects WHERE tenant_id = ? AND client_id = ?', [tenantId, clientId]); projectCount = pc[0] ? pc[0].c : 0;
      const tc = await q('SELECT COUNT(*) as c FROM tasks WHERE tenant_id = ? AND client_id = ?', [tenantId, clientId]); taskCount = tc[0] ? tc[0].c : 0;
      const comp = await q("SELECT COUNT(*) as c FROM tasks WHERE tenant_id = ? AND client_id = ? AND status = 'Done'", [tenantId, clientId]); completedTasks = comp[0] ? comp[0].c : 0;
      const pend = await q("SELECT COUNT(*) as c FROM tasks WHERE tenant_id = ? AND client_id = ? AND status != 'Done'", [tenantId, clientId]); pendingTasks = pend[0] ? pend[0].c : 0;
      if (client.manager_id) {
        try {
          const mgr = await q('SELECT public_id, name FROM users WHERE tenant_id = ? AND (_id = ? OR public_id = ?) LIMIT 1', [tenantId, client.manager_id, String(client.manager_id)]);
          if (Array.isArray(mgr) && mgr.length > 0) assignedManager = { public_id: mgr[0].public_id, name: mgr[0].name };
          else assignedManager = null;
        } catch (me) {
          assignedManager = null;
        }
      }
    } catch (e) { logger.debug('Skipping some dashboard metrics: ' + e.message); }
    return res.json({ success: true, data: { client, contacts, documents, activities, projects, dashboard: { projectCount, taskCount, completedTasks, pendingTasks, billableHours, assignedManager } } });
  } catch (e) { logger.error('Error fetching client details: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); }
});

router.put(
  '/:id',
  ruleEngine(RULES.CLIENT_UPDATE),
  requireRole(['Admin', 'Manager']),
  authorize('clients', 'update'),
  async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = req.params.id;

      const existingClient = await resolveClientForTenant(id, tenantId, true);
      if (!existingClient) {
        return res.status(404).json({
          success: false,
          message: 'Client not found'
        });
      }

      const existing = await q(
        `SELECT 
          id, name, company, billing_address, office_address,
          gst_number, tax_id, industry, notes, status,
          manager_id, email, phone, district, state, pincode
         FROM clients
         WHERE id = ? AND tenant_id = ?
         LIMIT 1`,
        [existingClient.id, tenantId]
      );

      const before = existing[0];


      let payload = req.body || {};
      delete payload.id;
      delete payload.ref;

      // Smart manager resolution: check all possible keys and pick the first non-empty one
      const managerInputs = [payload.managerId, payload.manager_id, payload.managerPublicId, payload.manager_public_id];
      const hasManagerInput = managerInputs.some(v => v !== undefined);

      if (hasManagerInput) {
        // If we have any manager input, find the best value or default to null (clear manager)
        const validManager = managerInputs.find(v => !isEmptyValue(v));
        payload.manager_id = validManager || null;
      }

      if (payload.taxId !== undefined) payload.tax_id = payload.taxId;
      if (payload.billingAddress !== undefined) payload.billing_address = payload.billingAddress;
      if (payload.officeAddress !== undefined) payload.office_address = payload.officeAddress;
      if (payload.gstNumber !== undefined) payload.gst_number = payload.gstNumber;

      if (payload.address !== undefined && !payload.billing_address) {
        payload.billing_address = payload.address;
      }

      delete payload.managerId;
      delete payload.taxId;
      delete payload.billingAddress;
      delete payload.officeAddress;
      delete payload.gstNumber;
      delete payload.address;
      delete payload.managerPublicId;
      delete payload.manager_public_id;


      if (payload.manager_id !== undefined) {
        if (payload.manager_id) {
          const resolved = await resolveUserId(payload.manager_id, tenantId);
          if (!resolved) {
            return res.status(404).json({
              success: false,
              message: 'Manager not found'
            });
          }
          payload.manager_id = resolved;
        } else {
          payload.manager_id = null;
        }
      }


      const allowed = [
        'name', 'company', 'billing_address', 'office_address',
        'gst_number', 'tax_id', 'industry', 'notes', 'status',
        'manager_id', 'email', 'phone', 'district', 'state', 'pincode'
      ];

      const setCols = [];
      const params = [];

      for (const key of allowed) {
        if (payload[key] !== undefined && String(payload[key]) !== String(before[key])) {
          setCols.push(`${key} = ?`);
          params.push(payload[key]);
        }
      }


      if (setCols.length === 0) {
        return res.json({
          success: true,
          message: 'No changes detected',
          data: before
        });
      }

      params.push(existingClient.id, tenantId);
      await q(
        `UPDATE clients SET ${setCols.join(', ')} WHERE id = ? AND tenant_id = ?`,
        params
      );


      const updated = await q(
        `SELECT 
          id, name, company, billing_address, office_address,
          gst_number, tax_id, industry, notes, status,
          manager_id, email, phone, district, state, pincode,
          (SELECT public_id FROM users WHERE tenant_id = clients.tenant_id AND _id = clients.manager_id LIMIT 1) as manager_public_id,
          (SELECT name FROM users WHERE tenant_id = clients.tenant_id AND _id = clients.manager_id LIMIT 1) as manager_name
         FROM clients
         WHERE id = ? AND tenant_id = ?
         LIMIT 1`,
        [existingClient.id, tenantId]
      );


      q(
        `INSERT INTO client_activity_logs 
         (client_id, actor_id, action, details, created_at)
         VALUES (?, ?, 'update', ?, NOW())`,
        [
          id,
          req.user?._id || null,
          JSON.stringify(payload)
        ]
      ).catch(() => { });


      NotificationService.createAndSendToRoles(
        ['Admin'],
        'Client Updated',
        `Client "${updated[0].name}" was updated`,
        'CLIENT_UPDATED',
        'client',
        id,
        req.user?.tenant_id
      ).catch(() => { });

      try {
        const auditController = require('./auditController');
        auditController.log({
          user_id: req.user._id,
          tenant_id: tenantId,
          action: 'UPDATE_CLIENT',
          entity: 'Client',
          entity_id: String(existingClient.id),
          details: { before, after: updated[0], name: updated[0].name, updates: payload }
        });
      } catch (auditErr) {
        logger.warn('Failed to log update_client audit:', auditErr.message);
      }


      return res.json({
        success: true,
        message: 'Client updated successfully',
        data: updated[0]
      });

    } catch (err) {
      logger.error('Client update error:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to update client'
      });
    }
  }
);


async function permanentlyDeleteClientById(id) {
  const viewerRows = await q('SELECT user_id FROM client_viewers WHERE client_id = ?', [id]).catch(() => []);
  const candidateIds = new Set();
  (viewerRows || []).forEach(row => { if (row && row.user_id) candidateIds.add(Number(row.user_id)); });
  const clientUserRows = await q('SELECT user_id FROM clients WHERE id = ? LIMIT 1', [id]).catch(() => []);
  if (Array.isArray(clientUserRows) && clientUserRows.length && clientUserRows[0].user_id) {
    candidateIds.add(Number(clientUserRows[0].user_id));
  }
  const resolvedIds = Array.from(candidateIds).filter(v => Number.isFinite(v) && v > 0);
  if (resolvedIds.length) {
    const matchingUsers = await q('SELECT _id FROM users WHERE _id IN (?) AND role = ?', [resolvedIds, 'Client-Viewer']).catch(() => []);
    const deleteIds = Array.isArray(matchingUsers)
      ? Array.from(new Set(matchingUsers.map(u => Number(u._id)).filter(v => Number.isFinite(v) && v > 0)))
      : [];
    if (deleteIds.length) {
      await q('DELETE FROM client_viewers WHERE user_id IN (?)', [deleteIds]).catch(() => { });
      await q('DELETE FROM users WHERE _id IN (?)', [deleteIds]).catch(() => { });
    }
  }
  await q('DELETE FROM documents WHERE entityType = ? AND clientId = ?', ['CLIENT', id]).catch(() => { });
  await q('DELETE FROM client_contacts WHERE client_id = ?', [id]).catch(() => { });
  await q('DELETE FROM client_activity_logs WHERE client_id = ?', [id]).catch(() => { });
  await q('DELETE FROM clients WHERE id = ?', [id]);
  await q('DELETE FROM client_viewers WHERE client_id = ?', [id]).catch(() => { });
}

router.delete('/:id', ruleEngine(RULES.CLIENT_DELETE), requireRole('Admin'), authorize('clients', 'delete'), async (req, res) => {
  try {
    const tenantId = resolveTenantId(req);
    const client = await resolveClientForTenant(req.params.id, tenantId, true);
    if (!client) return res.status(404).json(errorResponse.notFound('Client not found', 'NOT_FOUND'));

    const setParts = ['isDeleted = 1'];
    const params = [];
    if (await hasColumn('clients', 'archived_at')) setParts.push('archived_at = NOW()');
    if (await hasColumn('clients', 'archived_by')) {
      setParts.push('archived_by = ?');
      params.push(req.user && req.user._id ? req.user._id : null);
    }
    params.push(client.id, tenantId);
    await q(`UPDATE clients SET ${setParts.join(', ')} WHERE id = ? AND tenant_id = ?`, params);

    await q(`INSERT INTO client_activity_logs (tenant_id, client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, ?, NOW())`, [tenantId, client.id, req.user && req.user._id ? req.user._id : null, 'archived', 'soft archived']).catch(() => { });
    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin'], 'Client Archived', `Client "${client.name}" has been archived`, 'CLIENT_ARCHIVED', 'client', client.id, tenantId);
      } catch (notifErr) {
        logger.error('Client delete notification error:', notifErr);
      }
    })();
    return res.json({ success: true, message: 'Client archived successfully' });
  } catch (e) {
    logger.error('Error deleting client: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.delete('/:id/permanent', ruleEngine(RULES.CLIENT_DELETE), requireRole('Admin'), async (req, res) => {
  return res.status(405).json(errorResponse.badRequest('Permanent client deletion is disabled. Archive the client instead.', 'PERMANENT_DELETE_DISABLED'));
});

router.post('/:id/assign-manager', ruleEngine(RULES.CLIENT_UPDATE), requireRole('Admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const { managerId, manager_id: managerIdSnake, managerPublicId } = req.body || {};
    const hasManagerField = Object.prototype.hasOwnProperty.call(req.body || {}, 'managerId')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'manager_id')
      || Object.prototype.hasOwnProperty.call(req.body || {}, 'managerPublicId');
    if (!hasManagerField) {
      return res.status(400).json(errorResponse.badRequest('managerId required', 'BAD_REQUEST'));
    }
    const managerInput = managerId ?? managerIdSnake ?? managerPublicId ?? null;
    let finalManagerId = null;
    if (!isEmptyValue(managerInput)) {
      finalManagerId = await resolveUserId(managerInput);
      if (finalManagerId === null) {
        return res.status(404).json(errorResponse.notFound('Manager not found', 'NOT_FOUND'));
      }
    }
    await q('UPDATE clients SET manager_id = ? WHERE id = ?', [finalManagerId, id]);
    await q('INSERT INTO client_activity_logs (client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, req.user && req.user._id ? req.user._id : null, finalManagerId ? 'assign-manager' : 'unassign-manager', JSON.stringify({ managerId: finalManagerId })])
      .catch(() => { });
    return res.json({ success: true, message: finalManagerId ? 'Manager assigned' : 'Manager unassigned' });
  } catch (e) {
    logger.error('Error assigning manager: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.post('/:id/create-viewer', ruleEngine(RULES.CLIENT_CREATE), requireRole('Admin'), async (req, res) => {
  try {
    const id = req.params.id;
    const { email, name } = req.body;

    if (!email) {
      logger.warn('[CREATE-VIEWER] Missing email');
      return res.status(400).json(errorResponse.badRequest('email required', 'BAD_REQUEST'));
    }

    const tempPassword = crypto.randomBytes(6).toString('hex');

    const hashed = await new Promise((resH, rejH) => {
      require('bcryptjs').hash(tempPassword, 10, (e, h) => e ? rejH(e) : resH(h));
    });

    const publicId = crypto.randomBytes(8).toString('hex');

    const roleToInsert = 'Client-Viewer';

    const insertUserSql = 'INSERT INTO users (tenant_id, public_id, name, email, password, role, title, isActive, is_active, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())';

    const userRes = await q(insertUserSql, [tenantId, publicId, name || `Viewer for ${id}`, email, hashed, roleToInsert, 'Client Viewer', 1]);
    const newUserId = userRes && userRes.insertId ? userRes.insertId : null;

    if (newUserId) {
      const verifyRole = await q('SELECT role, public_id FROM users WHERE id = ?', [newUserId]);

      try {
        await q('INSERT INTO client_viewers (client_id, user_id, created_at) VALUES (?, ?, NOW())', [id, newUserId]);
      } catch (e) {
        logger.error(`[CREATE-VIEWER] Failed client_viewers mapping: ${e.message}`);
      }

      try {
        if (await hasColumn('clients', 'user_id')) {
          await q('UPDATE clients SET user_id = ? WHERE id = ?', [newUserId, id]);
        }
      } catch (e) {
        logger.error(`[CREATE-VIEWER] Failed clients update: ${e.message}`);
      }

      if (verifyRole[0]?.role !== 'Client-Viewer') {
        await q('UPDATE users SET role = "Client-Viewer" WHERE id = ?', [newUserId]);
        logger.warn(`[CREATE-VIEWER] FORCE-UPDATED role from "${verifyRole[0]?.role}" to "Client-Viewer"`);
      }
    }

    try {
      await emailService.sendCredentials(email, name || `Client Viewer`, publicId, tempPassword);
    } catch (e) {
      logger.warn(`[CREATE-VIEWER] Email failed: ${e.message}`);
    }

    await q('INSERT INTO client_activity_logs (client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, req.user?._id || null, 'create-viewer', JSON.stringify({ userId: newUserId, publicId })])
      .catch(e => logger.error(`[CREATE-VIEWER] Activity log failed: ${e.message}`));

    logger.info(`[CREATE-VIEWER] SUCCESS: ${JSON.stringify({ publicId, userId: newUserId })}`);
    return res.status(201).json({ success: true, data: { publicId, userId: newUserId } });

  } catch (e) {
    logger.error(`[CREATE-VIEWER] FULL ERROR: ${e.stack || e.message}`);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/:id/viewers/:userId', requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const clientId = req.params.id;
    const userId = req.params.userId;

    const mapping = await q('SELECT * FROM client_viewers WHERE client_id = ? AND user_id = ? LIMIT 1', [clientId, userId]).catch(() => []);
    if (!mapping || mapping.length === 0) return res.status(404).json(errorResponse.notFound('Viewer not found for this client', 'NOT_FOUND'));
    const users = await q('SELECT _id, public_id, name, email, role, modules FROM users WHERE _id = ? LIMIT 1', [userId]);
    if (!users || users.length === 0) return res.status(404).json(errorResponse.notFound('User not found', 'NOT_FOUND'));
    const u = users[0];
    let modules = null;
    try { modules = u.modules ? (typeof u.modules === 'string' ? JSON.parse(u.modules) : u.modules) : null; } catch (e) { modules = null; }
    return res.json({ success: true, data: { id: u._id, publicId: u.public_id, name: u.name, email: u.email, role: u.role, modules } });
  } catch (e) { logger.error('Error fetching viewer info: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); }
});

router.put('/:id/viewers/:userId/modules', requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const clientId = req.params.id;
    const userId = req.params.userId;
    const modules = req.body.modules;
    if (!Array.isArray(modules)) return res.status(400).json(errorResponse.badRequest('modules array required', 'BAD_REQUEST'));

    const mapping = await q('SELECT * FROM client_viewers WHERE client_id = ? AND user_id = ? LIMIT 1', [clientId, userId]).catch(() => []);
    if (!mapping || mapping.length === 0) return res.status(404).json(errorResponse.notFound('Viewer not found for this client', 'NOT_FOUND'));

    const modulesStr = JSON.stringify(modules);
    await q('UPDATE users SET modules = ? WHERE _id = ?', [modulesStr, userId]);
    await q('INSERT INTO client_activity_logs (client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, NOW())', [clientId, req.user && req.user._id ? req.user._id : null, 'update-viewer-modules', JSON.stringify({ userId, modules })]).catch(() => { });
    return res.json({ success: true, message: 'Viewer modules updated', data: { userId, modules } });
  } catch (e) { logger.error('Error updating viewer modules: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); }
});

router.post('/:id/contacts', ruleEngine(RULES.CLIENT_CONTACT_ADD), requireRole(['Admin', 'Manager']), async (req, res) => { try { const id = req.params.id; const { name, email, phone, designation, is_primary } = req.body; if (!name) return res.status(400).json(errorResponse.badRequest('name required', 'BAD_REQUEST')); if (is_primary) { await q('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?', [id]); } const r = await q('INSERT INTO client_contacts (client_id, name, email, phone, designation, is_primary, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [id, name, email || null, phone || null, designation || null, is_primary ? 1 : 0]); return res.status(201).json({ success: true, data: { id: r.insertId } }); } catch (e) { logger.error('Error adding contact: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); } });

router.put('/:id/contacts/:contactId', requireRole(['Admin', 'Manager']), async (req, res) => { try { const id = req.params.id; const contactId = req.params.contactId; const payload = req.body || {}; if (payload.is_primary) { await q('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?', [id]); } const allowed = ['name', 'email', 'phone', 'designation', 'is_primary']; const sets = []; const params = []; for (const k of allowed) if (payload[k] !== undefined) { sets.push(`${k} = ?`); params.push(payload[k]); } if (!sets.length) return res.status(400).json(errorResponse.badRequest('No fields', 'BAD_REQUEST')); params.push(contactId); await q(`UPDATE client_contacts SET ${sets.join(', ')} WHERE id = ?`, params); return res.json({ success: true, message: 'Contact updated' }); } catch (e) { logger.error('Error updating contact: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); } });

router.delete('/:id/contacts/:contactId', requireRole(['Admin', 'Manager']), async (req, res) => { try { const contactId = req.params.contactId; await q('DELETE FROM client_contacts WHERE id = ?', [contactId]); return res.json({ success: true, message: 'Contact deleted' }); } catch (e) { logger.error('Error deleting contact: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); } });

router.post('/:id/contacts/:contactId/set-primary', ruleEngine(RULES.CLIENT_CONTACT_UPDATE), requireRole(['Admin', 'Manager']), async (req, res) => { try { const id = req.params.id; const contactId = req.params.contactId; await q('UPDATE client_contacts SET is_primary = 0 WHERE client_id = ?', [id]); await q('UPDATE client_contacts SET is_primary = 1 WHERE id = ?', [contactId]); return res.json({ success: true, message: 'Primary contact set' }); } catch (e) { logger.error('Error setting primary contact: ' + e.message); return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message })); } });

// Example: allow single file upload up to 50MB
router.post(
  '/:id/documents',
  upload.single('document'),
  ruleEngine(RULES.CLIENT_UPDATE),
  requireRole(['Admin', 'Manager']),
  async (req, res) => {
  try {
    const id = req.params.id;
    if (!req.file) {
      return res.status(400).json(errorResponse.badRequest('No file uploaded. Field name: document', 'BAD_REQUEST'));
    }
    // Upload to storage with structured path
    const subfolder = `CLIENT/${id}`;
    const filename = `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9-_\.]/g, '_')}`;
    const key = `${subfolder}/${filename}`;
    const storageInfo = await storageService.upload(req.file, key);
    const storedPath = storageInfo.storagePath;

    // Insert document record
    const fileType = req.file.mimetype || guessMimeType(filename) || null;
    const documentId = crypto.randomBytes(12).toString('hex');
    const uploadedBy = req.user && req.user._id ? req.user._id : null;
    await q(
      'INSERT INTO documents (documentId, entityType, entityId, uploadedBy, storageProvider, filePath, encrypted, createdAt, updatedAt, fileName, mimeType, clientId) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)',
      [documentId, 'CLIENT', id, uploadedBy, storageInfo.provider, storedPath, 0, req.file.originalname, fileType, id]
    );
    await q('INSERT INTO client_activity_logs (client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, NOW())', [id, uploadedBy, 'attach-document', JSON.stringify({ id: documentId, file_url: storedPath, file_name: req.file.originalname, file_type: fileType })]).catch(() => { });
    logger.info(`Document inserted: id=${documentId}, fileName=${req.file.originalname}`);
    return res.status(201).json({ success: true, data: { id: documentId, file_url: storedPath, file_name: req.file.originalname, file_type: fileType } });
  } catch (e) {
    logger.error('Error attaching document(s): ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.post('/:id/upload', ruleEngine(RULES.UPLOAD_CREATE), requireRole(['Admin', 'Manager']), upload.array('files', 20), async (req, res) => {
  try {
    const id = req.params.id;
    if (!req.files || req.files.length === 0) return res.status(400).json(errorResponse.badRequest('No files uploaded', 'BAD_REQUEST'));
    logger.info(`Upload ${req.files.length} files for client ${id}`);
    const inserted = [];
    const errors = [];
    for (const f of req.files) {
      try {
        const fileName = f.originalname || f.filename;
        const filename = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9-_\.]/g, '_')}`;
        const key = `CLIENT/${id}/${filename}`;
        const storageInfo = await storageService.upload(f, key);
        const storedPath = storageInfo.storagePath;
        const fileType = f.mimetype || guessMimeType(filename) || null;
        const documentId = crypto.randomBytes(12).toString('hex');
        const uploadedBy = req.user && req.user._id ? req.user._id : null;

        logger.info(`Uploading: fileName=${fileName}, mimeType=${fileType}, size=${f.size}`);

        const r = await q(
          'INSERT INTO documents (documentId, entityType, entityId, uploadedBy, storageProvider, filePath, encrypted, createdAt, updatedAt, fileName, fileSize, mimeType, clientId) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)',
          [documentId, 'CLIENT', id, uploadedBy, storageInfo.provider, storedPath, 0, fileName, f.size || null, fileType, id]
        );

        const docRec = { id: documentId, file_url: storedPath, file_name: fileName, file_type: fileType };
        inserted.push(docRec);
        logger.info(`File inserted: id=${documentId}, fileName=${fileName}`);

        await q('INSERT INTO client_activity_logs (client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, NOW())', [id, uploadedBy, 'attach-document', JSON.stringify(docRec)]).catch(() => { });
      } catch (e) {
        const errMsg = 'Failed inserting uploaded file for client ' + id + ': ' + (e && e.message);
        logger.error(errMsg);
        errors.push(errMsg);
      }
    }
    if (inserted.length === 0) return res.status(400).json({ success: false, message: 'Failed to save any documents', errors: errors });
    return res.status(201).json({ success: true, data: inserted });
  } catch (e) {
    logger.error('Error in file upload: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/:id/documents/:documentId', ruleEngine(RULES.CLIENT_VIEW), requireRole(['Admin', 'Manager', 'Client-Viewer']), async (req, res) => {
  try {
    const { id, documentId } = req.params;

    if (req.user && req.user.role === 'Client-Viewer') {
      if (!req.viewerClientId) return res.status(403).json(errorResponse.forbidden('Viewer not mapped to a client', 'FORBIDDEN'));
      if (String(req.viewerClientId) !== String(id)) return res.status(403).json(errorResponse.forbidden('Access denied', 'FORBIDDEN'));
    }

    const doc = await q(`
      SELECT 
        documentId as id, 
        filePath as file_url, 
        fileName as file_name, 
        mimeType as file_type, 
        uploadedBy as uploaded_by, 
        createdAt as uploaded_at,
        'Document' as document_type,
        u.name as uploaded_by_name
      FROM documents d
      LEFT JOIN users u ON d.uploadedBy = u._id
      WHERE d.documentId = ? AND d.entityType = 'CLIENT' AND d.entityId = ? 
      LIMIT 1
    `, [documentId, id]).catch(() => []);

    if (!Array.isArray(doc) || doc.length === 0) {
      return res.status(404).json(errorResponse.notFound('Document not found', 'NOT_FOUND'));
    }

    const document = doc[0];
    const base = req.protocol + '://' + req.get('host');

    if (document.file_url && String(document.file_url).startsWith('/uploads/')) {
      const rel = String(document.file_url).replace(/^\/uploads\//, '');
      const parts = rel.split('/').map(p => encodeURIComponent(p));
      document.file_url = base + '/uploads/' + parts.join('/');
    }

    return res.json({ success: true, data: document });
  } catch (e) {
    logger.error('Error fetching document: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.delete('/:id/documents/:documentId', ruleEngine(RULES.CLIENT_UPDATE), requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const { id, documentId } = req.params;

    const doc = await q('SELECT documentId, fileName, filePath, storageProvider FROM documents WHERE documentId = ? AND entityType = ? AND entityId = ? LIMIT 1', [documentId, 'CLIENT', id]).catch(() => []);

    if (!Array.isArray(doc) || doc.length === 0) {
      return res.status(404).json(errorResponse.notFound('Document not found', 'NOT_FOUND'));
    }

    const document = doc[0];

    // Delete the physical file
    try {
      await storageService.deleteFile(document.filePath);
    } catch (e) {
      logger.warn("Failed to delete file from storage: " + e.message);
    }

    // Delete the document record
    await q('DELETE FROM documents WHERE documentId = ?', [documentId]);

    // Log the deletion
    await q('INSERT INTO client_activity_logs (client_id, actor_id, action, details, created_at) VALUES (?, ?, ?, ?, NOW())',
      [id, req.user && req.user._id ? req.user._id : null, 'delete-document',
        JSON.stringify({ documentId: documentId, fileName: document.fileName, deletedBy: req.user ? req.user.id : null })]).catch(() => { });

    return res.json({ success: true, message: 'Document deleted successfully', data: { id: documentId, file_name: document.fileName } });
  } catch (e) {
    logger.error('Error deleting document: ' + e.message);
    return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
  }
});

router.get('/settings', requireRole(['Admin', 'Manager', 'Employee', 'Client-Viewer']), (req, res) => {
  const settings = {
    version: "1.0.0",
    general: {
      site_name: "Task Manager",
      support_email: "support@taskmanager.com",
      timezone: "Asia/Kolkata"
    },
    database: {
      primary_db: "connected",
      replica_db: "connected"
    },
    security: {
      password_expiry: true,
      login_notifications: true,
      session_timeout: false
    },
    notifications: {
      email_alerts: true,
      sms_alerts: false,
      weekly_summary: true
    },
    api: {
      base_url: "https://api.taskmanager.com",
      public_key: "pk_live_123456",
      secret_key: "sk_live_123456"
    }
  };
  return res.json({ success: true, data: settings });
});

router.put('/settings', requireRole(['Admin', 'Manager', 'Employee', 'Client-Viewer']), (req, res) => {
  const updates = req.body;
  const current = {
    version: "1.0.0",
    general: {
      site_name: "Task Manager",
      support_email: "support@taskmanager.com",
      timezone: "Asia/Kolkata"
    },
    database: {
      primary_db: "connected",
      replica_db: "connected"
    },
    security: {
      password_expiry: true,
      login_notifications: true,
      session_timeout: false
    },
    notifications: {
      email_alerts: true,
      sms_alerts: false,
      weekly_summary: true
    },
    api: {
      base_url: "https://api.taskmanager.com",
      public_key: "pk_live_123456",
      secret_key: "sk_live_123456"
    }
  };
  Object.keys(updates).forEach(key => {
    if (current[key]) {
      Object.assign(current[key], updates[key]);
    }
  });
  return res.json({ success: true, data: current });
});

module.exports = router;


