const { query } = require('../repositories/mysql');

async function listWorkloads(tenantId) {
  return query(
    `
      SELECT u._id, u.public_id, u.name, u.email,
             SUM(CASE WHEN UPPER(t.status) NOT IN ('RESOLVED', 'CLOSED', 'DRAFT') THEN 1 ELSE 0 END) AS open_tickets,
             SUM(CASE WHEN UPPER(t.status) IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END) AS closed_tickets
      FROM users u
      LEFT JOIN tickets t ON t.assigned_to = u._id AND t.tenant_id = u.tenant_id
      WHERE u.tenant_id = ?
      GROUP BY u._id
      ORDER BY open_tickets DESC, u.name ASC
    `,
    [tenantId]
  );
}

async function getWorkloadForEngineer(tenantId, engineerId) {
  const rows = await query(
    `
      SELECT u._id, u.public_id, u.name, u.email,
             SUM(CASE WHEN UPPER(t.status) NOT IN ('RESOLVED', 'CLOSED', 'DRAFT') THEN 1 ELSE 0 END) AS open_tickets,
             SUM(CASE WHEN UPPER(t.status) IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END) AS closed_tickets
      FROM users u
      LEFT JOIN tickets t ON t.assigned_to = u._id AND t.tenant_id = u.tenant_id
      WHERE u.tenant_id = ? AND (u._id = ? OR u.public_id = ?)
      GROUP BY u._id
      LIMIT 1
    `,
    [tenantId, engineerId, String(engineerId)]
  );
  return rows[0] || null;
}

module.exports = {
  listWorkloads,
  getWorkloadForEngineer,
};
