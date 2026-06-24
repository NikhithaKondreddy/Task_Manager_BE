const mysql = require('./mysql');

function cleanObject(obj) {
  return Object.entries(obj).reduce((result, [key, value]) => {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
    return result;
  }, {});
}

function mapComment(row) {
  if (!row) return null;
  return cleanObject({
    id: row.id,
    ticket_id: row.ticket_id,
    user_id: row.user_id,
    author_email: row.author_email || undefined,
    author_name: row.author_name || undefined,
    body: row.body,
    source: row.source,
    source_message_id: row.source_message_id || undefined,
    created_at: row.created_at,
  });
}

async function create(comment) {
  const result = await mysql.query(
    `INSERT INTO comments (ticket_id, user_id, author_email, body, source, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      comment.ticket_id,
      comment.user_id || null,
      comment.author_email || null,
      comment.body,
      comment.source || 'api',
      comment.source_message_id || null,
    ]
  );

  const rows = await mysql.query(
    `SELECT c.*, u.name AS author_name
     FROM comments c
     LEFT JOIN users u ON u._id = c.user_id
     WHERE c.id = ?
     LIMIT 1`,
    [result.insertId]
  );
  return mapComment(rows[0]);
}

async function listByTicketId(ticketDbId) {
  const rows = await mysql.query(
    `SELECT c.*, u.name AS author_name
     FROM comments c
     LEFT JOIN users u ON u._id = c.user_id
     WHERE c.ticket_id = ?
     ORDER BY c.created_at ASC`,
    [ticketDbId]
  );

  return rows.map(mapComment);
}

async function findByMessageId(messageId) {
  if (!messageId) return null;
  const rows = await mysql.query(
    `SELECT c.*, u.name AS author_name
     FROM comments c
     LEFT JOIN users u ON u._id = c.user_id
     WHERE c.source_message_id = ?
     LIMIT 1`,
    [messageId]
  );

  return mapComment(rows[0]);
}

module.exports = {
  create,
  listByTicketId,
  findByMessageId,
};
