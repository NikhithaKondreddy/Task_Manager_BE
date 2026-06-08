const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query } = require('../repositories/mysql');
const { safeJsonParse, safeJsonStringify } = require('../helpers/ticketUtils');

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value == null || value === '') return [];
  return [value];
}

function mapMapping(row) {
  return {
    id: row.id,
    engineerId: row.engineer_id,
    engineer: {
      id: row.engineer_public_id || row.engineer_id,
      internalId: row.engineer_id,
      name: row.engineer_name,
      email: row.engineer_email,
      role: row.engineer_role,
    },
    stateId: row.state_id,
    regionId: row.region_id,
    clusterId: row.cluster_id,
    branchId: row.branch_id,
    skills: safeJsonParse(row.skills_json, []),
    supportedCategories: safeJsonParse(row.supported_categories_json, []),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listMappings(tenantId, filters = {}) {
  const params = [tenantId];
  const where = ['em.tenant_id = ?'];

  if (filters.engineerId) {
    where.push('(em.engineer_id = ? OR u.public_id = ?)');
    params.push(filters.engineerId, String(filters.engineerId));
  }

  const rows = await query(
    `
      SELECT
        em.*,
        u.public_id AS engineer_public_id,
        u.name AS engineer_name,
        u.email AS engineer_email,
        u.role AS engineer_role
      FROM engineer_mapping em
      INNER JOIN users u ON u._id = em.engineer_id
      WHERE ${where.join(' AND ')}
      ORDER BY u.name ASC, em.id ASC
    `,
    params
  );

  return rows.map(mapMapping);
}

async function getUserForMapping(tenantId, engineerId) {
  const rows = await query(
    `
      SELECT _id, public_id, name, email, role
      FROM users
      WHERE tenant_id = ?
        AND (_id = ? OR public_id = ?)
      LIMIT 1
    `,
    [tenantId, engineerId, String(engineerId)]
  );
  return rows[0] || null;
}

async function createMapping(tenantId, payload, user) {
  let engineerId = payload.engineerId || payload.engineer_id;
  if (!engineerId) {
    const fallbackUser = await query(
      `
        SELECT _id, public_id
        FROM users
        WHERE tenant_id = ? AND COALESCE(isActive, 1) = 1
        ORDER BY _id ASC
        LIMIT 1
      `,
      [tenantId]
    );
    engineerId = fallbackUser && fallbackUser[0] ? (fallbackUser[0].public_id || fallbackUser[0]._id) : null;
  }
  if (!engineerId) {
    throw new HttpError(400, 'engineerId is required', 'ENGINEER_ID_REQUIRED');
  }

  const engineer = await getUserForMapping(tenantId, engineerId);
  if (!engineer) {
    throw new HttpError(404, 'Engineer not found', 'ENGINEER_NOT_FOUND');
  }

  const skills = normalizeArray(payload.skills);
  const supportedCategories = normalizeArray(payload.supportedCategories || payload.supported_categories);

  const result = await query(
    `
      INSERT INTO engineer_mapping
        (tenant_id, engineer_id, state_id, region_id, cluster_id, branch_id, skills_json, supported_categories_json, is_active, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      tenantId,
      engineer._id,
      payload.stateId || payload.state_id || null,
      payload.regionId || payload.region_id || null,
      payload.clusterId || payload.cluster_id || null,
      payload.branchId || payload.branch_id || null,
      safeJsonStringify(skills, '[]'),
      safeJsonStringify(supportedCategories, '[]'),
      payload.isActive === undefined ? 1 : Number(Boolean(payload.isActive)),
      user?._id || null,
      user?._id || null,
    ]
  );

  await auditLogger.logAudit({
    action: 'ENGINEER_MAPPING_CREATED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'EngineerMapping',
    entity_id: String(result.insertId),
    module: 'Ticketing',
    details: { engineerId: engineer.public_id || engineer._id, supportedCategories, skills },
  });

  const rows = await listMappings(tenantId, { engineerId: engineer._id });
  return rows.find((row) => Number(row.id) === Number(result.insertId)) || null;
}

async function updateMapping(tenantId, mappingId, payload, user) {
  const existingRows = await listMappings(tenantId);
  const existing = existingRows.find((row) => Number(row.id) === Number(mappingId));
  if (!existing) {
    return { id: Number(mappingId), updated: false, message: 'Engineer mapping not found' };
  }

  const skills = payload.skills !== undefined ? normalizeArray(payload.skills) : existing.skills;
  const supportedCategories = payload.supportedCategories !== undefined || payload.supported_categories !== undefined
    ? normalizeArray(payload.supportedCategories || payload.supported_categories)
    : existing.supportedCategories;

  await query(
    `
      UPDATE engineer_mapping
      SET
        state_id = ?,
        region_id = ?,
        cluster_id = ?,
        branch_id = ?,
        skills_json = ?,
        supported_categories_json = ?,
        is_active = ?,
        updated_by = ?
      WHERE tenant_id = ? AND id = ?
    `,
    [
      payload.stateId !== undefined ? payload.stateId : existing.stateId,
      payload.regionId !== undefined ? payload.regionId : existing.regionId,
      payload.clusterId !== undefined ? payload.clusterId : existing.clusterId,
      payload.branchId !== undefined ? payload.branchId : existing.branchId,
      safeJsonStringify(skills, '[]'),
      safeJsonStringify(supportedCategories, '[]'),
      payload.isActive === undefined ? Number(existing.isActive) : Number(Boolean(payload.isActive)),
      user?._id || null,
      tenantId,
      mappingId,
    ]
  );

  await auditLogger.logAudit({
    action: 'ENGINEER_MAPPING_UPDATED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'EngineerMapping',
    entity_id: String(mappingId),
    module: 'Ticketing',
    previous_value: existing,
    new_value: {
      ...existing,
      stateId: payload.stateId !== undefined ? payload.stateId : existing.stateId,
      regionId: payload.regionId !== undefined ? payload.regionId : existing.regionId,
      clusterId: payload.clusterId !== undefined ? payload.clusterId : existing.clusterId,
      branchId: payload.branchId !== undefined ? payload.branchId : existing.branchId,
      skills,
      supportedCategories,
      isActive: payload.isActive === undefined ? existing.isActive : Boolean(payload.isActive),
    },
  });

  const updatedRows = await listMappings(tenantId);
  return updatedRows.find((row) => Number(row.id) === Number(mappingId)) || null;
}

async function deleteMapping(tenantId, mappingId, user) {
  const existingRows = await listMappings(tenantId);
  const existing = existingRows.find((row) => Number(row.id) === Number(mappingId));
  if (!existing) {
    return { id: Number(mappingId), deleted: true, noop: true };
  }

  await query(`DELETE FROM engineer_mapping WHERE tenant_id = ? AND id = ?`, [tenantId, mappingId]);

  await auditLogger.logAudit({
    action: 'ENGINEER_MAPPING_DELETED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'EngineerMapping',
    entity_id: String(mappingId),
    module: 'Ticketing',
    previous_value: existing,
  });

  return { id: Number(mappingId), deleted: true };
}

module.exports = {
  listMappings,
  createMapping,
  updateMapping,
  deleteMapping,
};
