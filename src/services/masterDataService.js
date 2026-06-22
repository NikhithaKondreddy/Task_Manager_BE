const db = require('../db');
const auditLogger = require('./auditLogger');
const { normalizeRole } = require('../config/rbac');

function query(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function normalizeListOptions(options = {}, allowedSortFields = ['name', 'id', 'status']) {
  const limit = Math.min(Math.max(Number(options.limit || options.pageSize || 50), 1), 200);
  const page = Math.max(Number(options.page || 1), 1);
  const offset = options.offset !== undefined ? Math.max(Number(options.offset || 0), 0) : (page - 1) * limit;
  const sortBy = allowedSortFields.includes(String(options.sortBy || options.sort_by || 'name'))
    ? String(options.sortBy || options.sort_by || 'name')
    : 'name';
  const sortOrder = String(options.sortOrder || options.sort_order || 'ASC').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  const search = String(options.search || options.q || '').trim();
  const status = options.status ? String(options.status).trim().toUpperCase() : null;
  const includeInactive = String(options.includeInactive || options.include_inactive || 'false').toLowerCase() === 'true';
  return { limit, page, offset, sortBy, sortOrder, search, status, includeInactive };
}

async function listMasterRows(tableName, selectSql, tenantId, options = {}, extraWhere = [], extraParams = [], sortMap = {}) {
  const normalized = normalizeListOptions(options, Object.keys(sortMap).length ? Object.keys(sortMap) : ['name', 'id', 'status']);
  const where = ['tenant_id = ?'].concat(extraWhere);
  const params = [tenantId].concat(extraParams);

  if (normalized.status) {
    where.push('UPPER(status) = ?');
    params.push(normalized.status);
  } else if (!normalized.includeInactive) {
    where.push("UPPER(COALESCE(status, 'ACTIVE')) <> 'INACTIVE'");
  }

  if (normalized.search) {
    where.push('name LIKE ?');
    params.push(`%${normalized.search}%`);
  }

  const sortColumn = sortMap[normalized.sortBy] || normalized.sortBy;
  const rows = await query(
    `
      ${selectSql}
      WHERE ${where.join(' AND ')}
      ORDER BY ${sortColumn} ${normalized.sortOrder}, id ASC
      LIMIT ? OFFSET ?
    `,
    params.concat([normalized.limit, normalized.offset])
  );

  const totalRows = await query(
    `
      SELECT COUNT(*) AS total
      FROM ${tableName}
      WHERE ${where.join(' AND ')}
    `,
    params
  );

  return {
    items: rows,
    total: Number(totalRows[0]?.total || 0),
    limit: normalized.limit,
    offset: normalized.offset,
    page: normalized.page,
  };
}

function normalizeStatus(value) {
  return String(value || 'ACTIVE').trim().toUpperCase();
}

async function logMasterAudit(action, tenantId, userId, entity, entityId, details = {}, previousValue = null, newValue = null) {
  await auditLogger.logAudit({
    action,
    tenant_id: tenantId,
    actor_id: userId || null,
    entity,
    entity_id: String(entityId),
    module: 'MasterData',
    details,
    previous_value: previousValue,
    new_value: newValue,
  });
}

async function listStates(tenantId, options = {}, user = null) {
  const extraWhere = [];
  const extraParams = [];
  if (user) {
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const allowed = await getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        extraWhere.push('id IN (?)');
        extraParams.push(allowed.states.length > 0 ? allowed.states : [0]);
      }
    }
  }
  return listMasterRows('states', 'SELECT id, name, status FROM states', tenantId, options, extraWhere, extraParams);
}

async function createState(tenantId, payload, userId) {
  const name = String(payload.name || payload.stateName || '').trim();
  if (!name) throw new Error('State name is required');
  const status = normalizeStatus(payload.status);
  const result = await query(
    'INSERT INTO states (tenant_id, name, status, created_by) VALUES (?, ?, ?, ?)',
    [tenantId, name, status, userId || null]
  );
  const rows = await query('SELECT id, name, status FROM states WHERE id = ?', [result.insertId]);
  await logMasterAudit('STATE_CREATED', tenantId, userId, 'State', result.insertId, { name, status }, null, rows[0] || null);
  return rows[0];
}

async function updateState(tenantId, id, payload, userId) {
  const rows = await query('SELECT id, name, status FROM states WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('State not found');
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? normalizeStatus(payload.status) : existing.status;
  await query(
    'UPDATE states SET name = ?, status = ?, updated_at = NOW(), created_by = COALESCE(created_by, ?) WHERE tenant_id = ? AND id = ?',
    [name, status, userId || null, tenantId, id]
  );
  const updated = { id: Number(id), name, status };
  await logMasterAudit('STATE_UPDATED', tenantId, userId, 'State', id, { name, status }, existing, updated);
  return updated;
}

async function deleteState(tenantId, id, userId) {
  const rows = await query('SELECT id, name, status FROM states WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('State not found');
  await query("UPDATE states SET status = 'INACTIVE', updated_at = NOW() WHERE tenant_id = ? AND id = ?", [tenantId, id]);
  await logMasterAudit('STATE_DELETED', tenantId, userId, 'State', id, { softDelete: true }, rows[0], { ...rows[0], status: 'INACTIVE' });
  return { id: Number(id), deleted: true, softDeleted: true, status: 'INACTIVE' };
}

async function listRegions(tenantId, options = {}, user = null) {
  const extraWhere = [];
  const extraParams = [];
  if (options.stateId || options.state_id) {
    extraWhere.push('state_id = ?');
    extraParams.push(options.stateId || options.state_id);
  }
  if (user) {
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const allowed = await getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        extraWhere.push('id IN (?)');
        extraParams.push(allowed.regions.length > 0 ? allowed.regions : [0]);
      }
    }
  }
  return listMasterRows(
    'regions',
    'SELECT id, state_id, name, status FROM regions',
    tenantId,
    options,
    extraWhere,
    extraParams,
    { name: 'name', id: 'id', status: 'status', state_id: 'state_id', stateId: 'state_id' }
  );
}

async function createRegion(tenantId, payload, userId) {
  const name = String(payload.name || payload.regionName || '').trim();
  let stateId = Number(payload.stateId || payload.state_id);
  if (!name) throw new Error('Region name is required');
  if (!stateId) {
    const fallback = await query("SELECT id FROM states WHERE tenant_id = ? AND UPPER(status) <> 'INACTIVE' ORDER BY id ASC LIMIT 1", [tenantId]);
    stateId = fallback && fallback[0] ? Number(fallback[0].id) : 0;
  }
  if (!stateId) throw new Error('stateId is required');
  const status = normalizeStatus(payload.status);
  const result = await query(
    'INSERT INTO regions (tenant_id, state_id, name, status, created_by) VALUES (?, ?, ?, ?, ?)',
    [tenantId, stateId, name, status, userId || null]
  );
  const rows = await query('SELECT id, state_id, name, status FROM regions WHERE id = ?', [result.insertId]);
  await logMasterAudit('REGION_CREATED', tenantId, userId, 'Region', result.insertId, { name, stateId, status }, null, rows[0] || null);
  return rows[0];
}

async function updateRegion(tenantId, id, payload, userId) {
  const rows = await query('SELECT id, state_id, name, status FROM regions WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('Region not found');
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? normalizeStatus(payload.status) : existing.status;
  const stateId = payload.stateId || payload.state_id || existing.state_id;
  await query(
    'UPDATE regions SET name = ?, status = ?, state_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?',
    [name, status, stateId, tenantId, id]
  );
  const updated = { id: Number(id), stateId: Number(stateId), state_id: Number(stateId), name, status };
  await logMasterAudit('REGION_UPDATED', tenantId, userId, 'Region', id, { name, stateId, status }, existing, updated);
  return updated;
}

async function deleteRegion(tenantId, id, userId) {
  const rows = await query('SELECT id, state_id, name, status FROM regions WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('Region not found');
  await query("UPDATE regions SET status = 'INACTIVE', updated_at = NOW() WHERE tenant_id = ? AND id = ?", [tenantId, id]);
  await logMasterAudit('REGION_DELETED', tenantId, userId, 'Region', id, { softDelete: true }, rows[0], { ...rows[0], status: 'INACTIVE' });
  return { id: Number(id), deleted: true, softDeleted: true, status: 'INACTIVE' };
}

async function listClusters(tenantId, options = {}, user = null) {
  const extraWhere = [];
  const extraParams = [];
  if (options.regionId || options.region_id) {
    extraWhere.push('region_id = ?');
    extraParams.push(options.regionId || options.region_id);
  }
  if (user) {
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const allowed = await getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        extraWhere.push('id IN (?)');
        extraParams.push(allowed.clusters.length > 0 ? allowed.clusters : [0]);
      }
    }
  }
  return listMasterRows(
    'clusters',
    'SELECT id, region_id, name, status FROM clusters',
    tenantId,
    options,
    extraWhere,
    extraParams,
    { name: 'name', id: 'id', status: 'status', region_id: 'region_id', regionId: 'region_id' }
  );
}

async function createCluster(tenantId, payload, userId) {
  const name = String(payload.name || payload.clusterName || '').trim();
  let regionId = Number(payload.regionId || payload.region_id);
  if (!name) throw new Error('Cluster name is required');
  if (!regionId) {
    const fallback = await query("SELECT id FROM regions WHERE tenant_id = ? AND UPPER(status) <> 'INACTIVE' ORDER BY id ASC LIMIT 1", [tenantId]);
    regionId = fallback && fallback[0] ? Number(fallback[0].id) : 0;
  }
  if (!regionId) throw new Error('regionId is required');
  const status = normalizeStatus(payload.status);
  const result = await query(
    'INSERT INTO clusters (tenant_id, region_id, name, status, created_by) VALUES (?, ?, ?, ?, ?)',
    [tenantId, regionId, name, status, userId || null]
  );
  const rows = await query('SELECT id, region_id, name, status FROM clusters WHERE id = ?', [result.insertId]);
  await logMasterAudit('CLUSTER_CREATED', tenantId, userId, 'Cluster', result.insertId, { name, regionId, status }, null, rows[0] || null);
  return rows[0];
}

async function updateCluster(tenantId, id, payload, userId) {
  const rows = await query('SELECT id, region_id, name, status FROM clusters WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('Cluster not found');
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? normalizeStatus(payload.status) : existing.status;
  const regionId = payload.regionId || payload.region_id || existing.region_id;
  await query(
    'UPDATE clusters SET name = ?, status = ?, region_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?',
    [name, status, regionId, tenantId, id]
  );
  const updated = { id: Number(id), regionId: Number(regionId), region_id: Number(regionId), name, status };
  await logMasterAudit('CLUSTER_UPDATED', tenantId, userId, 'Cluster', id, { name, regionId, status }, existing, updated);
  return updated;
}

async function deleteCluster(tenantId, id, userId) {
  const rows = await query('SELECT id, region_id, name, status FROM clusters WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('Cluster not found');
  await query("UPDATE clusters SET status = 'INACTIVE', updated_at = NOW() WHERE tenant_id = ? AND id = ?", [tenantId, id]);
  await logMasterAudit('CLUSTER_DELETED', tenantId, userId, 'Cluster', id, { softDelete: true }, rows[0], { ...rows[0], status: 'INACTIVE' });
  return { id: Number(id), deleted: true, softDeleted: true, status: 'INACTIVE' };
}

async function listBranches(tenantId, options = {}, user = null) {
  const extraWhere = [];
  const extraParams = [];
  if (options.clusterId || options.cluster_id) {
    extraWhere.push('cluster_id = ?');
    extraParams.push(options.clusterId || options.cluster_id);
  }
  if (user) {
    const userRole = normalizeRole(user.role);
    if (userRole !== 'SUPER_ADMIN' && userRole !== 'IT_ADMIN') {
      const allowed = await getAllowedLocationIds(tenantId, user._id);
      if (allowed) {
        extraWhere.push('id IN (?)');
        extraParams.push(allowed.branches.length > 0 ? allowed.branches : [0]);
      }
    }
  }
  return listMasterRows(
    'branches',
    'SELECT id, cluster_id, name, status FROM branches',
    tenantId,
    options,
    extraWhere,
    extraParams,
    { name: 'name', id: 'id', status: 'status', cluster_id: 'cluster_id', clusterId: 'cluster_id' }
  );
}

async function createBranch(tenantId, payload, userId) {
  const name = String(payload.name || payload.branchName || '').trim();
  let clusterId = Number(payload.clusterId || payload.cluster_id);
  if (!name) throw new Error('Branch name is required');
  if (!clusterId) {
    const fallback = await query("SELECT id FROM clusters WHERE tenant_id = ? AND UPPER(status) <> 'INACTIVE' ORDER BY id ASC LIMIT 1", [tenantId]);
    clusterId = fallback && fallback[0] ? Number(fallback[0].id) : 0;
  }
  if (!clusterId) throw new Error('clusterId is required');
  const status = normalizeStatus(payload.status);
  const result = await query(
    'INSERT INTO branches (tenant_id, cluster_id, name, status, created_by) VALUES (?, ?, ?, ?, ?)',
    [tenantId, clusterId, name, status, userId || null]
  );
  const rows = await query('SELECT id, cluster_id, name, status FROM branches WHERE id = ?', [result.insertId]);
  await logMasterAudit('BRANCH_CREATED', tenantId, userId, 'Branch', result.insertId, { name, clusterId, status }, null, rows[0] || null);
  return rows[0];
}

async function updateBranch(tenantId, id, payload, userId) {
  const rows = await query('SELECT id, cluster_id, name, status FROM branches WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('Branch not found');
  const existing = rows[0];
  const name = payload.name ? String(payload.name).trim() : existing.name;
  const status = payload.status ? normalizeStatus(payload.status) : existing.status;
  const clusterId = payload.clusterId || payload.cluster_id || existing.cluster_id;
  await query(
    'UPDATE branches SET name = ?, status = ?, cluster_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?',
    [name, status, clusterId, tenantId, id]
  );
  const updated = { id: Number(id), clusterId: Number(clusterId), cluster_id: Number(clusterId), name, status };
  await logMasterAudit('BRANCH_UPDATED', tenantId, userId, 'Branch', id, { name, clusterId, status }, existing, updated);
  return updated;
}

async function deleteBranch(tenantId, id, userId) {
  const rows = await query('SELECT id, cluster_id, name, status FROM branches WHERE tenant_id = ? AND id = ? LIMIT 1', [tenantId, id]);
  if (!rows.length) throw new Error('Branch not found');
  const { withTransaction } = require('../modules/tickets/repositories/mysql');
  await withTransaction(async (tx) => {
    await tx.query('UPDATE tickets SET branch_id = NULL WHERE tenant_id = ? AND branch_id = ?', [tenantId, id]);
    await tx.query('UPDATE users SET branch_id = NULL WHERE tenant_id = ? AND branch_id = ?', [tenantId, id]);
    await tx.query('UPDATE engineer_mapping SET branch_id = NULL WHERE tenant_id = ? AND branch_id = ?', [tenantId, id]);
    await tx.query('DELETE FROM branches WHERE tenant_id = ? AND id = ?', [tenantId, id]);
  });
  await logMasterAudit('BRANCH_DELETED', tenantId, userId, 'Branch', id, { softDelete: false, permanentDelete: true }, rows[0], null);
  return { id: Number(id), deleted: true, permanentDelete: true };
}

async function getAllowedLocationIds(tenantId, userId) {
  const mappings = await query(
    "SELECT state_id, region_id, cluster_id, branch_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1",
    [tenantId, userId]
  );
  const userRows = await query(
    "SELECT state_id, region_id, cluster_id, branch_id FROM users WHERE tenant_id = ? AND _id = ? LIMIT 1",
    [tenantId, userId]
  );

  const A_states = [];
  const A_regions = [];
  const A_clusters = [];
  const A_branches = [];

  const addUnique = (arr, val) => {
    if (val != null && val !== '' && !arr.includes(Number(val))) {
      arr.push(Number(val));
    }
  };

  mappings.forEach(m => {
    addUnique(A_states, m.state_id);
    addUnique(A_regions, m.region_id);
    addUnique(A_clusters, m.cluster_id);
    addUnique(A_branches, m.branch_id);
  });

  if (userRows.length > 0) {
    const u = userRows[0];
    addUnique(A_states, u.state_id);
    addUnique(A_regions, u.region_id);
    addUnique(A_clusters, u.cluster_id);
    addUnique(A_branches, u.branch_id);
  }

  if (!A_states.length && !A_regions.length && !A_clusters.length && !A_branches.length) {
    return null;
  }

  const resolveList = (arr) => arr.length > 0 ? arr : [0];

  const allowedStatesRows = await query(`
    SELECT DISTINCT id FROM states WHERE tenant_id = ? AND (
      id IN (?)
      OR id IN (SELECT state_id FROM regions WHERE id IN (?))
      OR id IN (SELECT state_id FROM regions WHERE id IN (SELECT region_id FROM clusters WHERE id IN (?)))
      OR id IN (SELECT state_id FROM regions WHERE id IN (SELECT region_id FROM clusters WHERE id IN (SELECT cluster_id FROM branches WHERE id IN (?))))
    )
  `, [tenantId, resolveList(A_states), resolveList(A_regions), resolveList(A_clusters), resolveList(A_branches)]);
  const allowedStates = allowedStatesRows.map(r => r.id);

  const allowedRegionsRows = await query(`
    SELECT DISTINCT id FROM regions WHERE tenant_id = ? AND (
      state_id IN (?)
      OR id IN (?)
      OR id IN (SELECT region_id FROM clusters WHERE id IN (?))
      OR id IN (SELECT region_id FROM clusters WHERE id IN (SELECT cluster_id FROM branches WHERE id IN (?)))
    )
  `, [tenantId, resolveList(allowedStates), resolveList(A_regions), resolveList(A_clusters), resolveList(A_branches)]);
  const allowedRegions = allowedRegionsRows.map(r => r.id);

  const allowedClustersRows = await query(`
    SELECT DISTINCT id FROM clusters WHERE tenant_id = ? AND (
      region_id IN (?)
      OR id IN (?)
      OR id IN (SELECT cluster_id FROM branches WHERE id IN (?))
    )
  `, [tenantId, resolveList(allowedRegions), resolveList(A_clusters), resolveList(A_branches)]);
  const allowedClusters = allowedClustersRows.map(r => r.id);

  const allowedBranchesRows = await query(`
    SELECT DISTINCT id FROM branches WHERE tenant_id = ? AND (
      cluster_id IN (?)
      OR id IN (?)
    )
  `, [tenantId, resolveList(allowedClusters), resolveList(A_branches)]);
  const allowedBranches = allowedBranchesRows.map(r => r.id);

  return {
    states: allowedStates,
    regions: allowedRegions,
    clusters: allowedClusters,
    branches: allowedBranches
  };
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
  getAllowedLocationIds,
};
