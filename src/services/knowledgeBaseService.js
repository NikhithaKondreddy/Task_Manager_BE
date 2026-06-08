const db = require('../db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function listArticles(tenantId, filters = {}) {
  const where = ['tenant_id = ?'];
  const params = [tenantId];
  if (filters.status) {
    where.push('UPPER(status) = ?');
    params.push(String(filters.status).trim().toUpperCase());
  }
  if (filters.search) {
    where.push('(title LIKE ? OR content LIKE ? OR category LIKE ?)');
    const term = `%${String(filters.search).trim()}%`;
    params.push(term, term, term);
  }
  return q(
    `
      SELECT id, title, content, category, tags_json, status, created_by, created_at, updated_at
      FROM knowledge_base
      WHERE ${where.join(' AND ')}
      ORDER BY updated_at DESC, id DESC
    `,
    params
  );
}

async function getArticleById(tenantId, id) {
  const rows = await q(
    `SELECT id, title, content, category, tags_json, status, created_by, created_at, updated_at
     FROM knowledge_base
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, id]
  );
  return rows[0] || null;
}

async function createArticle(tenantId, payload, user) {
  const title = String(payload.title || '').trim();
  const content = String(payload.content || '').trim();
  if (!title || !content) {
    const err = new Error('title and content are required');
    err.status = 400;
    throw err;
  }
  const category = payload.category ? String(payload.category).trim() : null;
  const tags = Array.isArray(payload.tags) ? payload.tags : [];
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();

  const result = await q(
    `
      INSERT INTO knowledge_base
        (tenant_id, title, content, category, tags_json, status, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [tenantId, title, content, category, JSON.stringify(tags), status, user?._id || null, user?._id || null]
  );

  return getArticleById(tenantId, result.insertId);
}

async function updateArticle(tenantId, id, payload, user) {
  const existing = await getArticleById(tenantId, id);
  if (!existing) {
    const err = new Error('Knowledge base article not found');
    err.status = 404;
    throw err;
  }

  const title = payload.title !== undefined ? String(payload.title).trim() : existing.title;
  const content = payload.content !== undefined ? String(payload.content).trim() : existing.content;
  const category = payload.category !== undefined ? String(payload.category || '').trim() : existing.category;
  const status = payload.status !== undefined ? String(payload.status).trim().toUpperCase() : existing.status;
  const tags = payload.tags !== undefined ? (Array.isArray(payload.tags) ? payload.tags : []) : null;

  await q(
    `
      UPDATE knowledge_base
      SET title = ?, content = ?, category = ?, status = ?, tags_json = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `,
    [title, content, category, status, tags ? JSON.stringify(tags) : existing.tags_json, user?._id || null, tenantId, id]
  );

  return getArticleById(tenantId, id);
}

async function deleteArticle(tenantId, id) {
  await q('DELETE FROM knowledge_base WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

module.exports = {
  listArticles,
  getArticleById,
  createArticle,
  updateArticle,
  deleteArticle,
};
