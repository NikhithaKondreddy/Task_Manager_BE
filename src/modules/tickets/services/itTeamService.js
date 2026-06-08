const HttpError = require('../../../errors/HttpError');
const auditLogger = require('../../../services/auditLogger');
const { query, withTransaction } = require('../repositories/mysql');

function normalizeArray(value) {
  if (Array.isArray(value)) return value.filter((item) => item !== null && item !== undefined && item !== '');
  if (value == null || value === '') return [];
  return [value];
}

async function findUserByIdOrPublicId(tenantId, id) {
  if (id == null || id === '') return null;
  const rows = await query(
    `
      SELECT _id, public_id, name, email, role
      FROM users
      WHERE tenant_id = ?
        AND (_id = ? OR public_id = ?)
      LIMIT 1
    `,
    [tenantId, id, String(id)]
  );
  return rows[0] || null;
}

async function getTeamRows(tenantId, teamId = null) {
  const params = [tenantId];
  let teamClause = '';
  if (teamId) {
    teamClause = 'AND t.id = ?';
    params.push(teamId);
  }

  return query(
    `
      SELECT
        t.id,
        t.team_name,
        t.description,
        t.team_lead_id,
        t.status,
        t.created_by,
        t.created_at,
        t.updated_at,
        u.public_id AS lead_public_id,
        u.name AS lead_name,
        u.email AS lead_email,
        tm.user_id AS member_user_id,
        um.public_id AS member_public_id,
        um.name AS member_name,
        um.email AS member_email,
        tc.category_id,
        c.category_name
      FROM it_teams t
      LEFT JOIN users u ON u._id = t.team_lead_id
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users um ON um._id = tm.user_id
      LEFT JOIN team_categories tc ON tc.team_id = t.id
      LEFT JOIN categories c ON c.id = tc.category_id
      WHERE t.tenant_id = ?
        ${teamClause}
      ORDER BY t.team_name ASC
    `,
    params
  );
}

function mapTeams(rows = []) {
  const teams = new Map();

  rows.forEach((row) => {
    if (!teams.has(row.id)) {
      teams.set(row.id, {
        id: row.id,
        teamName: row.team_name,
        description: row.description,
        teamLead: row.team_lead_id
          ? {
            id: row.lead_public_id || row.team_lead_id,
            internalId: row.team_lead_id,
            publicId: row.lead_public_id || null,
            name: row.lead_name || null,
            email: row.lead_email || null,
          }
          : null,
        status: row.status,
        createdBy: row.created_by || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        members: [],
        categories: [],
      });
    }

    const team = teams.get(row.id);
    if (row.member_user_id) {
      const exists = team.members.some((member) => Number(member.internalId) === Number(row.member_user_id));
      if (!exists) {
        team.members.push({
          id: row.member_public_id || row.member_user_id,
          internalId: row.member_user_id,
          publicId: row.member_public_id || null,
          name: row.member_name || null,
          email: row.member_email || null,
        });
      }
    }

    if (row.category_id) {
      const hasCategory = team.categories.some((category) => Number(category.id) === Number(row.category_id));
      if (!hasCategory) {
        team.categories.push({
          id: row.category_id,
          name: row.category_name || null,
        });
      }
    }
  });

  return Array.from(teams.values());
}

async function listTeams(tenantId, filters = {}) {
  const params = [tenantId];
  const where = ['t.tenant_id = ?'];

  if (filters.status) {
    where.push('UPPER(t.status) = ?');
    params.push(String(filters.status).trim().toUpperCase());
  }

  if (filters.teamLeadId) {
    where.push('(t.team_lead_id = ? OR u.public_id = ?)');
    params.push(filters.teamLeadId, String(filters.teamLeadId));
  }

  const rows = await query(
    `
      SELECT
        t.id,
        t.team_name,
        t.description,
        t.team_lead_id,
        t.status,
        t.created_by,
        t.created_at,
        t.updated_at,
        u.public_id AS lead_public_id,
        u.name AS lead_name,
        u.email AS lead_email,
        tm.user_id AS member_user_id,
        um.public_id AS member_public_id,
        um.name AS member_name,
        um.email AS member_email,
        tc.category_id,
        c.category_name
      FROM it_teams t
      LEFT JOIN users u ON u._id = t.team_lead_id
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN users um ON um._id = tm.user_id
      LEFT JOIN team_categories tc ON tc.team_id = t.id
      LEFT JOIN categories c ON c.id = tc.category_id
      WHERE ${where.join(' AND ')}
      ORDER BY t.team_name ASC
    `,
    params
  );

  return mapTeams(rows);
}

async function getTeamById(tenantId, teamId) {
  const rows = await getTeamRows(tenantId, teamId);
  const teams = mapTeams(rows);
  return teams[0] || null;
}

async function createTeam(tenantId, payload, user) {
  const teamName = String(payload.teamName || payload.team_name || '').trim();
  if (!teamName) throw new HttpError(400, 'teamName is required', 'TEAM_NAME_REQUIRED');

  const description = payload.description ? String(payload.description).trim() : null;
  const status = String(payload.status || 'ACTIVE').trim().toUpperCase();
  const teamLeadInput = payload.teamLeadId || payload.team_lead_id || null;
  const members = normalizeArray(payload.members || payload.memberIds || payload.member_ids);
  const categories = normalizeArray(payload.categoryIds || payload.category_ids);

  const teamLead = teamLeadInput ? await findUserByIdOrPublicId(tenantId, teamLeadInput) : null;
  if (teamLeadInput && !teamLead) throw new HttpError(404, 'Team lead not found', 'TEAM_LEAD_NOT_FOUND');

  const duplicate = await query(
    `
      SELECT id
      FROM it_teams
      WHERE tenant_id = ? AND team_name = ?
      LIMIT 1
    `,
    [tenantId, teamName]
  );
  if (duplicate.length) throw new HttpError(409, 'Team name already exists', 'TEAM_EXISTS');

  const teamId = await withTransaction(async (tx) => {
    const result = await tx.query(
      `
        INSERT INTO it_teams
          (tenant_id, team_name, description, team_lead_id, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [tenantId, teamName, description, teamLead ? teamLead._id : null, status, user?._id || null]
    );

    const memberIds = members.length ? members : (teamLead ? [teamLead._id] : []);
    for (const memberId of memberIds) {
      const member = await findUserByIdOrPublicId(tenantId, memberId);
      if (!member) throw new HttpError(404, 'Team member not found', 'TEAM_MEMBER_NOT_FOUND');
      await tx.query(
        `INSERT IGNORE INTO team_members (tenant_id, team_id, user_id) VALUES (?, ?, ?)`,
        [tenantId, result.insertId, member._id]
      );
    }

    for (const categoryId of categories) {
      await tx.query(
        `INSERT IGNORE INTO team_categories (tenant_id, team_id, category_id) VALUES (?, ?, ?)`,
        [tenantId, result.insertId, Number(categoryId)]
      );
    }

    await auditLogger.logAudit({
      action: 'IT_TEAM_CREATED',
      tenant_id: tenantId,
      actor_id: user?._id || null,
      entity: 'ITTeam',
      entity_id: String(result.insertId),
      module: 'Ticketing',
      details: { teamName, teamLeadId: teamLead ? teamLead.public_id || teamLead._id : null },
    });

    return result.insertId;
  });

  return getTeamById(tenantId, teamId);
}

async function updateTeam(tenantId, teamId, payload, user) {
  const existing = await getTeamById(tenantId, teamId);
  if (!existing) throw new HttpError(404, 'Team not found', 'TEAM_NOT_FOUND');

  const teamName = payload.teamName || payload.team_name ? String(payload.teamName || payload.team_name).trim() : existing.teamName;
  const description = payload.description !== undefined ? (payload.description ? String(payload.description).trim() : null) : existing.description;
  const status = payload.status ? String(payload.status).trim().toUpperCase() : existing.status;
  const teamLeadInput = payload.teamLeadId || payload.team_lead_id || (existing.teamLead ? existing.teamLead.internalId : null);
  const members = payload.members !== undefined || payload.memberIds !== undefined || payload.member_ids !== undefined
    ? normalizeArray(payload.members || payload.memberIds || payload.member_ids)
    : null;
  const categories = payload.categoryIds !== undefined || payload.category_ids !== undefined
    ? normalizeArray(payload.categoryIds || payload.category_ids)
    : null;

  const teamLead = teamLeadInput ? await findUserByIdOrPublicId(tenantId, teamLeadInput) : null;
  if (teamLeadInput && !teamLead) throw new HttpError(404, 'Team lead not found', 'TEAM_LEAD_NOT_FOUND');

  const duplicate = await query(
    `
      SELECT id
      FROM it_teams
      WHERE tenant_id = ? AND id <> ? AND team_name = ?
      LIMIT 1
    `,
    [tenantId, teamId, teamName]
  );
  if (duplicate.length) throw new HttpError(409, 'Team name already exists', 'TEAM_EXISTS');

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE it_teams
        SET team_name = ?, description = ?, team_lead_id = ?, status = ?, updated_at = NOW()
        WHERE tenant_id = ? AND id = ?
      `,
      [teamName, description, teamLead ? teamLead._id : null, status, tenantId, teamId]
    );

    if (members) {
      await tx.query(`DELETE FROM team_members WHERE team_id = ? AND tenant_id = ?`, [teamId, tenantId]);
      for (const memberId of members) {
        const member = await findUserByIdOrPublicId(tenantId, memberId);
        if (!member) throw new HttpError(404, 'Team member not found', 'TEAM_MEMBER_NOT_FOUND');
        await tx.query(
          `INSERT IGNORE INTO team_members (tenant_id, team_id, user_id) VALUES (?, ?, ?)`,
          [tenantId, teamId, member._id]
        );
      }
    }

    if (categories) {
      await tx.query(`DELETE FROM team_categories WHERE team_id = ? AND tenant_id = ?`, [teamId, tenantId]);
      for (const categoryId of categories) {
        await tx.query(
          `INSERT IGNORE INTO team_categories (tenant_id, team_id, category_id) VALUES (?, ?, ?)`,
          [tenantId, teamId, Number(categoryId)]
        );
      }
    }

    await auditLogger.logAudit({
      action: 'IT_TEAM_UPDATED',
      tenant_id: tenantId,
      actor_id: user?._id || null,
      entity: 'ITTeam',
      entity_id: String(teamId),
      module: 'Ticketing',
      previous_value: existing,
      new_value: { teamName, description, status },
    });
  });

  return getTeamById(tenantId, teamId);
}

async function deleteTeam(tenantId, teamId, user) {
  const existing = await getTeamById(tenantId, teamId);
  if (!existing) throw new HttpError(404, 'Team not found', 'TEAM_NOT_FOUND');

  await query(`DELETE FROM it_teams WHERE tenant_id = ? AND id = ?`, [tenantId, teamId]);

  await auditLogger.logAudit({
    action: 'IT_TEAM_DELETED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'ITTeam',
    entity_id: String(teamId),
    module: 'Ticketing',
    previous_value: existing,
  });

  return { id: Number(teamId), deleted: true };
}

async function listMembers(tenantId, teamId) {
  const rows = await query(
    `
      SELECT tm.user_id, u.public_id, u.name, u.email
      FROM team_members tm
      LEFT JOIN users u ON u._id = tm.user_id
      WHERE tm.tenant_id = ? AND tm.team_id = ?
      ORDER BY u.name ASC
    `,
    [tenantId, teamId]
  );
  return rows.map((row) => ({
    id: row.public_id || row.user_id,
    internalId: row.user_id,
    publicId: row.public_id || null,
    name: row.name || null,
    email: row.email || null,
  }));
}

async function addMembers(tenantId, teamId, payload, user) {
  const members = normalizeArray(payload.members || payload.memberIds || payload.member_ids);
  if (!members.length) throw new HttpError(400, 'members are required', 'TEAM_MEMBERS_REQUIRED');

  for (const memberId of members) {
    const member = await findUserByIdOrPublicId(tenantId, memberId);
    if (!member) throw new HttpError(404, 'Team member not found', 'TEAM_MEMBER_NOT_FOUND');
    await query(
      `INSERT IGNORE INTO team_members (tenant_id, team_id, user_id) VALUES (?, ?, ?)`,
      [tenantId, teamId, member._id]
    );
  }

  await auditLogger.logAudit({
    action: 'IT_TEAM_MEMBERS_ADDED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'ITTeam',
    entity_id: String(teamId),
    module: 'Ticketing',
    details: { members },
  });

  return listMembers(tenantId, teamId);
}

async function removeMember(tenantId, teamId, userId, user) {
  const member = await findUserByIdOrPublicId(tenantId, userId);
  if (!member) throw new HttpError(404, 'Team member not found', 'TEAM_MEMBER_NOT_FOUND');

  await query(
    `DELETE FROM team_members WHERE tenant_id = ? AND team_id = ? AND user_id = ?`,
    [tenantId, teamId, member._id]
  );

  await auditLogger.logAudit({
    action: 'IT_TEAM_MEMBER_REMOVED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'ITTeam',
    entity_id: String(teamId),
    module: 'Ticketing',
    details: { userId: member.public_id || member._id },
  });

  return listMembers(tenantId, teamId);
}

async function updateTeamLead(tenantId, teamId, payload, user) {
  const leadInput = payload.teamLeadId || payload.team_lead_id;
  if (!leadInput) throw new HttpError(400, 'teamLeadId is required', 'TEAM_LEAD_REQUIRED');

  const lead = await findUserByIdOrPublicId(tenantId, leadInput);
  if (!lead) throw new HttpError(404, 'Team lead not found', 'TEAM_LEAD_NOT_FOUND');

  await query(
    `UPDATE it_teams SET team_lead_id = ?, updated_at = NOW() WHERE tenant_id = ? AND id = ?`,
    [lead._id, tenantId, teamId]
  );

  await auditLogger.logAudit({
    action: 'IT_TEAM_LEAD_UPDATED',
    tenant_id: tenantId,
    actor_id: user?._id || null,
    entity: 'ITTeam',
    entity_id: String(teamId),
    module: 'Ticketing',
    details: { teamLeadId: lead.public_id || lead._id },
  });

  return getTeamById(tenantId, teamId);
}

module.exports = {
  listTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  listMembers,
  addMembers,
  removeMember,
  updateTeamLead,
};
