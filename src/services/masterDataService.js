const db = require('../db');

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function listStates(tenantId) {
  return query('SELECT id, name, status FROM states WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
}

async function createState(tenantId, payload, userId) {
  const name = String(payload.name || payload.stateName || `State-${Date.now()}`).trim();
  if (!name) throw new Error('State name is required');
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();
  const result = await query(
    'INSERT INTO states (tenant_id, name, status, created_by) VALUES (?, ?, ?, ?)',
    [tenantId, name, status, userId || null]
  );
  const rows = await query('SELECT id, name, status FROM states WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function updateState(tenantId, id, payload, userId) {
  const rows = await query('SELECT id, name, status FROM states WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) return { id: Number(id), updated: false, message: 'State not found' };
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  await query('UPDATE states SET name = ?, status = ?, updated_at = NOW(), created_by = COALESCE(created_by, ?) WHERE tenant_id = ? AND id = ?',
    [name, status, userId || null, tenantId, id]
  );
  return { id: Number(id), name, status };
}

async function deleteState(tenantId, id) {
  await query('DELETE FROM states WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

async function listRegions(tenantId) {
  return query('SELECT id, state_id, name, status FROM regions WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
}

async function createRegion(tenantId, payload, userId) {
  const name = String(payload.name || payload.regionName || `Region-${Date.now()}`).trim();
  let stateId = Number(payload.stateId || payload.state_id);
  if (!name) throw new Error('Region name is required');
  if (!stateId) {
    const fallback = await query('SELECT id FROM states WHERE tenant_id = ? ORDER BY id ASC LIMIT 1', [tenantId]);
    stateId = fallback && fallback[0] ? Number(fallback[0].id) : 0;
  }
  if (!stateId) throw new Error('stateId is required');
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();
  const result = await query(
    'INSERT INTO regions (tenant_id, state_id, name, status, created_by) VALUES (?, ?, ?, ?, ?)',
    [tenantId, stateId, name, status, userId || null]
  );
  const rows = await query('SELECT id, state_id, name, status FROM regions WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function updateRegion(tenantId, id, payload) {
  const rows = await query('SELECT id, state_id, name, status FROM regions WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) return { id: Number(id), updated: false, message: 'Region not found' };
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  const stateId = payload.stateId || payload.state_id || existing.state_id;
  await query('UPDATE regions SET name = ?, status = ?, state_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?',
    [name, status, stateId, tenantId, id]
  );
  return { id: Number(id), stateId: Number(stateId), name, status };
}

async function deleteRegion(tenantId, id) {
  await query('DELETE FROM regions WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

async function listClusters(tenantId) {
  return query('SELECT id, region_id, name, status FROM clusters WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
}

async function createCluster(tenantId, payload, userId) {
  const name = String(payload.name || payload.clusterName || `Cluster-${Date.now()}`).trim();
  let regionId = Number(payload.regionId || payload.region_id);
  if (!name) throw new Error('Cluster name is required');
  if (!regionId) {
    const fallback = await query('SELECT id FROM regions WHERE tenant_id = ? ORDER BY id ASC LIMIT 1', [tenantId]);
    regionId = fallback && fallback[0] ? Number(fallback[0].id) : 0;
  }
  if (!regionId) throw new Error('regionId is required');
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();
  const result = await query(
    'INSERT INTO clusters (tenant_id, region_id, name, status, created_by) VALUES (?, ?, ?, ?, ?)',
    [tenantId, regionId, name, status, userId || null]
  );
  const rows = await query('SELECT id, region_id, name, status FROM clusters WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function updateCluster(tenantId, id, payload) {
  const rows = await query('SELECT id, region_id, name, status FROM clusters WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) return { id: Number(id), updated: false, message: 'Cluster not found' };
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  const regionId = payload.regionId || payload.region_id || existing.region_id;
  await query('UPDATE clusters SET name = ?, status = ?, region_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?',
    [name, status, regionId, tenantId, id]
  );
  return { id: Number(id), regionId: Number(regionId), name, status };
}

async function deleteCluster(tenantId, id) {
  await query('DELETE FROM clusters WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

async function listBranches(tenantId) {
  return query('SELECT id, cluster_id, name, status FROM branches WHERE tenant_id = ? ORDER BY name ASC', [tenantId]);
}

async function createBranch(tenantId, payload, userId) {
  const name = String(payload.name || payload.branchName || `Branch-${Date.now()}`).trim();
  let clusterId = Number(payload.clusterId || payload.cluster_id);
  if (!name) throw new Error('Branch name is required');
  if (!clusterId) {
    const fallback = await query('SELECT id FROM clusters WHERE tenant_id = ? ORDER BY id ASC LIMIT 1', [tenantId]);
    clusterId = fallback && fallback[0] ? Number(fallback[0].id) : 0;
  }
  if (!clusterId) throw new Error('clusterId is required');
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();
  const result = await query(
    'INSERT INTO branches (tenant_id, cluster_id, name, status, created_by) VALUES (?, ?, ?, ?, ?)',
    [tenantId, clusterId, name, status, userId || null]
  );
  const rows = await query('SELECT id, cluster_id, name, status FROM branches WHERE id = ?', [result.insertId]);
  return rows[0];
}

async function updateBranch(tenantId, id, payload) {
  const rows = await query('SELECT id, cluster_id, name, status FROM branches WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) return { id: Number(id), updated: false, message: 'Branch not found' };
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  const clusterId = payload.clusterId || payload.cluster_id || existing.cluster_id;
  await query('UPDATE branches SET name = ?, status = ?, cluster_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?',
    [name, status, clusterId, tenantId, id]
  );
  return { id: Number(id), clusterId: Number(clusterId), name, status };
}

async function deleteBranch(tenantId, id) {
  await query('DELETE FROM branches WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  return { id: Number(id), deleted: true };
}

module.exports = {
  listStates,
  createState,
  updateState,
  deleteState,
  listRegions,
  createRegion,
  updateRegion,
  deleteRegion,
  listClusters,
  createCluster,
  updateCluster,
  deleteCluster,
  listBranches,
  createBranch,
  updateBranch,
  deleteBranch,
};
