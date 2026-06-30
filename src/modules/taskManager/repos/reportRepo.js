const dayjs = require('dayjs');
const { q } = require('../utils/db');
const dashboardRepo = require('./dashboardRepo');

async function taskSummary(tenantId, { fromDate, toDate } = {}) {
  const items = await dashboardRepo.getWorkItems(tenantId);
  const filtered = items.filter((it) => {
    if (fromDate && dayjs(it.created_at).isBefore(dayjs(fromDate))) return false;
    if (toDate && dayjs(it.created_at).isAfter(dayjs(toDate))) return false;
    return true;
  });
  const summary = dashboardRepo.summarize(filtered);
  const byType = {};
  for (const it of filtered) byType[it.task_type] = (byType[it.task_type] || 0) + 1;
  return { ...summary, byType };
}

async function employeePerformance(tenantId, userIds = null) {
  const users = userIds && userIds.length
    ? await q(`SELECT _id, name, email FROM users WHERE tenant_id = ? AND _id IN (${userIds.map(() => '?').join(',')})`, [tenantId, ...userIds])
    : await q(`SELECT _id, name, email FROM users WHERE tenant_id = ? AND role = 'Employee'`, [tenantId]);

  const result = [];
  for (const user of users) {
    const items = await dashboardRepo.getWorkItems(tenantId, { assignedToIds: [user._id] });
    const stats = dashboardRepo.summarize(items);
    const completedWithDuration = items.filter((it) => it.completed_at && it.created_at);
    const avgCompletionHours = completedWithDuration.length
      ? Math.round(
          completedWithDuration.reduce((sum, it) => sum + dayjs(it.completed_at).diff(dayjs(it.created_at), 'hour'), 0) /
            completedWithDuration.length
        )
      : null;
    result.push({
      userId: user._id,
      name: user.name,
      email: user.email,
      totalAssigned: stats.total,
      completed: stats.completed,
      overdue: stats.overdue,
      completionRate: stats.total ? Math.round((stats.completed / stats.total) * 100) : 0,
      avgCompletionHours
    });
  }
  return result;
}

async function completionTrend(tenantId, days = 30) {
  const items = await dashboardRepo.getWorkItems(tenantId);
  return dashboardRepo.trendSeries(items, days);
}

async function recurringTaskReport(tenantId) {
  return q(
    `SELECT t.public_id, t.title, r.frequency, r.repeat_every,
       COUNT(o.id) AS total_occurrences,
       SUM(CASE WHEN o.status IN ('Completed','Approved') THEN 1 ELSE 0 END) AS completed_occurrences,
       SUM(CASE WHEN o.status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_occurrences
     FROM tm_tasks t
     JOIN tm_task_recurrence r ON r.id = t.recurrence_id
     LEFT JOIN tm_task_occurrences o ON o.task_id = t.id
     WHERE t.tenant_id = ? AND t.task_type = 'RECURRING' AND t.is_deleted = 0
     GROUP BY t.id`,
    [tenantId]
  );
}

async function gembaWalkReport(tenantId) {
  return q(
    `SELECT t.public_id, t.title, g.department, g.area, g.location,
       COUNT(o.id) AS total_walks,
       SUM(CASE WHEN o.status IN ('Completed','Approved') THEN 1 ELSE 0 END) AS completed_walks,
       SUM(CASE WHEN o.status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_walks,
       MIN(o.started_at) AS first_start_time,
       MAX(o.completed_at) AS last_end_time,
       SUM(COALESCE(o.total_duration_seconds, 0)) AS total_duration_seconds,
       AVG(NULLIF(o.total_duration_seconds, 0)) AS average_duration_seconds
     FROM tm_tasks t
     JOIN tm_gemba_details g ON g.task_id = t.id
     LEFT JOIN tm_task_occurrences o ON o.task_id = t.id
     WHERE t.tenant_id = ? AND t.task_type = 'GEMBA_WALK' AND t.is_deleted = 0
     GROUP BY t.id`,
    [tenantId]
  );
}

async function approvalReport(tenantId) {
  const rows = await q(
    `SELECT a.approval_type, a.status, a.decided_by, u.name AS decided_by_name,
            TIMESTAMPDIFF(MINUTE, a.requested_at, a.decided_at) AS turnaround_minutes
     FROM tm_approvals a LEFT JOIN users u ON u._id = a.decided_by
     WHERE a.tenant_id = ?`,
    [tenantId]
  );
  const byApprover = {};
  let approvedCount = 0;
  let rejectedCount = 0;
  let pendingCount = 0;
  let turnaroundTotal = 0;
  let turnaroundCount = 0;
  for (const row of rows) {
    if (row.status === 'Approved') approvedCount++;
    else if (row.status === 'Rejected') rejectedCount++;
    else pendingCount++;
    if (row.turnaround_minutes != null) { turnaroundTotal += row.turnaround_minutes; turnaroundCount++; }
    if (row.decided_by_name) {
      byApprover[row.decided_by_name] = byApprover[row.decided_by_name] || { approved: 0, rejected: 0 };
      if (row.status === 'Approved') byApprover[row.decided_by_name].approved++;
      if (row.status === 'Rejected') byApprover[row.decided_by_name].rejected++;
    }
  }
  return {
    approvedCount,
    rejectedCount,
    pendingCount,
    avgTurnaroundMinutes: turnaroundCount ? Math.round(turnaroundTotal / turnaroundCount) : null,
    byApprover
  };
}

module.exports = { taskSummary, employeePerformance, completionTrend, recurringTaskReport, gembaWalkReport, approvalReport };
