const { q, genPublicId, parsePagination, parseSort } = require('../utils/db');

async function create(data) {
  const publicId = genPublicId('tmt');
  const result = await q(
    `INSERT INTO tm_tasks
      (public_id, tenant_id, task_type, title, description, project_id, parent_task_id,
       assigned_to, assigned_by, priority, status, start_date, due_date,
       allow_photo, photo_required, multiple_photos, reminder_enabled, reminder_time,
       recurrence_id, is_starred, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publicId, data.tenantId, data.taskType, data.title, data.description || null,
      data.projectId || null, data.parentTaskId || null,
      data.assignedTo || null, data.assignedBy, data.priority || 'Medium', data.status || 'Pending',
      data.startDate || null, data.dueDate || null,
      data.allowPhoto ? 1 : 0, data.photoRequired ? 1 : 0, data.multiplePhotos ? 1 : 0,
      data.reminderEnabled ? 1 : 0, data.reminderTime || null,
      data.recurrenceId || null, data.isStarred ? 1 : 0, data.createdBy
    ]
  );
  return findById(result.insertId, data.tenantId);
}

async function findById(id, tenantId) {
  const rows = await q(
    `SELECT t.*, ua.name AS assignee_name, ua.photo AS assignee_photo, ub.name AS assigner_name,
            p.name AS project_name, p.public_id AS project_public_id
     FROM tm_tasks t
     LEFT JOIN users ua ON ua._id = t.assigned_to
     LEFT JOIN users ub ON ub._id = t.assigned_by
     LEFT JOIN tm_projects p ON p.id = t.project_id
     WHERE t.id = ? AND t.tenant_id = ? AND t.is_deleted = 0`,
    [id, tenantId]
  );
  return rows[0] || null;
}

async function findByPublicId(publicId, tenantId) {
  const rows = await q(
    `SELECT t.*, ua.name AS assignee_name, ua.photo AS assignee_photo, ub.name AS assigner_name,
            p.name AS project_name, p.public_id AS project_public_id
     FROM tm_tasks t
     LEFT JOIN users ua ON ua._id = t.assigned_to
     LEFT JOIN users ub ON ub._id = t.assigned_by
     LEFT JOIN tm_projects p ON p.id = t.project_id
     WHERE t.public_id = ? AND t.tenant_id = ? AND t.is_deleted = 0`,
    [publicId, tenantId]
  );
  return rows[0] || null;
}

async function list(tenantId, query = {}, scope = {}) {
  const { page, limit, offset } = parsePagination(query);
  const sort = parseSort(query, ['title', 'created_at', 'due_date', 'priority', 'status'], 'created_at');

  const where = ['t.tenant_id = ?', 't.is_deleted = 0'];
  const params = [tenantId];

  const taskTypes = scope.taskTypes || (query.taskType ? [query.taskType] : ['INDIVIDUAL', 'PROJECT']);
  where.push(`t.task_type IN (${taskTypes.map(() => '?').join(',')})`);
  params.push(...taskTypes);

  if (query.status) { where.push('t.status = ?'); params.push(query.status); }
  if (query.priority) { where.push('t.priority = ?'); params.push(query.priority); }
  if (query.projectId) { where.push('t.project_id = ?'); params.push(query.projectId); }
  if (query.assignedTo) { where.push('t.assigned_to = ?'); params.push(query.assignedTo); }
  if (query.search) { where.push('t.title LIKE ?'); params.push(`%${query.search}%`); }
  if (query.dueBefore) { where.push('t.due_date <= ?'); params.push(query.dueBefore); }
  if (query.dueAfter) { where.push('t.due_date >= ?'); params.push(query.dueAfter); }

  if (scope.assignedToUserId) { where.push('t.assigned_to = ?'); params.push(scope.assignedToUserId); }
  if (scope.assignedToUserIds && scope.assignedToUserIds.length) {
    where.push(`t.assigned_to IN (${scope.assignedToUserIds.map(() => '?').join(',')})`);
    params.push(...scope.assignedToUserIds);
  }

  const whereSql = where.join(' AND ');
  const rows = await q(
    `SELECT t.*, ua.name AS assignee_name, ua.photo AS assignee_photo, p.name AS project_name
     FROM tm_tasks t
     LEFT JOIN users ua ON ua._id = t.assigned_to
     LEFT JOIN tm_projects p ON p.id = t.project_id
     WHERE ${whereSql} ORDER BY t.${sort} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const countRows = await q(`SELECT COUNT(*) AS total FROM tm_tasks t WHERE ${whereSql}`, params);
  return { rows, total: countRows[0].total, page, limit };
}

async function update(id, tenantId, fields) {
  const allowed = [
    'title', 'description', 'priority', 'status', 'start_date', 'due_date', 'assigned_to',
    'allow_photo', 'photo_required', 'multiple_photos', 'reminder_enabled', 'reminder_time',
    'is_starred', 'remarks'
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) { sets.push(`${key} = ?`); params.push(fields[key]); }
  }
  if (!sets.length) return findById(id, tenantId);
  sets.push('updated_at = NOW()');
  params.push(id, tenantId);
  await q(`UPDATE tm_tasks SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
  return findById(id, tenantId);
}

async function softDelete(id, tenantId, deletedBy) {
  return q(
    `UPDATE tm_tasks SET is_deleted = 1, deleted_at = NOW(), deleted_by = ? WHERE id = ? AND tenant_id = ?`,
    [deletedBy, id, tenantId]
  );
}

async function markOverdueTasks() {
  return q(
    `UPDATE tm_tasks SET status = 'Overdue', updated_at = NOW()
     WHERE is_deleted = 0 AND status IN ('Pending','In Progress') AND due_date IS NOT NULL AND due_date < NOW()`
  );
}

async function findDueTasksNeedingReminder() {
  return q(
    `SELECT * FROM tm_tasks
     WHERE is_deleted = 0 AND reminder_enabled = 1 AND reminder_sent = 0
       AND status IN ('Pending','In Progress') AND due_date IS NOT NULL
       AND due_date BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 24 HOUR)`
  );
}

async function markReminderSent(id) {
  return q(`UPDATE tm_tasks SET reminder_sent = 1 WHERE id = ?`, [id]);
}

module.exports = {
  create, findById, findByPublicId, list, update, softDelete,
  markOverdueTasks, findDueTasksNeedingReminder, markReminderSent
};
