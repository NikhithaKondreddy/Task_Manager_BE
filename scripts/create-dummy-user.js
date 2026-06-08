require('dotenv').config();
const db = require('../src/config/db');
const bcrypt = require('bcryptjs');

function q(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

async function main() {
  const email = process.argv[2] || 'test.admin@example.com';
  const password = process.argv[3] || 'Password123!';
  const tenantId = Number(process.env.SEED_TENANT_ID || process.env.DB_TENANT_ID || 1);
  try {
    const existing = await q('SELECT _id, public_id FROM users WHERE email = ? AND tenant_id = ? LIMIT 1', [email, tenantId]);
    if (existing && existing.length) {
      console.log('User already exists:', existing[0]);
      process.exit(0);
    }

    const publicId = 'test-admin-' + Date.now();
    const hashed = await bcrypt.hash(password, 10);

    const insert = `INSERT INTO users
      (public_id, tenant_id, email, name, password, role, title, is_active, is_locked, is_online, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`;

    const params = [publicId, tenantId, email, 'Test Admin', hashed, 'Admin', 'Automated Test Admin', 1, 0, 0];
    const res = await q(insert, params);
    console.log('Created test admin user:', { insertId: res.insertId, public_id: publicId, email });
    process.exit(0);
  } catch (e) {
    console.error('Failed to create user:', e && e.message ? e.message : e);
    process.exit(2);
  }
}

main();
