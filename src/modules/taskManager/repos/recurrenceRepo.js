const { q } = require('../utils/db');

async function create(taskId, tenantId, { frequency, repeatEvery, daysOfWeek, dayOfMonth, startDate, endDate }) {
  const result = await q(
    `INSERT INTO tm_task_recurrence (task_id, tenant_id, frequency, repeat_every, days_of_week, day_of_month, start_date, end_date, next_occurrence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [taskId, tenantId, frequency, repeatEvery || 1, daysOfWeek || null, dayOfMonth || null, startDate, endDate || null, startDate]
  );
  await q(`UPDATE tm_tasks SET recurrence_id = ? WHERE id = ?`, [result.insertId, taskId]);
  return findById(result.insertId);
}

async function findById(id) {
  const rows = await q(`SELECT * FROM tm_task_recurrence WHERE id = ?`, [id]);
  return rows[0] || null;
}

async function findByTaskId(taskId) {
  const rows = await q(`SELECT * FROM tm_task_recurrence WHERE task_id = ?`, [taskId]);
  return rows[0] || null;
}

async function update(id, fields) {
  const allowed = ['frequency', 'repeat_every', 'days_of_week', 'day_of_month', 'end_date'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) { sets.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return findById(id);
  sets.push('updated_at = NOW()');
  params.push(id);
  await q(`UPDATE tm_task_recurrence SET ${sets.join(', ')} WHERE id = ?`, params);
  return findById(id);
}

async function dueForGeneration() {
  return q(
    `SELECT * FROM tm_task_recurrence WHERE frequency != 'None' AND next_occurrence IS NOT NULL AND next_occurrence <= CURDATE()`
  );
}

module.exports = { create, findById, findByTaskId, update, dueForGeneration };
