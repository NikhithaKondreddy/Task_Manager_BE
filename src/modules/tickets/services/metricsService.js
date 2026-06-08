const { query } = require('../repositories/mysql');

async function getTicketMetrics(tenantId) {
  const rows = await query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN UPPER(status) = 'OPEN' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN UPPER(status) = 'ASSIGNED' THEN 1 ELSE 0 END) AS assigned_count,
        SUM(CASE WHEN UPPER(status) = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN UPPER(status) = 'RESOLVED' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN UPPER(status) = 'CLOSED' THEN 1 ELSE 0 END) AS closed_count
      FROM tickets
      WHERE tenant_id = ?
        AND COALESCE(is_draft, 0) = 0
    `,
    [tenantId]
  );
  const row = rows[0] || {};
  return {
    total: Number(row.total || 0),
    open: Number(row.open_count || 0),
    assigned: Number(row.assigned_count || 0),
    inProgress: Number(row.in_progress_count || 0),
    resolved: Number(row.resolved_count || 0),
    closed: Number(row.closed_count || 0),
  };
}

async function getSlaMetrics(tenantId) {
  const rows = await query(
    `
      SELECT
        SUM(CASE WHEN response_due_at IS NOT NULL AND responded_at IS NULL AND NOW() > response_due_at THEN 1 ELSE 0 END) AS response_breaches,
        SUM(CASE WHEN resolution_due_at IS NOT NULL AND UPPER(status) NOT IN ('RESOLVED', 'CLOSED', 'DRAFT') AND NOW() > resolution_due_at THEN 1 ELSE 0 END) AS resolution_breaches
      FROM tickets
      WHERE tenant_id = ?
    `,
    [tenantId]
  );
  const row = rows[0] || {};
  return {
    responseBreaches: Number(row.response_breaches || 0),
    resolutionBreaches: Number(row.resolution_breaches || 0),
  };
}

async function getEngineerMetrics(tenantId) {
  return query(
    `
      SELECT u.public_id AS engineer_id, u.name, u.email,
             COUNT(t.id) AS assigned_tickets,
             SUM(CASE WHEN UPPER(t.status) IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END) AS resolved_tickets
      FROM users u
      LEFT JOIN tickets t ON t.assigned_to = u._id AND t.tenant_id = u.tenant_id
      WHERE u.tenant_id = ?
      GROUP BY u._id
      ORDER BY assigned_tickets DESC, u.name ASC
    `,
    [tenantId]
  );
}

module.exports = {
  getTicketMetrics,
  getSlaMetrics,
  getEngineerMetrics,
};
