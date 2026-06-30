'use strict';

/**
 * seedTaskManager.js
 * Idempotent sample data for the new Task Management module (tm_* tables).
 * Runs against tenant_id = 1 (the default tenant, same one seedUsers.js uses).
 * Creates supporting users/department if missing, then projects, individual/
 * project tasks across all statuses, a recurring task, a Gemba Walk, photos,
 * and approval records so dashboards/reports/approvals render non-empty.
 *
 * Run: node src/seed/seedTaskManager.js   (also exposed as `npm run seed:task-manager`)
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const dayjs = require('dayjs');
const db = require('../db');

let logger;
try { logger = require(__root + 'logger'); } catch (_) {
  try { logger = require('../logger'); } catch (_2) { logger = console; }
}

const TENANT_ID = 1;

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function genUuid() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

async function ensureUser({ name, email, password, role, title }) {
  const existing = await q('SELECT _id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length) return existing[0]._id;
  const hashed = await bcrypt.hash(password, 10);
  const result = await q(
    'INSERT INTO users (name, email, password, role, tenant_id, isActive, title, public_id) VALUES (?,?,?,?,?,?,?,?)',
    [name, email, hashed, role, TENANT_ID, 1, title || '', genUuid()]
  );
  return result.insertId;
}

async function ensureDepartment(name, managerId) {
  const existing = await q('SELECT id, public_id FROM departments WHERE name = ? AND tenant_id = ? LIMIT 1', [name, TENANT_ID]);
  if (existing.length) return existing[0];
  const publicId = crypto.randomBytes(8).toString('hex');
  const result = await q(
    'INSERT INTO departments (name, public_id, manager_id, head_id, tenant_id) VALUES (?,?,?,?,?)',
    [name, publicId, String(managerId), String(managerId), TENANT_ID]
  );
  return { id: result.insertId, public_id: publicId };
}

async function placeholderPhoto(taskId, occurrenceId, uploadedBy) {
  await q(
    `INSERT INTO tm_task_photos (task_id, occurrence_id, tenant_id, uploaded_by, storage_path, storage_provider, file_name, mime_type, caption)
     VALUES (?, ?, ?, ?, ?, 'local', ?, 'image/png', ?)`,
    [taskId, occurrenceId, TENANT_ID, uploadedBy, '/uploads/seed/placeholder.png', 'placeholder.png', 'Seed sample photo']
  );
}

async function seedTaskManager() {
  const existingProjects = await q('SELECT COUNT(*) AS c FROM tm_projects WHERE tenant_id = ?', [TENANT_ID]);
  if (existingProjects[0].c > 0) {
    logger.info('seedTaskManager: tm_ sample data already exists for tenant 1 — skipping');
    return;
  }

  const taskRepo = require('../modules/taskManager/repos/taskRepo');
  const projectRepo = require('../modules/taskManager/repos/projectRepo');
  const recurrenceRepo = require('../modules/taskManager/repos/recurrenceRepo');
  const recurrenceEngine = require('../modules/taskManager/services/recurrenceEngine');
  const gembaRepo = require('../modules/taskManager/repos/gembaRepo');

  const managerId = await ensureUser({ name: 'Manager User', email: 'manager@nivarahousing.com', password: 'Manager@123', role: 'Manager' });
  const employeeId = await ensureUser({ name: 'Employee User', email: 'employee@nivarahousing.com', password: 'Employee@123', role: 'Employee' });
  const adminId = await ensureUser({ name: 'TM Admin', email: 'tm.admin@nivarahousing.com', password: 'TmAdmin@123', role: 'Admin', title: 'Administrator' });
  const saraId = await ensureUser({ name: 'Sara Employee', email: 'sara.tm@nivarahousing.com', password: 'Sara@123', role: 'Employee', title: 'QA' });
  const mikeId = await ensureUser({ name: 'Mike Employee', email: 'mike.tm@nivarahousing.com', password: 'Mike@123', role: 'Employee', title: 'Technician' });

  const dept = await ensureDepartment('Operations', managerId);
  await q('UPDATE users SET department_public_id = ? WHERE _id IN (?, ?, ?)', [dept.public_id, employeeId, saraId, mikeId]);

  // --- Project with project tasks ---
  const project = await projectRepo.create({
    tenantId: TENANT_ID,
    name: 'Plant Maintenance',
    description: 'Quarterly plant maintenance project',
    priority: 'High',
    startDate: dayjs().subtract(10, 'day').format('YYYY-MM-DD'),
    endDate: dayjs().add(20, 'day').format('YYYY-MM-DD'),
    managerId,
    createdBy: adminId
  });
  await projectRepo.addMember(project.id, employeeId, TENANT_ID);
  await projectRepo.addMember(project.id, saraId, TENANT_ID);

  const projectTask1 = await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'PROJECT', title: 'Electrical Check', description: 'Inspect electrical panels',
    projectId: project.id, assignedTo: employeeId, assignedBy: managerId, priority: 'High',
    startDate: dayjs().subtract(5, 'day').format('YYYY-MM-DD'), dueDate: dayjs().add(3, 'day').format('YYYY-MM-DD HH:mm:ss'),
    photoRequired: true, createdBy: managerId
  });
  await q(`UPDATE tm_tasks SET status='Approved', approval_status='Approved', completed_at=NOW(), approved_by=?, approved_at=NOW() WHERE id=?`, [managerId, projectTask1.id]);
  await placeholderPhoto(projectTask1.id, null, employeeId);

  await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'PROJECT', title: 'Mechanical Check', description: 'Inspect mechanical systems',
    projectId: project.id, assignedTo: saraId, assignedBy: managerId, priority: 'Medium',
    startDate: dayjs().format('YYYY-MM-DD'), dueDate: dayjs().add(5, 'day').format('YYYY-MM-DD HH:mm:ss'),
    createdBy: managerId
  });

  // --- Individual tasks across statuses ---
  await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'INDIVIDUAL', title: 'Submit Weekly Report', description: 'Weekly work progress report',
    assignedTo: employeeId, assignedBy: managerId, priority: 'Low',
    startDate: dayjs().format('YYYY-MM-DD'), dueDate: dayjs().add(1, 'day').format('YYYY-MM-DD HH:mm:ss'),
    createdBy: managerId
  });

  const overdueTask = await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'INDIVIDUAL', title: 'Database Backup', description: 'Weekly database backup',
    assignedTo: mikeId, assignedBy: adminId, priority: 'High',
    startDate: dayjs().subtract(10, 'day').format('YYYY-MM-DD'), dueDate: dayjs().subtract(2, 'day').format('YYYY-MM-DD HH:mm:ss'),
    createdBy: adminId
  });
  await q(`UPDATE tm_tasks SET status='Overdue' WHERE id=?`, [overdueTask.id]);

  const rejectedTask = await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'INDIVIDUAL', title: 'API Documentation', description: 'Write API docs',
    assignedTo: mikeId, assignedBy: managerId, priority: 'Medium',
    startDate: dayjs().subtract(6, 'day').format('YYYY-MM-DD'), dueDate: dayjs().subtract(1, 'day').format('YYYY-MM-DD HH:mm:ss'),
    createdBy: managerId
  });
  await q(
    `UPDATE tm_tasks SET status='Rejected', approval_status='Rejected', rejected_by=?, rejected_at=NOW(), rejection_reason='Missing endpoint examples' WHERE id=?`,
    [managerId, rejectedTask.id]
  );

  // --- Recurring task: Weekly Safety Inspection ---
  const recTask = await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'RECURRING', title: 'Weekly Safety Inspection',
    description: 'Inspect all safety equipment and ensure compliance.',
    assignedTo: employeeId, assignedBy: managerId, priority: 'High',
    startDate: dayjs().subtract(14, 'day').format('YYYY-MM-DD'), dueDate: null,
    allowPhoto: true, photoRequired: true, multiplePhotos: true,
    reminderEnabled: true, reminderTime: '09:00:00', isStarred: true, createdBy: managerId
  });
  const recurrence = await recurrenceRepo.create(recTask.id, TENANT_ID, {
    frequency: 'Weekly', repeatEvery: 1, daysOfWeek: 'WED',
    startDate: dayjs().subtract(14, 'day').format('YYYY-MM-DD'), endDate: dayjs().add(180, 'day').format('YYYY-MM-DD')
  });
  await recurrenceEngine.generateInitialOccurrences(recurrence.id, 6);

  const occurrences = await q('SELECT id FROM tm_task_occurrences WHERE task_id = ? ORDER BY due_date ASC', [recTask.id]);
  if (occurrences[0]) {
    await q(`UPDATE tm_task_occurrences SET status='Approved', approval_status='Approved', completed_at=NOW(), approved_by=? WHERE id=?`, [managerId, occurrences[0].id]);
    await placeholderPhoto(null, occurrences[0].id, employeeId);
  }
  if (occurrences[1]) {
    await q(`UPDATE tm_task_occurrences SET status='Pending' WHERE id=?`, [occurrences[1].id]);
  }

  // --- Gemba Walk ---
  const gembaTask = await taskRepo.create({
    tenantId: TENANT_ID, taskType: 'GEMBA_WALK', title: 'Gemba Walk - Production Area',
    description: 'Daily shopfloor inspection', assignedTo: saraId, assignedBy: managerId, priority: 'Medium',
    startDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'), dueDate: null,
    allowPhoto: true, photoRequired: true, multiplePhotos: true,
    reminderEnabled: true, reminderTime: '08:30:00', createdBy: managerId
  });
  const gembaRecurrence = await recurrenceRepo.create(gembaTask.id, TENANT_ID, {
    frequency: 'Daily', repeatEvery: 1, startDate: dayjs().subtract(7, 'day').format('YYYY-MM-DD'), endDate: null
  });
  await gembaRepo.createDetails(gembaTask.id, TENANT_ID, { department: 'Production', area: 'Line 1', location: 'Plant A' });
  await gembaRepo.addChecklistItems(gembaTask.id, TENANT_ID, ['Check fire extinguisher', 'Check emergency exits', 'Check machine guards']);
  await recurrenceEngine.generateInitialOccurrences(gembaRecurrence.id, 6);

  // --- Approval queue records ---
  await q(
    `INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status) VALUES (?, 'TASK_COMPLETION', ?, ?, 'Approved')`,
    [TENANT_ID, projectTask1.id, employeeId]
  );
  if (occurrences[0]) {
    await q(
      `INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status) VALUES (?, 'OCCURRENCE_COMPLETION', ?, ?, 'Approved')`,
      [TENANT_ID, occurrences[0].id, employeeId]
    );
  }
  await q(
    `INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status, decided_by, decided_at, rejection_reason) VALUES (?, 'TASK_COMPLETION', ?, ?, 'Rejected', ?, NOW(), 'Missing endpoint examples')`,
    [TENANT_ID, rejectedTask.id, mikeId, managerId]
  );

  logger.info('seedTaskManager: sample data created for tenant 1 (manager/employee/admin/sara/mike + project + tasks + recurring + gemba walk)');
}

module.exports = { seedTaskManager };

if (require.main === module) {
  seedTaskManager()
    .then(() => {
      logger.info('seedTaskManager: done');
      return db.end ? new Promise((resolve) => db.end(resolve)) : null;
    })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('seedTaskManager failed:', err);
      process.exit(1);
    });
}
