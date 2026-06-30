const dayjs = require('dayjs');
const { q, genPublicId } = require('../utils/db');
const gembaRepo = require('../repos/gembaRepo');

const WEEKDAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function matchesWeeklyPattern(candidate, rule) {
  const days = (rule.days_of_week || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!days.length) return true;
  const code = WEEKDAY_CODES[candidate.day()];
  if (!days.includes(code)) return false;
  const start = dayjs(rule.start_date);
  const weeksSinceStart = candidate.startOf('week').diff(start.startOf('week'), 'week');
  return weeksSinceStart % Math.max(rule.repeat_every || 1, 1) === 0;
}

function computeNextDate(rule, fromDateStr) {
  const from = dayjs(fromDateStr);
  const every = Math.max(rule.repeat_every || 1, 1);

  if (rule.frequency === 'Daily') {
    return from.add(every, 'day');
  }

  if (rule.frequency === 'Weekly') {
    let candidate = from.add(1, 'day');
    for (let i = 0; i < 400; i++) {
      if (matchesWeeklyPattern(candidate, rule)) return candidate;
      candidate = candidate.add(1, 'day');
    }
    return from.add(7 * every, 'day');
  }

  if (rule.frequency === 'Monthly') {
    let next = from.add(every, 'month');
    if (rule.day_of_month) {
      const lastDay = next.endOf('month').date();
      next = next.date(Math.min(rule.day_of_month, lastDay));
    }
    return next;
  }

  return null;
}

async function generateNextOccurrence(recurrenceRow) {
  if (recurrenceRow.frequency === 'None' || !recurrenceRow.next_occurrence) return null;

  const occurrenceDate = dayjs(recurrenceRow.next_occurrence);
  if (recurrenceRow.end_date && occurrenceDate.isAfter(dayjs(recurrenceRow.end_date))) {
    await q(`UPDATE tm_task_recurrence SET next_occurrence = NULL WHERE id = ?`, [recurrenceRow.id]);
    return null;
  }

  const taskRows = await q(`SELECT assigned_to, task_type FROM tm_tasks WHERE id = ?`, [recurrenceRow.task_id]);
  const task = taskRows[0];
  if (!task) return null;

  const followingDate = computeNextDate(recurrenceRow, occurrenceDate.format('YYYY-MM-DD'));
  const followingValue = followingDate
    ? (recurrenceRow.end_date && followingDate.isAfter(dayjs(recurrenceRow.end_date)) ? null : followingDate.format('YYYY-MM-DD'))
    : null;

  let insertId = null;
  try {
    const publicId = genPublicId('tmo');
    const result = await q(
      `INSERT INTO tm_task_occurrences (public_id, task_id, tenant_id, due_date, assigned_to) VALUES (?, ?, ?, ?, ?)`,
      [publicId, recurrenceRow.task_id, recurrenceRow.tenant_id, occurrenceDate.format('YYYY-MM-DD HH:mm:ss'), task.assigned_to]
    );
    insertId = result.insertId;
    if (task.task_type === 'GEMBA_WALK') {
      await gembaRepo.cloneChecklistToOccurrence(recurrenceRow.task_id, insertId, recurrenceRow.tenant_id);
    }
  } catch (e) {
    if (e.code !== 'ER_DUP_ENTRY') throw e;
  }

  await q(`UPDATE tm_task_recurrence SET next_occurrence = ? WHERE id = ?`, [followingValue, recurrenceRow.id]);
  return insertId;
}

async function generateInitialOccurrences(recurrenceId, count = 5) {
  const createdIds = [];
  for (let i = 0; i < count; i++) {
    const rows = await q(`SELECT * FROM tm_task_recurrence WHERE id = ?`, [recurrenceId]);
    const rule = rows[0];
    if (!rule || !rule.next_occurrence) break;
    const id = await generateNextOccurrence(rule);
    if (id) createdIds.push(id);
  }
  return createdIds;
}

async function runDailyGeneration() {
  const dueRules = await q(
    `SELECT * FROM tm_task_recurrence WHERE frequency != 'None' AND next_occurrence IS NOT NULL AND next_occurrence <= CURDATE()`
  );
  let generated = 0;
  for (const rule of dueRules) {
    const id = await generateNextOccurrence(rule);
    if (id) generated++;
  }
  return generated;
}

module.exports = { computeNextDate, generateNextOccurrence, generateInitialOccurrences, runDailyGeneration };
