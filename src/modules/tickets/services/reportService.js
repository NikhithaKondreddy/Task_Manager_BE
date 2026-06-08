const { query } = require('../repositories/mysql');
const { buildPdfBuffer } = require('../helpers/pdfExport');

function buildFilters(tenantId, filters = {}) {
  const where = ['t.tenant_id = ?'];
  const params = [tenantId];

  if (filters.status) {
    where.push('UPPER(t.status) = ?');
    params.push(String(filters.status).trim().toUpperCase());
  }

  if (filters.priority) {
    where.push('UPPER(t.priority) = ?');
    params.push(String(filters.priority).trim().toUpperCase());
  }

  if (filters.fromDate) {
    where.push('DATE(t.created_at) >= DATE(?)');
    params.push(filters.fromDate);
  }

  if (filters.toDate) {
    where.push('DATE(t.created_at) <= DATE(?)');
    params.push(filters.toDate);
  }

  return { where, params };
}

async function getSummaryReport(tenantId, filters) {
  const { where, params } = buildFilters(tenantId, filters);
  return query(
    `
      SELECT
        UPPER(t.status) AS status,
        UPPER(t.priority) AS priority,
        COUNT(*) AS ticket_count
      FROM tickets t
      WHERE ${where.join(' AND ')}
      GROUP BY UPPER(t.status), UPPER(t.priority)
      ORDER BY status ASC, priority ASC
    `,
    params
  );
}

async function getSlaReport(tenantId, filters) {
  const { where, params } = buildFilters(tenantId, filters);
  return query(
    `
      SELECT
        UPPER(t.priority) AS priority,
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN t.response_due_at IS NOT NULL AND t.responded_at IS NULL AND NOW() > t.response_due_at THEN 1 ELSE 0 END) AS response_breaches,
        SUM(CASE WHEN t.resolution_due_at IS NOT NULL AND UPPER(t.status) NOT IN ('RESOLVED', 'CLOSED', 'DRAFT') AND NOW() > t.resolution_due_at THEN 1 ELSE 0 END) AS resolution_breaches,
        SUM(CASE WHEN t.current_escalation_level > 0 THEN 1 ELSE 0 END) AS escalated_tickets
      FROM tickets t
      WHERE ${where.join(' AND ')}
      GROUP BY UPPER(t.priority)
      ORDER BY priority ASC
    `,
    params
  );
}

async function getEngineerPerformanceReport(tenantId, filters) {
  const { where, params } = buildFilters(tenantId, filters);
  return query(
    `
      SELECT
        COALESCE(u.public_id, t.assigned_to) AS engineer_id,
        COALESCE(u.name, 'Unassigned') AS engineer_name,
        COALESCE(u.email, '') AS engineer_email,
        COUNT(*) AS assigned_tickets,
        SUM(CASE WHEN UPPER(t.status) IN ('RESOLVED', 'CLOSED') THEN 1 ELSE 0 END) AS resolved_tickets,
        SUM(CASE WHEN UPPER(t.status) IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'REOPENED') THEN 1 ELSE 0 END) AS active_tickets
      FROM tickets t
      LEFT JOIN users u ON u._id = t.assigned_to
      WHERE ${where.join(' AND ')}
      GROUP BY engineer_id, engineer_name, engineer_email
      ORDER BY assigned_tickets DESC, engineer_name ASC
    `,
    params
  );
}

async function getBranchReport(tenantId, filters) {
  const { where, params } = buildFilters(tenantId, filters);
  return query(
    `
      SELECT
        COALESCE(t.branch_id, 0) AS branch_id,
        UPPER(t.status) AS status,
        COUNT(*) AS ticket_count
      FROM tickets t
      WHERE ${where.join(' AND ')}
      GROUP BY COALESCE(t.branch_id, 0), UPPER(t.status)
      ORDER BY branch_id ASC, status ASC
    `,
    params
  );
}

async function getRegionReport(tenantId, filters) {
  const { where, params } = buildFilters(tenantId, filters);
  return query(
    `
      SELECT
        COALESCE(t.region_id, 0) AS region_id,
        UPPER(t.status) AS status,
        COUNT(*) AS ticket_count
      FROM tickets t
      WHERE ${where.join(' AND ')}
      GROUP BY COALESCE(t.region_id, 0), UPPER(t.status)
      ORDER BY region_id ASC, status ASC
    `,
    params
  );
}

async function getCategoryReport(tenantId, filters) {
  const { where, params } = buildFilters(tenantId, filters);
  return query(
    `
      SELECT
        COALESCE(c.category_name, 'Uncategorized') AS category_name,
        COALESCE(s.subcategory_name, 'General') AS subcategory_name,
        UPPER(t.status) AS status,
        COUNT(*) AS ticket_count
      FROM tickets t
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN subcategories s ON s.id = t.subcategory_id
      WHERE ${where.join(' AND ')}
      GROUP BY category_name, subcategory_name, UPPER(t.status)
      ORDER BY category_name ASC, subcategory_name ASC, status ASC
    `,
    params
  );
}

async function getReportRows(tenantId, type, filters = {}) {
  switch (String(type || '').trim().toLowerCase()) {
    case 'summary':
      return getSummaryReport(tenantId, filters);
    case 'sla':
      return getSlaReport(tenantId, filters);
    case 'engineer-performance':
    case 'engineer_performance':
      return getEngineerPerformanceReport(tenantId, filters);
    case 'branch':
      return getBranchReport(tenantId, filters);
    case 'region':
      return getRegionReport(tenantId, filters);
    case 'category':
      return getCategoryReport(tenantId, filters);
    default:
      throw new Error(`Unsupported report type: ${type}`);
  }
}

function toCsv(rows = []) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  rows.forEach((row) => {
    const values = headers.map((header) => {
      const raw = row[header] == null ? '' : String(row[header]);
      return `"${raw.replace(/"/g, '""')}"`;
    });
    lines.push(values.join(','));
  });
  return lines.join('\n');
}

async function buildReportPayload(tenantId, type, filters = {}) {
  const rows = await getReportRows(tenantId, type, filters);
  const normalizedType = String(type || '').trim().toLowerCase();
  const format = String(filters.format || 'json').trim().toLowerCase();

  if (format === 'excel' || format === 'csv') {
    return {
      type: 'text/csv',
      filename: `${normalizedType}-report.csv`,
      body: Buffer.from(toCsv(rows), 'utf8'),
    };
  }

  if (format === 'pdf') {
    return {
      type: 'application/pdf',
      filename: `${normalizedType}-report.pdf`,
      body: buildPdfBuffer(`${normalizedType.toUpperCase()} REPORT`, rows),
    };
  }

  return {
    type: 'application/json',
    filename: `${normalizedType}-report.json`,
    body: rows,
  };
}

module.exports = {
  getReportRows,
  buildReportPayload,
};
