const { query } = require('../repositories/mysql');

async function getHierarchy(tenantId, user = null) {
  let allowed = null;
  if (user) {
    const { normalizeRole } = require('../../../config/rbac');
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const masterDataService = require('../../../services/masterDataService');
      allowed = await masterDataService.getAllowedLocationIds(tenantId, user._id);
    }
  }

  let sql = `
    SELECT 
      b.id AS id,
      s.id AS state_id,
      r.id AS region_id,
      c.id AS cluster_id,
      b.id AS branch_id,
      b.status AS status
    FROM branches b
    LEFT JOIN clusters c ON b.cluster_id = c.id
    LEFT JOIN regions r ON c.region_id = r.id
    LEFT JOIN states s ON r.state_id = s.id
    WHERE b.tenant_id = ?
  `;
  const params = [tenantId];
  if (allowed) {
    sql += " AND b.id IN (?)";
    params.push(allowed.branches.length > 0 ? allowed.branches : [0]);
  }
  sql += " ORDER BY s.name ASC, r.name ASC, c.name ASC, b.name ASC";
  return query(sql, params);
}

async function getRegionsByState(tenantId, stateId, user = null) {
  let sql = "SELECT id, state_id, name, status FROM regions WHERE tenant_id = ? AND state_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE'";
  const params = [tenantId, stateId];
  if (user) {
    const { normalizeRole } = require('../../../config/rbac');
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const masterDataService = require('../../../services/masterDataService');
      const allowed = await masterDataService.getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        sql += " AND id IN (?)";
        params.push(allowed.regions.length > 0 ? allowed.regions : [0]);
      }
    }
  }
  sql += " ORDER BY name ASC";
  return query(sql, params);
}

async function getClustersByRegion(tenantId, regionId, user = null) {
  let sql = "SELECT id, region_id, name, status FROM clusters WHERE tenant_id = ? AND region_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE'";
  const params = [tenantId, regionId];
  if (user) {
    const { normalizeRole } = require('../../../config/rbac');
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const masterDataService = require('../../../services/masterDataService');
      const allowed = await masterDataService.getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        sql += " AND id IN (?)";
        params.push(allowed.clusters.length > 0 ? allowed.clusters : [0]);
      }
    }
  }
  sql += " ORDER BY name ASC";
  return query(sql, params);
}

async function getBranchesByCluster(tenantId, clusterId, user = null) {
  let sql = "SELECT id, cluster_id, name, status FROM branches WHERE tenant_id = ? AND cluster_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE'";
  const params = [tenantId, clusterId];
  if (user) {
    const { normalizeRole } = require('../../../config/rbac');
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const masterDataService = require('../../../services/masterDataService');
      const allowed = await masterDataService.getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        sql += " AND id IN (?)";
        params.push(allowed.branches.length > 0 ? allowed.branches : [0]);
      }
    }
  }
  sql += " ORDER BY name ASC";
  return query(sql, params);
}

module.exports = {
  getHierarchy,
  getRegionsByState,
  getClustersByRegion,
  getBranchesByCluster,
};
