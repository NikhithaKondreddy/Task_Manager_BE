const db = require('../../../../src/config/db');

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      return resolve(rows);
    });
  });
}

async function createComment(ticketId, authorId, body, commentType = 'PUBLIC') {
  const res = await query('INSERT INTO comments (ticket_id, author_id, body, comment_type, created_at) VALUES (?, ?, ?, ?, NOW())', [ticketId, authorId, body, commentType]);
  return res && res.insertId ? res.insertId : null;
}

async function getCommentById(commentId) {
  const rows = await query('SELECT * FROM comments WHERE id = ? AND is_deleted = 0', [commentId]);
  return rows && rows[0] ? rows[0] : null;
}

async function listCommentsByTicket(ticketId, limit = 50, offset = 0) {
  const rows = await query('SELECT * FROM comments WHERE ticket_id = ? AND is_deleted = 0 ORDER BY created_at ASC LIMIT ? OFFSET ?', [ticketId, Number(limit), Number(offset)]);
  return rows || [];
}

async function updateComment(commentId, body) {
  await query('UPDATE comments SET body = ?, updated_at = NOW() WHERE id = ? AND is_deleted = 0', [body, commentId]);
  return getCommentById(commentId);
}

async function deleteComment(commentId) {
  await query('UPDATE comments SET is_deleted = 1, updated_at = NOW() WHERE id = ?', [commentId]);
  return true;
}

module.exports = {
  createComment,
  getCommentById,
  listCommentsByTicket,
  updateComment,
  deleteComment,
};
