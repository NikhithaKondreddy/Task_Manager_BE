
const db = require(__root + 'db');

function q(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

module.exports = {
  
  async getDashboardMetrics(userId, role, tenantId, publicId) {
    return {
      projects: 0,
      tasks: 0,
      overdueTasks: 0,
      onTimeTasks: 0,
    };
  },

  
  async getAccessibleResources(userId, role, tenantId, publicId) {

    const base = { projects: [], tasks: [], modules: [] };
    const featuresByRole = {
      'Admin': ['Dashboard', 'Assigned Clients', 'Projects', 'Tasks', 'Assigned Tasks', 'Departments', 'Users'],
      'Manager': ['Dashboard', 'Assigned Clients', 'Projects', 'Tasks', 'Departments', 'Users'],
      'Employee': ['Assigned Tasks'],
      'Client-Viewer': ['Documents']
    };
    const features = featuresByRole[role] || ['Assigned Tasks'];
    const resources = { ...base, features };

    if (role === 'Manager') {
      let assignedClientIds = [];
      try {

        const clientsByManager = await q(
          'SELECT id FROM clients WHERE manager_id = ? OR manager_id = ? ORDER BY id DESC',
          [userId, publicId || -1]
        );
        assignedClientIds = (clientsByManager || []).map(r => r.id).filter(Boolean);

        if (!assignedClientIds.length) {
          const viaProjects = await q(
            `SELECT DISTINCT c.id
             FROM projects p
             INNER JOIN clients c ON c.id = p.client_id
             WHERE (p.project_manager_id = ? OR p.project_manager_id = ? OR p.manager_id = ? OR p.manager_id = ?)`,
            [userId, publicId || -1, userId, publicId || -1]
          );
          assignedClientIds = (viaProjects || []).map(r => r.id).filter(Boolean);
        }
      } catch (e) {

        assignedClientIds = [];
      }

      resources.assignedClientIds = assignedClientIds;
    }

    return resources;
  }
};
