const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query, withTransaction } = require('../repositories/mysql');
const ticketActivityService = require('./ticketActivityService');
const { dispatchTicketNotifications } = require('./ticketAutomationService');

async function findUserByIdOrPublicId(tenantId, id) {
  if (id == null || id === '') return null;
  const rows = await query(
    `
      SELECT _id, public_id, name, email
      FROM users
      WHERE tenant_id = ?
        AND (_id = ? OR public_id = ?)
      LIMIT 1
    `,
    [tenantId, id, String(id)]
  );
  return rows[0] || null;
}

async function getTicketRow(tenantId, ticketId) {
  const rows = await query(
    `
      SELECT id, ticket_id, current_escalation_level, escalated_to_user_id
      FROM tickets
      WHERE tenant_id = ?
        AND (ticket_id = ? OR CAST(id AS CHAR) = ?)
      LIMIT 1
    `,
    [tenantId, String(ticketId), String(ticketId)]
  );
  return rows[0] || null;
}

async function loadNotificationTicket(tenantId, ticketId) {
  const rows = await query(
    `
      SELECT
        t.id,
        t.ticket_id,
        t.title,
        t.status,
        t.priority,
        t.requester_email,
        t.requester_user_id,
        t.requested_for_user_id,
        t.created_by_user_id,
        t.assigned_to,
        t.tenant_id
      FROM tickets t
      WHERE t.tenant_id = ? AND (t.ticket_id = ? OR CAST(t.id AS CHAR) = ?)
      LIMIT 1
    `,
    [tenantId, String(ticketId), String(ticketId)]
  );
  return rows[0] || null;
}

async function writeHistory(txQuery, payload) {
  await txQuery(
    `
      INSERT INTO ticket_history
        (ticket_id, actor_user_id, action, field_name, from_value, to_value, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.ticketId,
      payload.actorUserId || null,
      payload.action,
      payload.fieldName || null,
      payload.fromValue == null ? null : String(payload.fromValue),
      payload.toValue == null ? null : String(payload.toValue),
      payload.notes || null,
    ]
  );
}

async function escalateTicket(tenantId, ticketId, payload, user) {
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  const escalatedToInput = payload.escalatedTo || payload.escalated_to || payload.escalatedToUserId || payload.escalated_to_user_id;
  if (!escalatedToInput) throw new HttpError(400, 'escalatedTo is required', 'ESCALATION_TARGET_REQUIRED');

  const target = await findUserByIdOrPublicId(tenantId, escalatedToInput);
  if (!target) throw new HttpError(404, 'Escalation target not found', 'ESCALATION_TARGET_NOT_FOUND');

  const reason = payload.reason ? String(payload.reason).trim() : 'Manual escalation';
  const nextLevel = Number(ticket.current_escalation_level || 0) + 1;

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET current_escalation_level = ?, escalated_to_user_id = ?, last_activity_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [nextLevel, target._id, ticket.id, tenantId]
    );

    await tx.query(
      `
        INSERT INTO ticket_escalations (ticket_id, escalation_level, from_user_id, to_user_id, reason, status)
        VALUES (?, ?, ?, ?, ?, 'OPEN')
      `,
      [ticket.id, nextLevel, user?._id || null, target._id, reason]
    );

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user?._id || null,
      action: 'TICKET_ESCALATED',
      fieldName: 'current_escalation_level',
      fromValue: ticket.current_escalation_level || 0,
      toValue: nextLevel,
      notes: reason,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'ESCALATED',
      oldValue: ticket.current_escalation_level || 0,
      newValue: nextLevel,
      performedBy: user?._id || null,
      remarks: reason,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_ESCALATED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(ticket.ticket_id || ticket.id),
    module: 'Ticketing',
    details: {
      escalationLevel: nextLevel,
      escalatedTo: target.public_id || target._id,
      reason,
    },
  });

  const notifyTicket = await loadNotificationTicket(tenantId, ticketId);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, 'escalated', {
      message: `Ticket ${notifyTicket.ticket_id} escalated`,
    }).catch(() => null);
  }

  return { escalationLevel: nextLevel, escalatedTo: target.public_id || target._id };
}

async function listEscalations(tenantId, filters = {}) {
  const params = [tenantId];
  const where = ['t.tenant_id = ?'];

  if (filters.ticketId) {
    where.push('(t.ticket_id = ? OR CAST(t.id AS CHAR) = ?)');
    params.push(String(filters.ticketId), String(filters.ticketId));
  }

  if (filters.status) {
    where.push('UPPER(e.status) = ?');
    params.push(String(filters.status).trim().toUpperCase());
  }

  const rows = await query(
    `
      SELECT
        e.id,
        e.ticket_id,
        t.ticket_id AS ticket_public_id,
        e.escalation_level,
        e.from_user_id,
        e.to_user_id,
        e.reason,
        e.status,
        e.created_at,
        u.public_id AS to_public_id,
        u.name AS to_name,
        u.email AS to_email,
        f.public_id AS from_public_id,
        f.name AS from_name,
        f.email AS from_email
      FROM ticket_escalations e
      INNER JOIN tickets t ON t.id = e.ticket_id
      LEFT JOIN users u ON u._id = e.to_user_id
      LEFT JOIN users f ON f._id = e.from_user_id
      WHERE ${where.join(' AND ')}
      ORDER BY e.created_at DESC, e.id DESC
    `,
    params
  );

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticket_public_id || row.ticket_id,
    escalationLevel: Number(row.escalation_level),
    escalatedBy: row.from_user_id
      ? { id: row.from_public_id || row.from_user_id, name: row.from_name || null, email: row.from_email || null }
      : null,
    escalatedTo: row.to_user_id
      ? { id: row.to_public_id || row.to_user_id, name: row.to_name || null, email: row.to_email || null }
      : null,
    reason: row.reason,
    status: row.status,
    escalatedAt: row.created_at,
  }));
}

module.exports = {
  escalateTicket,
  listEscalations,
};
