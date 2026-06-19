const { query } = require('../repositories/mysql');

async function getHierarchy(tenantId) {
  const active = "tenant_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE'";
  const states = await query(`SELECT id, name, status FROM states WHERE ${active} ORDER BY name ASC`, [tenantId]);
  const regions = await query(`SELECT id, state_id, name, status FROM regions WHERE ${active} ORDER BY name ASC`, [tenantId]);
  const clusters = await query(`SELECT id, region_id, name, status FROM clusters WHERE ${active} ORDER BY name ASC`, [tenantId]);
  const branches = await query(`SELECT id, cluster_id, name, status FROM branches WHERE ${active} ORDER BY name ASC`, [tenantId]);
  return { states, regions, clusters, branches };
}

async function getRegionsByState(tenantId, stateId) {
  return query("SELECT id, state_id, name, status FROM regions WHERE tenant_id = ? AND state_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE' ORDER BY name ASC", [tenantId, stateId]);
}

async function getClustersByRegion(tenantId, regionId) {
  return query("SELECT id, region_id, name, status FROM clusters WHERE tenant_id = ? AND region_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE' ORDER BY name ASC", [tenantId, regionId]);
}

async function getBranchesByCluster(tenantId, clusterId) {
  return query("SELECT id, cluster_id, name, status FROM branches WHERE tenant_id = ? AND cluster_id = ? AND UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE' ORDER BY name ASC", [tenantId, clusterId]);
}

module.exports = {
  getHierarchy,
  getRegionsByState,
  getClustersByRegion,
  getBranchesByCluster,
};
