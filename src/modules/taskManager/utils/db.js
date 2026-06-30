const db = require('../../../db');
const crypto = require('crypto');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function genPublicId(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function parsePagination(query = {}) {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

function parseSort(query = {}, allowedColumns, defaultColumn) {
  const col = allowedColumns.includes(query.sortBy) ? query.sortBy : defaultColumn;
  const dir = String(query.sortDir || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${col} ${dir}`;
}

module.exports = { q, genPublicId, parsePagination, parseSort };
