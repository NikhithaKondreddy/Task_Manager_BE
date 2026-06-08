const db = require('../db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

async function listTemplates(tenantId) {
  return q(
    `SELECT id, name, subject, body, is_active, created_at, updated_at
     FROM email_templates
     WHERE tenant_id = ?
     ORDER BY name ASC`,
    [tenantId]
  );
}

async function getTemplateById(tenantId, id) {
  const rows = await q(
    `SELECT id, name, subject, body, is_active, created_at, updated_at
     FROM email_templates
     WHERE tenant_id = ? AND id = ?
     LIMIT 1`,
    [tenantId, id]
  );
  return rows[0] || null;
}

async function createTemplate(tenantId, payload, user) {
  const name = String(payload.name || '').trim();
  const subject = String(payload.subject || '').trim();
  const body = String(payload.body || '').trim();
  if (!name || !subject || !body) {
    const err = new Error('name, subject and body are required');
    err.status = 400;
    throw err;
  }

  const result = await q(
    `
      INSERT INTO email_templates
        (tenant_id, name, subject, body, is_active, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [tenantId, name, subject, body, payload.isActive === undefined ? 1 : Number(Boolean(payload.isActive)), user?._id || null, user?._id || null]
  );

  return getTemplateById(tenantId, result.insertId);
}

async function updateTemplate(tenantId, id, payload, user) {
  const existing = await getTemplateById(tenantId, id);
  if (!existing) {
    const err = new Error('Email template not found');
    err.status = 404;
    throw err;
  }

  const name = payload.name !== undefined ? String(payload.name).trim() : existing.name;
  const subject = payload.subject !== undefined ? String(payload.subject).trim() : existing.subject;
  const body = payload.body !== undefined ? String(payload.body).trim() : existing.body;
  const isActive = payload.isActive === undefined ? existing.is_active : Number(Boolean(payload.isActive));

  await q(
    `
      UPDATE email_templates
      SET name = ?, subject = ?, body = ?, is_active = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `,
    [name, subject, body, isActive, user?._id || null, tenantId, id]
  );

  return getTemplateById(tenantId, id);
}

async function deleteTemplate(tenantId, id) {
  await q('DELETE FROM email_templates WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

module.exports = {
  listTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
};
