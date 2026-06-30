const { success } = require('../../../utils/response');
const dashboardRepo = require('../repos/dashboardRepo');
const approvalRepo = require('../repos/approvalRepo');
const photoRepo = require('../repos/photoRepo');
const { q } = require('../utils/db');
const { getManagerTeamUsers } = require('../utils/teamScope');
const NotificationService = require('../../../services/notificationService');

async function admin(req, res) {
  const tenantId = req.user.tenant_id;
  const items = await dashboardRepo.getWorkItems(tenantId);
  const summary = dashboardRepo.summarize(items);

  const [activeUsers, projects, recentTasks, overdueTasks, approvals] = await Promise.all([
    dashboardRepo.countActiveUsers(tenantId),
    dashboardRepo.countProjects(tenantId),
    dashboardRepo.recentTasks(tenantId, 5),
    dashboardRepo.overdueList(tenantId, null, 5),
    approvalRepo.list(tenantId, { status: 'Pending', limit: 5 })
  ]);

  return success(res, {
    counts: {
      totalTasks: summary.total,
      completedTasks: summary.completed,
      dueToday: summary.dueToday,
      overdueTasks: summary.overdue,
      activeUsers,
      projects
    },
    taskOverview: dashboardRepo.trendSeries(items, 7),
    tasksByStatus: summary.byStatus,
    tasksByPriority: summary.byPriority,
    recentTasks,
    overdueTasks,
    tasksRequiringApproval: approvals.rows
  });
}

async function manager(req, res) {
  const tenantId = req.user.tenant_id;
  const teamUsers = await getManagerTeamUsers(req.user._id, tenantId);
  const teamIds = teamUsers.map((u) => u._id);

  const items = await dashboardRepo.getWorkItems(tenantId, { assignedToIds: teamIds.length ? teamIds : [-1] });
  const summary = dashboardRepo.summarize(items);

  const [projects, approvals, teamTaskSummary, upcomingDeadlines] = await Promise.all([
    dashboardRepo.countProjects(tenantId, req.user._id),
    approvalRepo.list(tenantId, { status: 'Pending', limit: 5 }, teamIds),
    dashboardRepo.teamTaskSummary(tenantId, teamUsers),
    dashboardRepo.upcomingDeadlines(tenantId, teamIds.length ? teamIds : [-1], 5)
  ]);

  return success(res, {
    counts: {
      totalTasks: summary.total,
      completedTasks: summary.completed,
      dueToday: summary.dueToday,
      overdueTasks: summary.overdue,
      teamMembers: teamUsers.length,
      projects
    },
    teamTaskSummary,
    myApprovals: approvals.rows,
    upcomingDeadlines,
    tasksByStatus: summary.byStatus,
    teamProgress: {
      completed: summary.completed,
      inProgress: summary.byStatus['In Progress'],
      pending: summary.byStatus.Pending,
      total: summary.total
    }
  });
}

async function employee(req, res) {
  const tenantId = req.user.tenant_id;
  const userId = req.user._id;
  const items = await dashboardRepo.getWorkItems(tenantId, { assignedToIds: [userId] });
  const summary = dashboardRepo.summarize(items);

  const recurringCountRows = await q(
    `SELECT COUNT(*) AS total FROM tm_tasks WHERE tenant_id = ? AND assigned_to = ? AND task_type IN ('RECURRING','GEMBA_WALK') AND is_deleted = 0`,
    [tenantId, userId]
  );

  const upcomingReminders = await q(
    `SELECT public_id, title, due_date FROM tm_tasks
     WHERE tenant_id = ? AND assigned_to = ? AND reminder_enabled = 1 AND status IN ('Pending','In Progress')
       AND due_date IS NOT NULL AND due_date >= NOW()
     ORDER BY due_date ASC LIMIT 5`,
    [tenantId, userId]
  );

  const [recentNotifications, recentPhotos, myTasks] = await Promise.all([
    NotificationService.getForUser(userId, 5, 0),
    photoRepo.listForUser(userId, tenantId, { limit: 6, offset: 0 }),
    dashboardRepo.recentTasks(tenantId, 5, [userId])
  ]);

  return success(res, {
    counts: {
      myTasks: summary.total,
      recurringTasks: recurringCountRows[0].total,
      dueToday: summary.dueToday,
      overdueTasks: summary.overdue,
      completedToday: summary.completed
    },
    myTasks,
    taskProgress: summary.byStatus,
    upcomingReminders,
    recentNotifications,
    recentPhotos
  });
}

module.exports = { admin, manager, employee };
