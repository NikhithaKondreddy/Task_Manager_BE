'use strict';

/**
 * seedUsers.js
 * Automatically seeds one test user per role on server start (idempotent).
 * All seeded users share tenant_id = 1 (the default tenant).
 *
 * Roles seeded:
 *   SuperAdmin | Admin | Manager | Employee | Client-Viewer
 *
 * Run automatically via bootstrapService.ensureBootstrap().
 * Safe to call repeatedly — skips existing emails.
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

let logger;
try { logger = require(__root + 'logger'); } catch (_) {
  try { logger = require('../logger'); } catch (_2) { logger = console; }
}

// ---------------------------------------------------------------------------
// Seed definitions (fixed test credentials).
// Change passwords here if needed; hashing is done at runtime.
// ---------------------------------------------------------------------------
const SEED_TENANT_ID = 1;
const BCRYPT_ROUNDS = 10;

const SEED_USERS = [
  {
    name: 'Super Admin',
    email: 'superadmin@nivarahousing.com',
    password: 'SuperAdmin@123',
    role: 'SuperAdmin'
  },
  {
    name: 'Admin User',
    email: 'admin@nivarahousing.com',
    password: 'Admin@123',
    role: 'Admin'
  },
  {
    name: 'Manager User',
    email: 'manager@nivarahousing.com',
    password: 'Manager@123',
    role: 'Manager'
  },
  {
    name: 'Employee User',
    email: 'employee@nivarahousing.com',
    password: 'Employee@123',
    role: 'Employee'
  },
  {
    name: 'Client Viewer',
    email: 'viewer@nivarahousing.com',
    password: 'Viewer@123',
    role: 'Client-Viewer'
  },
  {
    name: 'IT Support User',
    email: 'Ashwini.m@nmit-solutions.com',
    password: 'ITSupport@123',
    role: 'IT Support'
  }
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function generatePublicId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function tableHasColumn(tableName, columnName) {
  const rows = await q(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME   = ?
       AND COLUMN_NAME  = ?`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function seedUsers() {
  // Guard: users table must exist.
  const tableRows = await q(
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
  );
  if (!tableRows || tableRows.length === 0) {
    logger.warn('seedUsers: users table does not exist — skipping seed');
    return;
  }

  // Detect whether the table has a public_id column.
  const hasPublicId = await tableHasColumn('users', 'public_id');
  const hasTitle = await tableHasColumn('users', 'title');

  const seeded = [];

  for (const spec of SEED_USERS) {
    // Check existence by email (globally, since email is unique across tenants).
    const existing = await q(
      'SELECT _id FROM users WHERE email = ? LIMIT 1',
      [spec.email]
    );
    if (existing && existing.length > 0) {
      // Already seeded — nothing to do.
      continue;
    }

    const hashedPassword = await bcrypt.hash(spec.password, BCRYPT_ROUNDS);
    const publicId = generatePublicId();

    // Build insert dynamically so we don't break tables with fewer columns.
    const cols = ['name', 'email', 'password', 'role', 'tenant_id', 'isActive'];
    const vals = [spec.name, spec.email, hashedPassword, spec.role, SEED_TENANT_ID, 1];

    if (hasTitle) {
      cols.push('title');
      // Use provided spec.title or empty string to avoid NOT NULL errors
      vals.push(spec.title || '');
    }

    if (hasPublicId) {
      cols.push('public_id');
      vals.push(publicId);
    }

    const placeholders = cols.map(() => '?').join(', ');
    const colList = cols.map((c) => `\`${c}\``).join(', ');

    await q(`INSERT INTO users (${colList}) VALUES (${placeholders})`, vals);

    seeded.push({ email: spec.email, password: spec.password, role: spec.role });
  }

  if (seeded.length > 0) {
    logger.info('');
    logger.info('╔══════════════════════════════════════════════════════════╗');
    logger.info('║              TEST USERS CREATED (seed)                   ║');
    logger.info('╠══════════════════════════════════════════════════════════╣');
    for (const u of seeded) {
      const line = `  ${u.role.padEnd(14)}  ${u.email}  /  ${u.password}`;
      logger.info(`║ ${line.padEnd(57)}║`);
    }
    logger.info('╠══════════════════════════════════════════════════════════╣');
    logger.info('║  All users belong to tenant_id = 1 (default tenant)      ║');
    logger.info('╚══════════════════════════════════════════════════════════╝');
    logger.info('');
  } else {
    logger.info('seedUsers: all test users already exist — no action taken');
  }
}

module.exports = { seedUsers };
