const NotificationService = require('../../../services/notificationService');

const TYPES = {
  TASK_ASSIGNED: 'TM_TASK_ASSIGNED',
  TASK_REMINDER: 'TM_TASK_REMINDER',
  TASK_APPROVED: 'TM_TASK_APPROVED',
  TASK_REJECTED: 'TM_TASK_REJECTED',
  TASK_COMPLETED: 'TM_TASK_COMPLETED',
  TASK_OVERDUE: 'TM_TASK_OVERDUE',
  PROJECT_CLOSURE_REQUESTED: 'TM_PROJECT_CLOSURE_REQUESTED',
  PROJECT_CLOSED: 'TM_PROJECT_CLOSED'
};

async function notifyTaskAssigned(userId, title, taskPublicId, tenantId) {
  return NotificationService.createAndSend(
    [userId],
    'Task Assigned',
    `You have been assigned to "${title}"`,
    TYPES.TASK_ASSIGNED,
    'tm_task',
    taskPublicId,
    tenantId
  );
}

async function notifyCompletionSubmitted(approverUserIds, title, taskPublicId, requesterName, tenantId) {
  return NotificationService.createAndSend(
    approverUserIds,
    'Approval Requested',
    `${requesterName} submitted "${title}" for approval`,
    TYPES.TASK_COMPLETED,
    'tm_task',
    taskPublicId,
    tenantId
  );
}

async function notifyApproved(userId, title, taskPublicId, tenantId) {
  return NotificationService.createAndSend(
    [userId],
    'Task Approved',
    `"${title}" has been approved`,
    TYPES.TASK_APPROVED,
    'tm_task',
    taskPublicId,
    tenantId
  );
}

async function notifyRejected(userId, title, taskPublicId, reason, tenantId) {
  return NotificationService.createAndSend(
    [userId],
    'Task Rejected',
    `"${title}" was rejected${reason ? ': ' + reason : ''}`,
    TYPES.TASK_REJECTED,
    'tm_task',
    taskPublicId,
    tenantId
  );
}

async function notifyOverdue(userId, title, taskPublicId, tenantId) {
  return NotificationService.createAndSend(
    [userId],
    'Task Overdue',
    `"${title}" is now overdue`,
    TYPES.TASK_OVERDUE,
    'tm_task',
    taskPublicId,
    tenantId
  );
}

async function notifyReminder(userId, title, taskPublicId, tenantId) {
  return NotificationService.createAndSend(
    [userId],
    'Reminder',
    `"${title}" is due soon`,
    TYPES.TASK_REMINDER,
    'tm_task',
    taskPublicId,
    tenantId
  );
}

async function notifyProjectClosureRequested(userIds, name, projectPublicId, tenantId) {
  return NotificationService.createAndSend(
    userIds,
    'Project Closure Requested',
    `Project "${name}" submitted for final approval`,
    TYPES.PROJECT_CLOSURE_REQUESTED,
    'tm_project',
    projectPublicId,
    tenantId
  );
}

async function notifyProjectClosed(userIds, name, projectPublicId, approved, tenantId) {
  return NotificationService.createAndSend(
    userIds,
    approved ? 'Project Closed' : 'Project Closure Rejected',
    `Project "${name}" closure was ${approved ? 'approved' : 'rejected'}`,
    TYPES.PROJECT_CLOSED,
    'tm_project',
    projectPublicId,
    tenantId
  );
}

module.exports = {
  TYPES,
  notifyTaskAssigned,
  notifyCompletionSubmitted,
  notifyApproved,
  notifyRejected,
  notifyOverdue,
  notifyReminder,
  notifyProjectClosureRequested,
  notifyProjectClosed
};
