const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../src/config/db');

function generatePublicId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function q(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

async function tableHasColumn(tableName, columnName) {
  const rows = await q(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function main() {
  try {
    const tenantId = 1; // default test tenant
    const users = [
      { name: 'Nikki', email: 'n11443547@gmail.com', role: 'IT Admin', password: 'ITAdmin@123' },
      { name: 'nikkkk', email: 'nikhithakondreddygari@nmit-solutions.com', role: 'L1 Engineer', password: 'L1Engineer@123' },
      { name: 'IT Support User', email: 'Ashwini.m@nmit-solutions.com', role: 'Regional IT Manager', password: 'RegionalMgr@123' },
      { name: 'ashhoney', email: 'ashhoney959@gmail.com', role: 'Cluster Lead', password: 'ClusterLead@123' },
      { name: 'ashwinisubba25', email: 'ashwinisubba25@gmail.com', role: 'IT Support', password: 'ITSupport@123' }
    ];

    const hasPublicId = await tableHasColumn('users', 'public_id');
    const hasTitle = await tableHasColumn('users', 'title');

    const created = [];
    for (const u of users) {
      try {
        const exists = await q('SELECT _id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1', [u.email, tenantId]);
        if (exists && exists.length > 0) {
          console.log(`Skipping existing user: ${u.email}`);
          continue;
        }

        const hashed = await bcrypt.hash(u.password, 10);
        const publicId = generatePublicId();

        const fields = ['name', 'email', 'password', 'role', 'tenant_id', 'isActive'];
        const placeholders = ['?', '?', '?', '?', '?', '?'];
        const params = [u.name, u.email, hashed, u.role, tenantId, 1];

        if (hasTitle) {
          fields.push('title'); placeholders.push('?'); params.push(u.role);
        }
        if (hasPublicId) {
          fields.push('public_id'); placeholders.push('?'); params.push(publicId);
        }

        const sql = `INSERT INTO users (${fields.join(', ')}) VALUES (${placeholders.join(', ')})`;
        const res = await q(sql, params);
        created.push({ email: u.email, password: u.password, role: u.role, public_id: publicId });
        console.log(`Created user: ${u.email} (${u.role})`);
      } catch (e) {
        console.error(`Failed to create ${u.email}:`, e.message || e);
      }
    }

    if (created.length > 0) {
      console.log('\nSummary of created users:');
      created.forEach(u => console.log(`- ${u.email} | role=${u.role} | password=${u.password} | public_id=${u.public_id}`));
    } else {
      console.log('No new users were created.');
    }

  } catch (err) {
    console.error('Script error:', err.message || err);
  } finally {
    try { if (db && typeof db.end === 'function') db.end(() => process.exit(0)); else process.exit(0); } catch (e) { process.exit(0); }
  }
}

main();
