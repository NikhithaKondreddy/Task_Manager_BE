const { query } = require('../repositories/mysql');
const { buildPdfBuffer } = require('../helpers/pdfExport');

function buildFilters(tenantId, filters = {}) {
  const where = ['t.tenant_id = ?'];
  const params = [tenantId];

  // helper to extract scalar value from nested query objects: { id, name } or simple values
  function extract(filtersObj, key) {
    if (!filtersObj || filtersObj[key] == null) return null;
    const v = filtersObj[key];
    if (typeof v === 'object') {
      if (v.id != null) return v.id;
      if (v.name != null) return v.name;
      return null;
    }
    return v;
  }

  if (filters.status) {
    where.push('UPPER(t.status) = ?');
    params.push(String(filters.status).trim().toUpperCase());
  }

  if (filters.priority) {
    where.push('UPPER(t.priority) = ?');
    params.push(String(filters.priority).trim().toUpperCase());
  }

  const fromVal = filters.fromDate || filters.from;
  if (fromVal) {
    where.push('DATE(t.created_at) >= DATE(?)');
    params.push(fromVal);
  }

  const toVal = filters.toDate || filters.to;
  if (toVal) {
    where.push('DATE(t.created_at) <= DATE(?)');
    params.push(toVal);
  }

  const categoryVal = extract(filters, 'category') || filters.category;
  if (categoryVal) {
    if (!isNaN(categoryVal) && Number(categoryVal) > 0) {
      where.push('t.category_id = ?');
      params.push(Number(categoryVal));
    } else {
      where.push('t.category_id IN (SELECT id FROM categories WHERE UPPER(category_name) = UPPER(?) AND tenant_id = ?)');
      params.push(String(categoryVal).trim(), tenantId);
    }
  }

  const stateVal = extract(filters, 'state') || filters.state;
  if (stateVal) {
    if (!isNaN(stateVal) && Number(stateVal) > 0) {
      where.push('t.state_id = ?');
      params.push(Number(stateVal));
    } else {
      where.push('t.state_id IN (SELECT id FROM states WHERE UPPER(name) = UPPER(?) AND tenant_id = ?)');
      params.push(String(stateVal).trim(), tenantId);
    }
  }

  const regionVal = extract(filters, 'region') || filters.region;
  if (regionVal) {
    if (!isNaN(regionVal) && Number(regionVal) > 0) {
      where.push('t.region_id = ?');
      params.push(Number(regionVal));
    } else {
      where.push('t.region_id IN (SELECT id FROM regions WHERE UPPER(name) = UPPER(?) AND tenant_id = ?)');
      params.push(String(regionVal).trim(), tenantId);
    }
  }

  const clusterVal = extract(filters, 'cluster') || filters.cluster;
  if (clusterVal) {
    if (!isNaN(clusterVal) && Number(clusterVal) > 0) {
      where.push('t.cluster_id = ?');
      params.push(Number(clusterVal));
    } else {
      where.push('t.cluster_id IN (SELECT id FROM clusters WHERE UPPER(name) = UPPER(?) AND tenant_id = ?)');
      params.push(String(clusterVal).trim(), tenantId);
    }
  }

  const branchVal = extract(filters, 'branch') || filters.branch;
  if (branchVal) {
    if (!isNaN(branchVal) && Number(branchVal) > 0) {
      where.push('t.branch_id = ?');
      params.push(Number(branchVal));
    } else {
      where.push('t.branch_id IN (SELECT id FROM branches WHERE UPPER(name) = UPPER(?) AND tenant_id = ?)');
      params.push(String(branchVal).trim(), tenantId);
    }
  }

  const engineerVal = extract(filters, 'engineer') || filters.engineer;
  if (engineerVal) {
    where.push('t.assigned_to IN (SELECT _id FROM users WHERE (public_id = ? OR name = ? OR _id = ?) AND tenant_id = ?)');
    params.push(String(engineerVal).trim(), String(engineerVal).trim(), String(engineerVal).trim(), tenantId);
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
  const normalizedType = String(type || '').trim().toLowerCase();

  if (normalizedType === 'json') {
    const { where, params } = buildFilters(tenantId, filters);
    let rows = await query(
      `SELECT t.id, t.ticket_id AS ticketId, t.title, t.status, t.priority, t.created_at AS createdAt, t.updated_at AS updatedAt, t.resolution_due_at AS slaDueAt,
       u.name AS assignedTo, u.public_id AS assignedToId, c.category_name AS category, s.name AS state, r.name AS region
       FROM tickets t
       LEFT JOIN users u ON u._id = t.assigned_to
       LEFT JOIN categories c ON c.id = t.category_id
       LEFT JOIN states s ON s.id = t.state_id AND s.tenant_id = t.tenant_id
       LEFT JOIN regions r ON r.id = t.region_id AND r.tenant_id = t.tenant_id
       WHERE ${where.join(' AND ')}
       ORDER BY t.created_at DESC`,
      params
    );

    // Normalize rows to avoid null values in the JSON response
    rows = rows.map(r => ({
      id: r.id,
      ticketId: r.ticketId || '',
      title: r.title || '',
      status: r.status || '',
      priority: r.priority || '',
      createdAt: r.createdAt ? (new Date(r.createdAt)).toISOString() : '',
      updatedAt: r.updatedAt ? (new Date(r.updatedAt)).toISOString() : '',
      slaDueAt: r.slaDueAt ? (new Date(r.slaDueAt)).toISOString() : '',
      assignedTo: r.assignedTo || 'Unassigned',
      assignedToId: r.assignedToId || '',
      category: r.category || 'Uncategorized',
      state: r.state || 'Unknown',
      region: r.region || 'Unknown'
    }));

    let total = rows.length;
    let open = rows.filter(t => !['CLOSED', 'RESOLVED'].includes(String(t.status).toUpperCase())).length;
    let closed = total - open;
    let slaBreached = rows.filter(t => t.slaDueAt && new Date(t.slaDueAt) < new Date() && !['CLOSED'].includes(String(t.status).toUpperCase())).length;

    let closedTickets = rows.filter(t => ['CLOSED', 'RESOLVED'].includes(String(t.status).toUpperCase()));
    let avgResolution = 0;
    if (closedTickets.length > 0) {
      let totalHrs = 0;
      let count = 0;
      closedTickets.forEach(t => {
        const start = t.createdAt ? new Date(t.createdAt).getTime() : null;
        const end = t.updatedAt ? new Date(t.updatedAt).getTime() : null;
        if (start && end && end >= start) {
          totalHrs += (end - start) / (1000 * 60 * 60);
          count += 1;
        }
      });
      avgResolution = count > 0 ? Number((totalHrs / count).toFixed(1)) : 0;
    }

    return {
      type: 'application/json',
      filename: `report.json`,
      body: {
        rows,
        summary: {
          total,
          open,
          closed,
          slaBreached,
          avgResolutionHours: avgResolution
        }
      }
    };
  }

  const rows = await getReportRows(tenantId, type, filters);
  const format = String(filters.format || 'json').trim().toLowerCase();

  // For SLA reports return a structured JSON payload with rows and an aggregated summary
  if (normalizedType === 'sla' && format === 'json') {
    let total = 0;
    let response_breaches = 0;
    let resolution_breaches = 0;
    let escalated_tickets = 0;
    (rows || []).forEach(r => {
      total += Number(r.total_tickets || 0);
      response_breaches += Number(r.response_breaches || 0);
      resolution_breaches += Number(r.resolution_breaches || 0);
      escalated_tickets += Number(r.escalated_tickets || 0);
    });

    return {
      type: 'application/json',
      filename: `${normalizedType}-report.json`,
      body: {
        rows: rows || [],
        summary: {
          total_tickets: total,
          response_breaches,
          resolution_breaches,
          escalated_tickets
        }
      }
    };
  }

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
