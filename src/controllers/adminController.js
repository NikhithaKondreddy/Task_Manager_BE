const db = require(__root + 'db');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NotificationService = require('../services/notificationService');
const errorResponse = require(__root + 'utils/errorResponse');
const { loadSettings, saveSettings } = require('../services/settingsService');
const { assertTenantId } = require(__root + 'utils/tenantScope');

let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../../logger'); } catch (e2) { logger = console; } }
let env;
try { env = require(global.__root + 'config/env'); } catch (e) { env = require('../config/env'); }

const MODULES_FILE = path.join(__root, 'data', 'modules.json');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function resolveTenantId(req) {
  // Always use assertTenantId to ensure failure if no tenant context exists.
  // This helps prevent any accidental queries against the whole database.
  try {
    const tenantId = assertTenantId(req);
    if (!tenantId) throw new Error('Tenant context missing'); // Fallback if assert didn't throw but returned null
    return tenantId;
  } catch (e) {
    // Re-throw if it's already an error with status (likely from assertTenantId)
    if (e.status) throw e;
    
    // Default error for missing tenant
    const error = new Error('tenant_id is required and must be valid');
    error.status = 400;
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
}

function readModules() {
  try {
    if (!fs.existsSync(MODULES_FILE)) return [];
    const raw = fs.readFileSync(MODULES_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (e) { logger.error('readModules error', e && e.message); return []; }
}

function writeModules(arr) {
  try {
    fs.mkdirSync(path.dirname(MODULES_FILE), { recursive: true });
    fs.writeFileSync(MODULES_FILE, JSON.stringify(arr, null, 2), 'utf8');
    return true;
  } catch (e) { logger.error('writeModules error', e && e.message); return false; }
}

function buildSelect(table, baseCols, optionalCols = []) {
  return new Promise((resolve) => {
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table], (err, cols) => {
      try {
        if (err || !Array.isArray(cols) || cols.length === 0) return resolve(baseCols.join(', '));
        const present = new Set(cols.map(c => c.COLUMN_NAME));
        const colsToSelect = baseCols.concat(optionalCols.filter(c => present.has(c)));
        return resolve(colsToSelect.join(', '));
      } catch (e) {
        return resolve(baseCols.join(', '));
      }
    });
  });
}

function tableHasColumn(table, column) {
  return new Promise((resolve) => {
    db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column], (err, rows) => {
      if (err || !Array.isArray(rows)) return resolve(false);
      return resolve(rows.length > 0);
    });
  });
}

async function fetchClientDocuments(clientIds = []) {
  if (!clientIds.length) return {};
  const hasDocuments = await tableHasColumn('documents', 'entityType');
  if (!hasDocuments) return {};
  const rows = await q(
    'SELECT documentId as id, clientId as client_id, filePath as file_url, fileName as file_name, mimeType as file_type, createdAt as uploaded_at FROM documents WHERE entityType = ? AND clientId IN (?) ORDER BY createdAt DESC',
    ['CLIENT', clientIds]
  );

  const base = env.BASE_URL || env.FRONTEND_URL;
  return (rows || []).reduce((memo, row) => {
    if (!row || row.client_id === undefined || row.client_id === null) return memo;
    if (!memo[row.client_id]) memo[row.client_id] = [];
    try {
      if (row && row.file_url && String(row.file_url).startsWith('/uploads/')) {
        const rel = String(row.file_url).replace(/^\/uploads\//, '');
        const parts = rel.split('/').map(p => encodeURIComponent(p));
        row.file_url = base + '/uploads/' + parts.join('/');
      }
    } catch (e) { }
    memo[row.client_id].push(row);
    return memo;
  }, {});
}

function getColumnType(table, column) {
  return new Promise((resolve) => {
    db.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column], (err, rows) => {
      if (err || !Array.isArray(rows) || rows.length === 0) return resolve(null);
      return resolve(rows[0].DATA_TYPE);
    });
  });
}

function safeSelect(table, baseCols, optionalCols = [], whereClause = '', params = [], cb) {
  (async () => {
    try {
      const selectCols = await buildSelect(table, baseCols, optionalCols).catch(() => baseCols.join(', '));
      const sql = `SELECT ${selectCols} FROM ${table} ${whereClause || ''}`;
      db.query(sql, params, (err, rows) => {
        if (!err) return cb(null, rows);
        if (err && err.code === 'ER_BAD_FIELD_ERROR') {
          db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [table], (colErr, cols) => {
            if (colErr || !Array.isArray(cols) || cols.length === 0) return cb(err);
            const present = new Set(cols.map(c => c.COLUMN_NAME));
            const colsToSelect = baseCols.concat(optionalCols.filter(c => present.has(c))).filter(c => present.has(c));
            if (colsToSelect.length === 0) return cb(err);
            const sql2 = `SELECT ${colsToSelect.join(', ')} FROM ${table} ${whereClause || ''}`;
            db.query(sql2, params, (err2, rows2) => cb(err2, rows2));
          });
        } else return cb(err);
      });
    } catch (e) { return cb(e); }
  })();
}

module.exports = {
  getDashboard: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const totalUsers = (await q('SELECT COUNT(*) AS c FROM users WHERE tenant_id = ? AND COALESCE(isActive, 1) = 1', [tenantId]))[0].c || 0;
      const totalClients = (await q('SELECT COUNT(*) AS c FROM clients WHERE tenant_id = ? AND COALESCE(isDeleted, 0) != 1', [tenantId]))[0].c || 0;
      const totalProjects = (await q('SELECT COUNT(*) AS c FROM projects WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1', [tenantId]))[0].c || 0;
      const totalTasks = (await q('SELECT COUNT(*) AS c FROM tasks WHERE tenant_id = ?', [tenantId]))[0].c || 0;
      const pendingTasks = (await q("SELECT COUNT(*) AS c FROM tasks WHERE tenant_id = ? AND UPPER(status) IN ('PENDING', 'NOT STARTED', 'TO DO')", [tenantId]))[0].c || 0;
      const inProgressTasks = (await q("SELECT COUNT(*) AS c FROM tasks WHERE tenant_id = ? AND UPPER(status) IN ('IN PROGRESS', 'IN_PROGRESS')", [tenantId]))[0].c || 0;
      const completedTasks = (await q("SELECT COUNT(*) AS c FROM tasks WHERE tenant_id = ? AND UPPER(status) IN ('COMPLETED', 'APPROVED')", [tenantId]))[0].c || 0;
      const overdueTasks = (await q("SELECT COUNT(*) AS c FROM tasks WHERE tenant_id = ? AND taskDate < CURDATE() AND UPPER(status) NOT IN ('COMPLETED', 'APPROVED', 'CLOSED')", [tenantId]))[0].c || 0;

      const recentProjects = await q(
        `SELECT p.id, p.public_id, p.name, p.status, p.created_at, c.name AS client_name
         FROM projects p
         LEFT JOIN clients c ON c.id = p.client_id AND c.tenant_id = p.tenant_id
         WHERE p.tenant_id = ?
           AND COALESCE(p.is_active, 1) = 1
         ORDER BY p.created_at DESC
         LIMIT 5`,
        [tenantId]
      );

      return res.json({
        status: 'success',
        data: {
          dashboardMetrics: {
            totalUsers,
            totalClients,
            totalProjects,
            totalTasks,
            pendingTasks,
            inProgressTasks,
            completedTasks,
            overdueTasks
          },
          recentProjects
        },
        requestId: `REQ-${Math.floor(Math.random() * 100000)}`,
        timestamp: new Date().toISOString()
      });
    } catch (e) {
      logger.error('Dashboard error:', e && e.message ? e.message : e);
      return res.status(500).json({
        status: 'error',
        message: 'Unable to load dashboard data',
        errorCode: 'DASHBOARD_FETCH_FAILED',
        requestId: `REQ-${Math.floor(Math.random() * 100000)}`
      });
    }
  },

  manageUsers: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const rows = await q(
        "SELECT _id, public_id, name, email, role, isActive, tenant_id, department_public_id FROM users WHERE tenant_id = ? AND role NOT IN ('SuperAdmin', 'Super-Admin') ORDER BY createdAt DESC",
        [tenantId]
      );
      const out = rows.map((row) => ({
        id: row.public_id || row._id,
        internal_id: row._id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: row.isActive,
        department_public_id: row.department_public_id || null,
        tenant_id: row.tenant_id
      }));
      return res.json({ success: true, data: out });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  },

  updateUser: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const { id } = req.params;
      const { name, title, email, role, isActive, isGuest, phone, departmentId, departmentName } = req.body;

      if (!name || !email || !role) {
        return res.status(400).json(errorResponse.badRequest('Name, email and role are required', 'MISSING_REQUIRED_FIELD'));
      }

      const department = await resolveDepartment(departmentId || departmentName, tenantId);
      if (!department && (departmentId || departmentName)) {
        return res.status(400).json({ success: false, message: 'Invalid department' });
      }
      const departmentPublicId = department ? department.public_id : null;

      const derivedIsGuest = typeof isGuest === 'undefined' ? role === 'Client-Viewer' : Boolean(isGuest);
      const derivedIsActive = typeof isActive === 'undefined' ? !derivedIsGuest : Boolean(isActive);
      if (!validateGuestState(derivedIsActive, derivedIsGuest)) {
        return res.status(400).json({ success: false, message: 'Choose exactly one user state: active user or guest' });
      }

      const isNumeric = /^\d+$/.test(String(id));

      const updates = {};
      if (name !== undefined) updates.name = name;
      if (title !== undefined) updates.title = title;
      if (email !== undefined) updates.email = email;
      if (role !== undefined) updates.role = role;
      updates.isActive = derivedIsActive;
      updates.isGuest = derivedIsGuest;
      if (phone !== undefined) updates.phone = phone;
      updates.department_public_id = departmentPublicId;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json(errorResponse.badRequest('No fields to update', 'NO_FIELDS_PROVIDED'));
      }

      const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
      const values = Object.values(updates);
      values.push(id, tenantId);

      const sql = `UPDATE users SET ${setClause} WHERE ${isNumeric ? '_id' : 'public_id'} = ? AND tenant_id = ?`;

      db.query(sql, values, (err, result) => {
        if (err) {
          logger.error(`Database error updating user ${id}: ${err.message}`);
          return res.status(500).json({ success: false, message: "Database error", error: err.message });
        }
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "User not found" });

        const selectSql = `
          SELECT u._id, u.public_id, u.name, u.title, u.email, u.role, u.isActive, u.phone, u.isGuest, u.tenant_id,
                 u.department_public_id, d.name AS department_name
          FROM users u
          LEFT JOIN departments d ON d.public_id = u.department_public_id
          WHERE ${isNumeric ? 'u._id' : 'u.public_id'} = ? AND u.tenant_id = ? LIMIT 1
        `;
        db.query(selectSql, [id, tenantId], (err, user) => {
          if (err || !user || user.length === 0) {
            return res.status(200).json({
              success: true,
              message: "User updated but could not fetch updated data",
              user: { id, name, email, role, title, isActive: Boolean(derivedIsActive), phone: phone || null, departmentPublicId }
            });
          }

          const u = user[0];
          res.status(200).json({
            success: true,
            message: "User updated successfully",
            user: {
              id: u.public_id || u._id,
              name: u.name,
              email: u.email,
              role: u.role,
              title: u.title,
              isActive: u.isActive,
              phone: u.phone,
              isGuest: u.isGuest || false,
              tenant_id: u.tenant_id || tenantId,
              departmentPublicId: u.department_public_id,
              departmentName: u.department_name
            }
          });
        });
      });

    } catch (error) {
      logger.error('Update user error:', error);
      return res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
    }
  },

  deleteUser: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const { user_id } = req.params;
      const isNumeric = /^\d+$/.test(String(user_id));
      const sqlDelete = isNumeric
        ? `DELETE FROM users WHERE _id = ? AND tenant_id = ?`
        : `DELETE FROM users WHERE public_id = ? AND tenant_id = ?`;
      db.query(sqlDelete, [user_id, tenantId], (err, result) => {
        if (err) return res.status(500).json({ success: false, message: "Database error", error: err.message });
        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "User not found" });
        return res.status(200).json({ success: true, message: "User deactivated successfully" });
      });
    } catch (error) {
      logger.error('Delete user error:', error);
      return res.status(500).json({ success: false, message: 'Failed to delete user', error: error.message });
    }
  },

  manageClients: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const rows = await q(
        `SELECT c.id, c.ref, c.name, c.company, c.email, c.phone, c.status, c.created_at, c.manager_id, c.tenant_id,
                u.public_id AS manager_public_id, u.name AS manager_name
         FROM clients c
         LEFT JOIN users u ON u._id = c.manager_id AND u.tenant_id = c.tenant_id
         WHERE c.tenant_id = ?
         ORDER BY c.created_at DESC`,
        [tenantId]
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  },

  manageDepartments: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const filterUserParam = req.query.userId;

      const runQuery = async (resolvedUserId) => {
        const hasPublic = await tableHasColumn('departments', 'public_id');
        const optional = [].concat(hasPublic ? ['public_id'] : []).concat(['manager_id', 'head_id']);
        
        // Isolation: Always filter by tenant_id
        const baseWhere = 'WHERE tenant_id = ?';
        const baseParams = [tenantId];

        safeSelect('departments', ['id', 'name', 'created_at'], optional, baseWhere, baseParams, (err, rows) => {
          if (err) return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
          const finishWith = (outRows) => {
            try {
              const userIds = Array.from(new Set((outRows || []).map(r => r.manager_id).concat((outRows || []).map(r => r.head_id)).filter(Boolean)));
              if (userIds.length === 0) return res.json({ success: true, data: outRows });
              
              // Isolation: Filter users query by tenant_id
              db.query('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND (_id IN (?) OR public_id IN (?))', [tenantId, userIds, userIds], (uErr, uRows) => {
                if (uErr || !Array.isArray(uRows)) return res.json({ success: true, data: outRows });
                const mapId = {};
                const mapName = {};
                uRows.forEach(u => {
                  if (u._id) mapId[String(u._id)] = u.public_id || String(u._id);
                  if (u.public_id) mapId[String(u.public_id)] = u.public_id || String(u._id);
                  if (u._id) mapName[String(u._id)] = u.name || null;
                  if (u.public_id) mapName[String(u.public_id)] = u.name || null;
                });
                const out = outRows.map(r => ({
                  ...r,
                  id: r.public_id || r.id,
                  manager_id: r.manager_id ? (mapId[String(r.manager_id)] || r.manager_id) : null,
                  manager_name: r.manager_name ? r.manager_name : (r.manager_id ? (mapName[String(r.manager_id)] || null) : null),
                  head_id: r.head_id ? (mapId[String(r.head_id)] || r.head_id) : null,
                  head_name: r.head_name ? r.head_name : (r.head_id ? (mapName[String(r.head_id)] || null) : null)
                }));
                return res.json({ success: true, data: out });
              });
            } catch (e) {
              return res.json({ success: true, data: outRows });
            }
          };

          if (!resolvedUserId) return finishWith(rows);
          db.query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'departments' AND TABLE_SCHEMA = DATABASE() AND COLUMN_NAME IN ('head_id','manager_id','created_by','user_id')", [], (colErr, cols) => {
            if (colErr || !Array.isArray(cols) || cols.length === 0) return finishWith(rows);
            const colNames = cols.map(c => c.COLUMN_NAME);
            
            // Isolation: Combine tenant_id with column filters
            const whereParts = colNames.map(n => `(${n} = ?)`).join(' OR ');
            const finalWhere = `WHERE tenant_id = ? AND (${whereParts})`;
            const params = [tenantId, ...colNames.map(() => resolvedUserId)];

            const hasPublic2 = colNames.includes('public_id');
            const optional2 = [].concat(hasPublic2 ? ['public_id'] : []).concat(['manager_id', 'head_id']);

            safeSelect('departments', ['id', 'name', 'created_at'], optional2, finalWhere, params, (fErr, fRows) => {
              if (fErr) return finishWith(rows);
              return finishWith(fRows);
            });
          });
        });
      };

      if (filterUserParam) {
        // Isolation: Filter user lookup by tenant_id
        db.query('SELECT _id FROM users WHERE (public_id = ? OR _id = ?) AND tenant_id = ? LIMIT 1', [filterUserParam, filterUserParam, tenantId], (err, rows) => {
          if (err) return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
          if (!rows || rows.length === 0) return res.status(404).json(errorResponse.notFound('User not found in your tenant', 'NOT_FOUND'));
          runQuery(rows[0]._id);
        });
        return;
      }

      // If requester is a Manager and no explicit filter provided, allow fetching all tenant departments
      // (so managers can see departments created by Admins as well).
      if (!filterUserParam && req.user && String(req.user.role).toLowerCase() === 'manager') {
        runQuery(null);
      } else {
        runQuery(null);
      }
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  },

  createDepartment: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const { name, managerId, headId } = req.body;
      if (!name) return res.status(400).json(errorResponse.badRequest('Department name required', 'BAD_REQUEST'));

      const resolveUser = (rawId) => new Promise((resolve, reject) => {
        if (!rawId) return resolve(null);
        // FIX: Scoped by tenantId
        db.query('SELECT _id FROM users WHERE (public_id = ? OR _id = ?) AND tenant_id = ? LIMIT 1', [rawId, rawId, tenantId], (e, rows) => {
          if (e) return reject(e);
          if (!rows || rows.length === 0) return resolve(null);
          return resolve(rows[0]._id);
        });
      });

      const getColumnType = (table, column) => new Promise((resolve) => {
        db.query("SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column], (err, rows) => {
          if (err || !Array.isArray(rows) || rows.length === 0) return resolve(null);
          return resolve(rows[0].DATA_TYPE);
        });
      });

      const hasManager = await tableHasColumn('departments', 'manager_id');
      const hasHead = await tableHasColumn('departments', 'head_id');
      const hasCreatedBy = await tableHasColumn('departments', 'created_by');
      const hasPublic = await tableHasColumn('departments', 'public_id');
      const hasTenantId = await tableHasColumn('departments', 'tenant_id');
      const hasManagerNameCol = await tableHasColumn('departments', 'manager_name');
      const hasHeadNameCol = await tableHasColumn('departments', 'head_name');

      let manager_id = null;
      let head_id = null;
      let manager_name_val = null;
      let head_name_val = null;
      if (hasManager) {
        manager_id = await resolveUser(managerId).catch(() => null);
        if (req.body) {
          if (req.body.managerName) manager_name_val = String(req.body.managerName).trim();
          else if (req.body.manager_name) manager_name_val = String(req.body.manager_name).trim();
        }
        if ((manager_id === null || manager_id === undefined) && managerId) {
          const colType = await getColumnType('departments', 'manager_id').catch(() => null);
          if (colType && ['varchar', 'char', 'text'].includes(String(colType).toLowerCase())) {
            manager_id = managerId;
          }
        }
      }
      if (hasHead) {
        head_id = await resolveUser(headId).catch(() => null);
        if (req.body) {
          if (req.body.headName) head_name_val = String(req.body.headName).trim();
          else if (req.body.head_name) head_name_val = String(req.body.head_name).trim();
        }
        if ((head_id === null || head_id === undefined) && headId) {
          const colType = await getColumnType('departments', 'head_id').catch(() => null);
          if (colType && ['varchar', 'char', 'text'].includes(String(colType).toLowerCase())) head_id = headId;
        }
      }
      const created_by = hasCreatedBy ? (req.user && req.user._id ? req.user._id : null) : null;

      const publicId = hasPublic ? crypto.randomBytes(8).toString('hex') : null;
      const fields = ['name'];
      const placeholders = ['?'];
      const params = [name];
      if (hasManager) { fields.push('manager_id'); placeholders.push('?'); params.push(manager_id); }
      if (hasManagerNameCol) { fields.push('manager_name'); placeholders.push('?'); params.push(manager_name_val); }
      if (hasHead) { fields.push('head_id'); placeholders.push('?'); params.push(head_id); }
      if (hasHeadNameCol) { fields.push('head_name'); placeholders.push('?'); params.push(head_name_val); }
      if (hasCreatedBy) { fields.push('created_by'); placeholders.push('?'); params.push(created_by); }
      if (hasPublic) { fields.unshift('public_id'); placeholders.unshift('?'); params.unshift(publicId); }
      
      // FIX: Add tenant_id to fields
      if (hasTenantId) { fields.push('tenant_id'); placeholders.push('?'); params.push(tenantId); }

      const sql = `INSERT INTO departments (${fields.join(', ')}, created_at) VALUES (${placeholders.join(', ')}, NOW())`;
      logger.info('createDepartment insert:', sql, params);
      db.query(sql, params, (err, result) => {
        if (err) {
          logger.error('createDepartment error', err && err.message);
          return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
        }
        const insertId = result && result.insertId ? result.insertId : null;
        if (!insertId) return res.status(201).json({ success: true, data: { id: insertId, name, manager_id, head_id } });
        (async () => {
          try {
            await NotificationService.createAndSendToRoles(['Admin'], 'Department Created', `New department "${name}" has been created`, 'DEPARTMENT_CREATED', 'department', insertId, tenantId);
          } catch (notifErr) {
            logger.error('Department creation notification error:', notifErr);
          }
          const selOptional = [].concat(hasPublic ? ['public_id'] : [])
            .concat(['manager_id', 'head_id'])
            .concat(hasManagerNameCol ? ['manager_name'] : [])
            .concat(hasHeadNameCol ? ['head_name'] : []);
          
          // FIX: Scoped select
          safeSelect('departments', ['id', 'name'], selOptional, 'WHERE id = ? AND tenant_id = ? LIMIT 1', [insertId, tenantId], (sErr, rows) => {
            if (sErr) return res.status(201).json({ success: true, data: { id: hasPublic ? publicId : insertId, name, manager_id, head_id } });
            const row = (rows && rows[0]) || { id: insertId, name, manager_id, head_id, public_id: publicId, manager_name: manager_name_val, head_name: head_name_val };
            if ((row.manager_name || row.head_name) && (row.manager_name || row.head_name).length >= 0) {
              const outRow = {
                id: row.public_id || row.id,
                name: row.name,
                manager_id: row.manager_id ? String(row.manager_id) : null,
                manager_name: row.manager_name || null,
                head_id: row.head_id ? String(row.head_id) : null,
                head_name: row.head_name || null
              };
              const uids = [];
              if (row.manager_id) uids.push(row.manager_id);
              if (row.head_id) uids.push(row.head_id);
              if (uids.length === 0) return res.status(201).json({ success: true, data: outRow });
              
              // FIX: Scoped select for users
              db.query('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND (_id IN (?) OR public_id IN (?))', [tenantId, uids, uids], (uErr, uRows) => {
                if (uErr || !Array.isArray(uRows)) return res.status(201).json({ success: true, data: outRow });
                const mapId = {};
                uRows.forEach(u => {
                  if (u._id) mapId[String(u._id)] = u.public_id || String(u._id);
                  if (u.public_id) mapId[String(u.public_id)] = u.public_id || String(u._id);
                });
                outRow.manager_id = row.manager_id ? (mapId[String(row.manager_id)] || String(row.manager_id)) : null;
                outRow.head_id = row.head_id ? (mapId[String(row.head_id)] || String(row.head_id)) : null;
                return res.status(201).json({ success: true, data: outRow });
              });
            } else {

              const uids = [];
              if (row.manager_id) uids.push(row.manager_id);
              if (row.head_id) uids.push(row.head_id);
              if (uids.length === 0) return res.status(201).json({ success: true, data: { id: row.public_id || row.id, name: row.name, manager_id: row.manager_id, manager_name: null, head_id: row.head_id, head_name: null } });
              
              // FIX: Scoped select for users
              db.query('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND (_id IN (?) OR public_id IN (?))', [tenantId, uids, uids], (uErr, uRows) => {
                if (uErr || !Array.isArray(uRows)) return res.status(201).json({ success: true, data: { id: row.public_id || row.id, name: row.name, manager_id: row.manager_id, manager_name: null, head_id: row.head_id, head_name: null } });
                const mapId = {};
                const mapName = {};
                uRows.forEach(u => {
                  if (u._id) mapId[String(u._id)] = u.public_id || String(u._id);
                  if (u.public_id) mapId[String(u.public_id)] = u.public_id || String(u._id);
                  if (u._id) mapName[String(u._id)] = u.name || null;
                  if (u.public_id) mapName[String(u.public_id)] = u.name || null;
                });
                const outRow = {
                  id: row.public_id || row.id,
                  name: row.name,
                  manager_id: row.manager_id ? (mapId[String(row.manager_id)] || row.manager_id) : null,
                  manager_name: row.manager_name ? row.manager_name : (row.manager_id ? (mapName[String(row.manager_id)] || null) : null),
                  head_id: row.head_id ? (mapId[String(row.head_id)] || row.head_id) : null,
                  head_name: row.head_name ? row.head_name : (row.head_id ? (mapName[String(row.head_id)] || null) : null)
                };
                return res.status(201).json({ success: true, data: outRow });
              });
            }
          });
        })();
      });
    } catch (e) {
      logger.error('createDepartment catch', e && e.message);
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
    }
  },

  updateDepartment: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      let { id } = req.params;
      if (!id) return res.status(400).json(errorResponse.badRequest('Department id required', 'BAD_REQUEST'));
      
      // FIX: Scoped resolve ID
      if (!/^\d+$/.test(String(id))) {
        const rows = await new Promise((resolve) => db.query('SELECT id FROM departments WHERE public_id = ? AND tenant_id = ? LIMIT 1', [id, tenantId], (e, r) => e ? resolve([]) : resolve(r)));
        if (!rows || !rows[0]) return res.status(404).json(errorResponse.notFound('Department not found in your tenant', 'NOT_FOUND'));
        id = rows[0].id;
      }
      const { name, managerId, headId } = req.body;

      const resolveUser = (rawId) => new Promise((resolve, reject) => {
        if (!rawId) return resolve(null);
        // FIX: Scoped by tenantId
        db.query('SELECT _id FROM users WHERE (public_id = ? OR _id = ?) AND tenant_id = ? LIMIT 1', [rawId, rawId, tenantId], (e, rows) => {
          if (e) return reject(e);
          if (!rows || rows.length === 0) return resolve(null);
          return resolve(rows[0]._id);
        });
      });

      const updates = [];
      const params = [];
      const hasManagerCol = await tableHasColumn('departments', 'manager_id');
      const hasHeadCol = await tableHasColumn('departments', 'head_id');
      if (name) { updates.push('name = ?'); params.push(name); }
      if (managerId !== undefined && hasManagerCol) {
        const m = await resolveUser(managerId).catch(() => null);
        let finalM = m;
        if ((finalM === null || finalM === undefined) && managerId) {
          const colType = await getColumnType('departments', 'manager_id').catch(() => null);
          if (colType && ['varchar', 'char', 'text'].includes(String(colType).toLowerCase())) finalM = managerId;
        }
        updates.push('manager_id = ?'); params.push(finalM);
      }
      if (headId !== undefined && hasHeadCol) {
        const h = await resolveUser(headId).catch(() => null);
        let finalH = h;
        if ((finalH === null || finalH === undefined) && headId) {
          const colType = await getColumnType('departments', 'head_id').catch(() => null);
          if (colType && ['varchar', 'char', 'text'].includes(String(colType).toLowerCase())) finalH = headId;
        }
        updates.push('head_id = ?'); params.push(finalH);
      }

      if (updates.length === 0) return res.status(400).json(errorResponse.badRequest('No fields to update', 'BAD_REQUEST'));
      
      // FIX: Scoped update
      const sql = `UPDATE departments SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ? AND tenant_id = ?`;
      params.push(id, tenantId);
      db.query(sql, params, (err, result) => {
        if (err) {
          logger.error('updateDepartment error', err && err.message);
          return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
        }
        if (!result || result.affectedRows === 0) return res.status(404).json(errorResponse.notFound('Department not found', 'NOT_FOUND'));
        (async () => {
          try {
            await NotificationService.createAndSendToRoles(['Admin'], 'Department Updated', `Department "${name || 'Unknown'}" has been updated`, 'DEPARTMENT_UPDATED', 'department', id, tenantId);
          } catch (notifErr) {
            logger.error('Department update notification error:', notifErr);
          }
          const hasPublic = await tableHasColumn('departments', 'public_id');
          const selOptional = [].concat(hasPublic ? ['public_id'] : []).concat(['manager_id', 'head_id']);
          
          // FIX: Scoped select
          safeSelect('departments', ['id', 'name'], selOptional, 'WHERE id = ? AND tenant_id = ? LIMIT 1', [id, tenantId], (sErr, rows) => {
            if (sErr) return res.status(200).json({ success: true, message: 'Department updated' });
            const row = (rows && rows[0]) || {};
            const uids = [];
            if (row.manager_id) uids.push(row.manager_id);
            if (row.head_id) uids.push(row.head_id);
            if (uids.length === 0) return res.status(200).json({ success: true, data: { id: row.public_id || row.id, name: row.name, manager_id: row.manager_id, manager_name: null, head_id: row.head_id, head_name: null } });
            
            // FIX: Scoped select for users
            db.query('SELECT _id, public_id, name FROM users WHERE tenant_id = ? AND (_id IN (?) OR public_id IN (?))', [tenantId, uids, uids], (uErr, uRows) => {
              if (uErr || !Array.isArray(uRows)) return res.status(200).json({ success: true, data: { id: row.public_id || row.id, name: row.name, manager_id: row.manager_id, manager_name: null, head_id: row.head_id, head_name: null } });
              const mapId = {};
              const mapName = {};
              uRows.forEach(u => {
                if (u._id) mapId[String(u._id)] = u.public_id || String(u._id);
                if (u.public_id) mapId[String(u.public_id)] = u.public_id || String(u._id);
                if (u._id) mapName[String(u._id)] = u.name || null;
                if (u.public_id) mapName[String(u.public_id)] = u.name || null;
              });
              const outRow = {
                id: row.public_id || row.id,
                name: row.name,
                manager_id: row.manager_id ? (mapId[String(row.manager_id)] || row.manager_id) : null,
                manager_name: row.manager_id ? (mapName[String(row.manager_id)] || null) : null,
                head_id: row.head_id ? (mapId[String(row.head_id)] || row.head_id) : null,
                head_name: row.head_id ? (mapName[String(row.head_id)] || null) : null
              };
              return res.status(200).json({ success: true, data: outRow });
            });
          });
        })();
      });
    } catch (e) {
      logger.error('updateDepartment catch', e && e.message);
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: e.message }));
    }
  },

  deleteDepartment: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      let { id } = req.params;
      if (!id) return res.status(400).json(errorResponse.badRequest('Department id required', 'BAD_REQUEST'));
      
      // FIX: Scoped delete
      const sql = /^\d+$/.test(String(id)) 
        ? 'DELETE FROM departments WHERE id = ? AND tenant_id = ?'
        : 'DELETE FROM departments WHERE public_id = ? AND tenant_id = ?';
      
      db.query(sql, [id, tenantId], (err, result) => {
        if (err) {
          logger.error('deleteDepartment error', err && err.message);
          return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
        }
        if (!result || result.affectedRows === 0) return res.status(404).json(errorResponse.notFound('Department not found', 'NOT_FOUND'));
        (async () => {
          try {
            await NotificationService.createAndSendToRoles(['Admin'], 'Department Deleted', `Department with ID "${id}" has been deleted`, 'DEPARTMENT_DELETED', 'department', id, tenantId);
          } catch (notifErr) {
            logger.error('Department delete notification error:', notifErr);
          }
        })();
        return res.json({ success: true, message: 'Department deleted successfully' });
      });
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  },

  manageProjects: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const rows = await q(
        `SELECT p.id, p.public_id, p.name, p.description, p.status, p.project_manager_id, p.tenant_id,
                u.public_id AS manager_public_id, u.name AS manager_name
         FROM projects p
         LEFT JOIN users u ON u._id = p.project_manager_id AND u.tenant_id = p.tenant_id
         WHERE p.tenant_id = ?
         ORDER BY p.created_at DESC`,
        [tenantId]
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  },

  manageTasks: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const rows = await q(
        `SELECT id, public_id, title, description, status, priority, stage, taskDate, started_at, completed_at, total_duration, time_alloted, tenant_id
         FROM tasks
         WHERE tenant_id = ?
         ORDER BY createdAt DESC`,
        [tenantId]
      );
      return res.json({ success: true, data: rows });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  },

  getModules: (req, res) => {
    const modules = readModules();
    return res.json({ success: true, data: modules });
  },

  getModuleById: (req, res) => {
    const { id } = req.params;
    const modules = readModules();
    const m = modules.find(x => x.moduleId === id);
    if (!m) return res.status(404).json(errorResponse.notFound('Module not found', 'NOT_FOUND'));
    return res.json({ success: true, data: m });
  },

  createModule: (req, res) => {
    const { name, description } = req.body;
    if (!name) return res.status(400).json(errorResponse.badRequest('name required', 'BAD_REQUEST'));
    const modules = readModules();
    const moduleId = crypto.randomBytes(8).toString('hex');
    const m = { moduleId, name, description: description || '' };
    modules.push(m);
    if (!writeModules(modules)) return res.status(500).json({ success: false, message: 'Failed to save module' });
    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin'], 'Module Created', `New module "${name}" has been created`, 'MODULE_CREATED', 'module', moduleId, req.user ? req.user.tenant_id : null);
      } catch (notifErr) {
        logger.error('Module creation notification error:', notifErr);
      }
    })();
    return res.status(201).json({ success: true, data: m });
  },

  updateModule: (req, res) => {
    const { id } = req.params;
    const { name, description } = req.body;
    const modules = readModules();
    const idx = modules.findIndex(x => x.moduleId === id);
    if (idx === -1) return res.status(404).json(errorResponse.notFound('Module not found', 'NOT_FOUND'));
    if (name) modules[idx].name = name;
    if (description !== undefined) modules[idx].description = description;
    if (!writeModules(modules)) return res.status(500).json({ success: false, message: 'Failed to write module' });
    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin'], 'Module Updated', `Module "${name || modules[idx].name}" has been updated`, 'MODULE_UPDATED', 'module', id, req.user ? req.user.tenant_id : null);
      } catch (notifErr) {
        logger.error('Module update notification error:', notifErr);
      }
    })();
    return res.json({ success: true, data: modules[idx] });
  },

  deleteModule: (req, res) => {
    const { id } = req.params;
    let modules = readModules();
    const idx = modules.findIndex(x => x.moduleId === id);
    if (idx === -1) return res.status(404).json(errorResponse.notFound('Module not found', 'NOT_FOUND'));
    const removed = modules.splice(idx, 1)[0];
    if (!writeModules(modules)) return res.status(500).json({ success: false, message: 'Failed to write module' });
    (async () => {
      try {
        await NotificationService.createAndSendToRoles(['Admin'], 'Module Deleted', `Module "${removed.name}" has been deleted`, 'MODULE_DELETED', 'module', id, req.user ? req.user.tenant_id : null);
      } catch (notifErr) {
        logger.error('Module delete notification error:', notifErr);
      }
    })();
    return res.json({ success: true, data: removed });
  },

  getSettings: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const settings = await loadSettings(tenantId);
      return res.json({ success: true, data: { version: '1.0.0', general: settings.general } });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Failed to fetch settings', 'SERVER_ERROR', { details: err.message }));
    }
  },


  putSettings: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const payload = req.body && typeof req.body === 'object' ? req.body : {};
      const updates = payload.general && typeof payload.general === 'object' ? payload.general : payload;
      const normalizeValue = (value) => {
        if (value === undefined) return undefined;
        if (value === null) return null;
        if (Array.isArray(value)) return value.join('');
        return String(value);
      };
      const timestampPayload = updates.timestamps;
      const normalizedTimestamps = timestampPayload === undefined
        ? undefined
        : (typeof timestampPayload === 'string' ? timestampPayload : JSON.stringify(timestampPayload));
      const saved = await saveSettings(tenantId, {
        site_name: normalizeValue(updates.site_name ?? updates.siteName),
        support_email: normalizeValue(updates.support_email ?? updates.supportEmail ?? updates.email_id),
        email_id: normalizeValue(updates.email_id ?? updates.support_email ?? updates.supportEmail),
        timezone: normalizeValue(updates.timezone),
        logo_url: normalizeValue(updates.logo_url ?? updates.logoUrl),
        timestamps: normalizedTimestamps
      });
      return res.json({ success: true, message: 'Settings updated', data: { version: '1.0.0', general: saved.general } });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Failed to update settings', 'SERVER_ERROR', { details: err.message }));
    }
  },

  uploadLogo: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const uniqueName = `logo-${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._()-]/g, '_')}`;
      const uploadsDir = path.join(process.cwd(), 'uploads');

      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const dest = path.join(uploadsDir, uniqueName);
      fs.writeFileSync(dest, req.file.buffer);

      const storedPath = '/uploads/' + uniqueName;

      await saveSettings(tenantId, { logo_url: storedPath });
      const fileUrl = `${req.protocol}://${req.get('host')}${storedPath}`;
      return res.status(200).json({
        success: true,
        message: 'Logo uploaded successfully',
        logo_url: storedPath,
        full_url: fileUrl
      });
    } catch (error) {
      logger.error('Logo upload error:', error);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  },

  listManagers: async (req, res) => {
    try {
      const tenantId = resolveTenantId(req);
      const rows = await q(
        `SELECT u._id, u.public_id, u.name, u.email, u.role, u.isActive, u.tenant_id, u.department_public_id, d.name AS department_name
         FROM users u
         LEFT JOIN departments d ON d.public_id = u.department_public_id AND d.tenant_id = u.tenant_id
         WHERE u.tenant_id = ? AND u.role = 'Manager'
         ORDER BY u.createdAt DESC`,
        [tenantId]
      );
      const out = rows.map((row) => ({
        id: row.public_id || String(row._id),
        internal_id: row._id,
        name: row.name,
        email: row.email,
        role: row.role,
        isActive: Boolean(row.isActive),
        department_id: row.department_public_id || null,
        department_name: row.department_name || null,
        tenant_id: row.tenant_id
      }));
      return res.json({ success: true, data: out });
    } catch (err) {
      return res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: err.message }));
    }
  }
};

async function resolveDepartment(input, tenantId) {
  if (!input) return null;
  const rows = await q(
    `
      SELECT id, public_id, name
      FROM departments
      WHERE (public_id = ? OR name = ? OR id = ?)
        AND tenant_id = ?
      LIMIT 1
    `,
    [input, input, /^\d+$/.test(String(input)) ? Number(input) : -1, tenantId]
  );
  return rows && rows.length ? rows[0] : null;
}

function validateGuestState(isActive, isGuest) {
  const activeValue = Boolean(isActive);
  const guestValue = Boolean(isGuest);
  return activeValue !== guestValue;
}

