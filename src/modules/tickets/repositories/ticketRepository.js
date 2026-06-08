const { query } = require('./mysql');

function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    title: row.title,
    description: row.description,
    requester_user_id: row.requester_user_id,
    requested_for_user_id: row.requested_for_user_id,
    requester_email: row.requester_email,
    requester_name: row.requester_name || row.requested_for_name || null,
    status: row.status,
    priority: row.priority,
    assigned_to: row.assigned_to,
    assigned_queue: row.assigned_queue || 'IT Support',
    module: row.module || 'ticketing',
    source: row.source || 'api',
    source_message_id: row.source_message_id || null,
    tenant_id: row.tenant_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findByPublicIdOrId(id) {
  const rows = await query(
    `
      SELECT
        t.*,
        requester.name AS requester_name,
        requested_for.name AS requested_for_name
      FROM tickets t
      LEFT JOIN users requester ON requester._id = t.requester_user_id
      LEFT JOIN users requested_for ON requested_for._id = t.requested_for_user_id
      WHERE t.ticket_id = ? OR CAST(t.id AS CHAR) = ?
      LIMIT 1
    `,
    [String(id), String(id)]
  );
  return mapTicket(rows[0]);
}

async function findByMessageId(messageId) {
  if (!messageId) return null;
  const rows = await query(
    `
      SELECT
        t.*,
        requester.name AS requester_name,
        requested_for.name AS requested_for_name
      FROM tickets t
      LEFT JOIN users requester ON requester._id = t.requester_user_id
      LEFT JOIN users requested_for ON requested_for._id = t.requested_for_user_id
      WHERE t.source_message_id = ?
      LIMIT 1
    `,
    [messageId]
  );
  return mapTicket(rows[0]);
}

module.exports = {
  findByPublicIdOrId,
  findByMessageId,
};
