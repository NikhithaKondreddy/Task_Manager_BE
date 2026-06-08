const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query, withTransaction } = require('../repositories/mysql');
const { normalizeTicketStatus } = require('../helpers/ticketUtils');
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

async function findTeamById(tenantId, id) {
  if (id == null || id === '') return null;
  const rows = await query(
    `
      SELECT id, team_name
      FROM it_teams
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `,
    [tenantId, id]
  );
  return rows[0] || null;
}

async function getTicketRow(tenantId, ticketId) {
  const rows = await query(
    `
      SELECT id, ticket_id, status, assigned_to, assigned_team_id, tenant_id
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

function normalizeAssignmentStatus(status) {
  const normalized = normalizeTicketStatus(status, null);
  if (!normalized) return 'ASSIGNED';
  if (['RESOLVED', 'CLOSED', 'DRAFT'].includes(normalized)) return normalized;
  return 'ASSIGNED';
}

async function assignTicket(tenantId, ticketId, payload, user, mode) {
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  if (['RESOLVED', 'CLOSED'].includes(String(ticket.status || '').toUpperCase())) {
    throw new HttpError(400, 'Cannot assign a resolved or closed ticket', 'TICKET_ASSIGN_INVALID');
  }

  const assignedToUserId = payload.assignedTo || payload.assigned_to || payload.assignedToUserId || payload.assigned_to_user_id || null;
  const assignedToTeamId = payload.assignedTeamId || payload.assigned_team_id || null;
  if (!assignedToUserId && !assignedToTeamId) {
    throw new HttpError(400, 'assignedTo or assignedTeamId is required', 'ASSIGNEE_REQUIRED');
  }

  if (assignedToUserId && assignedToTeamId) {
    throw new HttpError(400, 'Provide either assignedTo or assignedTeamId, not both', 'ASSIGNEE_INVALID');
  }

  const assignee = assignedToUserId ? await findUserByIdOrPublicId(tenantId, assignedToUserId) : null;
  if (assignedToUserId && !assignee) throw new HttpError(404, 'Assigned engineer not found', 'ASSIGNEE_NOT_FOUND');

  const team = assignedToTeamId ? await findTeamById(tenantId, assignedToTeamId) : null;
  if (assignedToTeamId && !team) throw new HttpError(404, 'Assigned team not found', 'TEAM_NOT_FOUND');

  const nextStatus = normalizeAssignmentStatus(ticket.status);
  const assignmentType = mode || (ticket.assigned_to || ticket.assigned_team_id ? 'REASSIGN' : 'ASSIGN');
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET assigned_to = ?, assigned_team_id = ?, status = ?, last_activity_at = NOW(), last_status_change_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [assignee ? assignee._id : null, team ? team.id : null, nextStatus, ticket.id, tenantId]
    );

    await tx.query(
      `
        INSERT INTO ticket_assignments
          (tenant_id, ticket_id, assigned_to_user_id, assigned_to_team_id, assigned_by, assignment_type, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [tenantId, ticket.id, assignee ? assignee._id : null, team ? team.id : null, user?._id || null, assignmentType, remarks]
    );

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user?._id || null,
      action: assignmentType === 'REASSIGN' ? 'TICKET_REASSIGNED' : 'TICKET_ASSIGNED',
      fieldName: 'assigned_to',
      fromValue: ticket.assigned_to || ticket.assigned_team_id || null,
      toValue: assignee ? assignee._id : team ? `TEAM:${team.id}` : null,
      notes: remarks || null,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: assignmentType === 'REASSIGN' ? 'REASSIGNED' : 'ASSIGNED',
      oldValue: ticket.assigned_to || ticket.assigned_team_id || null,
      newValue: assignee ? assignee._id : team ? `TEAM:${team.id}` : null,
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: assignmentType === 'REASSIGN' ? 'TICKET_REASSIGNED' : 'TICKET_ASSIGNED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(ticket.ticket_id || ticket.id),
    module: 'Ticketing',
    details: {
      assignedToUserId: assignee ? assignee.public_id || assignee._id : null,
      assignedToTeamId: team ? team.id : null,
      remarks,
    },
  });

  const notifyTicket = await loadNotificationTicket(tenantId, ticketId);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, assignmentType === 'REASSIGN' ? 'reassigned' : 'assigned', {
      message: `Assignment updated for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { assignedToUserId: assignee ? assignee.public_id || assignee._id : null, assignedToTeamId: team ? team.id : null };
}

async function unassignTicket(tenantId, ticketId, payload, user) {
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  if (['RESOLVED', 'CLOSED'].includes(String(ticket.status || '').toUpperCase())) {
    throw new HttpError(400, 'Cannot unassign a resolved or closed ticket', 'TICKET_UNASSIGN_INVALID');
  }

  const remarks = payload.remarks ? String(payload.remarks).trim() : null;

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET assigned_to = NULL, assigned_team_id = NULL, status = 'OPEN', last_activity_at = NOW(), last_status_change_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [ticket.id, tenantId]
    );

    await tx.query(
      `
        INSERT INTO ticket_assignments
          (tenant_id, ticket_id, assigned_to_user_id, assigned_to_team_id, assigned_by, assignment_type, remarks)
        VALUES (?, ?, NULL, NULL, ?, 'UNASSIGN', ?)
      `,
      [tenantId, ticket.id, user?._id || null, remarks]
    );

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user?._id || null,
      action: 'TICKET_UNASSIGNED',
      fieldName: 'assigned_to',
      fromValue: ticket.assigned_to || ticket.assigned_team_id || null,
      toValue: null,
      notes: remarks || null,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'UNASSIGNED',
      oldValue: ticket.assigned_to || ticket.assigned_team_id || null,
      newValue: null,
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_UNASSIGNED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(ticket.ticket_id || ticket.id),
    module: 'Ticketing',
    details: { remarks },
  });

  const notifyTicket = await loadNotificationTicket(tenantId, ticketId);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, 'updated', {
      message: `Assignment removed for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { unassigned: true };
}

async function acceptTicket(tenantId, ticketId, user) {
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  if (['RESOLVED', 'CLOSED'].includes(String(ticket.status || '').toUpperCase())) {
    throw new HttpError(400, 'Cannot accept a resolved or closed ticket', 'TICKET_ACCEPT_INVALID');
  }

  // Only the assigned engineer may accept the assignment
  if (ticket.assigned_to && Number(ticket.assigned_to) !== Number(user?._id)) {
    throw new HttpError(403, 'Only the assigned engineer may accept this ticket', 'TICKET_ACCEPT_FORBIDDEN');
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET status = 'IN_PROGRESS', responded_at = COALESCE(responded_at, NOW()), last_activity_at = NOW(), last_status_change_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [ticket.id, tenantId]
    );

    await tx.query(
      `
        INSERT INTO ticket_assignments
          (tenant_id, ticket_id, assigned_to_user_id, assigned_to_team_id, assigned_by, assignment_type)
        VALUES (?, ?, ?, ?, ?, 'ACCEPT')
      `,
      [tenantId, ticket.id, user?._id || null, ticket.assigned_team_id || null, user?._id || null]
    );

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user?._id || null,
      action: 'ASSIGNMENT_ACCEPTED',
      oldValue: ticket.status,
      newValue: 'IN_PROGRESS',
      notes: 'Assignment accepted',
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'ACCEPTED',
      oldValue: ticket.status,
      newValue: 'IN_PROGRESS',
      performedBy: user?._id || null,
      remarks: 'Assignment accepted',
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_ACCEPTED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(ticket.ticket_id || ticket.id),
    module: 'Ticketing',
  });

  const notifyTicket = await loadNotificationTicket(tenantId, ticketId);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, 'accepted', {
      message: `Assignment accepted for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { accepted: true };
}

async function rejectTicket(tenantId, ticketId, payload, user) {
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  if (['RESOLVED', 'CLOSED'].includes(String(ticket.status || '').toUpperCase())) {
    throw new HttpError(400, 'Cannot reject a resolved or closed ticket', 'TICKET_REJECT_INVALID');
  }

  if (ticket.assigned_to && Number(ticket.assigned_to) !== Number(user?._id)) {
    throw new HttpError(403, 'Only the assigned engineer may reject this ticket', 'TICKET_REJECT_FORBIDDEN');
  }

  const remarks = payload && payload.remarks ? String(payload.remarks).trim() : null;

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET assigned_to = NULL, status = 'OPEN', last_activity_at = NOW(), last_status_change_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [ticket.id, tenantId]
    );

    await tx.query(
      `
        INSERT INTO ticket_assignments
          (tenant_id, ticket_id, assigned_to_user_id, assigned_to_team_id, assigned_by, assignment_type, remarks)
        VALUES (?, ?, NULL, ?, ?, 'REJECT', ?)
      `,
      [tenantId, ticket.id, ticket.assigned_team_id || null, user?._id || null, remarks]
    );

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user?._id || null,
      action: 'ASSIGNMENT_REJECTED',
      oldValue: ticket.assigned_to || ticket.assigned_team_id || null,
      newValue: null,
      notes: remarks || null,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'REJECTED',
      oldValue: ticket.assigned_to || ticket.assigned_team_id || null,
      newValue: null,
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_ASSIGNMENT_REJECTED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(ticket.ticket_id || ticket.id),
    module: 'Ticketing',
    details: { remarks },
  });

  const notifyTicket = await loadNotificationTicket(tenantId, ticketId);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, 'updated', {
      message: `Assignment rejected for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { rejected: true };
}

module.exports = {
  assignTicket,
  unassignTicket,
  acceptTicket,
  rejectTicket,
};
