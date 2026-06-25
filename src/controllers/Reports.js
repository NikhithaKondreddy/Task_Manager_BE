const express = require('express');
const router = express.Router();
const logger = require(__root + 'logger');
const { generateProjectReport, projectLookupDiagnostic, getExtendedDashboardMetrics } = require(__root + 'services/reportService');
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const db = require(__root + 'db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

router.use(requireAuth);

router.post('/project', async (req, res) => {
  try {
    const { projectId, startDate, endDate } = req.body || {};
    if (!projectId || !startDate || !endDate) {
      return res.status(400).json({ success: false, message: 'projectId, startDate and endDate are required' });
    }

    const sd = new Date(startDate);
    const ed = new Date(endDate);
    if (isNaN(sd.getTime()) || isNaN(ed.getTime()) || sd > ed) {
      return res.status(400).json({ success: false, message: 'Invalid date range' });
    }

    const report = await generateProjectReport(req.user, projectId, startDate, endDate);
    return res.json({ success: true, data: report });
  } catch (err) {
    logger.error('Generate project report error:', err && err.stack ? err.stack : err);
    if (err && err.status) {
      const payload = { success: false, message: err.message };
      if (err.diagnostic) payload.diagnostic = err.diagnostic;
      return res.status(err.status).json(payload);
    }
    return res.status(500).json({ success: false, message: err && err.message ? err.message : 'Failed generating project report' });
  }
});

router.get('/debug-project', requireRole(['Admin', 'Manager']), async (req, res) => {
  try {
    const projectId = req.query.projectId || req.query.project_id;
    if (!projectId) return res.status(400).json({ success: false, message: 'projectId required' });
    const diag = await projectLookupDiagnostic(projectId, req.user ? req.user.tenant_id : null);
    return res.json({ success: true, data: diag });
  } catch (err) {
    logger.error('Project lookup diagnostic error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Diagnostic failed', error: err && err.message });
  }
});

module.exports = router;

router.get('/overview', requireRole(['Admin', 'Manager', 'Employee']), async (req, res) => {
  try {
    const startDate = req.query.startDate || req.query.start_date;
    const endDate = req.query.endDate || req.query.end_date;

    const now = new Date();
    const start = startDate ? new Date(startDate) : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = endDate ? new Date(endDate) : new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;

    const userRole = String((req.user && req.user.role) || '').toLowerCase();
    const isEmployee = userRole === 'employee';
    const employeeId = req.user && req.user._id;

    const taskJoin = isEmployee ? 'JOIN task_assignments ta ON ta.task_id = t.id' : '';
    const taskScopeWhere = isEmployee ? 'AND ta.user_id = ?' : '';
    const taskScopeParams = isEmployee ? [employeeId] : [];

    let tasksCreated = 0;
    const createdVariants = [
      { sql: `SELECT COUNT(*) as c FROM tasks t ${taskJoin} WHERE DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] },
      { sql: `SELECT COUNT(*) as c FROM tasks t ${taskJoin} WHERE DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] }
    ];
    for (const v of createdVariants) {
      try { const r = await q(v.sql, v.params); tasksCreated = Number(r[0].c) || 0; break; } catch (e) { continue; }
    }

    let tasksCompleted = 0;
    const completedVariants = [
      { sql: `SELECT COUNT(*) as c FROM tasks t ${taskJoin} WHERE LOWER(t.status) = 'completed' AND (DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?)) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] },
      { sql: `SELECT COUNT(*) as c FROM tasks t ${taskJoin} WHERE LOWER(t.status) = 'completed' AND (DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?)) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] }
    ];
    for (const v of completedVariants) {
      try { const r = await q(v.sql, v.params); tasksCompleted = Number(r[0].c) || 0; break; } catch (e) { continue; }
    }

    let hoursLogged = 0;
    const hoursVariants = [
      {
        sql: isEmployee
          ? `SELECT COALESCE(SUM(tl.hours), 0) as h FROM timelogs tl JOIN tasks t ON tl.task_id = t.id ${taskJoin} WHERE DATE(tl.log_date) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`
          : 'SELECT COALESCE(SUM(hours), 0) as h FROM timelogs WHERE DATE(log_date) BETWEEN DATE(?) AND DATE(?)',
        params: isEmployee ? [startStr, endStr, ...taskScopeParams] : [startStr, endStr]
      },
      { sql: `SELECT COALESCE((SUM(t.total_duration) / 3600), 0) as h FROM tasks t ${taskJoin} WHERE DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] },
      { sql: `SELECT COALESCE((SUM(t.total_duration) / 3600), 0) as h FROM tasks t ${taskJoin} WHERE DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] }
    ];
    for (const v of hoursVariants) {
      try { const r = await q(v.sql, v.params); hoursLogged = Number(r[0].h) || 0; break; } catch (e) { continue; }
    }

    let activeProjects = 0;
    const projectsVariants = [
      { sql: `SELECT COUNT(DISTINCT t.project_id) as c FROM tasks t ${taskJoin} WHERE DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] },
      { sql: `SELECT COUNT(DISTINCT t.project_id) as c FROM tasks t ${taskJoin} WHERE DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere}`, params: [startStr, endStr, ...taskScopeParams] }
    ];
    for (const v of projectsVariants) {
      try { const r = await q(v.sql, v.params); activeProjects = Number(r[0].c) || 0; break; } catch (e) { continue; }
    }

    let statusRows = [];
    const statusVariants = [
      { sql: `SELECT LOWER(t.status) as s, COUNT(*) as c FROM tasks t ${taskJoin} WHERE DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere} GROUP BY t.status`, params: [startStr, endStr, ...taskScopeParams] },
      { sql: `SELECT LOWER(t.status) as s, COUNT(*) as c FROM tasks t ${taskJoin} WHERE DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?) ${taskScopeWhere} GROUP BY t.status`, params: [startStr, endStr, ...taskScopeParams] }
    ];
    for (const v of statusVariants) {
      try { statusRows = await q(v.sql, v.params); break; } catch (e) { continue; }
    }
    const taskStatus = { completed: 0, inProgress: 0, notStarted: 0, overdue: 0 };
    for (const r of statusRows) {
      const s = (r.s || '').trim();
      if (s === 'completed' || s === 'done') taskStatus.completed += Number(r.c) || 0;
      else if (s === 'in progress' || s === 'doing' || s === 'inprogress') taskStatus.inProgress += Number(r.c) || 0;
      else taskStatus.notStarted += Number(r.c) || 0;
    }

    try {
      const odRows = await q(
        `SELECT COUNT(*) as c FROM tasks t ${taskJoin} WHERE t.taskDate < ? AND LOWER(t.status) <> 'completed' ${taskScopeWhere}`,
        [endStr, ...taskScopeParams]
      );
      taskStatus.overdue = Number(odRows[0].c) || 0;
    } catch (_) { }

    let userRows = [];
    const userScopeWhere = isEmployee ? ' AND ta.user_id = ?' : '';
    const userVariants = [
      {
        sql: `SELECT u._id as userId, u.name as userName, LOWER(u.role) as role,
               COUNT(t.id) as totalTasks,
               SUM(CASE WHEN LOWER(t.status) = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN LOWER(t.status) IN ('in progress','doing','inprogress') THEN 1 ELSE 0 END) as inProgress,
               COALESCE(SUM(tl.hours), (SUM(t.total_duration) / 3600), 0) as hoursLogged
             FROM task_assignments ta
             JOIN users u ON ta.user_id = u._id
             JOIN tasks t ON ta.task_id = t.id
             LEFT JOIN timelogs tl ON tl.task_id = t.id
             WHERE (DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?)) OR (DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?))
             ${userScopeWhere}
             GROUP BY u._id, u.name, u.role
             ORDER BY u.name ASC`, params: isEmployee ? [startStr, endStr, startStr, endStr, employeeId] : [startStr, endStr, startStr, endStr]
      },
      {
        sql: `SELECT u._id as userId, u.name as userName, LOWER(u.role) as role,
               COUNT(t.id) as totalTasks,
               SUM(CASE WHEN LOWER(t.status) = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN LOWER(t.status) IN ('in progress','doing','inprogress') THEN 1 ELSE 0 END) as inProgress,
               COALESCE((SUM(t.total_duration) / 3600), 0) as hoursLogged
             FROM task_assignments ta
             JOIN users u ON ta.user_id = u._id
             JOIN tasks t ON ta.task_id = t.id
             WHERE (DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?)) OR (DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?))
             ${userScopeWhere}
             GROUP BY u._id, u.name, u.role
             ORDER BY u.name ASC`, params: isEmployee ? [startStr, endStr, startStr, endStr, employeeId] : [startStr, endStr, startStr, endStr]
      }
    ];
    for (const v of userVariants) {
      try { userRows = await q(v.sql, v.params); break; } catch (e) { continue; }
    }
    const userProductivity = (userRows || []).map(u => {
      const total = Number(u.totalTasks) || 0;
      const completed = Number(u.completed) || 0;
      const inProgress = Number(u.inProgress) || 0;
      const hours = Number(u.hoursLogged) || 0;
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { userId: u.userId, userName: u.userName, role: u.role, totalTasks: total, completed, inProgress, hoursLogged: hours, completionRate };
    });

    let clientRows = [];
    const clientJoin = isEmployee ? 'LEFT JOIN task_assignments ta ON ta.task_id = t.id' : '';
    const clientScopeWhere = isEmployee ? 'AND ta.user_id = ?' : '';
    const clientVariants = [
      {
        sql: `SELECT c.id as clientId, c.name as clientName,
               COUNT(DISTINCT p.id) as projects,
               COUNT(DISTINCT t.id) as totalTasks,
               SUM(CASE WHEN LOWER(t.status) = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN LOWER(t.status) IN ('in progress','doing','inprogress') THEN 1 ELSE 0 END) as inProgress,
               SUM(CASE WHEN LOWER(t.status) <> 'completed' AND DATE(t.due_date) < DATE(?) THEN 1 ELSE 0 END) as overdue
             FROM clients c
             LEFT JOIN projects p ON p.client_id = c.id
             LEFT JOIN tasks t ON t.project_id = p.id
             ${clientJoin}
             WHERE c.isDeleted IS NULL OR c.isDeleted != 1
             ${clientScopeWhere}
             GROUP BY c.id, c.name
             ORDER BY clientName ASC`, params: isEmployee ? [endStr, employeeId] : [endStr]
      },
      {
        sql: `SELECT c.id as clientId, c.name as clientName,
               COUNT(DISTINCT p.id) as projectss,
               COUNT(DISTINCT t.id) as totalTasks,
               SUM(CASE WHEN LOWER(t.status) = 'completed' THEN 1 ELSE 0 END) as completed,
               SUM(CASE WHEN LOWER(t.status) IN ('in progress','doing','inprogress') THEN 1 ELSE 0 END) as inProgress,
               SUM(CASE WHEN LOWER(t.status) <> 'completed' AND DATE(t.due_date) < DATE(?) THEN 1 ELSE 0 END) as overdue
             FROM clients c
             LEFT JOIN projects p ON p.client_id = c.id
             LEFT JOIN tasks t ON t.project_id = p.id
             ${clientJoin}
             WHERE c.isDeleted IS NULL OR c.isDeleted != 1
             ${clientScopeWhere}
             GROUP BY c.id, c.name
             ORDER BY clientName ASC`, params: isEmployee ? [endStr, employeeId] : [endStr]
      }
    ];
    for (const v of clientVariants) {
      try { clientRows = await q(v.sql, v.params); break; } catch (e) { continue; }
    }

    let allTasks = [];
    try {
      allTasks = await q(
        `SELECT t.id, t.name, t.status, t.taskDate as due_date, p.client_id as clientId, p.id as projectId, p.name as projectName
         FROM tasks t
         JOIN projects p ON t.project_id = p.id
         ${isEmployee ? 'JOIN task_assignments ta ON ta.task_id = t.id' : ''}
         WHERE ((DATE(t.taskDate) BETWEEN DATE(?) AND DATE(?)) OR (DATE(t.createdAt) BETWEEN DATE(?) AND DATE(?)))
         ${isEmployee ? 'AND ta.user_id = ?' : ''}`,
        isEmployee ? [startStr, endStr, startStr, endStr, employeeId] : [startStr, endStr, startStr, endStr]
      );
    } catch (e) { }

    const clientSummary = (clientRows || []).map(c => {
      const clientTasks = allTasks.filter(t => String(t.clientId) === String(c.clientId)).map(t => ({
        id: t.id,
        name: t.name,
        status: t.status,
        dueDate: t.due_date,
        projectId: t.projectId,
        projectName: t.projectName
      }));
      return {
        clientId: c.clientId != null ? String(c.clientId) : '',
        clientName: c.clientName || 'Unknown',
        projects: Number(c.projects) || 0,
        totalTasks: Number(c.totalTasks) || 0,
        completed: Number(c.completed) || 0,
        inProgress: Number(c.inProgress) || 0,
        overdue: Number(c.overdue) || 0,
        tasks: clientTasks
      };
    });

    const extendedMetrics = await getExtendedDashboardMetrics(req.user.tenant_id, {
      userId: isEmployee ? employeeId : null
    }).catch(() => ({}));

    return res.json({
      success: true, data: {
        summary: { tasksCreated, tasksCompleted, hoursLogged, activeProjects },
        taskStatus: {
          ...taskStatus,
          pending: extendedMetrics.pendingTasks || taskStatus.pending || 0,
          inProgress: extendedMetrics.inProgressTasks || taskStatus.inProgress || 0,
          completed: extendedMetrics.completedTasks || taskStatus.completed || 0,
          overdue: extendedMetrics.overdueTasks || taskStatus.overdue || 0
        },
        userProductivity: extendedMetrics.userWiseTaskPerformance || userProductivity,
        clientSummary,
        dateRange: { startDate: startStr, endDate: endStr },
        ...extendedMetrics
      }
    });
  } catch (err) {
    logger.error('Reports overview error:', err && err.stack ? err.stack : err);
    return res.status(500).json({ success: false, message: 'Failed to generate overview', error: err && err.message });
  }
});
