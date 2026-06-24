const crypto = require('crypto');
const mysql = require('./mysql');

function cleanObject(obj) {
  return Object.entries(obj).reduce((result, [key, value]) => {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
    return result;
  }, {});
}

function mapTicket(row) {
  if (!row) return null;
  return cleanObject({
    id: row.id,
    ticket_id: row.ticket_id,
    title: row.title,
    description: row.description,
    requester_user_id: row.requester_user_id,
    requester_email: row.requester_email,
    requester_name: row.requester_name || undefined,
    status: row.status || 'Open',
    priority: row.priority || 'Medium',
    assigned_to: row.assigned_to,
    assigned_to_email: row.assigned_to_email || undefined,
    assigned_queue: row.assigned_queue,
    module: row.module || 'general',
    source: row.source,
    source_message_id: row.source_message_id || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

function buildWhereClause(filters = {}) {
  const values = [];
  const where = [];

  if (filters.status) {
    values.push(filters.status);
    where.push('t.status = ?');
  }

  if (filters.priority) {
    values.push(filters.priority);
    where.push('t.priority = ?');
  }

  if (filters.requester_email) {
    values.push(filters.requester_email);
    where.push('LOWER(t.requester_email) = LOWER(?)');
  }

  if (filters.requester_user_id) {
    values.push(filters.requester_user_id);
    where.push('t.requester_user_id = ?');
  }

  if (filters.department_public_id) {
    values.push(filters.department_public_id);
    where.push('requester.department_public_id = ?');
  }

  if (filters.assigned_to) {
    values.push(filters.assigned_to);
    where.push('t.assigned_to = ?');
  }

  return { values, where };
}

const ticketSelect = `
  SELECT
    t.*,
    requester.name AS requester_name,
    assignee.email AS assigned_to_email
  FROM tickets t
  LEFT JOIN users requester ON requester._id = t.requester_user_id
  LEFT JOIN users assignee ON assignee._id = t.assigned_to
`;

async function create(ticket) {
  const pendingTicketId = `PENDING-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const result = await mysql.query(
    `INSERT INTO tickets
      (ticket_id, title, description, requester_user_id, requester_email, status, priority, assigned_to, assigned_queue, module, source, source_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pendingTicketId,
      ticket.title,
      ticket.description,
      ticket.requester_user_id,
      ticket.requester_email,
      ticket.status || 'Open',
      ticket.priority || 'Medium',
      ticket.assigned_to || null,
      ticket.assigned_queue || 'IT Support',
      ticket.module || 'general',
      ticket.source || 'api',
      ticket.source_message_id || null,
    ]
  );

  const ticketId = `TCK-${String(result.insertId).padStart(6, '0')}`;
  await mysql.query('UPDATE tickets SET ticket_id = ? WHERE id = ?', [ticketId, result.insertId]);

  return findByPublicIdOrId(ticketId);
}

async function list(filters = {}) {
  const { values, where } = buildWhereClause(filters);

  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);
  values.push(limit, offset);

  const sql = `
    ${ticketSelect}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY t.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await mysql.query(sql, values);
  return rows.map(mapTicket);
}

async function getDashboardSummary(filters = {}) {
  const { values, where } = buildWhereClause(filters);
  const rows = await mysql.query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN t.status = 'Open' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN t.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN t.status = 'Closed' THEN 1 ELSE 0 END) AS closed
      FROM tickets t
      LEFT JOIN users requester ON requester._id = t.requester_user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    `,
    values
  );

  const row = rows[0] || {};
  return {
    total: Number(row.total || 0),
    open: Number(row.open || 0),
    in_progress: Number(row.in_progress || 0),
    closed: Number(row.closed || 0),
  };
}

async function findByPublicIdOrId(id) {
  const rows = await mysql.query(
    `${ticketSelect}
     WHERE t.ticket_id = ? OR CAST(t.id AS CHAR) = ?
     LIMIT 1`,
    [String(id), String(id)]
  );
  return mapTicket(rows[0]);
}

async function findByMessageId(messageId) {
  if (!messageId) return null;
  const rows = await mysql.query(
    `${ticketSelect}
     WHERE t.source_message_id = ?
     LIMIT 1`,
    [messageId]
  );
  return mapTicket(rows[0]);
}

async function update(id, fields) {
  const values = [];
  const sets = [];

  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined) return;
    values.push(value);
    sets.push(`${key} = ?`);
  });

  if (!sets.length) return findByPublicIdOrId(id);

  const lookupId = String(id);
  const result = await mysql.query(
    `UPDATE tickets
     SET ${sets.join(', ')}
     WHERE ticket_id = ? OR CAST(id AS CHAR) = ?`,
    [...values, lookupId, lookupId]
  );

  if (!result.affectedRows) return null;
  return findByPublicIdOrId(id);
}

module.exports = {
  create,
  list,
  getDashboardSummary,
  findByPublicIdOrId,
  findByMessageId,
  update,
};
