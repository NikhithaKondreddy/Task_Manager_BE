const HttpError = require('../../../errors/HttpError');
const { q } = require('../utils/db');
const { normalizeRole } = require('../../../config/rbac');

const TABLES = {
  task: 'tm_tasks',
  occurrence: 'tm_task_occurrences'
};

function elapsedSeconds(row) {
  const saved = Number(row.total_duration_seconds || 0);
  if (row.timer_status !== 'Running' || !row.resumed_at) return saved;
  const resumedAt = new Date(row.resumed_at).getTime();
  if (!Number.isFinite(resumedAt)) return saved;
  return saved + Math.max(0, Math.floor((Date.now() - resumedAt) / 1000));
}

async function getEntity(kind, id, tenantId) {
  const rows = await q(`SELECT * FROM ${TABLES[kind]} WHERE id = ? AND tenant_id = ?`, [id, tenantId]);
  return rows[0] || null;
}

async function assertEmployeeOwner(req, entity) {
  if (normalizeRole(req.user.role) !== 'EMPLOYEE') {
    throw new HttpError(403, 'Timer is available only for Employees', 'AUTH_FORBIDDEN');
  }
  if (entity.assigned_to !== req.user._id) {
    throw new HttpError(403, 'You can only update timers assigned to you', 'AUTH_FORBIDDEN');
  }
}

async function record(kind, id, tenantId, action, userId) {
  await q(
    `INSERT INTO task_timer_history (tenant_id, entity_type, entity_id, action, action_time, performed_by)
     VALUES (?, ?, ?, ?, NOW(), ?)`,
    [tenantId, kind, id, action, userId]
  );
}

async function transition({ req, kind, id, action }) {
  const entity = await getEntity(kind, id, req.user.tenant_id);
  if (!entity) throw new HttpError(404, 'Timer target not found', 'NOT_FOUND');
  await assertEmployeeOwner(req, entity);

  const table = TABLES[kind];
  const currentStatus = entity.timer_status || 'Not Started';
  let sql;
  let params;

  if (action === 'Start') {
    if (!['Not Started', null, undefined].includes(currentStatus)) throw new HttpError(409, 'Timer has already started', 'INVALID_TIMER_STATE');
    sql = `UPDATE ${table} SET started_at = NOW(), resumed_at = NOW(), timer_status = 'Running', status = 'In Progress', updated_at = NOW() WHERE id = ?`;
    params = [id];
  } else if (action === 'Pause') {
    if (currentStatus !== 'Running') throw new HttpError(409, 'Only a running timer can be paused', 'INVALID_TIMER_STATE');
    sql = `UPDATE ${table} SET paused_at = NOW(), total_duration_seconds = ?, timer_status = 'Paused', updated_at = NOW() WHERE id = ?`;
    params = [elapsedSeconds(entity), id];
  } else if (action === 'Resume') {
    if (currentStatus !== 'Paused') throw new HttpError(409, 'Only a paused timer can be resumed', 'INVALID_TIMER_STATE');
    sql = `UPDATE ${table} SET resumed_at = NOW(), timer_status = 'Running', status = 'In Progress', updated_at = NOW() WHERE id = ?`;
    params = [id];
  } else {
    throw new HttpError(400, 'Unsupported timer action', 'VALIDATION_ERROR');
  }

  await q(sql, params);
  await record(kind, id, req.user.tenant_id, action, req.user._id);
  const updated = await getEntity(kind, id, req.user.tenant_id);
  return { ...updated, elapsed_seconds: elapsedSeconds(updated) };
}

module.exports = { transition, elapsedSeconds };
