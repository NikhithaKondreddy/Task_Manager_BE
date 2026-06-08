const db = require('../../../../src/config/db');

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

async function createAttachment(filename, mime, size, storageKey, uploadedBy, metadata = {}) {
  const res = await query('INSERT INTO attachments (filename, mime, size, storage_key, uploaded_by, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())', [filename, mime, size, storageKey, uploadedBy, JSON.stringify(metadata)]);
  return res && res.insertId ? res.insertId : null;
}

async function getAttachmentById(id) {
  const rows = await query('SELECT * FROM attachments WHERE id = ?', [id]);
  return rows && rows[0] ? rows[0] : null;
}

async function deleteAttachment(id) {
  await query('DELETE FROM attachments WHERE id = ?', [id]);
  return true;
}

module.exports = {
  createAttachment,
  getAttachmentById,
  deleteAttachment,
};
