const { q } = require('../utils/db');
const { getManagerTeamUsers } = require('../utils/teamScope');

async function getAssignable(tenantId) {
  return q(
    `SELECT _id, name, email, role, photo FROM users WHERE tenant_id = ? AND is_active = 1 ORDER BY name ASC`,
    [tenantId]
  );
}

async function getTeam(managerInternalId, tenantId) {
  return getManagerTeamUsers(managerInternalId, tenantId);
}

module.exports = { getAssignable, getTeam };
