const dayjs = require('dayjs');
const { q } = require('../utils/db');

/**
 * "Work items" = individual/project tm_tasks rows + tm_task_occurrences rows
 * (recurring/gemba instances). Combining both gives an accurate unit-of-work
 * count for dashboards. Aggregation is done in JS for readability across the
 * many breakdowns dashboards need (status/priority/trend/due-today).
 */
async function getWorkItems(tenantId, { assignedToIds = null } = {}) {
  const paramsTasks = [tenantId];
  const paramsOcc = [tenantId];
  let assigneeFilterTasks = '';
  let assigneeFilterOcc = '';
  if (assignedToIds && assignedToIds.length) {
    const ph = assignedToIds.map(() => '?').join(',');
    assigneeFilterTasks = ` AND t.assigned_to IN (${ph})`;
    assigneeFilterOcc = ` AND o.assigned_to IN (${ph})`;
    paramsTasks.push(...assignedToIds);
    paramsOcc.push(...assignedToIds);
  }

  const directTasks = await q(
    `SELECT t.id, t.public_id, t.title, t.status, t.priority, t.due_date, t.assigned_to, t.completed_at, t.created_at, t.task_type
     FROM tm_tasks t WHERE t.tenant_id = ? AND t.is_deleted = 0 AND t.task_type IN ('INDIVIDUAL','PROJECT')${assigneeFilterTasks}`,
    paramsTasks
  );

  const occurrences = await q(
    `SELECT o.id, o.public_id, t.title, o.status, t.priority, o.due_date, o.assigned_to, o.completed_at, o.created_at, t.task_type
     FROM tm_task_occurrences o JOIN tm_tasks t ON t.id = o.task_id
     WHERE o.tenant_id = ? AND t.is_deleted = 0${assigneeFilterOcc}`,
    paramsOcc
  );

  return [...directTasks, ...occurrences];
}

function summarize(items) {
  const today = dayjs().format('YYYY-MM-DD');
  const summary = {
    total: items.length,
    completed: 0,
    dueToday: 0,
    overdue: 0,
    byStatus: { Pending: 0, 'In Progress': 0, Completed: 0, Overdue: 0, Rejected: 0, Approved: 0 },
    byPriority: { Low: 0, Medium: 0, High: 0, Critical: 0 }
  };
  for (const item of items) {
    if (item.status === 'Completed' || item.status === 'Approved') summary.completed++;
    if (item.status === 'Overdue') summary.overdue++;
    if (item.due_date && dayjs(item.due_date).format('YYYY-MM-DD') === today && ['Pending', 'In Progress'].includes(item.status)) {
      summary.dueToday++;
    }
    if (summary.byStatus[item.status] !== undefined) summary.byStatus[item.status]++;
    if (summary.byPriority[item.priority] !== undefined) summary.byPriority[item.priority]++;
  }
  return summary;
}

function trendSeries(items, days = 7) {
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const dateStr = dayjs().subtract(i, 'day').format('YYYY-MM-DD');
    const createdThatDay = items.filter((it) => dayjs(it.created_at).format('YYYY-MM-DD') === dateStr);
    const completedThatDay = items.filter((it) => it.completed_at && dayjs(it.completed_at).format('YYYY-MM-DD') === dateStr);
    const openAsOfDay = items.filter(
      (it) => ['Pending', 'In Progress'].includes(it.status) && dayjs(it.created_at).format('YYYY-MM-DD') <= dateStr
    );
    const overdueThatDay = items.filter((it) => it.status === 'Overdue' && it.due_date && dayjs(it.due_date).format('YYYY-MM-DD') === dateStr);
    series.push({
      date: dateStr,
      all: createdThatDay.length,
      completed: completedThatDay.length,
      pending: openAsOfDay.length,
      overdue: overdueThatDay.length
    });
  }
  return series;
}

async function recentTasks(tenantId, limit = 5, assignedToIds = null) {
  let filter = '';
  const params = [tenantId];
  if (assignedToIds && assignedToIds.length) {
    filter = ` AND t.assigned_to IN (${assignedToIds.map(() => '?').join(',')})`;
    params.push(...assignedToIds);
  }
  return q(
    `SELECT t.public_id, t.title, t.status, t.priority, t.due_date, t.task_type, u.name AS assignee_name
     FROM tm_tasks t LEFT JOIN users u ON u._id = t.assigned_to
     WHERE t.tenant_id = ? AND t.is_deleted = 0${filter}
     ORDER BY t.created_at DESC LIMIT ${Number(limit) || 5}`,
    params
  );
}

async function overdueList(tenantId, assignedToIds = null, limit = 5) {
  let filter = '';
  const params = [tenantId];
  if (assignedToIds && assignedToIds.length) {
    filter = ` AND t.assigned_to IN (${assignedToIds.map(() => '?').join(',')})`;
    params.push(...assignedToIds);
  }
  return q(
    `SELECT t.public_id, t.title, t.due_date, t.priority, u.name AS assignee_name
     FROM tm_tasks t LEFT JOIN users u ON u._id = t.assigned_to
     WHERE t.tenant_id = ? AND t.is_deleted = 0 AND t.status = 'Overdue'${filter}
     ORDER BY t.due_date ASC LIMIT ${Number(limit) || 5}`,
    params
  );
}

async function upcomingDeadlines(tenantId, assignedToIds = null, limit = 5) {
  let filter = '';
  const params = [tenantId];
  if (assignedToIds && assignedToIds.length) {
    filter = ` AND t.assigned_to IN (${assignedToIds.map(() => '?').join(',')})`;
    params.push(...assignedToIds);
  }
  return q(
    `SELECT t.public_id, t.title, t.due_date, t.priority, u.name AS assignee_name
     FROM tm_tasks t LEFT JOIN users u ON u._id = t.assigned_to
     WHERE t.tenant_id = ? AND t.is_deleted = 0 AND t.status IN ('Pending','In Progress') AND t.due_date IS NOT NULL${filter}
     ORDER BY t.due_date ASC LIMIT ${Number(limit) || 5}`,
    params
  );
}

async function countProjects(tenantId, managerId = null) {
  const where = ['tenant_id = ?', 'is_deleted = 0'];
  const params = [tenantId];
  if (managerId) { where.push('manager_id = ?'); params.push(managerId); }
  const rows = await q(`SELECT COUNT(*) AS total FROM tm_projects WHERE ${where.join(' AND ')}`, params);
  return rows[0].total;
}

async function countActiveUsers(tenantId) {
  const rows = await q(`SELECT COUNT(*) AS total FROM users WHERE tenant_id = ? AND is_active = 1`, [tenantId]);
  return rows[0].total;
}

async function teamTaskSummary(tenantId, teamUsers) {
  const summary = [];
  for (const user of teamUsers) {
    const items = await getWorkItems(tenantId, { assignedToIds: [user._id] });
    const stats = summarize(items);
    summary.push({
      userId: user._id,
      name: user.name,
      photo: user.photo,
      total: stats.total,
      completed: stats.completed,
      inProgress: stats.byStatus['In Progress'],
      overdue: stats.overdue,
      completionPercent: stats.total ? Math.round((stats.completed / stats.total) * 100) : 0
    });
  }
  return summary;
}

module.exports = {
  getWorkItems, summarize, trendSeries, recentTasks, overdueList,
  upcomingDeadlines, countProjects, countActiveUsers, teamTaskSummary
};
