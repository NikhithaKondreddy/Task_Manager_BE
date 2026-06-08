const { query } = require('./mysql');

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
    is_inline: Boolean(row.is_inline),
    source_message_id: row.source_message_id,
    created_at: row.created_at,
  };
}

async function listByTicketId(ticketDbId) {
  const rows = await query(
    `
      SELECT *
      FROM ticket_attachments
      WHERE ticket_id = ?
      ORDER BY created_at ASC
    `,
    [ticketDbId]
  );
  return rows.map(mapAttachment);
}

module.exports = {
  listByTicketId,
};
