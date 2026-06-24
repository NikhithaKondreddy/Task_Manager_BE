const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mysql = require('./mysql');

let cachedColumns = null;

function mapUser(row) {
  if (!row) return null;
  return {
    id: row._id || row.id,
    public_id: row.public_id || null,
    tenant_id: row.tenant_id || null,
    department_public_id: row.department_public_id || null,
    email: row.email,
    name: row.name,
    role: row.role || null,
    title: row.title || null,
    created_at: row.created_at || row.createdAt,
    updated_at: row.updated_at || row.updatedAt,
  };
}

async function findByEmail(email) {
  const rows = await mysql.query(
    `SELECT *
     FROM users
     WHERE LOWER(email) = LOWER(?)
     ORDER BY _id ASC
     LIMIT 1`,
    [email]
  );
  return mapUser(rows[0]);
}

async function findById(id) {
  const rows = await mysql.query(
    `SELECT *
     FROM users
     WHERE _id = ? OR public_id = ?
     LIMIT 1`,
    [id, String(id)]
  );
  return mapUser(rows[0]);
}

async function getUserColumns() {
  if (cachedColumns) return cachedColumns;
  const rows = await mysql.query('SHOW COLUMNS FROM users');
  cachedColumns = rows;
  return cachedColumns;
}

function hasColumn(columns, name) {
  return columns.some((column) => column.Field === name);
}

function defaultValueForColumn(column) {
  const type = String(column.Type || '').toLowerCase();
  if (type.includes('int') || type.includes('decimal') || type.includes('float') || type.includes('double')) return 0;
  if (type.includes('timestamp') || type.includes('datetime') || type === 'date') return { expression: 'NOW()' };
  if (type.includes('json')) return '{}';
  if (type.includes('bool')) return 0;
  return '';
}

async function findOrCreateByEmail({ email, name = null, source = 'email' }) {
  const existing = await findByEmail(email);
  if (existing) return existing;

  const columns = await getUserColumns();
  const usedColumns = new Set();
  const insertColumns = [];
  const placeholders = [];
  const values = [];

  function addValue(column, value) {
    if (!hasColumn(columns, column) || usedColumns.has(column)) return;
    usedColumns.add(column);
    insertColumns.push('`' + column + '`');
    placeholders.push('?');
    values.push(value);
  }

  function addExpression(column, expression) {
    if (!hasColumn(columns, column) || usedColumns.has(column)) return;
    usedColumns.add(column);
    insertColumns.push('`' + column + '`');
    placeholders.push(expression);
  }

  const requesterRole = process.env.SUPPORT_REQUESTER_ROLE || 'Employee';
  const tenantIdEnv = process.env.SUPPORT_DEFAULT_TENANT_ID || process.env.DEFAULT_TENANT_ID;
  const tenantId = (tenantIdEnv !== undefined && tenantIdEnv !== null && tenantIdEnv !== '') ? Number(tenantIdEnv) : null;
  const tempPassword = crypto.randomBytes(12).toString('hex');
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  if (tenantId !== null) addValue('tenant_id', tenantId);
  addValue('public_id', crypto.randomBytes(8).toString('hex'));
  addValue('email', email);
  addValue('name', name || email.split('@')[0]);
  addValue('password', hashedPassword);
  addValue('role', requesterRole);
  addValue('title', source === 'email' ? 'Support Requester' : 'Requester');
  addValue('isActive', 1);
  addValue('isGuest', 1);
  addExpression('createdAt', 'NOW()');
  addExpression('updatedAt', 'NOW()');
  addExpression('created_at', 'NOW()');
  addExpression('updated_at', 'NOW()');

  for (const column of columns) {
    if (usedColumns.has(column.Field)) continue;
    if (String(column.Extra || '').toLowerCase().includes('auto_increment')) continue;
    if (column.Null === 'NO' && column.Default === null) {
      const fallback = defaultValueForColumn(column);
      if (fallback && typeof fallback === 'object' && fallback.expression) {
        addExpression(column.Field, fallback.expression);
      } else {
        addValue(column.Field, fallback);
      }
    }
  }

  try {
    const result = await mysql.query(
      `INSERT INTO users (${insertColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );

    const created = await findById(result.insertId);
    if (created) return created;
    return findByEmail(email);
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return findByEmail(email);
    }
    throw error;
  }
}

async function findByRole(role) {
  const rows = await mysql.query(
    `SELECT *
     FROM users
     WHERE role = ? AND isActive = 1
     ORDER BY name ASC`,
    [role]
  );
  return rows.map(mapUser);
}

module.exports = {
  findByEmail,
  findById,
  findOrCreateByEmail,
  findByRole,
};
