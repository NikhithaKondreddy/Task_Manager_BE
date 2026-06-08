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

module.exports = { generateProjectReport, projectLookupDiagnostic };
