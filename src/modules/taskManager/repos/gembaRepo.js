const { q } = require('../utils/db');

async function createDetails(taskId, tenantId, {
  department, area, location, walkType, startTime, endTime, referenceDocument,
  checklistTemplateId, managerId, teamMembers
}) {
  await q(
    `INSERT INTO tm_gemba_details
      (task_id, tenant_id, department, area, location, walk_type, start_time, end_time,
       reference_document, checklist_template_id, manager_id, team_members)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskId, tenantId, department || null, area || null, location || null,
      walkType || null, startTime || null, endTime || null, referenceDocument || null,
      checklistTemplateId || null, managerId || null,
      Array.isArray(teamMembers) ? JSON.stringify(teamMembers) : (teamMembers || null)
    ]
  );
  return findByTaskId(taskId);
}

async function findByTaskId(taskId) {
  const rows = await q(`SELECT * FROM tm_gemba_details WHERE task_id = ?`, [taskId]);
  return rows[0] || null;
}

async function addChecklistItems(taskId, tenantId, items = []) {
  const created = [];
  for (let i = 0; i < items.length; i++) {
    const result = await q(
      `INSERT INTO tm_checklist_items (task_id, tenant_id, title, sort_order) VALUES (?, ?, ?, ?)`,
      [taskId, tenantId, items[i], i]
    );
    created.push(result.insertId);
  }
  return created;
}

async function cloneChecklistToOccurrence(taskId, occurrenceId, tenantId) {
  const items = await q(`SELECT title, sort_order FROM tm_checklist_items WHERE task_id = ? ORDER BY sort_order`, [taskId]);
  for (const item of items) {
    await q(
      `INSERT INTO tm_checklist_items (occurrence_id, tenant_id, title, sort_order) VALUES (?, ?, ?, ?)`,
      [occurrenceId, tenantId, item.title, item.sort_order]
    );
  }
}

async function listForTask(taskId) {
  return q(`SELECT * FROM tm_checklist_items WHERE task_id = ? ORDER BY sort_order`, [taskId]);
}

async function listForOccurrence(occurrenceId) {
  return q(`SELECT * FROM tm_checklist_items WHERE occurrence_id = ? ORDER BY sort_order`, [occurrenceId]);
}

async function toggleItem(id, isCompleted) {
  return q(`UPDATE tm_checklist_items SET is_completed = ?, updated_at = NOW() WHERE id = ?`, [isCompleted ? 1 : 0, id]);
}

module.exports = {
  createDetails, findByTaskId, addChecklistItems,
  cloneChecklistToOccurrence, listForTask, listForOccurrence, toggleItem
};
