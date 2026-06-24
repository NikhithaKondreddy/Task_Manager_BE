const mysql = require('./mysql');

function mapAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    comment_id: row.comment_id,
    file_name: row.file_name,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    storage_path: row.storage_path,
    checksum_sha256: row.checksum_sha256,
    content_id: row.content_id,
    is_inline: row.is_inline,
    source_message_id: row.source_message_id,
    created_at: row.created_at,
  };
}

async function create(attachment) {
  const result = await mysql.query(
    `INSERT INTO attachments
      (ticket_id, comment_id, file_name, content_type, size_bytes, storage_path, checksum_sha256, content_id, is_inline, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      attachment.ticket_id,
      attachment.comment_id || null,
      attachment.file_name,
      attachment.content_type || null,
      attachment.size_bytes || null,
      attachment.storage_path,
      attachment.checksum_sha256 || null,
      attachment.content_id || null,
      Boolean(attachment.is_inline),
      attachment.source_message_id || null,
    ]
  );

  const rows = await mysql.query('SELECT * FROM attachments WHERE id = ? LIMIT 1', [result.insertId]);
  return mapAttachment(rows[0]);
}

async function listByTicketId(ticketDbId) {
  const rows = await mysql.query(
    `SELECT *
     FROM attachments
     WHERE ticket_id = ?
     ORDER BY created_at ASC`,
    [ticketDbId]
  );

  return rows.map(mapAttachment);
}

module.exports = {
  create,
  listByTicketId,
};
