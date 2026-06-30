const { normalizeRole } = require('../../../config/rbac');
const { getManagerTeamUserIds } = require('../utils/teamScope');

/**
 * Returns null for tenant-wide visibility (Admin/SuperAdmin), or an array of
 * allowed `assigned_to` user ids otherwise (Manager: team + self, Employee: self).
 */
async function getAssigneeScope(req) {
  const role = normalizeRole(req.user.role);
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return null;
  if (role === 'MANAGER') {
    const teamIds = await getManagerTeamUserIds(req.user._id, req.user.tenant_id);
    return [...new Set([...teamIds, req.user._id])];
  }
  return [req.user._id];
}

module.exports = { getAssigneeScope };
