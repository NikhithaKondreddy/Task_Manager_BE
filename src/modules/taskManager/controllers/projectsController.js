const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const { normalizeRole } = require('../../../config/rbac');
const projectRepo = require('../repos/projectRepo');
const notify = require('../services/notify');
const { logTaskEvent } = require('../services/audit');

function scopeUserId(req) {
  const role = normalizeRole(req.user.role);
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return null;
  return req.user._id;
}

async function list(req, res) {
  const result = await projectRepo.list(req.user.tenant_id, req.query, scopeUserId(req));
  return success(res, result);
}

async function getOne(req, res) {
  const project = await projectRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');
  const members = await projectRepo.getMembers(project.id);
  return success(res, { ...project, members });
}

async function create(req, res) {
  const { name, description, priority, startDate, endDate, managerId, memberIds } = req.body;
  if (!name) throw new HttpError(400, 'name is required', 'VALIDATION_ERROR');

  const project = await projectRepo.create({
    tenantId: req.user.tenant_id,
    name,
    description,
    priority,
    startDate,
    endDate,
    managerId: managerId || (normalizeRole(req.user.role) === 'MANAGER' ? req.user._id : null),
    createdBy: req.user._id
  });

  if (Array.isArray(memberIds)) {
    for (const userId of memberIds) await projectRepo.addMember(project.id, userId, req.user.tenant_id);
  }

  await logTaskEvent(req, { action: 'PROJECT_CREATED', entity: 'Project', entityId: project.id, details: { name } });
  return success(res, project, 'Project created', 201);
}

async function update(req, res) {
  const project = await projectRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');

  const fields = {};
  ['name', 'description', 'status', 'priority'].forEach((k) => { if (req.body[k] !== undefined) fields[k] = req.body[k]; });
  if (req.body.startDate !== undefined) fields.start_date = req.body.startDate;
  if (req.body.endDate !== undefined) fields.end_date = req.body.endDate;
  if (req.body.managerId !== undefined) fields.manager_id = req.body.managerId;

  const updated = await projectRepo.update(project.id, req.user.tenant_id, fields);
  await logTaskEvent(req, { action: 'PROJECT_UPDATED', entity: 'Project', entityId: project.id, details: fields });
  return success(res, updated, 'Project updated');
}

async function remove(req, res) {
  const project = await projectRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');
  await projectRepo.softDelete(project.id, req.user.tenant_id, req.user._id);
  await logTaskEvent(req, { action: 'PROJECT_DELETED', entity: 'Project', entityId: project.id });
  return success(res, null, 'Project deleted');
}

async function addMember(req, res) {
  const project = await projectRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');
  const { userId, roleInProject } = req.body;
  if (!userId) throw new HttpError(400, 'userId is required', 'VALIDATION_ERROR');
  await projectRepo.addMember(project.id, userId, req.user.tenant_id, roleInProject || 'Member');
  const members = await projectRepo.getMembers(project.id);
  return success(res, members, 'Member added');
}

async function removeMember(req, res) {
  const project = await projectRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');
  await projectRepo.removeMember(project.id, req.params.userId);
  const members = await projectRepo.getMembers(project.id);
  return success(res, members, 'Member removed');
}

async function requestClosure(req, res) {
  const project = await projectRepo.findByPublicId(req.params.id, req.user.tenant_id);
  if (!project) throw new HttpError(404, 'Project not found', 'NOT_FOUND');
  if (project.status === 'Closed') throw new HttpError(409, 'Project already closed', 'ALREADY_CLOSED');

  const allDone = await projectRepo.allTasksCompleted(project.id);
  if (!allDone) throw new HttpError(409, 'All project tasks must be completed before requesting closure', 'TASKS_INCOMPLETE');

  const { q } = require('../utils/db');
  await q(`UPDATE tm_projects SET status = 'Completed', completion_requested_at = NOW() WHERE id = ?`, [project.id]);
  await q(
    `INSERT INTO tm_approvals (tenant_id, approval_type, entity_id, requested_by, status) VALUES (?, 'PROJECT_CLOSURE', ?, ?, 'Pending')`,
    [req.user.tenant_id, project.id, req.user._id]
  );

  const recipients = project.manager_id ? [project.manager_id] : [];
  if (recipients.length) await notify.notifyProjectClosureRequested(recipients, project.name, project.public_id, req.user.tenant_id);

  await logTaskEvent(req, { action: 'PROJECT_CLOSURE_REQUESTED', entity: 'Project', entityId: project.id });
  return success(res, null, 'Closure requested');
}

module.exports = { list, getOne, create, update, remove, addMember, removeMember, requestClosure };
