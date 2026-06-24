const db = require(__root + 'db');
const storageService = require(__root + 'services/storageService');
const logger = require(__root + 'logger');
const path = require('path');
const crypto = require('crypto');

const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

function makeDocumentId() {
  return crypto.randomBytes(12).toString('hex');
}

module.exports = {

  async uploadDocument({ file, body = {}, user = {} }) {
    if (!file) {
      const err = new Error('No file uploaded');
      err.status = 400;
      throw err;
    }

    const entityType = (body.entityType || body.entity_type || 'GENERAL').toUpperCase();
    const entityId = body.entityId || body.entity_id || body.entity || 'unknown';
    const documentId = makeDocumentId();

    // Create structured key with subfolders
    const subfolder = `${entityType}/${entityId}`;
    const filename = documentId + path.extname(file.originalname);
    const key = `${subfolder}/${filename}`;

    const storageInfo = await storageService.upload(file, key);

    if (storageInfo && storageInfo.provider === 'local' && typeof storageInfo.storagePath === 'string') {
      try {
        const candidateUploads = path.resolve(path.join(__dirname, '..', '..', 'uploads'));
        const resolvedP = path.resolve(storageInfo.storagePath);
        if (resolvedP.startsWith(candidateUploads)) {
          const rel = path.relative(candidateUploads, resolvedP).replace(/\\/g, '/');

          storageInfo.publicPath = '/uploads/' + rel;

          storageInfo.storagePath = storageInfo.publicPath;
        } else {

          storageInfo.publicPath = '';
        }
      } catch (e) {
        storageInfo.publicPath = '';
      }
    }

    const createdAt = new Date();
    await q(
      'INSERT INTO documents (documentId, fileName, filePath, storageProvider, entityType, entityId, mimeType, uploadedBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [documentId, file.originalname, storageInfo.storagePath, storageInfo.provider, entityType, entityId, file.mimetype, user && (user.id || user._id) || null, createdAt]
    );

    return { id: documentId, documentId, fileName: file.originalname, storagePath: storageInfo.storagePath, entityType, entityId, mimeType: file.mimetype };
  },

  async listDocuments({ filter = {}, user = {} }) {
    try {
      const params = [];
      let sql = 'SELECT documentId AS id, documentId, fileName, filePath AS storagePath, storageProvider, entityType, entityId, mimeType, uploadedBy, createdAt FROM documents WHERE 1=1';
      if (filter.projectId || filter.projectPublicId) {
        const projectParam = filter.projectId || filter.projectPublicId;

        try {
          const projRows = await q('SELECT id FROM projects WHERE id = ? OR public_id = ? LIMIT 1', [projectParam, projectParam]);
          if (projRows && projRows.length > 0) {
            const internalId = projRows[0].id;
            sql += ' AND entityType = ? AND (entityId = ? OR entityId = ?)';
            params.push('PROJECT', internalId, projectParam);
          } else {
            sql += ' AND entityType = ? AND entityId = ?';
            params.push('PROJECT', projectParam);
          }
        } catch (e) {

          sql += ' AND entityType = ? AND entityId = ?';
          params.push('PROJECT', projectParam);
        }
      }
      if (filter.clientId) {
        sql += ' AND entityType = ? AND entityId = ?';
        params.push('CLIENT', filter.clientId);
      }

      const rows = await q(sql + ' ORDER BY createdAt DESC LIMIT 100', params);
      return rows || [];
    } catch (err) {
      logger.error('documentService.listDocuments error', err && err.message);
      throw err;
    }
  },

  async getDocumentById(id) {
    const rows = await q('SELECT documentId AS id, documentId, fileName, filePath AS storagePath, storageProvider, entityType, entityId, mimeType, uploadedBy, createdAt FROM documents WHERE documentId = ? LIMIT 1', [id]);
    if (!rows || rows.length === 0) {
      const err = new Error('Document not found');
      err.status = 404;
      throw err;
    }
    return rows[0];
  },

  async getDocumentPreview({ id, user = {} }) {
    const doc = await this.getDocumentById(id);

    const storageInfo = { storagePath: doc.storagePath };
    const handle = await storageService.getDownloadHandle(storageInfo);
    return { ...handle, fileName: doc.fileName, headers: { 'Content-Type': doc.mimeType } };
  },

  async downloadDocument({ id, user = {} }) {
    const doc = await this.getDocumentById(id);
    const storageInfo = { storagePath: doc.storagePath };
    const handle = await storageService.getDownloadHandle(storageInfo);
    return { ...handle, fileName: doc.fileName, headers: { 'Content-Type': doc.mimeType } };
  }
};
