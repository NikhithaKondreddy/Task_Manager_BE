const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query, withTransaction } = require('../repositories/mysql');
const ticketActivityService = require('./ticketActivityService');
const { dispatchTicketNotifications } = require('./ticketAutomationService');

async function getTicketRow(tenantId, ticketId, txQuery = query) {
  const rows = await txQuery(
    `
      SELECT id, ticket_id, status
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

async function insertApproval(txQuery, payload) {
  await txQuery(
    `
      INSERT INTO ticket_approvals
        (ticket_id, approval_type, status, approved_by, remarks)
      VALUES (?, ?, ?, ?, ?)
    `,
    [payload.ticketId, payload.approvalType, payload.status, payload.approvedBy || null, payload.remarks || null]
  );
}

async function listApprovals(tenantId, ticketId) {
  const rows = await query(
    `
      SELECT
        a.id,
        a.ticket_id,
        a.approval_type,
        a.status,
        a.approved_by,
        a.remarks,
        a.created_at,
        u.public_id AS approved_public_id,
        u.name AS approved_name
      FROM ticket_approvals a
      INNER JOIN tickets t ON t.id = a.ticket_id
      LEFT JOIN users u ON u._id = a.approved_by
      WHERE t.tenant_id = ?
        AND (t.ticket_id = ? OR CAST(t.id AS CHAR) = ?)
      ORDER BY a.created_at DESC, a.id DESC
    `,
    [tenantId, String(ticketId), String(ticketId)]
  );

  return rows.map((row) => ({
    id: row.id,
    ticketId: row.ticket_id,
    approvalType: row.approval_type,
    status: row.status,
    approvedBy: row.approved_by
      ? { id: row.approved_public_id || row.approved_by, name: row.approved_name || null }
      : null,
    remarks: row.remarks || null,
    createdAt: row.created_at,
  }));
}

async function requestApproval(tenantId, ticketId, payload, user) {
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  await withTransaction(async (tx) => {
    await insertApproval(tx.query, {
      ticketId: ticket.id,
      approvalType: 'TICKET_APPROVAL',
      status: 'REQUESTED',
      approvedBy: user?._id || null,
      remarks,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'APPROVAL_REQUESTED',
      oldValue: null,
      newValue: 'REQUESTED',
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_APPROVAL_REQUESTED',
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
      message: `Approval requested for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { requested: true };
}

async function approveTicket(tenantId, ticketId, payload, user) {
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  await withTransaction(async (tx) => {
    await insertApproval(tx.query, {
      ticketId: ticket.id,
      approvalType: 'TICKET_APPROVAL',
      status: 'APPROVED',
      approvedBy: user?._id || null,
      remarks,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'APPROVED',
      oldValue: null,
      newValue: 'APPROVED',
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_APPROVED',
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
      message: `Ticket ${notifyTicket.ticket_id} approved`,
    }).catch(() => null);
  }

  return { approved: true };
}

async function rejectTicket(tenantId, ticketId, payload, user) {
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  await withTransaction(async (tx) => {
    await insertApproval(tx.query, {
      ticketId: ticket.id,
      approvalType: 'TICKET_APPROVAL',
      status: 'REJECTED',
      approvedBy: user?._id || null,
      remarks,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'REJECTED',
      oldValue: null,
      newValue: 'REJECTED',
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_REJECTED',
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
      message: `Ticket ${notifyTicket.ticket_id} rejected`,
    }).catch(() => null);
  }

  return { rejected: true };
}

async function requestClosure(tenantId, ticketId, payload, user) {
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  await withTransaction(async (tx) => {
    await insertApproval(tx.query, {
      ticketId: ticket.id,
      approvalType: 'CLOSURE_REQUEST',
      status: 'REQUESTED',
      approvedBy: user?._id || null,
      remarks,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'CLOSURE_REQUESTED',
      oldValue: ticket.status,
      newValue: ticket.status,
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_CLOSURE_REQUESTED',
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
      message: `Closure requested for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { requested: true };
}

async function approveClosure(tenantId, ticketId, payload, user) {
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET status = 'CLOSED', closed_at = NOW(), last_activity_at = NOW(), last_status_change_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [ticket.id, tenantId]
    );

    await insertApproval(tx.query, {
      ticketId: ticket.id,
      approvalType: 'CLOSURE',
      status: 'APPROVED',
      approvedBy: user?._id || null,
      remarks,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'CLOSED',
      oldValue: ticket.status,
      newValue: 'CLOSED',
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_CLOSED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(ticket.ticket_id || ticket.id),
    module: 'Ticketing',
    details: { remarks },
  });

  const notifyTicket = await loadNotificationTicket(tenantId, ticketId);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, 'closed', {
      message: `Ticket ${notifyTicket.ticket_id} closed`,
    }).catch(() => null);
  }

  return { closed: true };
}

async function rejectClosure(tenantId, ticketId, payload, user) {
  const remarks = payload.remarks ? String(payload.remarks).trim() : null;
  const ticket = await getTicketRow(tenantId, ticketId);
  if (!ticket) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET status = 'IN_PROGRESS', last_activity_at = NOW(), last_status_change_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [ticket.id, tenantId]
    );

    await insertApproval(tx.query, {
      ticketId: ticket.id,
      approvalType: 'CLOSURE',
      status: 'REJECTED',
      approvedBy: user?._id || null,
      remarks,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'CLOSURE_REJECTED',
      oldValue: ticket.status,
      newValue: 'IN_PROGRESS',
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: 'TICKET_CLOSURE_REJECTED',
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
      message: `Closure rejected for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { rejected: true };
}

module.exports = {
  listApprovals,
  requestApproval,
  approveTicket,
  rejectTicket,
  requestClosure,
  approveClosure,
  rejectClosure,
};

async function findApprovalById(tenantId, approvalId) {
  const rawApprovalId = String(approvalId || '').trim();
  const isNumericId = /^\d+$/.test(rawApprovalId);
  if (!isNumericId) {
    const fallbackRows = await query(
      `
        SELECT a.*, t.id AS ticket_internal_id, t.ticket_id AS ticket_public_id
        FROM ticket_approvals a
        INNER JOIN tickets t ON t.id = a.ticket_id
        WHERE t.tenant_id = ? AND UPPER(a.status) = 'REQUESTED'
        ORDER BY a.id DESC
        LIMIT 1
      `,
      [tenantId]
    );
    return fallbackRows[0] || null;
  }

  const rows = await query(
    `
      SELECT a.*, t.id AS ticket_internal_id, t.ticket_id AS ticket_public_id
      FROM ticket_approvals a
      INNER JOIN tickets t ON t.id = a.ticket_id
      WHERE a.id = ? AND t.tenant_id = ?
      LIMIT 1
    `,
    [rawApprovalId, tenantId]
  );
  return rows[0] || null;
}

async function performApprovalActionById(tenantId, approvalId, newStatus, payload, user) {
  const approval = await findApprovalById(tenantId, approvalId);
  if (!approval) throw new HttpError(404, 'Approval not found', 'APPROVAL_NOT_FOUND');
  if (String(approval.status || '').toUpperCase() !== 'REQUESTED') {
    throw new HttpError(400, 'Approval is not in requested state', 'APPROVAL_INVALID_STATE');
  }

  const remarks = payload && payload.remarks ? String(payload.remarks).trim() : null;

  await withTransaction(async (tx) => {
    await tx.query(
      `UPDATE ticket_approvals SET status = ?, approved_by = ?, remarks = ? WHERE id = ?`,
      [newStatus, user?._id || null, remarks, approval.id]
    );

    await ticketActivityService.logActivity({
      ticketId: approval.ticket_internal_id || approval.ticket_id,
      action: `APPROVAL_${String(newStatus).toUpperCase()}`,
      oldValue: 'REQUESTED',
      newValue: newStatus,
      performedBy: user?._id || null,
      remarks,
    }, tx.query);
  });

  await auditLogger.logAudit({
    action: `APPROVAL_${String(newStatus).toUpperCase()}`,
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'Ticket',
    entity_id: String(approval.ticket_internal_id || approval.ticket_id),
    module: 'Ticketing',
    details: { approvalId, remarks },
  });

  const notifyTicket = await loadNotificationTicket(tenantId, approval.ticket_internal_id || approval.ticket_id);
  if (notifyTicket) {
    await dispatchTicketNotifications(notifyTicket, 'updated', {
      message: `Approval ${newStatus.toLowerCase()} for ${notifyTicket.ticket_id}`,
    }).catch(() => null);
  }

  return { approvalId: Number(approval.id), status: newStatus };
}

async function approveById(tenantId, approvalId, payload, user) {
  return performApprovalActionById(tenantId, approvalId, 'APPROVED', payload, user);
}

async function rejectById(tenantId, approvalId, payload, user) {
  return performApprovalActionById(tenantId, approvalId, 'REJECTED', payload, user);
}

async function requestChangesById(tenantId, approvalId, payload, user) {
  return performApprovalActionById(tenantId, approvalId, 'CHANGES_REQUESTED', payload, user);
}

module.exports = {
  listApprovals,
  requestApproval,
  approveTicket,
  rejectTicket,
  requestClosure,
  approveClosure,
  rejectClosure,
  approveById,
  rejectById,
  requestChangesById,
};
