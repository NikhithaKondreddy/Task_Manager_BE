const { query } = require('./mysql');

function mapComment(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    author_user_id: row.author_user_id || null,
    author_email: row.author_email || null,
    body: row.body,
    comment_type: row.comment_type || 'PUBLIC',
    source: row.source || 'api',
    source_message_id: row.source_message_id || null,
    created_at: row.created_at,
  };
}

async function findByMessageId(messageId) {
  if (!messageId) return null;
  const rows = await query(
    `
      SELECT *
      FROM ticket_comments
      WHERE source_message_id = ?
      LIMIT 1
    `,
    [messageId]
  );

  return mapComment(rows[0]);
}

module.exports = {
  findByMessageId,
};
