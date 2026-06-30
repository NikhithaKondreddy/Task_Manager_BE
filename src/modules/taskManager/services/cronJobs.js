const cron = require('node-cron');
const taskRepo = require('../repos/taskRepo');
const occurrenceRepo = require('../repos/occurrenceRepo');
const recurrenceEngine = require('./recurrenceEngine');
const notify = require('./notify');

let logger;
try { logger = require(__root + 'logger'); } catch (_) {
  try { logger = require('../../../logger'); } catch (_2) { logger = console; }
}

async function runRecurrenceGeneration() {
  try {
    const count = await recurrenceEngine.runDailyGeneration();
    if (count) logger.info(`[TaskManager] Generated ${count} recurring occurrence(s)`);
  } catch (err) {
    logger.error('[TaskManager] Recurrence generation failed: ' + err.message);
  }
}

async function runOverdueSweep() {
  try {
    await taskRepo.markOverdueTasks();
    await occurrenceRepo.markOverdueOccurrences();
  } catch (err) {
    logger.error('[TaskManager] Overdue sweep failed: ' + err.message);
  }
}

async function runReminderSweep() {
  try {
    const dueTasks = await taskRepo.findDueTasksNeedingReminder();
    for (const task of dueTasks) {
      if (!task.assigned_to) continue;
      await notify.notifyReminder(task.assigned_to, task.title, task.public_id, task.tenant_id);
      await taskRepo.markReminderSent(task.id);
    }
  } catch (err) {
    logger.error('[TaskManager] Reminder sweep failed: ' + err.message);
  }
}

function start() {
  cron.schedule('5 0 * * *', runRecurrenceGeneration);
  cron.schedule('*/15 * * * *', runOverdueSweep);
  cron.schedule('*/30 * * * *', runReminderSweep);
  logger.info('[TaskManager] Cron jobs registered (recurrence generation, overdue sweep, reminders)');
}

module.exports = { start, runRecurrenceGeneration, runOverdueSweep, runReminderSweep };
