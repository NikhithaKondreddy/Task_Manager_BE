const db = require(__root + 'db');
const logger = require('../logger');



const DEFAULT_ONBOARDING_TASKS = [
  { title: 'KYC Verification', description: 'Verify client KYC documents and identity', daysFromNow: 3 },
  { title: 'Contract Preparation', description: 'Prepare and send contract for client signature', daysFromNow: 5 },
  { title: 'Project Kickoff Discussion', description: 'Schedule kickoff meeting with client and team', daysFromNow: 7 },
  { title: 'Workspace Setup', description: 'Set up workspace, access, and initial project skeleton', daysFromNow: 2 }
];

// Convert JS Date/ISO to MySQL DATETIME `YYYY-MM-DD HH:MM:SS`
const toMySQLDate = (d) => {
  if (d === null || d === undefined) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const min = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}


async function generateOnboardingTasks(clientId, managerId, actorId) {
  try {
    const createdTasks = [];

    for (const taskTemplate of DEFAULT_ONBOARDING_TASKS) {
      try {

        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + taskTemplate.daysFromNow);

        const taskSql = `
          INSERT INTO tasks (
            title, description, client_id, assigned_to, status, 
            taskDate, createdAt, priority
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), 'Medium')
        `;
        const taskResult = await q(taskSql, [
          taskTemplate.title,
          taskTemplate.description,
          clientId,
          managerId || null,
          'Open',
          toMySQLDate(dueDate)
        ]).catch(e => {
          logger.debug('Skipping task insert (tasks table may not exist): ' + e.message);
          return { insertId: null };
        });

        const taskId = taskResult && taskResult.insertId ? taskResult.insertId : null;

        if (await tableExists('onboarding_tasks')) {
          const onboardingSql = `
            INSERT INTO onboarding_tasks (
              client_id, task_id, task_title, task_description,
              assigned_to, status, due_date, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
          `;
          const onboardingResult = await q(onboardingSql, [
            clientId,
            taskId,
            taskTemplate.title,
            taskTemplate.description,
            managerId || null,
            'Pending',
            toMySQLDate(dueDate)
          ]);

          createdTasks.push({
            id: onboardingResult && onboardingResult.insertId ? onboardingResult.insertId : null,
            title: taskTemplate.title,
            dueDate: dueDate.toISOString(),
            assignedTo: managerId || null
          });
        }
      } catch (e) {
        logger.warn(`Failed to create onboarding task "${taskTemplate.title}": ${e.message}`);
      }
    }

    if (await tableExists('client_activity_logs')) {
      try {
        await q(
          `INSERT INTO client_activity_logs (
            client_id, actor_id, action_type, action, details, created_at
          ) VALUES (?, ?, ?, ?, ?, NOW())`,
          [
            clientId,
            actorId || null,
            'onboarding_tasks_generated',
            'Auto-generated onboarding tasks',
            JSON.stringify({ taskCount: createdTasks.length })
          ]
        );
      } catch (e) {
        logger.debug('Failed to log onboarding task generation: ' + e.message);
      }
    }

    logger.info(`Generated ${createdTasks.length} onboarding tasks for client ${clientId}`);
    return createdTasks;
  } catch (e) {
    logger.error('Error in generateOnboardingTasks: ' + e.message);
    throw e;
  }
}

async function tableExists(tableName) {
  try {
    const rows = await q(
      "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      [tableName]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (e) {
    return false;
  }
}

module.exports = {
  generateOnboardingTasks,
  DEFAULT_ONBOARDING_TASKS
};
