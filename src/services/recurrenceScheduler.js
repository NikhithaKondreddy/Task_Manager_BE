const cron = require('node-cron');
const dayjs = require('dayjs');
const db = require(__root + 'db');
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = console; }

const OccurrenceService = require(__root + 'services/occurrenceService');
const NotificationService = require(__root + 'services/notificationService');

async function query(sql, params = []) {
  return new Promise((resolve, reject) => db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))));
}

const columnCache = new Map();

async function hasColumn(table, column) {
  const key = `${table}.${column}`;
  if (columnCache.has(key)) return columnCache.get(key);
  const rows = await query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  const exists = Array.isArray(rows) && rows.length > 0;
  columnCache.set(key, exists);
  return exists;
}

function addDaysSafe(date, days) {
  return dayjs(date).add(days, 'day');
}

function computeNextDate(task, baseDate) {
  const recurrence = (task.recurrence || '').toLowerCase();
  let d = dayjs(baseDate);
  try {
    if (recurrence === 'daily') {
      d = d.add(1, 'day');
    } else if (recurrence === 'weekly') {
      if (task.day_of_week != null) {
        // task.day_of_week expected 0 (Sunday) - 6 (Saturday)
        const target = Number(task.day_of_week);
        if (!Number.isFinite(target)) {
          d = d.add(7, 'day');
        } else {
          // move forward until matching day
          for (let i = 1; i <= 14; i++) {
            const cand = dayjs(baseDate).add(i, 'day');
            if (cand.day() === target) { d = cand; break; }
          }
        }
      } else {
        d = d.add(7, 'day');
      }
    } else if (recurrence === 'monthly') {
      if (task.day_of_month != null) {
        const dom = Number(task.day_of_month);
        if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
          let candidate = dayjs(baseDate).date(dom);
          if (candidate.isSame(dayjs(baseDate), 'day') || candidate.isBefore(dayjs(baseDate), 'day')) {
            candidate = candidate.add(1, 'month');
          }
          d = candidate;
        } else {
          d = d.add(1, 'month');
        }
      } else {
        d = d.add(1, 'month');
      }
    }
  } catch (e) {
    logger.warn('computeNextDate fallback: ' + e.message);
    d = dayjs(baseDate).add(1, 'day');
  }
  return d;
}

let scheduledTask = null;

async function processCreateOccurrences() {
  try {
    const taskColumns = {
      start_date: await hasColumn('tasks', 'start_date'),
      end_date: await hasColumn('tasks', 'end_date'),
      next_due_date: await hasColumn('tasks', 'next_due_date'),
      tenant_id: await hasColumn('tasks', 'tenant_id'),
      day_of_week: await hasColumn('tasks', 'day_of_week'),
      day_of_month: await hasColumn('tasks', 'day_of_month'),
      reminder_enabled: await hasColumn('tasks', 'reminder_enabled'),
      reminder_time: await hasColumn('tasks', 'reminder_time'),
      reminder_offset_days: await hasColumn('tasks', 'reminder_offset_days'),
      recurrence_parent_id: await hasColumn('tasks', 'recurrence_parent_id')
    };

    const selectColumns = [
      'id',
      'public_id',
      'title',
      'recurrence',
      taskColumns.recurrence_parent_id ? 'recurrence_parent_id' : 'NULL AS recurrence_parent_id',
      'taskDate',
      taskColumns.next_due_date ? 'next_due_date' : 'NULL AS next_due_date',
      taskColumns.tenant_id ? 'tenant_id' : 'NULL AS tenant_id',
      taskColumns.day_of_week ? 'day_of_week' : 'NULL AS day_of_week',
      taskColumns.day_of_month ? 'day_of_month' : 'NULL AS day_of_month',
      taskColumns.reminder_enabled ? 'reminder_enabled' : '0 AS reminder_enabled',
      taskColumns.reminder_time ? 'reminder_time' : 'NULL AS reminder_time',
      taskColumns.reminder_offset_days ? 'reminder_offset_days' : '0 AS reminder_offset_days'
    ];

    const where = ["recurrence IN ('Daily','Weekly','Monthly')"];
    if (taskColumns.start_date) where.push('(start_date IS NULL OR start_date <= NOW())');
    if (taskColumns.end_date) where.push('(end_date IS NULL OR end_date >= NOW())');

    const tasks = await query(`
      SELECT ${selectColumns.join(', ')}
      FROM tasks
      WHERE ${where.join(' AND ')}
      LIMIT 200
    `);

    for (const task of tasks || []) {
      try {
        // Decide base date to create occurrence for
        const base = task.next_due_date || task.taskDate || new Date();
        const occurrenceDate = dayjs(base).format('YYYY-MM-DD');

        const occ = await OccurrenceService.createOccurrence({ taskId: task.id, occurrenceDate, tenantId: task.tenant_id, createdBy: null });
        if (occ) {
          // Notify assignees about new occurrence
          try {
            const assignees = await query('SELECT user_id FROM task_assignments WHERE task_id = ?', [task.id]);
            const userIds = (assignees || []).map(a => a.user_id).filter(Boolean);
            if (userIds.length > 0) {
              await NotificationService.createAndSend(userIds, 'Task Occurrence Created', `New occurrence for \"${task.title}\" on ${occurrenceDate}`, 'TASK_OCCURRENCE_CREATED', 'task', task.public_id || String(task.id), task.tenant_id);
            }
          } catch (e) {
            logger.warn('Failed to notify assignees for occurrence: ' + (e && e.message ? e.message : e));
          }
        }

        // compute and update next_due_date
        const baseRef = task.next_due_date || task.taskDate || new Date();
        const next = computeNextDate(task, baseRef);
        if (next && next.isValid() && taskColumns.next_due_date) {
          await query('UPDATE tasks SET next_due_date = ? WHERE id = ?', [next.format('YYYY-MM-DD HH:mm:ss'), task.id]);
        }
      } catch (e) {
        logger.warn('processCreateOccurrences per-task error: ' + (e && e.message ? e.message : e));
      }
    }
  } catch (error) {
    logger.error('processCreateOccurrences error: ' + (error && error.message ? error.message : error));
  }
}

async function processReminders() {
  try {
    const occurrenceHasReminderSent = await hasColumn('task_occurrences', 'reminder_sent');
    const taskHasReminderEnabled = await hasColumn('tasks', 'reminder_enabled');
    if (!occurrenceHasReminderSent || !taskHasReminderEnabled) return;

    const taskColumns = {
      reminder_time: await hasColumn('tasks', 'reminder_time'),
      reminder_offset_days: await hasColumn('tasks', 'reminder_offset_days'),
      tenant_id: await hasColumn('tasks', 'tenant_id')
    };

    // Fetch occurrences that haven't had reminders sent and whose task has reminders enabled
    const rows = await query(`
      SELECT o.id AS occurrence_id,
             o.task_id,
             o.occurrence_date,
             o.reminder_sent,
             ${taskColumns.reminder_time ? 't.reminder_time' : 'NULL AS reminder_time'},
             ${taskColumns.reminder_offset_days ? 't.reminder_offset_days' : '0 AS reminder_offset_days'},
             ${taskColumns.tenant_id ? 't.tenant_id' : 'NULL AS tenant_id'},
             t.public_id,
             t.title
      FROM task_occurrences o
      INNER JOIN tasks t ON o.task_id = t.id
      WHERE t.reminder_enabled = 1
        AND (o.reminder_sent IS NULL OR o.reminder_sent = 0)
      LIMIT 200
    `);

    const now = dayjs();
    for (const r of rows || []) {
      try {
        const time = r.reminder_time || '00:00:00';
        const offsetDays = Number(r.reminder_offset_days || 0);
        const target = dayjs(`${r.occurrence_date} ${time}`).subtract(offsetDays, 'day');
        const diff = Math.abs(now.diff(target, 'second'));
        // within 90 seconds window
        if (diff <= 90) {
          // send notification to assignees
          try {
            const assignees = await query('SELECT user_id FROM task_assignments WHERE task_id = ?', [r.task_id]);
            const userIds = (assignees || []).map(a => a.user_id).filter(Boolean);
            if (userIds.length > 0) {
              await NotificationService.createAndSend(userIds, 'Task Reminder', `Reminder: ${r.title} scheduled on ${r.occurrence_date}`, 'TASK_REMINDER', 'task', r.public_id || String(r.task_id), r.tenant_id);
            }
            // mark reminder_sent
            await query('UPDATE task_occurrences SET reminder_sent = 1 WHERE id = ?', [r.occurrence_id]);
          } catch (e) {
            logger.warn('Failed to send reminder for occurrence: ' + (e && e.message ? e.message : e));
          }
        }
      } catch (e) {
        logger.warn('processReminders per-row error: ' + (e && e.message ? e.message : e));
      }
    }
  } catch (error) {
    logger.error('processReminders error: ' + (error && error.message ? error.message : error));
  }
}

function start() {
  if (scheduledTask) return scheduledTask;
  // Run every minute — lightweight checks, idempotent
  scheduledTask = cron.schedule('*/1 * * * *', async () => {
    try {
      await processCreateOccurrences();
      await processReminders();
    } catch (e) {
      logger.error('recurrenceScheduler job error: ' + (e && e.message ? e.message : e));
    }
  }, { scheduled: true });
  logger.info('recurrenceScheduler started (runs every minute)');
  return scheduledTask;
}

function stop() {
  if (!scheduledTask) return;
  scheduledTask.stop();
  scheduledTask = null;
}

module.exports = { start, stop, computeNextDate };
