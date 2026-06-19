const db = require(__root + 'db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

let emailService;
try { emailService = require(__root + 'services/emailService'); } catch (e) { emailService = null; }

let env;
try { env = require(__root + 'config/env'); } catch (e) { env = process.env; }

function q(sql, params = [], connection = db) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Admin module path map
const ADMIN_MODULE_PATH_MAP = {
  'Dashboard': '/admin/dashboard',
  'User Management': '/admin/users',
  'Clients': '/admin/clients',
  'Departments': '/admin/departments',
  'Tasks': '/admin/tasks',
  'Projects': '/admin/projects',
  'Workflow (Project & Task Flow)': '/admin/workflow',
  'Notifications': '/admin/notifications',
  'Reports & Analytics': '/admin/reports',
  'Document & File Management': '/admin/document-file-management',
  'Chat / Real-Time Collaboration': '/admin/chat',
  'Settings & Master Configuration': '/admin/settings',
  'Audit Logs': '/admin/audit-logs',
  'Sending Approval': '/admin/sending-approval',
};

function pathForModule(name) {
  if (ADMIN_MODULE_PATH_MAP[name]) return ADMIN_MODULE_PATH_MAP[name];
  const slug = String(name).toLowerCase().replace(/\s+&\s+/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `/admin/${slug}`;
}

function slugify(text) {
  return String(text).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

function getLoginUrl() {
  const base = (env && (env.FRONTEND_URL || env.BASE_URL)) || 'http://localhost:3000';
  return base.replace(/\/$/, '') + '/login';
}

async function sendWelcomeEmail(adminName, adminEmail, plainPassword, tenantName, modules) {
  if (!emailService || !emailService.sendEmail) return;
  const loginUrl = getLoginUrl();

  const tpl = emailService.welcomeTemplate({
    name: adminName,
    email: adminEmail,
    role: 'Admin',
    title: 'Administrator',
    tempPassword: plainPassword,
    createdBy: 'Super Admin',
    createdAt: new Date(),
    setupLink: loginUrl,
    userId: adminEmail
  });

  // Add tenant and modules information to the HTML
  const moduleListHtml = modules.map(m =>
    `<li>${m.name} <span style="color:#6c757d;font-size:12px;">(${m.access})</span></li>`
  ).join('');

  const enhancedHtml = tpl.html.replace(
    '<div style="max-width: 600px; margin: 0 auto; padding: 0 30px 30px; font-family: Arial, Helvetica, sans-serif; color: #444; line-height: 1.6; font-size: 14px;">',
    `<div style="max-width: 600px; margin: 0 auto; padding: 0 30px 30px; font-family: Arial, Helvetica, sans-serif; color: #444; line-height: 1.6; font-size: 14px;">
    <p style="margin: 20px 0; color: #666;"><strong>Company:</strong> ${tenantName}</p>
    <p style="margin: 20px 0 15px; color: #333; font-size: 16px;"><strong>Your Module Access:</strong></p>
    <ul style="margin: 0 0 20px; padding-left: 20px; color: #444;">${moduleListHtml}</ul>`
  );

  const moduleListText = modules.map(m => `  - ${m.name} (${m.access})`).join('\n');
  const enhancedText = tpl.text.replace(
    'Best regards,\nTASK Management Team',
    `Company: ${tenantName}\n\nYour Module Access:\n${moduleListText}\n\nBest regards,\nTASK Management Team`
  );

  await emailService.sendEmail({
    to: adminEmail,
    subject: `Welcome to Nivara TASK – Your Admin Account Details`,
    html: enhancedHtml,
    text: enhancedText
  });
}

async function sendITSupportWelcomeEmail(itSupportName, itSupportEmail, plainPassword) {
  if (!emailService || !emailService.sendEmail) return;
  const loginUrl = getLoginUrl();

  const tpl = emailService.welcomeTemplate({
    name: itSupportName,
    email: itSupportEmail,
    role: 'IT Support',
    title: 'IT Support',
    tempPassword: plainPassword,
    createdBy: 'Super Admin',
    createdAt: new Date(),
    setupLink: loginUrl,
    userId: itSupportEmail
  });

  await emailService.sendEmail({
    to: itSupportEmail,
    subject: 'Welcome to Nivara TASK – Your IT Support Account Details',
    html: tpl.html,
    text: tpl.text
  });
}

/**
 * POST /api/super-admin/admins
 * Create admin, assign modules, send welcome email.
 */
async function createAdmin(req, res) {
  let connection;
  try {
    connection = await new Promise((resolve, reject) => {
      db.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    const { admin, modules, superadminId } = req.body;

    // ── Validate inputs ──────────────────────────────────────────────────
    if (!superadminId) {
      return res.status(400).json({ success: false, error: 'superadminId is required' });
    }
    if (!admin || !admin.name || !admin.email) {
      return res.status(400).json({ success: false, error: 'admin.name and admin.email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(admin.email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Generate password if not provided
    let plainPassword = admin.password;
    if (!plainPassword) {
      plainPassword = crypto.randomBytes(6).toString('hex'); // 12 characters
    } else if (plainPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }

    // Validate modules: must be provided and not empty
    if (!modules || !Array.isArray(modules) || modules.length === 0) {
      return res.status(400).json({ success: false, error: 'modules array is required and must contain at least one module' });
    }

    // Validate each module has required fields
    for (const mod of modules) {
      if (!mod.name && !mod.moduleId) {
        return res.status(400).json({ success: false, error: 'Each module must have either name or moduleId' });
      }
      if (!['full', 'limited', 'view'].includes(mod.access)) {
        mod.access = 'full'; // default to full
      }
    }

    let finalModules = modules;

    // ── Fetch SuperAdmin for created_by ──────────────────────────────────
    const superadminRows = await q(
      'SELECT _id FROM users WHERE (public_id = ? OR _id = ?) AND role = ? LIMIT 1',
      [superadminId, superadminId, 'SuperAdmin'],
      connection
    );
    if (!superadminRows || superadminRows.length === 0) {
      return res.status(404).json({ success: false, error: 'SuperAdmin not found' });
    }
    const { _id: createdByInternalId } = superadminRows[0];

    // ── Create dedicated tenant for this admin ───────────────────────────
    const tenantPublicId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const tenantSlug = `admin-${admin.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
    const tenantName = `${admin.name}'s Organization`;

    // Get next tenant ID
    const maxTenantResult = await q('SELECT MAX(id) as maxId FROM tenants', [], connection);
    const nextTenantId = (maxTenantResult && maxTenantResult[0] && maxTenantResult[0].maxId) ? maxTenantResult[0].maxId + 1 : 2; // Start from 2 since 1 is default

    // Create new tenant
    await q(
      'INSERT INTO tenants (id, public_id, name, slug, domain, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      [nextTenantId, tenantPublicId, tenantName, tenantSlug, `${tenantSlug}.nivarahousing.com`],
      connection
    );

    const tenantInternalId = nextTenantId;

    // ── Email uniqueness across platform ──────────────────────────────────
    const existingUser = await q(
      'SELECT _id FROM users WHERE email = ? LIMIT 1',
      [admin.email.toLowerCase()],
      connection
    );
    if (existingUser && existingUser.length > 0) {
      return res.status(409).json({ success: false, error: 'Email already registered across platform' });
    }

    // ── Create admin user ────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash(plainPassword, 12);
    const adminPublicId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');

    // Ensure tenant_id is an integer and created_by uses internal _id
    const insertResult = await q(
      `INSERT INTO users (public_id, name, title, email, password, role, tenant_id, created_by, isActive, is_active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 'Admin', ?, ?, 1, 1, NOW(), NOW())`,
      [adminPublicId, admin.name, admin.title || 'Administrator', admin.email.toLowerCase(), hashedPassword, tenantInternalId, createdByInternalId],
      connection
    );

    let adminInternalId;
    if (insertResult && insertResult.insertId) {
      adminInternalId = insertResult.insertId;
    } else {
      const selectAdmin = await q('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [adminPublicId], connection);
      if (!selectAdmin || selectAdmin.length === 0) throw new Error('Failed to create admin user record');
      adminInternalId = selectAdmin[0]._id;
    }

    // ── Store modules ────────────────────────────────────────────────────
    const moduleRows = [];
    const seenModuleIds = new Set();
    for (const mod of finalModules) {
      let moduleName = mod.name || '';
      let moduleId = mod.moduleId || '';
      const access = mod.access || 'full';
      const path = mod.path || pathForModule(moduleName);

      // If moduleId not provided, generate or find by name
      if (!moduleId && moduleName) {
        // Check if we have a known moduleId for this name
        const knownModules = Object.keys(ADMIN_MODULE_PATH_MAP);
        if (knownModules.includes(moduleName)) {
          moduleId = crypto.randomBytes(8).toString('hex'); // Generate unique ID
        } else {
          moduleId = crypto.randomBytes(8).toString('hex');
        }
      } else if (!moduleId) {
        moduleId = crypto.randomBytes(8).toString('hex');
      }

      // Avoid duplicates
      if (seenModuleIds.has(moduleId)) continue;
      seenModuleIds.add(moduleId);

      moduleRows.push([adminInternalId, moduleId, moduleName, access, path]);
    }

    if (moduleRows.length > 0) {
      await q(
        'INSERT INTO admin_modules (admin_id, module_id, name, access, path) VALUES ?',
        [moduleRows],
        connection
      );
    }

    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // ── Send welcome email (non-blocking) ────────────────────────────────
    sendWelcomeEmail(admin.name, admin.email.toLowerCase(), plainPassword, tenantName, finalModules)
      .then(() => logger.info(`Welcome email sent to ${admin.email}`))
      .catch(e => logger.warn('Welcome email failed (non-fatal):', e && e.message));

    // ── Audit log ─────────────────────────────────────────────────────────
    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: createdByInternalId,
        tenant_id: tenantInternalId,
        action: 'CREATE',
        entity: 'User',
        entity_id: adminPublicId,
        details: { email: admin.email, role: 'Admin', tenant: tenantName, tenantId: tenantPublicId, createdBy: superadminId }
      });
    } catch (e) { /* audit failure is non-fatal */ }

    return res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: {
        tenant: {
          tenantId: tenantPublicId,
          name: tenantName,
          slug: tenantSlug,
          createdBy: superadminId
        },
        admin: {
          adminId: adminPublicId,
          name: admin.name,
          email: admin.email.toLowerCase(),
          role: 'Admin',
          createdBy: superadminId
        },
        modules: moduleRows.map(row => ({
          moduleId: row[1],
          name: row[2],
          access: row[3],
          path: row[4]
        }))
      }
    });
  } catch (err) {
    if (connection) {
      await new Promise((resolve) => {
        connection.rollback(() => resolve());
      });
    }
    logger.error('superAdminController.createAdmin error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  } finally {
    if (connection) {
      connection.release();
    }
  }
}

/**
 * GET /api/super-admin/admins
 * Paginated list of all admins.
 */
async function listAdmins(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const tenantFilter = req.query.tenant || '';

    let whereClause = "u.role = 'Admin' AND (u.is_active = 1 OR u.isActive = 1)";
    let params = [];

    if (search) {
      whereClause += " AND (u.name LIKE ? OR u.email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    if (tenantFilter) {
      whereClause += " AND (t.public_id = ? OR t.name LIKE ?)";
      params.push(tenantFilter, `%${tenantFilter}%`);
    }

    // 1. Fetch admins with their basic tenant join
    const query = `
      SELECT 
        u._id,
        u.public_id AS adminId, 
        u.name, 
        u.email, 
        u.phone,
        u.role,
        COALESCE(u.is_active, u.isActive, 1) as is_active,
        u.is_online,
        u.last_login,
        u.createdAt as created_at,
        u.modules AS user_modules,
        u.tenant_id,
        -- Tenant Details
        t.public_id AS tenantId, 
        t.name AS tenantName, 
        t.slug AS tenantSlug,
        t.domain AS tenantDomain,
        t.is_active AS tenantStatus,
        t.created_at AS tenantCreatedAt
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE ${whereClause}
      ORDER BY u.createdAt DESC
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);
    const admins = await q(query, params);
    if (!admins.length) {
      return res.json({ success: true, data: [], pagination: { total: 0, page, limit, totalPages: 0 } });
    }

    const adminIds = admins.map(a => a._id);

    // 2. Fetch modules from admin_modules table for these admins
    const moduleQuery = `
      SELECT admin_id, module_id, name, access, path 
      FROM admin_modules 
      WHERE admin_id IN (?)
    `;
    const dbModules = await q(moduleQuery, [adminIds]);

    // Group modules by admin_id
    const moduleMap = dbModules.reduce((acc, m) => {
      if (!acc[m.admin_id]) acc[m.admin_id] = [];
      acc[m.admin_id].push({
        moduleId: m.module_id,
        name: m.name,
        access: m.access,
        path: m.path
      });
      return acc;
    }, {});

    // 3. Format result
    const formattedAdmins = admins.map(adm => {
      // Priority 1: admin_modules table
      // Priority 2: users.modules JSON column
      // Priority 3: Empty array
      let finalModules = moduleMap[adm._id] || [];
      if (finalModules.length === 0 && adm.user_modules) {
        try {
          finalModules = typeof adm.user_modules === 'string' ? JSON.parse(adm.user_modules) : adm.user_modules;
        } catch (e) {
          finalModules = [];
        }
      }

      return {
        public_id: adm.adminId,
        name: adm.name,
        email: adm.email,
        phone: adm.phone,
        role: adm.role,
        is_active: adm.is_active,
        is_online: adm.is_online,
        last_login: adm.last_login,
        created_at: adm.created_at,
        default_route: finalModules.length > 0 ? finalModules[0].path : '/admin/dashboard',
        modules: finalModules,
        tenant: {
          public_id: adm.tenantId,
          name: adm.tenantName,
          slug: adm.tenantSlug,
          domain: adm.tenantDomain,
          is_active: adm.tenantStatus,
          created_at: adm.tenantCreatedAt
        }
      };
    });

    // Count query with same filters
    let countWhere = "role = 'Admin' AND (is_active = 1 OR isActive = 1)";
    let countParams = [];
    if (search) {
      countWhere += " AND (name LIKE ? OR email LIKE ?)";
      countParams.push(`%${search}%`, `%${search}%`);
    }
    if (tenantFilter) {
      countWhere += " AND tenant_id IN (SELECT id FROM tenants WHERE public_id = ? OR name LIKE ?)";
      countParams.push(tenantFilter, `%${tenantFilter}%`);
    }
    const countRows = await q(`SELECT COUNT(*) AS total FROM users WHERE ${countWhere}`, countParams);
    const total = (countRows && countRows[0] && countRows[0].total) || 0;

    return res.json({
      success: true,
      data: formattedAdmins,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    logger.error('superAdminController.listAdmins error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  }
}

/**
 * GET /api/super-admin/admins/:id
 * Get single admin with their tenant and modules.
 */
async function getAdmin(req, res) {
  try {
    const { id } = req.params;
    const rows = await q(
      `SELECT u.public_id AS adminId, u.name, u.email, u.isActive as is_active,
              t.public_id AS tenantId, t.name AS tenantName, t.slug AS tenantSlug,
              u.createdAt as created_at
       FROM users u
       LEFT JOIN tenants t ON t.id = u.tenant_id
       WHERE (u.public_id = ? OR u._id = ?) AND u.role = 'Admin'
       LIMIT 1`,
      [id, id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    const adminData = rows[0];

    // Fetch modules
    const internalRows = await q('SELECT _id FROM users WHERE public_id = ? LIMIT 1', [adminData.adminId]);
    let modules = [];
    if (internalRows && internalRows.length > 0) {
      modules = await q(
        'SELECT module_id AS moduleId, name, access, path FROM admin_modules WHERE admin_id = ? ORDER BY id ASC',
        [internalRows[0]._id]
      );
    }

    return res.json({ success: true, data: { ...adminData, default_route: modules.length > 0 ? modules[0].path : '/admin/dashboard', modules } });
  } catch (err) {
    logger.error('superAdminController.getAdmin error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PUT /api/super-admin/admins/:id
 * Update admin name, email, or password.
 */
async function updateAdmin(req, res) {
  try {
    const { id } = req.params;
    const { name, email, password } = req.body;

    if (!name && !email && !password) {
      return res.status(400).json({ success: false, error: 'Provide at least one field to update: name, email, or password' });
    }

    const rows = await q(
      `SELECT _id, tenant_id FROM users WHERE (public_id = ? OR _id = ?) AND role = 'Admin' LIMIT 1`,
      [id, id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    const { _id: internalId, tenant_id } = rows[0];

    // Check email uniqueness if changing email
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
      }
      const conflict = await q(
        'SELECT _id FROM users WHERE email = ? AND tenant_id = ? AND _id != ? LIMIT 1',
        [email.toLowerCase(), tenant_id, internalId]
      );
      if (conflict && conflict.length > 0) {
        return res.status(409).json({ success: false, error: 'Email already in use by another user in this tenant' });
      }
    }

    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (email) { updates.push('email = ?'); params.push(email.toLowerCase()); }
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      }
      const hashed = await bcrypt.hash(password, 12);
      updates.push('password = ?');
      params.push(hashed);
    }
    updates.push('updatedAt = NOW()');
    params.push(internalId);

    await q(`UPDATE users SET ${updates.join(', ')} WHERE _id = ?`, params);

    return res.json({ success: true, message: 'Admin updated successfully' });
  } catch (err) {
    logger.error('superAdminController.updateAdmin error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /api/super-admin/admins/:id
 * Permanent delete — removes the user record.
 */
async function deleteAdmin(req, res) {
  try {
    const { id } = req.params;
    const rows = await q(
      `SELECT _id, email FROM users WHERE (public_id = ? OR _id = ?) AND role = 'Admin' LIMIT 1`,
      [id, id]
    );
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    const { _id: internalId, email } = rows[0];

    // Permanent delete - remove user record
    await q(
      'DELETE FROM users WHERE _id = ?',
      [internalId]
    );

    // Also delete related admin_modules
    await q('DELETE FROM admin_modules WHERE admin_id = ?', [internalId]);

    return res.json({ success: true, message: 'Admin deleted permanently' });
  } catch (err) {
    logger.error('superAdminController.deleteAdmin error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /api/super-admin/admins/:id/modules
 */
async function getAdminModules(req, res) {
  try {
    const { id } = req.params;
    const userRows = await q(
      `SELECT _id FROM users WHERE (public_id = ? OR _id = ?) AND role = 'Admin' LIMIT 1`,
      [id, id]
    );
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    const modules = await q(
      'SELECT module_id AS moduleId, name, access, path FROM admin_modules WHERE admin_id = ? ORDER BY id ASC',
      [userRows[0]._id]
    );
    return res.json({ success: true, data: modules });
  } catch (err) {
    logger.error('superAdminController.getAdminModules error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PUT /api/super-admin/admins/:id/modules
 * Replace all modules for a given admin.
 */
async function updateAdminModules(req, res) {
  try {
    const { id } = req.params;
    const { modules } = req.body;

    if (!Array.isArray(modules) || modules.length === 0) {
      return res.status(400).json({ success: false, error: 'modules must be a non-empty array' });
    }

    const userRows = await q(
      `SELECT _id FROM users WHERE (public_id = ? OR _id = ?) AND role = 'Admin' LIMIT 1`,
      [id, id]
    );
    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    const internalId = userRows[0]._id;

    await q('DELETE FROM admin_modules WHERE admin_id = ?', [internalId]);

    const moduleRows = [];
    const seenModuleIds = new Set();
    for (const m of modules) {
      const moduleName = m.name || '';
      const access = ['full', 'limited', 'view'].includes(m.access) ? m.access : 'full';
      const path = m.path || pathForModule(moduleName);
      let moduleId = m.moduleId || crypto.randomBytes(8).toString('hex');

      // Avoid duplicates
      if (seenModuleIds.has(moduleId)) continue;
      seenModuleIds.add(moduleId);

      moduleRows.push([internalId, moduleId, moduleName, access, path]);
    }

    if (moduleRows.length > 0) {
      await q('INSERT INTO admin_modules (admin_id, module_id, name, access, path) VALUES ?', [moduleRows]);
    }

    return res.json({
      success: true,
      message: 'Admin modules updated',
      data: moduleRows.map(([, moduleId, name, access, path]) => ({ moduleId, name, access, path }))
    });
  } catch (err) {
    logger.error('superAdminController.updateAdminModules error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /api/super-admin/dashboard
 * Returns global metrics across all tenants.
 */
async function getDashboard(req, res) {
  try {
    // Fetch metrics from tenants, users, audit_logs
    const [stats] = await q(`
      SELECT
        (SELECT COUNT(*) FROM tenants) as totalTenants,
        (SELECT COUNT(*) FROM users WHERE role = 'Admin') as totalAdmins,
        (SELECT COUNT(*) FROM users) as totalUsers,
        (SELECT COUNT(*) FROM users WHERE is_online = TRUE) as activeUsers
    `);

    // System health: simple check (can be enhanced)
    const systemHealth = 'healthy'; // Placeholder, could check DB connections, etc.

    // Recent activities from audit_logs
    const rawActivities = await q(`
      SELECT al.id, al.actor_id as user_id, u.name as user_name, al.action, al.entity as entity_type, al.entity_id, al.createdAt as created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.actor_id = u._id
      ORDER BY al.createdAt DESC
      LIMIT 10
    `);

    // Helper function to clean action
    function cleanAction(rawAction) {
      // Remove method
      let action = rawAction.replace(/^(GET|POST|PUT|DELETE|OPTIONS) \//, '');
      // Remove /api/ prefixes
      action = action.replace(/^api\//, '').replace(/^super-admin\//, '');
      // Replace / with space
      action = action.replace(/\//g, ' ');
      // Capitalize words
      action = action.split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
      // Special mappings
      if (action.includes('dashboard')) return 'Viewed Dashboard';
      if (action.includes('settings')) return 'Accessed Settings';
      if (action.includes('refresh')) return 'Refreshed Token';
      if (action.includes('notifications')) return 'Checked Notifications';
      // Default
      return action || 'Unknown Action';
    }

    // Process activities
    let processedActivities = rawActivities
      .filter(activity => {
        // Exclude OPTIONS
        if (activity.action.includes('OPTIONS')) return false;
        // Exclude repetitive system logs
        const excludePatterns = ['/api/platform/settings', 'POST /refresh'];
        if (excludePatterns.some(pattern => activity.action.includes(pattern))) return false;
        return true;
      })
      .map(activity => ({
        action: cleanAction(activity.action),
        user: activity.user_name || 'System',
        time: activity.created_at
      }))
      // Remove duplicates (same action and user)
      .filter((activity, index, arr) =>
        arr.findIndex(a => a.action === activity.action && a.user === activity.user) === index
      )
      .slice(0, 5); // Max 5

    return res.json({
      success: true,
      data: {
        totalTenants: stats.totalTenants || 0,
        totalAdmins: stats.totalAdmins || 0,
        totalUsers: stats.totalUsers || 0,
        activeUsers: stats.activeUsers || 0,
        systemHealth,
        recentActivities: processedActivities
      }
    });
  } catch (err) {
    logger.error('superAdminController.getDashboard error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /api/super-admin/tenants
 * CRUD for Platform Tenants
 */
async function listTenants(req, res) {
  try {
    const list = await q('SELECT id, public_id, name, slug, is_active, created_at FROM tenants ORDER BY created_at DESC');
    return res.json({ success: true, data: list });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/super-admin/settings
 * Get platform settings
 */
async function getSettings(req, res) {
  try {
    // Ensure settings table exists
    await q(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        section VARCHAR(50) NOT NULL,
        key_name VARCHAR(100) NOT NULL,
        value JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_section_key (section, key_name)
      )
    `);

    const settings = await q('SELECT section, key_name, value FROM settings');
    const grouped = settings.reduce((acc, s) => {
      if (!acc[s.section]) acc[s.section] = {};
      acc[s.section][s.key_name] = s.value;
      return acc;
    }, {});

    return res.json({ success: true, data: grouped });
  } catch (err) {
    logger.error('superAdminController.getSettings error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * PUT /api/super-admin/settings
 * Update platform settings
 */
async function updateSettings(req, res) {
  try {
    const { admin_settings, platform_settings, workflow_config } = req.body;

    // Ensure settings table exists
    await q(`
      CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        section VARCHAR(50) NOT NULL,
        key_name VARCHAR(100) NOT NULL,
        value JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_section_key (section, key_name)
      )
    `);

    const updates = [];

    if (admin_settings) {
      for (const [key, value] of Object.entries(admin_settings)) {
        updates.push(['admin_settings', key, JSON.stringify(value)]);
      }
    }

    if (platform_settings) {
      for (const [key, value] of Object.entries(platform_settings)) {
        updates.push(['platform_settings', key, JSON.stringify(value)]);
      }
    }

    if (workflow_config) {
      for (const [key, value] of Object.entries(workflow_config)) {
        updates.push(['workflow_config', key, JSON.stringify(value)]);
      }
    }

    for (const [section, key, value] of updates) {
      await q(
        'INSERT INTO settings (section, key_name, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?',
        [section, key, value, value]
      );
    }

    return res.json({ success: true, message: 'Settings updated successfully' });
  } catch (err) {
    logger.error('superAdminController.updateSettings error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function sendITAdminWelcomeEmail(itAdminName, itAdminEmail, plainPassword) {
  if (!emailService || !emailService.sendEmail) return;
  const loginUrl = getLoginUrl();

  const tpl = emailService.welcomeTemplate({
    name: itAdminName,
    email: itAdminEmail,
    role: 'IT Admin',
    title: 'IT Admin',
    tempPassword: plainPassword,
    createdBy: 'Super Admin',
    createdAt: new Date(),
    setupLink: loginUrl,
    userId: itAdminEmail
  });

  await emailService.sendEmail({
    to: itAdminEmail,
    subject: 'Welcome to Nivara TASK – Your IT Admin Account Details',
    html: tpl.html,
    text: tpl.text
  });
}

/**
 * POST /api/super-admin/it-support-users
 * Create a new IT Admin user (Super Admin only)
 */
async function createITSupportUser(req, res) {
  try {
    // Validate that the logged-in user is Super Admin
    if (!req.user || req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ success: false, error: 'Access denied. Super Admin role required.' });
    }

    const { name, email, title } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ success: false, error: 'name and email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // Check if email already exists
    const existingUser = await q('SELECT _id FROM users WHERE email = ? LIMIT 1', [email.toLowerCase()]);
    if (existingUser && existingUser.length > 0) {
      return res.status(409).json({ success: false, error: 'Email already registered' });
    }

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    // Get tenant_id from the Super Admin
    let tenantIdNum;
    if (req.user.tenant_id) {
      if (typeof req.user.tenant_id === 'string' && req.user.tenant_id === 'tenant_1') {
        tenantIdNum = 1;
      } else {
        tenantIdNum = Number(req.user.tenant_id);
        if (isNaN(tenantIdNum)) {
          return res.status(400).json({ success: false, error: 'Invalid tenant_id for superadmin' });
        }
      }
    } else {
      return res.status(400).json({ success: false, error: 'Superadmin must have a tenant_id' });
    }

    // Create IT Admin user
    const publicId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const createdBy = req.user._id || req.user.id;

    const insertResult = await q(
      'INSERT INTO users (public_id, name, title, email, password, role, tenant_id, isActive, is_active, createdAt, updatedAt, created_by) VALUES (?, ?, ?, ?, ?, \'IT Admin\', ?, 1, 1, NOW(), NOW(), ?)',
      [publicId, name, title || 'IT Admin', email.toLowerCase(), hashedPassword, tenantIdNum, createdBy]
    );

    // Audit log
    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: createdBy,
        tenant_id: tenantIdNum,
        action: 'CREATE',
        entity: 'User',
        entity_id: publicId,
        details: { email: email.toLowerCase(), role: 'ITAdmin', createdBy: createdBy }
      });
    } catch (e) {
      logger.warn('Failed to log IT Admin user creation audit:', e.message);
    }

    // Send welcome email with temporary password (non-blocking)
    sendITAdminWelcomeEmail(name, email.toLowerCase(), tempPassword)
      .then(() => logger.info(`Welcome email sent to IT Admin user ${email}`))
      .catch(e => logger.warn('Welcome email failed (non-fatal):', e && e.message));

    return res.status(201).json({
      success: true,
      message: 'IT Admin user created successfully',
      data: {
        userId: publicId,
        name,
        email: email.toLowerCase(),
        role: 'ITAdmin',
        title: title || 'IT Admin'
      }
    });

  } catch (err) {
    logger.error('superAdminController.createITSupportUser error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /api/super-admin/it-support-users
 * List IT Support users (Super Admin only)
 */
async function listITSupportUsers(req, res) {
  try {
    if (!req.user || req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ success: false, error: 'Access denied. Super Admin role required.' });
    }

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const search = req.query.search ? String(req.query.search).trim() : '';

    let where = "role = 'IT Admin'";
    const params = [];

    // Enforce tenant isolation: only show IT Support users from the same tenant
    let tenantIdNum;
    if (req.user.tenant_id) {
      if (typeof req.user.tenant_id === 'string' && req.user.tenant_id === 'tenant_1') {
        tenantIdNum = 1;
      } else {
        tenantIdNum = Number(req.user.tenant_id);
        if (isNaN(tenantIdNum)) {
          return res.status(400).json({ success: false, error: 'Invalid tenant_id for superadmin' });
        }
      }
      where += " AND tenant_id = ?";
      params.push(tenantIdNum);
    } else {
      return res.status(400).json({ success: false, error: 'Superadmin must have a tenant_id' });
    }

    if (search) {
      where += " AND (name LIKE ? OR email LIKE ?)";
      params.push(`%${search}%`, `%${search}%`);
    }

    params.push(limit, offset);
    const rows = await q(
      `SELECT public_id, name, title, email, isActive, createdAt, updatedAt FROM users WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
      params
    );

    const formattedRows = rows.map(r => ({
      public_id: r.public_id,
      id: r.public_id,
      userId: r.public_id,
      name: r.name,
      title: r.title,
      email: r.email,
      role: 'ITAdmin',
      isActive: r.isActive,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    }));

    const countParams = [];
    let countWhere = "role = 'IT Admin'";
    if (tenantIdNum !== undefined) {
      countWhere += " AND tenant_id = ?";
      countParams.push(tenantIdNum);
    }
    if (search) { countWhere += " AND (name LIKE ? OR email LIKE ?)"; countParams.push(`%${search}%`, `%${search}%`); }
    const countRows = await q(`SELECT COUNT(*) AS total FROM users WHERE ${countWhere}`, countParams);
    const total = (countRows && countRows[0] && countRows[0].total) || 0;

    return res.json({
      success: true,
      data: formattedRows,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
    });
  } catch (err) {
    logger.error('superAdminController.listITSupportUsers error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * GET /api/super-admin/it-support-users/:id
 * Get a single IT Support user details (Super Admin only)
 */
async function getITSupportUser(req, res) {
  try {
    // Validate that the logged-in user is Super Admin
    if (!req.user || req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ success: false, error: 'Access denied. Super Admin role required.' });
    }

    const { id } = req.params;

    // Get tenant_id from superadmin
    let tenantIdNum;
    if (req.user.tenant_id) {
      if (typeof req.user.tenant_id === 'string' && req.user.tenant_id === 'tenant_1') {
        tenantIdNum = 1;
      } else {
        tenantIdNum = Number(req.user.tenant_id);
        if (isNaN(tenantIdNum)) {
          return res.status(400).json({ success: false, error: 'Invalid tenant_id for superadmin' });
        }
      }
    } else {
      return res.status(400).json({ success: false, error: 'Superadmin must have a tenant_id' });
    }

    // Find the IT Support user (now IT Admin)
    const userRows = await q(
      `SELECT public_id, name, title, email, isActive, createdAt, updatedAt FROM users WHERE (public_id = ? OR _id = ?) AND role = 'IT Admin' AND tenant_id = ? LIMIT 1`,
      [id, id, tenantIdNum]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: 'IT Support user not found' });
    }

    const user = userRows[0];

    return res.json({
      success: true,
      message: 'IT Support user fetched successfully',
      data: {
        id: user.public_id,
        public_id: user.public_id,
        userId: user.public_id,
        name: user.name,
        title: user.title,
        email: user.email,
        role: 'ITAdmin',
        status: user.isActive ? 'Active' : 'Inactive',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });

  } catch (err) {
    logger.error('superAdminController.getITSupportUser error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}
async function updateITSupportUser(req, res) {
  try {
    // Validate that the logged-in user is Super Admin
    if (!req.user || req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ success: false, error: 'Access denied. Super Admin role required.' });
    }

    const { id } = req.params;
    const { name, email, title } = req.body;

    // Validate that at least one field is provided
    if (!name && !email && !title) {
      return res.status(400).json({ success: false, error: 'At least one field (name, email, or title) must be provided for update' });
    }

    // Get tenant_id from superadmin
    let tenantIdNum;
    if (req.user.tenant_id) {
      if (typeof req.user.tenant_id === 'string' && req.user.tenant_id === 'tenant_1') {
        tenantIdNum = 1;
      } else {
        tenantIdNum = Number(req.user.tenant_id);
        if (isNaN(tenantIdNum)) {
          return res.status(400).json({ success: false, error: 'Invalid tenant_id for superadmin' });
        }
      }
    } else {
      return res.status(400).json({ success: false, error: 'Superadmin must have a tenant_id' });
    }

    // Find the IT Support user (now IT Admin)
    const userRows = await q(
      `SELECT _id, email FROM users WHERE (public_id = ? OR _id = ?) AND role = 'IT Admin' AND tenant_id = ? LIMIT 1`,
      [id, id, tenantIdNum]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: 'IT Support user not found' });
    }

    const { _id: internalId, email: currentEmail } = userRows[0];

    // Check email uniqueness if changing email
    if (email && email.toLowerCase() !== currentEmail) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({ success: false, error: 'Invalid email format' });
      }

      const existingUser = await q('SELECT _id FROM users WHERE email = ? AND _id != ? LIMIT 1', [email.toLowerCase(), internalId]);
      if (existingUser && existingUser.length > 0) {
        return res.status(409).json({ success: false, error: 'Email already in use by another user' });
      }
    }

    // Build update query
    const updates = [];
    const params = [];

    if (name) {
      updates.push('name = ?');
      params.push(name);
    }

    if (email) {
      updates.push('email = ?');
      params.push(email.toLowerCase());
    }

    if (title) {
      updates.push('title = ?');
      params.push(title);
    }

    updates.push('updatedAt = NOW()');
    params.push(internalId);

    await q(`UPDATE users SET ${updates.join(', ')} WHERE _id = ?`, params);

    // Audit log
    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id || req.user.id,
        action: 'UPDATE',
        entity: 'User',
        entity_id: id,
        details: { email: email || currentEmail, role: 'ITAdmin', updatedBy: req.user._id || req.user.id }
      });
    } catch (e) {
      logger.warn('Failed to log IT Admin user update audit:', e.message);
    }

    return res.json({
      success: true,
      message: 'IT Support user updated successfully'
    });

  } catch (err) {
    logger.error('superAdminController.updateITSupportUser error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

/**
 * DELETE /api/super-admin/it-support-users/:id
 * Delete an IT Support user (Super Admin only)
 */
async function deleteITSupportUser(req, res) {
  try {
    // Validate that the logged-in user is Super Admin
    if (!req.user || req.user.role !== 'SuperAdmin') {
      return res.status(403).json({ success: false, error: 'Access denied. Super Admin role required.' });
    }

    const { id } = req.params;

    // Get tenant_id from superadmin
    let tenantIdNum;
    if (req.user.tenant_id) {
      if (typeof req.user.tenant_id === 'string' && req.user.tenant_id === 'tenant_1') {
        tenantIdNum = 1;
      } else {
        tenantIdNum = Number(req.user.tenant_id);
        if (isNaN(tenantIdNum)) {
          return res.status(400).json({ success: false, error: 'Invalid tenant_id for superadmin' });
        }
      }
    } else {
      return res.status(400).json({ success: false, error: 'Superadmin must have a tenant_id' });
    }

    // Find the IT Support user (now IT Admin)
    const userRows = await q(
      `SELECT _id, email FROM users WHERE (public_id = ? OR _id = ?) AND role = 'IT Admin' AND tenant_id = ? LIMIT 1`,
      [id, id, tenantIdNum]
    );

    if (!userRows || userRows.length === 0) {
      return res.status(404).json({ success: false, error: 'IT Support user not found' });
    }

    const { _id: internalId, email } = userRows[0];

    // Permanent delete - remove user record
    await q(
      'DELETE FROM users WHERE _id = ?',
      [internalId]
    );

    // Audit log
    try {
      const auditController = require('./auditController');
      auditController.log({
        user_id: req.user._id || req.user.id,
        action: 'DELETE',
        entity: 'User',
        entity_id: id,
        details: { email, role: 'ITAdmin', deletedBy: req.user._id || req.user.id }
      });
    } catch (e) {
      logger.warn('Failed to log IT Admin user deletion audit:', e.message);
    }

    return res.json({
      success: true,
      message: 'IT Support user deleted successfully'
    });

  } catch (err) {
    logger.error('superAdminController.deleteITSupportUser error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function createTenant(req, res) {
  try {
    const { name, slug, domain, is_active } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, error: 'Tenant name and slug are required' });
    }
    const publicId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    const isActive = is_active === undefined ? 1 : Number(Boolean(is_active));

    const maxTenantResult = await q('SELECT MAX(id) as maxId FROM tenants', []);
    const nextTenantId = (maxTenantResult && maxTenantResult[0] && maxTenantResult[0].maxId) ? maxTenantResult[0].maxId + 1 : 2;

    await q(
      'INSERT INTO tenants (id, public_id, name, slug, domain, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [nextTenantId, publicId, name, slug, domain || `${slug}.nivarahousing.com`, isActive]
    );

    return res.status(201).json({
      success: true,
      message: 'Tenant created successfully',
      data: { id: nextTenantId, public_id: publicId, name, slug, domain, is_active: isActive }
    });
  } catch (err) {
    logger.error('superAdminController.createTenant error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  }
}

async function getTenant(req, res) {
  try {
    const { id } = req.params;
    const rows = await q('SELECT id, public_id, name, slug, is_active, created_at, domain FROM tenants WHERE id = ? OR public_id = ? LIMIT 1', [id, id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    return res.json({ success: true, data: rows[0] });
  } catch (err) {
    logger.error('superAdminController.getTenant error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function updateTenant(req, res) {
  try {
    const { id } = req.params;
    const { name, slug, domain, is_active } = req.body;

    const rows = await q('SELECT id FROM tenants WHERE id = ? OR public_id = ? LIMIT 1', [id, id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const tenantId = rows[0].id;

    const updates = [];
    const params = [];
    if (name) { updates.push('name = ?'); params.push(name); }
    if (slug) { updates.push('slug = ?'); params.push(slug); }
    if (domain) { updates.push('domain = ?'); params.push(domain); }
    if (is_active !== undefined) { updates.push('is_active = ?'); params.push(Number(Boolean(is_active))); }
    updates.push('updated_at = NOW()');
    params.push(tenantId);

    await q(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`, params);
    return res.json({ success: true, message: 'Tenant updated successfully' });
  } catch (err) {
    logger.error('superAdminController.updateTenant error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  }
}

async function deleteTenant(req, res) {
  try {
    const { id } = req.params;
    const rows = await q('SELECT id FROM tenants WHERE id = ? OR public_id = ? LIMIT 1', [id, id]);
    if (!rows || rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Tenant not found' });
    }
    const tenantId = rows[0].id;

    await q('DELETE FROM tenants WHERE id = ?', [tenantId]);
    return res.json({ success: true, message: 'Tenant deleted permanently' });
  } catch (err) {
    logger.error('superAdminController.deleteTenant error:', err && err.message);
    return res.status(500).json({ success: false, error: 'Internal server error', details: err.message });
  }
}

module.exports = {
  createAdmin,
  listAdmins,
  getAdmin,
  updateAdmin,
  deleteAdmin,
  getAdminModules,
  updateAdminModules,
  getDashboard,
  listTenants,
  getTenant,
  createTenant,
  updateTenant,
  deleteTenant,
  getSettings,
  updateSettings,
  createITSupportUser,
  listITSupportUsers,
  getITSupportUser,
  updateITSupportUser,
  deleteITSupportUser
};
