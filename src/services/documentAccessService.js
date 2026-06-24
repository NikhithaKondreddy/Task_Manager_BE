const db = require(__root + 'db');
const logger = require(__root + 'logger');

const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

function canAssign(user) {
  if (!user || !user.role) return false;
  const role = String(user.role).toLowerCase();
  return role === 'admin' || role === 'manager';
}

module.exports = {

  async assignAccess({ documentId, assigneeId, accessType = 'READ', user = {} }) {
    if (!documentId || !assigneeId) {
      const err = new Error('documentId and assigneeId required');
      err.status = 400;
      throw err;
    }

    if (!canAssign(user)) {
      const err = new Error('Forbidden');
      err.status = 403;
      throw err;
    }

    const createdAt = new Date();

    const res = await q('INSERT INTO document_access (documentId, userId, accessType, grantedBy, grantedAt) VALUES (?, ?, ?, ?, ?)', [documentId, assigneeId, accessType, user.id, createdAt]);

    return { id: res.insertId, documentId, assigneeId, accessType };
  }
};
