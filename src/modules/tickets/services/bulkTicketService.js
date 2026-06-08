const HttpError = require('../../../errors/HttpError');
const { query, withTransaction } = require('../repositories/mysql');
const { normalizePriority } = require('../helpers/ticketUtils');

async function resolveTicketIds(tenantId, ticketIds = []) {
  if (!ticketIds.length) return [];
  const rows = await query(
    `
      SELECT id
      FROM tickets
      WHERE tenant_id = ? AND (ticket_id IN (?) OR id IN (?))
    `,
    [tenantId, ticketIds, ticketIds]
  );
  return rows.map((row) => row.id);
}

async function bulkAssign(tenantId, payload) {
  const ids = await resolveTicketIds(tenantId, payload.ticketIds || []);
  if (!ids.length) throw new HttpError(400, 'No valid ticketIds provided', 'TICKET_IDS_REQUIRED');
  if (!payload.assignedTo) throw new HttpError(400, 'assignedTo is required', 'ASSIGNEE_REQUIRED');

  await query(
    `UPDATE tickets SET assigned_to = ?, status = 'ASSIGNED', assigned_at = NOW(), last_activity_at = NOW() WHERE tenant_id = ? AND id IN (?)`,
    [payload.assignedTo, tenantId, ids]
  );
  return { updated: ids.length };
}

async function bulkClose(tenantId, payload) {
  const ids = await resolveTicketIds(tenantId, payload.ticketIds || []);
  if (!ids.length) throw new HttpError(400, 'No valid ticketIds provided', 'TICKET_IDS_REQUIRED');

  await query(
    `UPDATE tickets SET status = 'CLOSED', closed_at = NOW(), last_activity_at = NOW(), last_status_change_at = NOW() WHERE tenant_id = ? AND id IN (?)`,
    [tenantId, ids]
  );
  return { updated: ids.length };
}

async function bulkUpdatePriority(tenantId, payload) {
  const ids = await resolveTicketIds(tenantId, payload.ticketIds || []);
  if (!ids.length) throw new HttpError(400, 'No valid ticketIds provided', 'TICKET_IDS_REQUIRED');
  const priority = normalizePriority(payload.priority, null);
  if (!priority) throw new HttpError(400, 'priority is required', 'PRIORITY_REQUIRED');

  await query(
    `UPDATE tickets SET priority = ?, last_activity_at = NOW() WHERE tenant_id = ? AND id IN (?)`,
    [priority, tenantId, ids]
  );
  return { updated: ids.length };
}

async function bulkDelete(tenantId, payload) {
  const ids = await resolveTicketIds(tenantId, payload.ticketIds || []);
  if (!ids.length) throw new HttpError(400, 'No valid ticketIds provided', 'TICKET_IDS_REQUIRED');

  await withTransaction(async (tx) => {
    await tx.query('DELETE FROM ticket_attachments WHERE ticket_id IN (?)', [ids]);
    await tx.query('DELETE FROM ticket_comments WHERE ticket_id IN (?)', [ids]);
    await tx.query('DELETE FROM ticket_history WHERE ticket_id IN (?)', [ids]);
    await tx.query('DELETE FROM tickets WHERE tenant_id = ? AND id IN (?)', [tenantId, ids]);
  });

  return { deleted: ids.length };
}

module.exports = {
  bulkAssign,
  bulkClose,
  bulkUpdatePriority,
  bulkDelete,
};
