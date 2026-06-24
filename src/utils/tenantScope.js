const db = require('../db');

const columnCache = new Map();

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function tableHasColumn(table, column) {
  const cacheKey = `${table}::${column}`;
  if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);

  try {
    const rows = await q(
      `
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = ?
          AND COLUMN_NAME = ?
      `,
      [table, column]
    );
    const exists = Array.isArray(rows) && rows.length > 0;
    columnCache.set(cacheKey, exists);
    return exists;
  } catch (error) {
    columnCache.set(cacheKey, false);
    return false;
  }
}

function getTenantId(req) {
  if (!req) return null;

  // 1. Source of Truth: Authenticated User Information
  // If the user is logged in, use THEIR tenant_id as the primary filter.
  if (req.user && req.user.tenant_id !== undefined && req.user.tenant_id !== null) {
    const userTenantId = req.user.tenant_id;
    const userRole = (req.user.role || '').toLowerCase();

    // If they are a SuperAdmin, they MIGHT want to look at another tenant.
    // In that case, we can check headers/body/query for an override.
    if (userRole === 'superadmin' || userRole === 'sa') {
      const override = (req.headers && req.headers['x-tenant-id']) ||
                       (req.body && req.body.tenantId) ||
                       (req.query && req.query.tenantId) ||
                       (req.tenantId);
      if (override !== undefined && override !== null && override !== '') {
        return override;
      }
    }

    // For all other roles (including Admin), STRICTLY use their assigned tenant_id.
    // They should NOT be able to access other tenants even if they pass a tenantId parameter.
    return userTenantId;
  }

  // 2. Fallbacks for non-authenticated or onboarding flows (if any)
  if (req.tenantId !== undefined && req.tenantId !== null) return req.tenantId;
  if (req.headers && req.headers['x-tenant-id']) return req.headers['x-tenant-id'];
  if (req.body && req.body.tenantId !== undefined) return req.body.tenantId;
  if (req.query && req.query.tenantId !== undefined) return req.query.tenantId;

  return null;
}

function assertTenantId(req) {
  const tenantId = getTenantId(req);
  if (tenantId === undefined || tenantId === null || tenantId === '') {
    const error = new Error('tenant_id is required');
    error.status = 400;
    error.code = 'TENANT_REQUIRED';
    throw error;
  }
  return tenantId;
}

async function buildTenantFilter(table, alias, tenantId, options = {}) {
  if (tenantId === undefined || tenantId === null || tenantId === '') {
    return { clause: '', params: [] };
  }

  const hasTenantId = await tableHasColumn(table, 'tenant_id');
  if (!hasTenantId) return { clause: '', params: [] };

  const qualified = alias ? `${alias}.tenant_id` : 'tenant_id';
  if (options.allowNull) {
    return {
      clause: `(${qualified} = ? OR ${qualified} IS NULL)`,
      params: [tenantId]
    };
  }

  return {
    clause: `${qualified} = ?`,
    params: [tenantId]
  };
}

function appendWhere(sql, clause) {
  if (!clause) return sql;
  return /\bwhere\b/i.test(sql) ? `${sql} AND ${clause}` : `${sql} WHERE ${clause}`;
}

async function resolveScopedEntity(table, value, tenantId, options = {}) {
  if (value === undefined || value === null || value === '') return null;

  const idColumn = options.idColumn || 'id';
  const publicColumn = options.publicColumn || 'public_id';
  const selectColumns = options.selectColumns || `${idColumn}, ${publicColumn}, tenant_id`;

  const candidates = [];
  const params = [];
  if (/^\d+$/.test(String(value))) {
    candidates.push(`${idColumn} = ?`);
    params.push(Number(value));
  }
  candidates.push(`${publicColumn} = ?`);
  params.push(String(value));

  const tenantFilter = await buildTenantFilter(table, '', tenantId);
  let sql = `SELECT ${selectColumns} FROM ${table} WHERE (${candidates.join(' OR ')})`;
  if (tenantFilter.clause) {
    sql += ` AND ${tenantFilter.clause}`;
    params.push(...tenantFilter.params);
  }
  sql += ' LIMIT 1';

  const rows = await q(sql, params);
  return rows && rows.length ? rows[0] : null;
}

function stampTenant(record, tenantId) {
  if (!record || typeof record !== 'object') return record;
  if (record.tenant_id === undefined || record.tenant_id === null) {
    record.tenant_id = tenantId;
  }
  return record;
}

module.exports = {
  q,
  tableHasColumn,
  getTenantId,
  assertTenantId,
  buildTenantFilter,
  appendWhere,
  resolveScopedEntity,
  stampTenant
};
