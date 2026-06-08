const { query } = require('../repositories/mysql');

async function logActivity(payload, txQuery = query) {
  await txQuery(
    `
      INSERT INTO ticket_activity_logs
        (ticket_id, action, old_value, new_value, performed_by, remarks)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
    [
      payload.ticketId,
      payload.action,
      payload.oldValue == null ? null : String(payload.oldValue),
      payload.newValue == null ? null : String(payload.newValue),
      payload.performedBy || null,
      payload.remarks || null,
    ]
  );
}

async function listHistory(tenantId, ticketId) {
  const rows = await query(
    `
      SELECT
        l.id,
        l.ticket_id,
        l.action,
        l.old_value,
        l.new_value,
        l.performed_by,
        l.remarks,
        l.created_at,
        u.public_id AS performed_public_id,
        u.name AS performed_name
      FROM ticket_activity_logs l
      LEFT JOIN users u ON u._id = l.performed_by
      INNER JOIN tickets t ON t.id = l.ticket_id
      WHERE t.tenant_id = ? AND (t.ticket_id = ? OR CAST(t.id AS CHAR) = ?)
      ORDER BY l.created_at DESC, l.id DESC
    `,
    [tenantId, String(ticketId), String(ticketId)]
  );

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    action: row.action,
    oldValue: row.old_value,
    newValue: row.new_value,
    performedBy: row.performed_by
      ? { id: row.performed_public_id || row.performed_by, name: row.performed_name || null }
      : null,
    remarks: row.remarks || null,
    createdAt: row.created_at,
  }));
}

module.exports = {
  logActivity,
  listHistory,
};
