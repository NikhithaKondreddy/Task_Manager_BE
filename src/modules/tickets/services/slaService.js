const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query } = require('../repositories/mysql');
const { DEFAULT_SLA_POLICIES, TICKET_PRIORITIES } = require('../constants');
const { normalizePriority } = require('../helpers/ticketUtils');

async function listPolicies(tenantId) {
  const rows = await query(
    `
      SELECT id, priority, response_time_minutes, resolution_time_minutes, escalation_time_minutes, is_active, created_at, updated_at
      FROM ticket_sla_policies
      WHERE tenant_id = ?
      ORDER BY FIELD(priority, 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')
    `,
    [tenantId]
  );

  const existingByPriority = new Map(rows.map((row) => [String(row.priority).toUpperCase(), row]));
  const merged = DEFAULT_SLA_POLICIES.map((policy) => existingByPriority.get(policy.priority) || {
    id: null,
    priority: policy.priority,
    response_time_minutes: policy.response_time_minutes,
    resolution_time_minutes: policy.resolution_time_minutes,
    escalation_time_minutes: policy.escalation_time_minutes,
    is_active: 1,
    created_at: null,
    updated_at: null,
  });

  rows.forEach((row) => {
    if (!TICKET_PRIORITIES.includes(String(row.priority).toUpperCase())) {
      merged.push(row);
    }
  });

  return merged.map((row) => ({
    id: row.id,
    priority: String(row.priority).toUpperCase(),
    responseTimeMinutes: Number(row.response_time_minutes),
    resolutionTimeMinutes: Number(row.resolution_time_minutes),
    escalationTimeMinutes: Number(row.escalation_time_minutes),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function getPolicyById(tenantId, policyId) {
  const rows = await query(
    `
      SELECT id, priority, response_time_minutes, resolution_time_minutes, escalation_time_minutes, is_active, created_at, updated_at
      FROM ticket_sla_policies
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `,
    [tenantId, policyId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    priority: String(row.priority).toUpperCase(),
    responseTimeMinutes: Number(row.response_time_minutes),
    resolutionTimeMinutes: Number(row.resolution_time_minutes),
    escalationTimeMinutes: Number(row.escalation_time_minutes),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createPolicy(tenantId, payload, user) {
  const priority = normalizePriority(payload.priority);
  if (!priority) {
    throw new HttpError(400, 'Valid priority is required', 'SLA_PRIORITY_REQUIRED');
  }

  const responseTimeMinutes = Number(payload.responseTimeMinutes || payload.response_time_minutes);
  const resolutionTimeMinutes = Number(payload.resolutionTimeMinutes || payload.resolution_time_minutes);
  const escalationTimeMinutes = Number(payload.escalationTimeMinutes || payload.escalation_time_minutes);

  if (![responseTimeMinutes, resolutionTimeMinutes, escalationTimeMinutes].every((value) => Number.isFinite(value) && value > 0)) {
    throw new HttpError(400, 'SLA times must be positive numbers', 'SLA_TIME_INVALID');
  }

  const result = await query(
    `
      INSERT INTO ticket_sla_policies
        (tenant_id, priority, response_time_minutes, resolution_time_minutes, escalation_time_minutes, is_active, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        response_time_minutes = VALUES(response_time_minutes),
        resolution_time_minutes = VALUES(resolution_time_minutes),
        escalation_time_minutes = VALUES(escalation_time_minutes),
        is_active = VALUES(is_active),
        updated_by = VALUES(updated_by)
    `,
    [
      tenantId,
      priority,
      responseTimeMinutes,
      resolutionTimeMinutes,
      escalationTimeMinutes,
      payload.isActive === undefined ? 1 : Number(Boolean(payload.isActive)),
      user?._id || null,
      user?._id || null,
    ]
  );

  await auditLogger.logAudit({
    action: 'SLA_POLICY_UPSERTED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'TicketSlaPolicy',
    entity_id: String(result.insertId || priority),
    module: 'Ticketing',
    details: { priority, responseTimeMinutes, resolutionTimeMinutes, escalationTimeMinutes },
  });

  const policies = await listPolicies(tenantId);
  return policies.find((policy) => policy.priority === priority) || null;
}

async function updatePolicy(tenantId, policyId, payload, user) {
  const rows = await query(
    `
      SELECT *
      FROM ticket_sla_policies
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `,
    [tenantId, policyId]
  );

  const existing = rows[0];
  if (!existing) {
    throw new HttpError(404, 'SLA policy not found', 'SLA_POLICY_NOT_FOUND');
  }

  const priority = payload.priority ? normalizePriority(payload.priority) : String(existing.priority).toUpperCase();
  const responseTimeMinutes = payload.responseTimeMinutes !== undefined || payload.response_time_minutes !== undefined
    ? Number(payload.responseTimeMinutes || payload.response_time_minutes)
    : Number(existing.response_time_minutes);
  const resolutionTimeMinutes = payload.resolutionTimeMinutes !== undefined || payload.resolution_time_minutes !== undefined
    ? Number(payload.resolutionTimeMinutes || payload.resolution_time_minutes)
    : Number(existing.resolution_time_minutes);
  const escalationTimeMinutes = payload.escalationTimeMinutes !== undefined || payload.escalation_time_minutes !== undefined
    ? Number(payload.escalationTimeMinutes || payload.escalation_time_minutes)
    : Number(existing.escalation_time_minutes);

  await query(
    `
      UPDATE ticket_sla_policies
      SET priority = ?, response_time_minutes = ?, resolution_time_minutes = ?, escalation_time_minutes = ?, is_active = ?, updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `,
    [
      priority,
      responseTimeMinutes,
      resolutionTimeMinutes,
      escalationTimeMinutes,
      payload.isActive === undefined ? existing.is_active : Number(Boolean(payload.isActive)),
      user?._id || null,
      tenantId,
      policyId,
    ]
  );

  await auditLogger.logAudit({
    action: 'SLA_POLICY_UPDATED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'TicketSlaPolicy',
    entity_id: String(policyId),
    module: 'Ticketing',
    previous_value: existing,
    new_value: { priority, responseTimeMinutes, resolutionTimeMinutes, escalationTimeMinutes },
  });

  const policies = await listPolicies(tenantId);
  return policies.find((policy) => Number(policy.id) === Number(policyId)) || null;
}

async function deletePolicy(tenantId, policyId, user) {
  const rows = await query(
    `
      SELECT *
      FROM ticket_sla_policies
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `,
    [tenantId, policyId]
  );

  if (!rows.length) {
    throw new HttpError(404, 'SLA policy not found', 'SLA_POLICY_NOT_FOUND');
  }

  await query(`DELETE FROM ticket_sla_policies WHERE tenant_id = ? AND id = ?`, [tenantId, policyId]);

  await auditLogger.logAudit({
    action: 'SLA_POLICY_DELETED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'TicketSlaPolicy',
    entity_id: String(policyId),
    module: 'Ticketing',
    previous_value: rows[0],
  });

  return { id: Number(policyId), deleted: true };
}

module.exports = {
  listPolicies,
  getPolicyById,
  createPolicy,
  updatePolicy,
  deletePolicy,
};
