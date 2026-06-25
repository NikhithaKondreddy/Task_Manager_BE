const db = require(__root + 'db');
const logger = require(__root + 'logger');

function q(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

async function hasColumn(table, column) {
  try {
    const rows = await q("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column]);
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    return false;
  }
}

async function projectExistsAndBelongs(projectIdentifier) {
  if (!projectIdentifier && projectIdentifier !== 0) return null;
  const idRaw = String(projectIdentifier).trim();
  const attempts = [];

  if (/^\d+$/.test(idRaw)) attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE id = ? LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE public_id = ? LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE LOWER(public_id) = LOWER(?) LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE public_id LIKE ? LIMIT 1', params: ['%' + idRaw + '%'] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE name = ? LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE name LIKE ? LIMIT 1', params: ['%' + idRaw + '%'] });

  for (const a of attempts) {
    try {
      logger.debug('Project lookup attempt', { sql: a.sql, params: a.params });
      const rows = await q(a.sql, a.params);
      if (rows && rows.length > 0) return rows[0];
    } catch (e) {
      logger.warn('Project lookup attempt failed', { sql: a.sql, err: e && e.message });
    }
  }

  return null;
}

async function findColumn(table, candidates) {
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasColumn(table, c)) return c;
  }
  return null;
}

async function projectLookupDiagnostic(projectIdentifier) {
  const idRaw = projectIdentifier == null ? '' : String(projectIdentifier).trim();
  const attempts = [];
  if (!idRaw) return { matched: null, attempts: [] };

  if (/^\d+$/.test(idRaw)) attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE id = ? LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE public_id = ? LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE LOWER(public_id) = LOWER(?) LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE public_id LIKE ? LIMIT 1', params: ['%' + idRaw + '%'] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE name = ? LIMIT 1', params: [idRaw] });
  attempts.push({ sql: 'SELECT id, public_id, name FROM projects WHERE name LIKE ? LIMIT 1', params: ['%' + idRaw + '%'] });

  const results = [];
  for (const a of attempts) {
    try {
      const rows = await q(a.sql, a.params);
      results.push({ sql: a.sql, params: a.params, found: Array.isArray(rows) && rows.length > 0, rows: (rows || []).map(r => ({ id: r.id, public_id: r.public_id, name: r.name })) });
      if (rows && rows.length > 0) return { matched: { id: rows[0].id, public_id: rows[0].public_id, name: rows[0].name }, attempts: results };
    } catch (e) {
      results.push({ sql: a.sql, params: a.params, error: e && e.message });
    }
  }

  return { matched: null, attempts: results };
}

async function userHasAccessToProject(user, projectId) {
  if (!user) return false;
  if (user.role === 'Admin' || user.role === 'Manager') return true;
  const rows = await q('SELECT COUNT(*) as c FROM task_assignments ta JOIN tasks t ON ta.task_id = t.id WHERE ta.user_id = ? AND t.project_id = ?', [user._id, projectId]);
  return rows && rows[0] && rows[0].c > 0;
}

async function generateProjectReport(user, projectIdentifier, startDate, endDate) {
  const project = await projectExistsAndBelongs(projectIdentifier);
  if (!project) {
    const diag = await projectLookupDiagnostic(projectIdentifier);
    throw { status: 404, message: 'Project not found or not accessible', diagnostic: diag };
  }

  const access = await userHasAccessToProject(user, project.id);
  if (!access) throw { status: 403, message: 'Access denied to project' };

  const start = startDate + ' 00:00:00';
  const end = endDate + ' 23:59:59';

  let tasks = [];

  // choose a numeric column from timelogs if present to avoid referencing missing columns
  const candidates = ['hours', 'duration', 'logged_hours', 'total_hours'];
  let tlCol = null;
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await hasColumn('timelogs', c)) { tlCol = c; break; }
  }

  const hoursExpr = tlCol ? `(SELECT SUM(tl.${tlCol}) FROM timelogs tl WHERE tl.task_id = t.id)` : null;

  // find appropriate column names on tasks table for due date, taskDate and created
  const dueCol = await findColumn('tasks', ['due_date', 'dueDate']);
  const taskDateCol = await findColumn('tasks', ['taskDate', 'task_date']);
  const createdCol = await findColumn('tasks', ['createdAt', 'created_at']) || 'createdAt';

  const baseSelect = (includeDue) => {
    const duePart = includeDue && dueCol ? `ANY_VALUE(DATE_FORMAT(t.${dueCol}, '%Y-%m-%d')) as dueDate,` : '';
    return `SELECT ANY_VALUE(t.public_id) as taskId, ANY_VALUE(t.title) as taskName, ANY_VALUE(t.status) as status, ${duePart} ANY_VALUE(DATE_FORMAT(t.${createdCol}, '%Y-%m-%d')) as createdDate, GROUP_CONCAT(DISTINCT u.name SEPARATOR ', ') as assignedTo,`;
  };

  const hoursSelect = tlCol ? `COALESCE(${hoursExpr}, t.total_duration, 0) as hoursLogged` : `COALESCE(t.total_duration, 0) as hoursLogged`;

  const taskQueryVariants = [
    {
        sql: `${baseSelect(true)} ${hoursSelect} FROM tasks t LEFT JOIN task_assignments ta ON t.id = ta.task_id LEFT JOIN users u ON ta.user_id = u._id WHERE t.project_id = ? AND ((${ taskDateCol ? `t.${taskDateCol} BETWEEN ? AND ?` : `t.${createdCol} BETWEEN ? AND ?` }) OR (t.${createdCol} BETWEEN ? AND ?)) GROUP BY t.id ORDER BY t.${createdCol} DESC`,
      params: [project.id, start, end, start, end]
    },
    {
      sql: `${baseSelect(true)} ${hoursSelect} FROM tasks t LEFT JOIN task_assignments ta ON t.id = ta.task_id LEFT JOIN users u ON ta.user_id = u._id WHERE t.project_id = ? AND ((${ taskDateCol ? `t.${taskDateCol} BETWEEN ? AND ?` : `t.${createdCol} BETWEEN ? AND ?` }) OR (t.${createdCol} BETWEEN ? AND ?)) GROUP BY t.id ORDER BY t.${createdCol} DESC`,
      params: [project.id, start, end, start, end]
    },
    {
      sql: `${baseSelect(false)} ${hoursSelect} FROM tasks t LEFT JOIN task_assignments ta ON t.id = ta.task_id LEFT JOIN users u ON ta.user_id = u._id WHERE t.project_id = ? AND ((${ taskDateCol ? `t.${taskDateCol} BETWEEN ? AND ?` : `t.${createdCol} BETWEEN ? AND ?` }) OR (t.${createdCol} BETWEEN ? AND ?)) GROUP BY t.id ORDER BY t.${createdCol} DESC`,
      params: [project.id, start, end, start, end]
    }
  ];

  let lastErr = null;
  for (const v of taskQueryVariants) {
    try {
      tasks = await q(v.sql, v.params);
      break;
    } catch (e) {
      if (e && (e.code === 'ER_BAD_FIELD_ERROR' || e.code === 'ER_NO_SUCH_TABLE')) {
        lastErr = e;
        logger.warn('Task query variant failed (schema issue), trying next', { sql: v.sql, err: e && e.message, code: e && e.code });
        continue;
      }
      throw e;
    }
  }

  if ((!tasks || tasks.length === 0) && lastErr) {
    throw lastErr;
  }

  const nowIso = new Date().toISOString().slice(0, 10);
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => (t.status || '').toLowerCase() === 'completed').length;
  const pendingTasks = tasks.filter(t => (t.status || '').toLowerCase() !== 'completed' && t.status).length;
  const overdueTasks = tasks.filter(t => t.dueDate && t.dueDate < nowIso && ((t.status || '').toLowerCase() !== 'completed')).length;

  const tasksOut = (tasks || []).map(t => ({
    taskId: t.taskId,
    taskName: t.taskName,
    assignedTo: t.assignedTo || '',
    status: t.status || null,
    hoursLogged: Number(t.hoursLogged) || 0,
    dueDate: (t.dueDate && String(t.dueDate).trim()) || (t.createdDate && String(t.createdDate).trim()) || endDate || ''
  }));

  const totalHoursLogged = tasksOut.reduce((s, t) => s + (Number(t.hoursLogged) || 0), 0);

  const productivityScore = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  const statusDistribution = { notStarted: 0, inProgress: 0, completed: 0 };
  for (const t of tasksOut) {
    const s = (t.status || '').toLowerCase();
    if (s === 'completed' || s === 'done') statusDistribution.completed += 1;
    else if (s === 'in progress' || s === 'inprogress' || s === 'doing') statusDistribution.inProgress += 1;
    else statusDistribution.notStarted += 1;
  }

  let userProductivity = [];
  try {
    const userAggSql = (function() {
      const tl = tlCol ? `SUM(tl.${tlCol})` : null;
      const hoursPart = tl ? `COALESCE(${tl}, SUM(t.total_duration), 0) as hoursLogged` : `COALESCE(SUM(t.total_duration), 0) as hoursLogged`;
      return `SELECT u._id as userId, u.name as userName,
        SUM(CASE WHEN LOWER(t.status) = 'completed' THEN 1 ELSE 0 END) as tasksCompleted,
        ${hoursPart}
      FROM task_assignments ta
      JOIN users u ON ta.user_id = u._id
      JOIN tasks t ON ta.task_id = t.id
      ${tlCol ? 'LEFT JOIN timelogs tl ON tl.task_id = t.id' : ''}
      WHERE t.project_id = ? AND ((t.taskDate BETWEEN ? AND ?) OR (t.createdAt BETWEEN ? AND ?))
      GROUP BY u._id, u.name`;
    })();
    const rows = await q(userAggSql, [project.id, start, end, start, end]);
    if (rows && rows.length > 0) {
      userProductivity = rows.map(r => ({ userId: r.userId || null, userName: r.userName || null, tasksCompleted: Number(r.tasksCompleted) || 0, hoursLogged: Number(r.hoursLogged) || 0 }));
    }
  } catch (e) {

    logger.warn('User productivity aggregation failed, falling back to names', { err: e && e.message });
    const map = Object.create(null);
    for (const t of tasksOut) {
      const names = t.assignedTo ? String(t.assignedTo).split(',').map(s => s.trim()).filter(Boolean) : [];
      for (const n of names) {
        if (!map[n]) map[n] = { userId: '', userName: n, tasksCompleted: 0, hoursLogged: 0 };
        map[n].hoursLogged += Number(t.hoursLogged) || 0;
        if ((t.status || '').toLowerCase() === 'completed') map[n].tasksCompleted += 1;
      }
    }

    const entries = Object.keys(map).map(k => map[k]);
    for (const ent of entries) {
      try {
        const urows = await q('SELECT _id FROM users WHERE name = ? LIMIT 1', [ent.userName]);
        if (urows && urows.length > 0) ent.userId = urows[0]._id || '';
      } catch (ux) {
        ent.userId = ent.userId || '';
      }
    }
    userProductivity = entries;
  }

  let clientName = project.client_name || project.clientName || project.client || '';
  if (!clientName) {
    try {
      const pr = await q('SELECT client_name, client_id FROM projects WHERE id = ? LIMIT 1', [project.id]);
      if (pr && pr.length > 0) {
        clientName = pr[0].client_name || pr[0].clientName || '';
      }
    } catch (e) {
      logger.debug('Could not enrich project clientName', { err: e && e.message });
      clientName = clientName || '';
    }
  }

  return {
    project: { projectId: project.public_id || String(project.id), projectName: project.name, clientName },
    dateRange: { startDate, endDate },
    summary: { totalTasks, completedTasks, pendingTasks, overdueTasks, totalHoursLogged, productivityScore },
    statusDistribution,
    userProductivity,
    tasks: tasksOut
  };
}

async function getExtendedDashboardMetrics(tenantId, options = {}) {
  const { projectIds, userId } = options;
  
  let taskWhere = ['t.tenant_id = ?'];
  let taskParams = [tenantId];
  
  if (projectIds && projectIds.length > 0) {
    taskWhere.push('t.project_id IN (?)');
    taskParams.push(projectIds);
  }
  
  if (userId) {
    taskWhere.push('exists (select 1 from task_assignments ta where ta.task_id = t.id and ta.user_id = ?)');
    taskParams.push(userId);
  }
  
  const whereClause = taskWhere.join(' AND ');

  // 1. Task Counts & Status Distribution
  const countsSql = `
    SELECT 
      COUNT(*) AS total,
      SUM(CASE WHEN UPPER(t.status) IN ('PENDING', 'NOT STARTED', 'TO DO') THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN UPPER(t.status) IN ('IN PROGRESS', 'IN_PROGRESS') THEN 1 ELSE 0 END) AS in_progress,
      SUM(CASE WHEN UPPER(t.status) IN ('COMPLETED', 'APPROVED') THEN 1 ELSE 0 END) AS completed,
      SUM(CASE WHEN t.taskDate < CURDATE() AND UPPER(t.status) NOT IN ('COMPLETED', 'APPROVED', 'CLOSED') THEN 1 ELSE 0 END) AS overdue,
      SUM(CASE WHEN UPPER(t.status) = 'ON HOLD' THEN 1 ELSE 0 END) AS on_hold
    FROM tasks t
    WHERE ${whereClause}
  `;
  const countsResult = await q(countsSql, taskParams);
  const counts = countsResult[0] || {};
  
  // 2. Daily Task Summary (last 30 days)
  const dailyCreatedSql = `
    SELECT DATE(t.createdAt) AS date, COUNT(*) AS count
    FROM tasks t
    WHERE ${whereClause} AND t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(t.createdAt)
  `;
  const dailyCompletedSql = `
    SELECT DATE(t.completed_at) AS date, COUNT(*) AS count
    FROM tasks t
    WHERE ${whereClause} AND t.completed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
    GROUP BY DATE(t.completed_at)
  `;
  
  const [dailyCreated, dailyCompleted] = await Promise.all([
    q(dailyCreatedSql, taskParams).catch(() => []),
    q(dailyCompletedSql, taskParams).catch(() => [])
  ]);
  
  // 3. Weekly Task Summary (last 12 weeks)
  const weeklyCreatedSql = `
    SELECT YEAR(t.createdAt) AS year, WEEK(t.createdAt) AS week, COUNT(*) AS count
    FROM tasks t
    WHERE ${whereClause} AND t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
    GROUP BY YEAR(t.createdAt), WEEK(t.createdAt)
  `;
  const weeklyCompletedSql = `
    SELECT YEAR(t.completed_at) AS year, WEEK(t.completed_at) AS week, COUNT(*) AS count
    FROM tasks t
    WHERE ${whereClause} AND t.completed_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
    GROUP BY YEAR(t.completed_at), WEEK(t.completed_at)
  `;
  const [weeklyCreated, weeklyCompleted] = await Promise.all([
    q(weeklyCreatedSql, taskParams).catch(() => []),
    q(weeklyCompletedSql, taskParams).catch(() => [])
  ]);

  // 4. Monthly Task Summary (last 12 months)
  const monthlyCreatedSql = `
    SELECT YEAR(t.createdAt) AS year, MONTH(t.createdAt) AS month, COUNT(*) AS count
    FROM tasks t
    WHERE ${whereClause} AND t.createdAt >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    GROUP BY YEAR(t.createdAt), MONTH(t.createdAt)
  `;
  const monthlyCompletedSql = `
    SELECT YEAR(t.completed_at) AS year, MONTH(t.completed_at) AS month, COUNT(*) AS count
    FROM tasks t
    WHERE ${whereClause} AND t.completed_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
    GROUP BY YEAR(t.completed_at), MONTH(t.completed_at)
  `;
  const [monthlyCreated, monthlyCompleted] = await Promise.all([
    q(monthlyCreatedSql, taskParams).catch(() => []),
    q(monthlyCompletedSql, taskParams).catch(() => [])
  ]);

  // 5. User-wise Task Performance
  let userPerformance = [];
  try {
    let userWhere = ['u.tenant_id = ? AND u.role = \'Employee\''];
    let userParams = [tenantId];
    if (userId) {
      userWhere.push('u._id = ?');
      userParams.push(userId);
    }
    
    // Join tasks with matching filters
    let taskFilter = '';
    if (projectIds && projectIds.length > 0) {
      taskFilter += ' AND t.project_id IN (?)';
      userParams.push(projectIds);
    }
    
    const userPerfSql = `
      SELECT 
        u._id AS userId,
        u.public_id AS userPublicId,
        u.name AS userName,
        u.role AS userRole,
        COUNT(ta.task_id) AS totalTasks,
        SUM(CASE WHEN t.status = 'Completed' OR t.status = 'Approved' THEN 1 ELSE 0 END) AS completedTasks,
        SUM(CASE WHEN t.status = 'In Progress' OR t.status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS inProgressTasks,
        SUM(CASE WHEN t.status = 'Pending' OR t.status = 'PENDING' THEN 1 ELSE 0 END) AS pendingTasks,
        SUM(CASE WHEN t.taskDate < CURDATE() AND t.status NOT IN ('Completed', 'Approved', 'Closed') THEN 1 ELSE 0 END) AS overdueTasks
      FROM users u
      LEFT JOIN task_assignments ta ON u._id = ta.user_id
      LEFT JOIN tasks t ON ta.task_id = t.id ${taskFilter}
      WHERE ${userWhere.join(' AND ')}
      GROUP BY u._id, u.public_id, u.name, u.role
      ORDER BY u.name ASC
    `;
    const userPerfRows = await q(userPerfSql, userParams);
    userPerformance = (userPerfRows || []).map(r => {
      const total = Number(r.totalTasks) || 0;
      const completed = Number(r.completedTasks) || 0;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      return {
        userId: r.userPublicId || String(r.userId),
        userName: r.userName,
        role: r.userRole,
        totalTasks: total,
        completed: completed,
        inProgress: Number(r.inProgressTasks) || 0,
        pending: Number(r.pendingTasks) || 0,
        overdue: Number(r.overdueTasks) || 0,
        completionRate
      };
    });
  } catch (e) {
    logger.warn('Failed to calculate user performance: ' + e.message);
  }

  // Helper to align date series
  const dailySummary = [];
  const dailyMap = {};
  dailyCreated.forEach(c => {
    const d = c.date ? new Date(c.date).toISOString().split('T')[0] : 'Unknown';
    dailyMap[d] = { date: d, created: c.count, completed: 0 };
  });
  dailyCompleted.forEach(c => {
    const d = c.date ? new Date(c.date).toISOString().split('T')[0] : 'Unknown';
    if (!dailyMap[d]) dailyMap[d] = { date: d, created: 0, completed: 0 };
    dailyMap[d].completed = c.count;
  });
  Object.keys(dailyMap).sort().forEach(k => dailySummary.push(dailyMap[k]));

  const weeklySummary = [];
  const weeklyMap = {};
  weeklyCreated.forEach(c => {
    const k = `${c.year}-W${c.week}`;
    weeklyMap[k] = { label: k, created: c.count, completed: 0 };
  });
  weeklyCompleted.forEach(c => {
    const k = `${c.year}-W${c.week}`;
    if (!weeklyMap[k]) weeklyMap[k] = { label: k, created: 0, completed: 0 };
    weeklyMap[k].completed = c.count;
  });
  Object.keys(weeklyMap).sort().forEach(k => weeklySummary.push(weeklyMap[k]));

  const monthlySummary = [];
  const monthlyMap = {};
  monthlyCreated.forEach(c => {
    const k = `${c.year}-${String(c.month).padStart(2, '0')}`;
    monthlyMap[k] = { label: k, created: c.count, completed: 0 };
  });
  monthlyCompleted.forEach(c => {
    const k = `${c.year}-${String(c.month).padStart(2, '0')}`;
    if (!monthlyMap[k]) monthlyMap[k] = { label: k, created: 0, completed: 0 };
    monthlyMap[k].completed = c.count;
  });
  Object.keys(monthlyMap).sort().forEach(k => monthlySummary.push(monthlyMap[k]));

  return {
    totalTasks: Number(counts.total || 0),
    pendingTasks: Number(counts.pending || 0),
    inProgressTasks: Number(counts.in_progress || 0),
    completedTasks: Number(counts.completed || 0),
    overdueTasks: Number(counts.overdue || 0),
    onHoldTasks: Number(counts.on_hold || 0),
    dailyTaskSummary: dailySummary,
    weeklyTaskSummary: weeklySummary,
    monthlyTaskSummary: monthlySummary,
    userWiseTaskPerformance: userPerformance,
    taskStatusDistribution: [
      { name: 'Pending', value: Number(counts.pending || 0) },
      { name: 'In Progress', value: Number(counts.in_progress || 0) },
      { name: 'Completed', value: Number(counts.completed || 0) },
      { name: 'On Hold', value: Number(counts.on_hold || 0) },
      { name: 'Overdue', value: Number(counts.overdue || 0) }
    ],
    taskCompletionTrends: dailySummary.map(item => ({
      date: item.date,
      completionRate: (item.created > 0) ? Math.round((item.completed / item.created) * 100) : 0,
      created: item.created,
      completed: item.completed
    }))
  };
}

module.exports = { generateProjectReport, projectLookupDiagnostic, getExtendedDashboardMetrics };
