const cron = require('node-cron');
const db = require(__root + 'db');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

const NotificationService = require(__root + 'services/notificationService');

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

// Tasks are overdue when their taskDate has passed and they haven't reached a terminal state
const NON_OVERDUE_STATUSES = ['COMPLETED', 'APPROVED', 'CLOSED'];

async function processOverdueTasks() {
  try {
    const tasks = await query(`
      SELECT id, public_id, title, taskDate, tenant_id
      FROM tasks
      WHERE taskDate IS NOT NULL
        AND taskDate < NOW()
        AND UPPER(COALESCE(status, '')) NOT IN ('COMPLETED', 'APPROVED', 'CLOSED')
        AND COALESCE(isDeleted, 0) = 0
        AND overdue_notified_at IS NULL
      LIMIT 200
    `);

    for (const task of tasks || []) {
      try {
        const assignees = await query('SELECT user_id FROM task_assignments WHERE task_id = ?', [task.id]);
        const userIds = (assignees || []).map(a => a.user_id).filter(Boolean);

        const title = 'Task Overdue';
        const message = `Task "${task.title}" was due on ${new Date(task.taskDate).toLocaleDateString()} and is now overdue.`;

        if (userIds.length > 0) {
          await NotificationService.createAndSend(userIds, title, message, 'TASK_OVERDUE', 'task', task.public_id || String(task.id), task.tenant_id);
        }

        await NotificationService.createAndSendToRoles(['Manager', 'Admin'], title, message, 'TASK_OVERDUE', 'task', task.public_id || String(task.id), task.tenant_id);

        await query('UPDATE tasks SET overdue_notified_at = NOW() WHERE id = ?', [task.id]);
      } catch (e) {
        logger.warn('processOverdueTasks per-task error: ' + (e && e.message ? e.message : e));
      }
    }
  } catch (error) {
    logger.error('processOverdueTasks error: ' + (error && error.message ? error.message : error));
  }
}

// Today's occurrences still Pending past the parent task's due_time are flagged once each.
// Covers "pending occurrence notification" / "occurrence overdue" for recurring activities
// (e.g. Gemba Walk) without a separate scheduler.
async function processOverdueOccurrences() {
  try {
    const occurrences = await query(`
      SELECT o.id, o.task_id, o.occurrence_date, t.public_id, t.title, t.due_time, t.tenant_id
      FROM task_occurrences o
      INNER JOIN tasks t ON t.id = o.task_id
      WHERE o.occurrence_date = CURDATE()
        AND UPPER(COALESCE(o.status, '')) = 'PENDING'
        AND t.due_time IS NOT NULL
        AND CURTIME() > t.due_time
        AND o.overdue_notified_at IS NULL
      LIMIT 200
    `);

    for (const occ of occurrences || []) {
      try {
        const assignees = await query('SELECT user_id FROM task_assignments WHERE task_id = ?', [occ.task_id]);
        const userIds = (assignees || []).map((a) => a.user_id).filter(Boolean);

        const title = 'Occurrence Overdue';
        const message = `"${occ.title}" for ${occ.occurrence_date} is still pending past its due time.`;

        if (userIds.length > 0) {
          await NotificationService.createAndSend(userIds, title, message, 'OCCURRENCE_OVERDUE', 'task', occ.public_id || String(occ.task_id), occ.tenant_id);
        }
        await NotificationService.createAndSendToRoles(['Manager', 'Admin'], title, message, 'OCCURRENCE_OVERDUE', 'task', occ.public_id || String(occ.task_id), occ.tenant_id);

        await query('UPDATE task_occurrences SET overdue_notified_at = NOW() WHERE id = ?', [occ.id]);
      } catch (e) {
        logger.warn('processOverdueOccurrences per-occurrence error: ' + (e && e.message ? e.message : e));
      }
    }
  } catch (error) {
    logger.error('processOverdueOccurrences error: ' + (error && error.message ? error.message : error));
  }
}

let scheduledTask = null;

function start() {
  if (scheduledTask) return scheduledTask;
  // Check every 5 minutes — overdue status doesn't need minute-level precision
  scheduledTask = cron.schedule('*/5 * * * *', async () => {
    try {
      await processOverdueTasks();
      await processOverdueOccurrences();
    } catch (e) {
      logger.error('overdueScheduler job error: ' + (e && e.message ? e.message : e));
    }
  }, { scheduled: true });
  logger.info('overdueScheduler started (runs every 5 minutes)');
  return scheduledTask;
}

function stop() {
  if (!scheduledTask) return;
  scheduledTask.stop();
  scheduledTask = null;
}

module.exports = { start, stop, processOverdueTasks, processOverdueOccurrences };
