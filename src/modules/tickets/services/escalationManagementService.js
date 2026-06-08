const HttpError = require('../../../errors/HttpError');
const { query } = require('../repositories/mysql');

async function getEscalationById(tenantId, escalationId) {
  const rows = await query(
    `
      SELECT e.*, t.ticket_id AS ticket_public_id
      FROM ticket_escalations e
      INNER JOIN tickets t ON t.id = e.ticket_id
      WHERE t.tenant_id = ? AND e.id = ?
      LIMIT 1
    `,
    [tenantId, escalationId]
  );
  return rows[0] || null;
}

async function updateEscalation(tenantId, escalationId, payload) {
  const existing = await getEscalationById(tenantId, escalationId);
  if (!existing) throw new HttpError(404, 'Escalation not found', 'ESCALATION_NOT_FOUND');

  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  const reason = payload.reason !== undefined ? String(payload.reason).trim() : existing.reason;

  await query(
    `UPDATE ticket_escalations SET status = ?, reason = ? WHERE id = ?`,
    [status, reason, escalationId]
  );

  return getEscalationById(tenantId, escalationId);
}

async function closeEscalation(tenantId, escalationId) {
  const existing = await getEscalationById(tenantId, escalationId);
  if (!existing) throw new HttpError(404, 'Escalation not found', 'ESCALATION_NOT_FOUND');

  await query(
    `UPDATE ticket_escalations SET status = 'CLOSED', resolved_at = NOW() WHERE id = ?`,
    [escalationId]
  );

  return getEscalationById(tenantId, escalationId);
}

module.exports = {
  getEscalationById,
  updateEscalation,
  closeEscalation,
};
