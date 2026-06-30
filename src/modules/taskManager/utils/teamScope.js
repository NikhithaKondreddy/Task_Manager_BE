const { q } = require('./db');

/**
 * A Manager's "team" is derived from the existing departments table:
 * employees whose department's manager_id/head_id (stored as the user's
 * numeric _id) matches this manager. Avoids a new mapping table.
 */
async function getManagerDepartmentPublicIds(managerInternalId, tenantId) {
  const rows = await q(
    `SELECT public_id FROM departments WHERE (manager_id = ? OR head_id = ?) AND (tenant_id = ? OR tenant_id IS NULL)`,
    [String(managerInternalId), String(managerInternalId), tenantId]
  );
  return rows.map((r) => r.public_id);
}

async function getManagerTeamUsers(managerInternalId, tenantId) {
  const deptIds = await getManagerDepartmentPublicIds(managerInternalId, tenantId);
  if (!deptIds.length) return [];
  const placeholders = deptIds.map(() => '?').join(',');
  return q(
    `SELECT _id, name, email, role, photo, department_public_id FROM users
     WHERE department_public_id IN (${placeholders}) AND tenant_id = ? AND role = 'Employee'`,
    [...deptIds, tenantId]
  );
}

async function getManagerTeamUserIds(managerInternalId, tenantId) {
  const users = await getManagerTeamUsers(managerInternalId, tenantId);
  return users.map((u) => u._id);
}

module.exports = { getManagerDepartmentPublicIds, getManagerTeamUsers, getManagerTeamUserIds };
