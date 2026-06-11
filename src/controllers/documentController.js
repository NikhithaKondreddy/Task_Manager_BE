
const upload = require('../multer');
const storageService = require('../services/storageService');
const db = require('../db');
const crypto = require('crypto');
const path = require('path');
const errorResponse = require(__root + 'utils/errorResponse');
const { assertTenantId, tableHasColumn } = require(__root + 'utils/tenantScope');

const NotificationService = require('../services/notificationService');
const workflowService = require(__root + 'workflow/workflowService');

let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../../logger'); } catch (e2) { logger = console; } }

const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

function resolveTenantId(req) {
  return assertTenantId(req);
}

function makeId() { return crypto.randomBytes(12).toString('hex'); }

function isAdmin(user) { return user && String(user.role).toLowerCase() === 'admin'; }
function isManager(user) { return user && String(user.role).toLowerCase() === 'manager'; }
function isEmployee(user) { return user && String(user.role).toLowerCase() === 'employee'; }

async function documentsUseTenant() {
  return tableHasColumn('documents', 'tenant_id');
}

async function documentAccessUsesTenant() {
  return tableHasColumn('document_access', 'tenant_id');
}

async function taskAssignmentsUseTenant() {
  return tableHasColumn('task_assignments', 'tenant_id');
}

async function clientManagedByUser(clientId, user) {
  if (!clientId || !user) return false;
  const tenantId = user.tenant_id || null;
  const rows = await q(
    `
      SELECT 1
      FROM projects
      WHERE tenant_id = ?
        AND client_id = ?
        AND (project_manager_id = ? OR project_manager_id = ?)
      LIMIT 1
    `,
    [tenantId, clientId, user._id, user.public_id]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function employeeHasClientAccess(clientId, user) {
  if (!clientId || !user) return false;
  const tenantId = user.tenant_id || null;
  const hasAssignmentTenant = await taskAssignmentsUseTenant();
  const assignmentTenantClause = hasAssignmentTenant ? 'AND ta.tenant_id = ?' : '';
  const params = hasAssignmentTenant
    ? [tenantId, user._id, tenantId, clientId]
    : [tenantId, user._id, clientId];
  const rows = await q(
    `
      SELECT 1
      FROM task_assignments ta
      JOIN tasks t ON ta.task_id = t.id
      JOIN projects p ON t.project_id = p.id
      WHERE t.tenant_id = ?
        AND ta.user_id = ?
        ${assignmentTenantClause}
        AND p.client_id = ?
      LIMIT 1
    `,
    params
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function loadDocumentForTenant(documentId, tenantId) {
  const hasTenant = await documentsUseTenant();
  const sql = hasTenant
    ? 'SELECT * FROM documents WHERE documentId = ? AND tenant_id = ? LIMIT 1'
    : 'SELECT * FROM documents WHERE documentId = ? LIMIT 1';
  const params = hasTenant ? [documentId, tenantId] : [documentId];
  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

async function insertDocumentRecord(payload, tenantId) {
  const hasTenant = await documentsUseTenant();
  const columns = ['documentId', 'fileName', 'filePath', 'fileSize', 'mimeType', 'uploadedBy', 'projectId', 'clientId', 'entityId', 'entityType', 'storageProvider', 'createdAt'];
  const values = [payload.documentId, payload.fileName, payload.filePath, payload.fileSize, payload.mimeType, payload.uploadedBy, payload.projectId, payload.clientId, payload.entityId, payload.entityType, payload.storageProvider, payload.createdAt];
  if (hasTenant) {
    columns.push('tenant_id');
    values.push(tenantId);
  }
  await q(
    `INSERT INTO documents (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values
  );
}

async function grantDocumentAccess(documentId, userId, tenantId, createdAt) {
  const hasTenant = await documentAccessUsesTenant();
  const columns = ['documentId', 'userId', 'accessType', 'grantedBy', 'grantedAt'];
  const values = [documentId, userId, 'READ', userId, createdAt];
  if (hasTenant) {
    columns.push('tenant_id');
    values.push(tenantId);
  }
  await q(
    `INSERT INTO document_access (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    values
  );
}

async function canAccessDocumentRecord(doc, user) {
  if (!doc || !user) return false;
  if (isAdmin(user)) return true;
  if (doc.projectId) {
    if (isManager(user)) return managerOwnsProject(doc.projectId, user);
    if (isEmployee(user)) return employeeHasTaskInProject(doc.projectId, user);
  }
  if (doc.clientId) {
    if (isManager(user)) return clientManagedByUser(doc.clientId, user);
    if (isEmployee(user)) return employeeHasClientAccess(doc.clientId, user);
  }
  return String(doc.uploadedBy) === String(user._id || user.id);
}

// --- Schema Helper ---
async function ensureDocumentsSchema() {
  try {
    // Check if clientId and projectId columns exist
    const cols = await q("SHOW COLUMNS FROM documents LIKE 'clientId'");
    if (!cols || cols.length === 0) {
      await q("ALTER TABLE documents ADD COLUMN clientId INT NULL, ADD COLUMN projectId INT NULL");
      await q("CREATE INDEX idx_documents_clientId ON documents (clientId)");
      await q("CREATE INDEX idx_documents_projectId ON documents (projectId)");
      logger.info("Updated documents table schema: added clientId, projectId");
    }
  } catch (e) {
    logger.warn("Failed to check/update documents schema: " + e.message);
  }
}

// Call on load (or could be called in middleware)
ensureDocumentsSchema();

async function managerOwnsProject(projectId, user) {
  if (!projectId || !user) return false;
  try {
    const internal = user._id || null;
    const publicId = user.public_id || user.id || null;
    const tenantId = user.tenant_id || null;
    const rows = await q('SELECT id FROM projects WHERE tenant_id = ? AND (id = ? OR public_id = ?) AND (project_manager_id = ? OR project_manager_id = ?) LIMIT 1', [tenantId, projectId, projectId, internal, publicId]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) { return false; }
}

async function employeeHasTaskInProject(projectId, user) {
  if (!projectId || !user) return false;
  try {
    const userId = user._id || user.id;
    const tenantId = user.tenant_id || null;
    // Get internal project ID first
    const prows = await q('SELECT id FROM projects WHERE tenant_id = ? AND (id = ? OR public_id = ?) LIMIT 1', [tenantId, projectId, projectId]);
    if (!prows || !prows.length) return false;
    const pid = prows[0].id;

    const rows = await q(`
      SELECT 1 FROM task_assignments ta 
      JOIN tasks t ON ta.task_id = t.id 
      WHERE t.tenant_id = ? AND ta.tenant_id = ? AND ta.user_id = ? AND (t.project_id = ? OR t.project_public_id = ?) LIMIT 1
    `, [tenantId, tenantId, userId, pid, projectId]);
    return rows && rows.length > 0;
  } catch (e) { return false; }
}

// Helper: Normalize Public IDs to Internal IDs (and return both if possible)
async function resolveIds(pId, cId) {
  const tenantId = arguments.length > 2 ? arguments[2] : null;
  let projectId = null;
  let clientId = null;
  let projectPublicId = null;

  if (pId) {
    const rows = tenantId !== null
      ? await q('SELECT id, public_id, client_id FROM projects WHERE tenant_id = ? AND (id = ? OR public_id = ?) LIMIT 1', [tenantId, pId, pId])
      : await q('SELECT id, public_id, client_id FROM projects WHERE id = ? OR public_id = ? LIMIT 1', [pId, pId]);
    if (rows && rows.length) {
      projectId = rows[0].id;
      projectPublicId = rows[0].public_id;
      if (!cId && rows[0].client_id) clientId = rows[0].client_id;
    }
  }
  if (cId && !clientId) {
    // Check ID or Ref (since clients use Ref as public identifier often)
    const rows = tenantId !== null
      ? await q('SELECT id FROM clients WHERE tenant_id = ? AND (id = ? OR ref = ?) LIMIT 1', [tenantId, cId, cId])
      : await q('SELECT id FROM clients WHERE id = ? OR ref = ? LIMIT 1', [cId, cId]);
    if (rows && rows.length) clientId = rows[0].id;
  }
  return { projectId, clientId, projectPublicId };
}


// Helper to add full URL
function transformDocuments(docs, req) {
  if (!docs || !Array.isArray(docs)) return [];
  const baseUrl = req.protocol + '://' + req.get('host');
  return docs.map(doc => {
    let fullUrl = doc.filePath;
    if (doc.filePath && typeof doc.filePath === 'string' && doc.filePath.startsWith('/')) {
      try {
        // Decode first to avoid double-encoding if it's already encoded
        const decoded = decodeURIComponent(doc.filePath);
        // Then encode each part separately, preserving slashes
        const parts = decoded.split('/');
        fullUrl = baseUrl + parts.map(encodeURIComponent).join('/').replace(/%2F/g, '/');
      } catch (e) {
        // Fallback to baseUrl + path if decoding fails
        fullUrl = baseUrl + doc.filePath;
      }
    }
    return { ...doc, filePath: fullUrl, file_url: fullUrl, originalPath: doc.filePath };
  });
}

module.exports = {

  uploadForProject: [
    upload.any(),
    async (req, res, next) => {
      try {
        const tenantId = resolveTenantId(req);
        const user = req.user;
        const userId = user._id || user.id;
        const rawProjectId = req.body.projectId || req.body.project_id || req.params.projectId || req.params.project_id;
        if (!rawProjectId) {
          return res.status(400).json(errorResponse.badRequest('Missing projectId', 'NO_PROJECT_ID'));
        }
        // Only allow employee or manager
        if (!isEmployee(user) && !isManager(user)) {
          return res.status(403).json(errorResponse.forbidden('Only employees or managers can upload via this endpoint', 'FORBIDDEN'));
        }
        // Resolve project
        const { projectId } = await resolveIds(rawProjectId, null, tenantId);
        if (!projectId) {
          return res.status(404).json(errorResponse.notFound('Project not found', 'PROJECT_NOT_FOUND'));
        }
        // Check access
        let allowed = false;
        if (isManager(user)) {
          allowed = await managerOwnsProject(projectId, user);
        } else if (isEmployee(user)) {
          allowed = await employeeHasTaskInProject(projectId, user);
        }
        if (!allowed) {
          return res.status(403).json(errorResponse.forbidden('You are not assigned to this project', 'NOT_ASSIGNED'));
        }
        if (!req.files || req.files.length === 0) {
          return res.status(400).json(errorResponse.badRequest('No files uploaded', 'NO_FILES'));
        }
        const uploadedDocs = [];
        for (const file of req.files) {
          const documentId = makeId();
          const fileName = file.originalname;
          const mimeType = file.mimetype;
          const fileSize = file.size;
          const createdAt = new Date();
          // Upload to storage with structured path
          const subfolder = `PROJECT/${projectId}`;
          const filename = documentId + path.extname(file.originalname);
          const key = `${subfolder}/${filename}`;
          const storageInfo = await storageService.upload(file, key);
          const filePath = storageInfo.storagePath;
          const payload = {
            documentId,
            fileName,
            filePath,
            fileSize,
            mimeType,
            uploadedBy: userId,
            projectId,
            clientId: null,
            entityId: projectId,
            entityType: 'PROJECT',
            storageProvider: storageInfo.provider,
            createdAt
          };
          await insertDocumentRecord(payload, tenantId);
          uploadedDocs.push(payload);
        }
        // Notify manager and all admins in the tenant
        // Find project manager
        const mgrRows = await q('SELECT project_manager_id FROM projects WHERE id = ?', [projectId]);
        const managerId = mgrRows && mgrRows[0] && mgrRows[0].project_manager_id;
        // Find all admins in tenant
        const adminRows = await q('SELECT _id FROM users WHERE role = ? AND tenant_id = ?', ['admin', tenantId]);
        const adminIds = adminRows.map(r => r._id);
        const notifyIds = [];
        if (managerId) notifyIds.push(managerId);
        notifyIds.push(...adminIds);
        if (notifyIds.length > 0) {
          await NotificationService.createAndSend(
            notifyIds,
            'New Project Document',
            `A new document was uploaded for project ID ${projectId}.`,
            'document',
            'PROJECT',
            projectId,
            tenantId
          );
        }
        const transformedDocs = transformDocuments(uploadedDocs, req);
        return res.status(201).json({ success: true, message: 'Documents uploaded successfully', data: { documents: transformedDocs } });
      } catch (err) {
        logger.error('Error in uploadForProject:', err);
        return next(err);
      }
    }
  ],

  uploadDocument: [
    upload.any(), // Accept any field name (documents, files, etc.)
    async (req, res, next) => {
      try {
        const tenantId = resolveTenantId(req);
        const userId = req.user._id || req.user.id;
        // Handle both camelCase and snake_case for projectId and clientId from body and params
        const rawProjectId = req.body.projectId || req.body.project_id || req.params.projectId || req.params.project_id;
        const rawClientId = req.body.clientId || req.body.client_id || req.params.clientId || req.params.client_id;
        const rawEntityType = req.body.entityType || req.body.entity_type || req.params.entityType || req.params.entity_type;
        const rawEntityId = req.body.entityId || req.body.entity_id || req.body.taskId || req.body.task_id || req.params.entityId || req.params.entity_id || 'GENERAL';

        // Resolve project and client IDs
        const { projectId, clientId } = await resolveIds(rawProjectId, rawClientId, tenantId);

        // Determine entity type, ensuring it's uppercase and defaults to 'TASK'
        let entityType = (rawEntityType || 'TASK').toUpperCase();
        if (projectId) entityType = 'PROJECT';
        else if (clientId) entityType = 'CLIENT';
        // Ensure entityType is one of the allowed values, default to 'TASK' if not
        if (!['PROJECT', 'CLIENT', 'TASK'].includes(entityType)) entityType = 'TASK';

        // Authorization check
        let allowed = false;
        if (isAdmin(req.user)) {
          allowed = true;
        } else if (isManager(req.user)) {
          if (projectId && await managerOwnsProject(projectId, req.user)) allowed = true;
          else if (clientId) allowed = await clientManagedByUser(clientId, req.user);
          // Managers can upload general documents
          if (!projectId && !clientId) allowed = true;
        } else if (isEmployee(req.user)) {
          if (projectId && await employeeHasTaskInProject(projectId, req.user)) allowed = true;
          else if (clientId) allowed = await employeeHasClientAccess(clientId, req.user);
          // Employees cannot upload general documents or documents not tied to their projects/clients
        }

        if (!allowed) {
          return res.status(403).json(errorResponse.forbidden('Insufficient permissions to upload document', 'FORBIDDEN'));
        }

        if (!req.files || req.files.length === 0) {
          return res.status(400).json(errorResponse.badRequest('No files uploaded', 'NO_FILES'));
        }

        const uploadedDocs = [];
        for (const file of req.files) {
          const documentId = makeId();
          const fileName = file.originalname;
          const mimeType = file.mimetype;
          const fileSize = file.size;
          const createdAt = new Date();

          const filename = documentId + path.extname(file.originalname || '');

          // Upload to storage
          const uploadResult = await storageService.upload(file, filename);
          const filePath = uploadResult.storagePath;
          const storageProvider = uploadResult.provider || 'local';

          // Insert into documents table (using both entityId for compatibility and specific clientId/projectId columns)
          await insertDocumentRecord({
            documentId,
            fileName,
            filePath,
            fileSize,
            mimeType,
            uploadedBy: userId,
            projectId,
            clientId,
            entityId: projectId || clientId || rawEntityId,
            entityType,
            storageProvider,
            createdAt
          }, tenantId);

          // Insert into document_access for the uploader
          await grantDocumentAccess(documentId, userId, tenantId, createdAt);

          uploadedDocs.push({
            documentId,
            fileName,
            filePath,
            fileSize,
            mimeType,
            uploadedBy: userId,
            projectId,
            clientId,
            entityType,
            createdAt,
          });
        }

        const transformedDocs = transformDocuments(uploadedDocs, req);
        return res.status(201).json({ success: true, message: 'Documents uploaded successfully', data: { documents: transformedDocs } });

      } catch (err) {
        logger.error("Error uploading document: ", err);
        return next(err);
      }
    }
  ],

  listDocuments: async (req, res, next) => {
    try {
      // Endpoint: GET /api/documents
      const tenantId = resolveTenantId(req);
      const userId = req.user._id || req.user.id;
      const hasTenant = await documentsUseTenant();
      let sql = 'SELECT d.* FROM documents d';
      let params = [];
      let conditions = [];

      if (hasTenant) {
        conditions.push('d.tenant_id = ?');
        params.push(tenantId);
      }

      // Support query filter if valid for role
      if (req.query.projectId) {
        const { projectId: resolvedPid } = await resolveIds(req.query.projectId, null, tenantId);
        if (!resolvedPid) {
          return res.status(400).json(errorResponse.badRequest('Invalid Project ID', 'BAD_REQUEST'));
        }
        conditions.push('d.projectId = ?');
        params.push(resolvedPid);
      }
      if (req.query.clientId) {
        const { clientId: resolvedCid } = await resolveIds(null, req.query.clientId, tenantId);
        if (!resolvedCid) {
          return res.status(400).json(errorResponse.badRequest('Invalid Client ID', 'BAD_REQUEST'));
        }
        conditions.push('d.clientId = ?');
        params.push(resolvedCid);
      }
      if (req.query.type) {
        conditions.push('d.entityType = ?');
        params.push(req.query.type);
      }

      if (isAdmin(req.user)) {
        // Admins see everything
      } else if (isManager(req.user)) {
        const myProjects = await q(
          'SELECT id, client_id FROM projects WHERE tenant_id = ? AND (project_manager_id = ? OR project_manager_id = ?)',
          [tenantId, userId, req.user.public_id || 'NONE']
        );
        const pIds = myProjects.map(p => p.id).filter(id => id);
        const cIds = myProjects.map(p => p.client_id).filter(id => id);
        if (pIds.length || cIds.length) {
          const roleFilters = [];
          if (pIds.length) roleFilters.push(`d.projectId IN (${pIds.map(() => '?').join(', ')})`);
          if (cIds.length) roleFilters.push(`d.clientId IN (${cIds.map(() => '?').join(', ')})`);
          roleFilters.push('d.uploadedBy = ?');
          conditions.push(`(${roleFilters.join(' OR ')})`);
          params.push(...pIds, ...cIds, userId);
        } else {
          conditions.push('d.uploadedBy = ?');
          params.push(userId);
        }
      } else if (isEmployee(req.user)) {
        const hasAssignmentTenant = await taskAssignmentsUseTenant();
        const assignmentTenantClause = hasAssignmentTenant ? 'AND ta.tenant_id = ?' : '';
        const employeeParams = hasAssignmentTenant ? [tenantId, userId, tenantId] : [tenantId, userId];
        const projectRows = await q(
          `
            SELECT DISTINCT p.id, p.client_id
            FROM task_assignments ta
            JOIN tasks t ON ta.task_id = t.id
            LEFT JOIN projects p ON t.project_id = p.id
            WHERE t.tenant_id = ?
              AND ta.user_id = ?
              ${assignmentTenantClause}
          `,
          employeeParams
        );
        const pIds = projectRows.map(p => p.id).filter(Boolean);
        const cIds = projectRows.map(p => p.client_id).filter(Boolean);
        const roleFilters = ['d.uploadedBy = ?'];
        params.push(userId);
        if (pIds.length) {
          roleFilters.push(`d.projectId IN (${pIds.map(() => '?').join(', ')})`);
          params.push(...pIds);
        }
        if (cIds.length) {
          roleFilters.push(`d.clientId IN (${cIds.map(() => '?').join(', ')})`);
          params.push(...cIds);
        }
        conditions.push(`(${roleFilters.join(' OR ')})`);
      }

      if (conditions.length) {
        sql += ' WHERE ' + conditions.join(' AND ');
      }

      sql += ' ORDER BY d.createdAt DESC LIMIT 500';

      const rows = await q(sql, params);
      const docs = transformDocuments(rows, req);
      return res.json({ success: true, data: { documents: docs } });

    } catch (err) { return next(err); }
  },

  getProjectDocuments: async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);
      const pId = req.params.projectId;
      const { projectId } = await resolveIds(pId, null, tenantId);
      if (!projectId) return res.status(404).json(errorResponse.notFound('Project not found', 'NOT_FOUND'));

      // Check Access
      let allowed = false;
      if (isAdmin(req.user)) allowed = true;
      else if (isManager(req.user)) allowed = await managerOwnsProject(projectId, req.user);
      else if (isEmployee(req.user)) allowed = await employeeHasTaskInProject(projectId, req.user);

      if (!allowed) return res.status(403).json(errorResponse.forbidden('Access denied', 'FORBIDDEN'));

      const hasTenant = await documentsUseTenant();
      const sql = hasTenant
        ? 'SELECT * FROM documents WHERE tenant_id = ? AND projectId = ? ORDER BY createdAt DESC'
        : 'SELECT * FROM documents WHERE projectId = ? ORDER BY createdAt DESC';
      const rows = await q(sql, hasTenant ? [tenantId, projectId] : [projectId]);
      const docs = transformDocuments(rows, req);
      return res.json({ success: true, data: { documents: docs } });
    } catch (e) { next(e); }
  },

  getClientDocuments: async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);
      const cId = req.params.clientId;
      const { clientId } = await resolveIds(null, cId, tenantId);
      if (!clientId) return res.status(404).json(errorResponse.notFound('Client not found', 'NOT_FOUND'));
      let allowed = false;
      if (isAdmin(req.user)) allowed = true;
      else if (isManager(req.user)) allowed = await clientManagedByUser(clientId, req.user);
      else if (isEmployee(req.user)) allowed = await employeeHasClientAccess(clientId, req.user);

      if (!allowed) return res.status(403).json(errorResponse.forbidden('Access denied', 'FORBIDDEN'));

      const hasTenant = await documentsUseTenant();
      const sql = hasTenant
        ? 'SELECT * FROM documents WHERE tenant_id = ? AND clientId = ? ORDER BY createdAt DESC'
        : 'SELECT * FROM documents WHERE clientId = ? ORDER BY createdAt DESC';
      const rows = await q(sql, hasTenant ? [tenantId, clientId] : [clientId]);
      const docs = transformDocuments(rows, req);
      return res.json({ success: true, data: { documents: docs } });

    } catch (e) { next(e); }
  },

  deleteDocument: async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);
      const docId = req.params.documentId;
      const doc = await loadDocumentForTenant(docId, tenantId);
      if (!doc) return res.status(404).json(errorResponse.notFound('Document not found', 'NOT_FOUND'));

      let allowed = false;
      if (isAdmin(req.user)) allowed = true;
      else if (isManager(req.user)) allowed = await canAccessDocumentRecord(doc, req.user);

      if (!allowed) return res.status(403).json(errorResponse.forbidden('Insufficient permissions to delete document', 'FORBIDDEN'));

      // Perform deletion
      if (doc.filePath) {
        try { await storageService.deleteFile(doc.filePath); } catch (e) { logger.warn("Failed to delete file from storage: " + e.message); }
      }

      const hasTenant = await documentsUseTenant();
      const hasAccessTenant = await documentAccessUsesTenant();
      await q(
        hasTenant ? 'DELETE FROM documents WHERE documentId = ? AND tenant_id = ?' : 'DELETE FROM documents WHERE documentId = ?',
        hasTenant ? [docId, tenantId] : [docId]
      );
      await q(
        hasAccessTenant ? 'DELETE FROM document_access WHERE documentId = ? AND tenant_id = ?' : 'DELETE FROM document_access WHERE documentId = ?',
        hasAccessTenant ? [docId, tenantId] : [docId]
      ); // Clean up access

      return res.json({ success: true, message: 'Document deleted' });

    } catch (e) { next(e); }
  },

  getDocumentPreview: async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);
      const id = req.params.id;
      const doc = await loadDocumentForTenant(id, tenantId);
      if (!doc) return res.status(404).json(errorResponse.notFound('Not found', 'NOT_FOUND'));

      const allowed = await canAccessDocumentRecord(doc, req.user);

      if (!allowed) return res.status(403).json(errorResponse.forbidden('Access denied', 'FORBIDDEN'));

      // Build absolute URL for preview
      const env = require('../config/env');
      let previewUrl = null;

      // Try to get signed S3 URL if using S3 storage
      const handle = await storageService.getDownloadHandle({ storagePath: doc.filePath }, { expiresIn: 300 }).catch(() => null);
      if (handle && handle.redirectUrl) {
        previewUrl = handle.redirectUrl;
      } else {
        // Build local file URL - remove leading slashes and construct absolute URL
        const filePath = doc.filePath && doc.filePath.startsWith('/') ? doc.filePath : '/' + doc.filePath;
        previewUrl = `${env.BASE_URL}${filePath}`;
      }

      return res.json({
        success: true,
        previewUrl,
        mimeType: doc.mimeType,
        fileName: doc.fileName
      });
    } catch (e) { next(e); }
  },

  downloadDocument: async (req, res, next) => {
    // Similar access check to preview
    // ...
    // For brevity, assume similar implementation
    try {
      const tenantId = resolveTenantId(req);
      const id = req.params.id;
      const doc = await loadDocumentForTenant(id, tenantId);
      if (!doc) return res.status(404).json(errorResponse.notFound('Not found', 'NOT_FOUND'));

      const allowed = await canAccessDocumentRecord(doc, req.user);

      if (!allowed) return res.status(403).json(errorResponse.forbidden('Access denied', 'FORBIDDEN'));

      // Serve
      const handle = await storageService.getDownloadHandle({ storagePath: doc.filePath }).catch(() => null);

      // If storage returned a signed redirect (S3), redirect the client
      if (handle && handle.redirectUrl) return res.redirect(handle.redirectUrl);

      // If storage returned a readable stream, pipe it to the response with proper headers
      if (handle && handle.stream) {
        const stream = handle.stream;
        const filename = (doc.fileName || 'download').replace(/"/g, '');
        try {
          res.setHeader('Content-Type', doc.mimeType || 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        } catch (e) {}
        stream.on('error', (err) => next(err));
        return stream.pipe(res);
      }

      // If storage exposed a publicPath, redirect there
      if (handle && handle.publicPath) return res.redirect(handle.publicPath);

      // Last-resort: redirect to the known filePath (served by express static)
      if (doc.filePath && typeof doc.filePath === 'string') {
        const publicPath = doc.filePath.startsWith('/') ? doc.filePath : '/' + doc.filePath;
        return res.redirect(publicPath);
      }

      return res.status(404).json(errorResponse.notFound('File not found', 'NOT_FOUND'));
    } catch (e) { next(e); }
  },

  // Legacy support for existing routes that might verify project members separately
  getProjectMembers: async (req, res, next) => {
    // Keep existing logic or stub
    return res.json({ success: true, data: { members: [] } });
  },

  assignDocumentAccess: async (req, res, next) => {
    return res.status(501).json({ message: "Not implemented in this RBAC version" });
  },

  getMyDocuments: async (req, res, next) => {
    // Redirect to listDocuments logic
    return module.exports.listDocuments(req, res, next);
  }

};
