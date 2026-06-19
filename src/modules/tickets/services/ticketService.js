const validator = require('validator');
const HttpError = require('../../../errors/HttpError');
const logger = require('../../../logger');
const auditLogger = require('../../../services/auditLogger');
const { query, withTransaction } = require('../repositories/mysql');
const userRepository = require('../repositories/userRepository');
const { saveAttachment } = require('../helpers/attachmentStorage');
const {
  normalizeTicketStatus,
  normalizePriority,
  normalizeCommentType,
  safeJsonParse,
  safeJsonStringify,
  asArray,
  normalizeTicketRoleKey,
  buildPermissionSet,
  allowedStatusTransitions,
  isInternalCommentVisibleToUser,
} = require('../helpers/ticketUtils');
const { computeDueDates, autoAssignTicket, dispatchTicketNotifications } = require('./ticketAutomationService');
const { TICKET_ROLE_KEYS } = require('../constants');
const ticketActivityService = require('./ticketActivityService');

const ACTIVE_TICKET_STATUSES = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'REOPENED'];

const baseTicketSelect = `
  SELECT
    t.*,
    requester.public_id AS requester_public_id,
    requester.name AS requester_name,
    requester.email AS requester_user_email,
    requested_for.public_id AS requested_for_public_id,
    requested_for.name AS requested_for_name,
    requested_for.email AS requested_for_email,
    creator.public_id AS created_by_public_id,
    creator.name AS created_by_name,
    creator.email AS created_by_email,
    assigned.public_id AS assigned_to_public_id,
    assigned.name AS assigned_to_name,
    assigned.email AS assigned_to_email,
    escalated.public_id AS escalated_to_public_id,
    escalated.name AS escalated_to_name,
    escalated.email AS escalated_to_email,
    c.category_name,
    c.category_code,
    s.subcategory_name
  FROM tickets t
  LEFT JOIN users requester ON requester._id = t.requester_user_id
  LEFT JOIN users requested_for ON requested_for._id = t.requested_for_user_id
  LEFT JOIN users creator ON creator._id = t.created_by_user_id
  LEFT JOIN users assigned ON assigned._id = t.assigned_to
  LEFT JOIN users escalated ON escalated._id = t.escalated_to_user_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN subcategories s ON s.id = t.subcategory_id
`;

function detectPriority(subject = '', description = '') {
  const text = `${subject} ${description}`.toLowerCase();
  if (/\b(critical|sev1|p1|outage|production down|security incident)\b/.test(text)) return 'CRITICAL';
  if (/\b(high|urgent|sev2|p2|asap)\b/.test(text)) return 'HIGH';
  if (/\b(low|minor|no rush)\b/.test(text)) return 'LOW';
  return 'MEDIUM';
}

function mapTicketRow(row) {
  if (!row) return null;

  const ticket = {
    id: row.id,
    ticketId: row.ticket_id,
    ticket_id: row.ticket_id,
    subject: row.title,
    title: row.title,
    description: row.description,
    department: row.department,
    status: normalizeTicketStatus(row.status, 'OPEN'),
    priority: normalizePriority(row.priority, 'MEDIUM'),
    assignedQueue: row.assigned_queue || 'IT Support',
    assigned_queue: row.assigned_queue || 'IT Support',
    source: row.source || 'api',
    sourceMessageId: row.source_message_id || null,
    source_message_id: row.source_message_id || null,
    requester_email: row.requester_email,
    requester_email_raw: row.requester_email,
    requester_name: row.requester_name || row.requested_for_name || null,
    location: {
      stateId: row.state_id,
      regionId: row.region_id,
      clusterId: row.cluster_id,
      branchId: row.branch_id,
    },
    category: row.category_id ? {
      id: row.category_id,
      name: row.category_name,
      code: row.category_code,
    } : null,
    subcategory: row.subcategory_id ? {
      id: row.subcategory_id,
      name: row.subcategory_name,
    } : null,
    categoryId: row.category_id || null,
    subcategoryId: row.subcategory_id || null,
    ccRecipients: safeJsonParse(row.cc_recipients_json, []),
    requestedFor: row.requested_for_user_id ? {
      id: row.requested_for_public_id || row.requested_for_user_id,
      internalId: row.requested_for_user_id,
      publicId: row.requested_for_public_id || null,
      name: row.requested_for_name || null,
      email: row.requested_for_email || row.requester_email,
    } : null,
    requested_for_user_id: row.requested_for_user_id || null,
    requesterUser: row.requester_user_id ? {
      id: row.requester_public_id || row.requester_user_id,
      internalId: row.requester_user_id,
      publicId: row.requester_public_id || null,
      name: row.requester_name || null,
      email: row.requester_user_email || row.requester_email,
    } : null,
    requester_user_id: row.requester_user_id || null,
    createdBy: row.created_by_user_id ? {
      id: row.created_by_public_id || row.created_by_user_id,
      internalId: row.created_by_user_id,
      publicId: row.created_by_public_id || null,
      name: row.created_by_name || null,
      email: row.created_by_email || null,
    } : null,
    created_by_user_id: row.created_by_user_id || null,
    assignee: row.assigned_to ? {
      id: row.assigned_to_public_id || row.assigned_to,
      internalId: row.assigned_to,
      publicId: row.assigned_to_public_id || null,
      name: row.assigned_to_name || null,
      email: row.assigned_to_email || null,
    } : null,
    assigned_to: row.assigned_to || null,
    assignedTeamId: row.assigned_team_id || null,
    assigned_team_id: row.assigned_team_id || null,
    escalatedTo: row.escalated_to_user_id ? {
      id: row.escalated_to_public_id || row.escalated_to_user_id,
      internalId: row.escalated_to_user_id,
      publicId: row.escalated_to_public_id || null,
      name: row.escalated_to_name || null,
      email: row.escalated_to_email || null,
    } : null,
    escalated_to_user_id: row.escalated_to_user_id || null,
    isDraft: Boolean(row.is_draft),
    is_draft: Boolean(row.is_draft),
    currentEscalationLevel: Number(row.current_escalation_level || 0),
    current_escalation_level: Number(row.current_escalation_level || 0),
    assignmentMode: row.assignment_mode || null,
    assignmentReason: row.assignment_reason || null,
    workloadSnapshot: row.workload_snapshot == null ? null : Number(row.workload_snapshot),
    resolutionNotes: row.resolution_notes || null,
    resolution_notes: row.resolution_notes || null,
    reopenedCount: Number(row.reopened_count || 0),
    reopened_count: Number(row.reopened_count || 0),
    responseDueAt: row.response_due_at || null,
    resolutionDueAt: row.resolution_due_at || null,
    escalationDueAt: row.escalation_due_at || null,
    nextEscalationAt: row.next_escalation_at || null,
    assignedAt: row.assigned_at || null,
    respondedAt: row.responded_at || null,
    resolvedAt: row.resolved_at || null,
    closedAt: row.closed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActivityAt: row.last_activity_at || row.updated_at || row.created_at,
    lastStatusChangeAt: row.last_status_change_at || row.updated_at || row.created_at,
    workStartAt: row.work_start_at || null,
    work_start_at: row.work_start_at || null,
    workDurationSeconds: row.work_duration_seconds == null ? 0 : Number(row.work_duration_seconds),
    work_duration_seconds: row.work_duration_seconds == null ? 0 : Number(row.work_duration_seconds),
    holdDurationSeconds: row.hold_duration_seconds == null ? 0 : Number(row.hold_duration_seconds),
    hold_duration_seconds: row.hold_duration_seconds == null ? 0 : Number(row.hold_duration_seconds),
    resolutionDurationSeconds: row.resolution_duration_seconds == null ? null : Number(row.resolution_duration_seconds),
    resolution_duration_seconds: row.resolution_duration_seconds == null ? null : Number(row.resolution_duration_seconds),
    closureDurationSeconds: row.closure_duration_seconds == null ? null : Number(row.closure_duration_seconds),
    closure_duration_seconds: row.closure_duration_seconds == null ? null : Number(row.closure_duration_seconds),
    holdReason: row.hold_reason || null,
    hold_reason: row.hold_reason || null,
    holdRemarks: row.hold_remarks || null,
    hold_remarks: row.hold_remarks || null,
    resolutionSummary: row.resolution_summary || null,
    resolution_summary: row.resolution_summary || null,
    closureRemarks: row.closure_remarks || null,
    closure_remarks: row.closure_remarks || null,
  };

  ticket.tenant_id = row.tenant_id;
  ticket.requested_for_email = ticket.requestedFor?.email || row.requester_email || null;
  ticket.assigned_to_email = ticket.assignee?.email || null;
  ticket.created_by_email = ticket.createdBy?.email || null;

  return ticket;
}

async function findUserByIdOrPublicId(tenantId, id, txQuery = query) {
  if (id == null || id === '') return null;
  const rows = await txQuery(
    `
      SELECT _id, public_id, name, email, role, tenant_id
      FROM users
      WHERE tenant_id = ?
        AND (_id = ? OR public_id = ?)
      LIMIT 1
    `,
    [tenantId, id, String(id)]
  );
  return rows[0] || null;
}

async function resolveActorUser(input, user) {
  if (user) return user;
  const email = input.requester_email || input.requesterEmail || input.author_email || input.authorEmail;
  if (!email || !validator.isEmail(String(email))) {
    throw new HttpError(400, 'A valid requester email is required', 'REQUESTER_EMAIL_INVALID');
  }
  const resolved = await userRepository.findOrCreateByEmail({
    email: validator.normalizeEmail(String(email)),
    name: input.requester_name || input.requesterName || input.author_name || input.authorName || null,
    source: input.source === 'email' ? 'email' : 'api',
  });
  return {
    _id: resolved.id,
    id: resolved.public_id || String(resolved.id),
    public_id: resolved.public_id || null,
    name: resolved.name,
    email: resolved.email,
    role: resolved.role || 'Employee',
    tenant_id: resolved.tenant_id || 1,
  };
}

async function getSlaPolicy(tenantId, priority, txQuery = query) {
  const rows = await txQuery(
    `
      SELECT *
      FROM ticket_sla_policies
      WHERE tenant_id = ?
        AND UPPER(priority) = ?
        AND is_active = 1
      LIMIT 1
    `,
    [tenantId, String(priority).trim().toUpperCase()]
  );
  return rows[0] || null;
}

async function validateCategorySelection(tenantId, categoryId, subcategoryId, txQuery = query) {
  if (!categoryId && !subcategoryId) return { category: null, subcategory: null };

  let category = null;
  if (categoryId) {
    const categoryRows = await txQuery(
      `
        SELECT id, category_name, category_code
        FROM categories
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `,
      [tenantId, categoryId]
    );
    category = categoryRows[0] || null;
    if (!category) throw new HttpError(400, 'categoryId is invalid', 'CATEGORY_INVALID');
  }

  let subcategory = null;
  if (subcategoryId) {
    const subcategoryRows = await txQuery(
      `
        SELECT id, category_id, subcategory_name
        FROM subcategories
        WHERE tenant_id = ? AND id = ?
        LIMIT 1
      `,
      [tenantId, subcategoryId]
    );
    subcategory = subcategoryRows[0] || null;
    if (!subcategory) throw new HttpError(400, 'subcategoryId is invalid', 'SUBCATEGORY_INVALID');
    if (category && Number(subcategory.category_id) !== Number(category.id)) {
      throw new HttpError(400, 'subcategoryId does not belong to categoryId', 'SUBCATEGORY_MISMATCH');
    }
  }

  return { category, subcategory };
}

async function getTicketRow(tenantId, id, txQuery = query) {
  const rows = await txQuery(
    `
      ${baseTicketSelect}
      WHERE t.tenant_id = ?
        AND (t.ticket_id = ? OR CAST(t.id AS CHAR) = ?)
      LIMIT 1
    `,
    [tenantId, String(id), String(id)]
  );

  return rows[0] || null;
}

async function getTicketOrThrow(tenantId, id, txQuery = query) {
  const row = await getTicketRow(tenantId, id, txQuery);
  if (!row) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  return row;
}

async function getComments(ticketId) {
  const rows = await query(
    `
      SELECT
        c.*,
        u.public_id AS author_public_id,
        u.name AS author_name,
        u.email AS author_user_email
      FROM ticket_comments c
      LEFT JOIN users u ON u._id = c.author_user_id
      WHERE c.ticket_id = ?
      ORDER BY c.created_at ASC, c.id ASC
    `,
    [ticketId]
  );
  return rows;
}

async function getAttachments(ticketId) {
  return query(
    `
      SELECT *
      FROM ticket_attachments
      WHERE ticket_id = ?
      ORDER BY created_at ASC, id ASC
    `,
    [ticketId]
  );
}

async function getHistory(ticketId) {
  return query(
    `
      SELECT
        h.*,
        u.public_id AS actor_public_id,
        u.name AS actor_name,
        u.email AS actor_email
      FROM ticket_history h
      LEFT JOIN users u ON u._id = h.actor_user_id
      WHERE h.ticket_id = ?
      ORDER BY h.created_at ASC, h.id ASC
    `,
    [ticketId]
  );
}

function mapAttachmentRow(row) {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    commentId: row.comment_id,
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
    storagePath: row.storage_path,
    checksumSha256: row.checksum_sha256,
    contentId: row.content_id,
    isInline: Boolean(row.is_inline),
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
  };
}

function mapCommentRow(row, attachments = [], role = null) {
  const commentType = normalizeCommentType(row.comment_type, 'PUBLIC');
  if (!isInternalCommentVisibleToUser(commentType, role)) return null;

  return {
    id: row.id,
    ticketId: row.ticket_id,
    commentType,
    body: row.body,
    source: row.source,
    sourceMessageId: row.source_message_id || null,
    mentions: safeJsonParse(row.mentions_json, []),
    author: {
      id: row.author_public_id || row.author_user_id || null,
      internalId: row.author_user_id || null,
      publicId: row.author_public_id || null,
      name: row.author_name || null,
      email: row.author_user_email || row.author_email || null,
    },
    attachments,
    createdAt: row.created_at,
  };
}

function mapHistoryRow(row) {
  return {
    id: row.id,
    action: row.action,
    fieldName: row.field_name,
    fromValue: row.from_value,
    toValue: row.to_value,
    notes: row.notes,
    actor: row.actor_public_id || row.actor_user_id ? {
      id: row.actor_public_id || row.actor_user_id,
      internalId: row.actor_user_id || null,
      publicId: row.actor_public_id || null,
      name: row.actor_name || null,
      email: row.actor_email || null,
    } : null,
    createdAt: row.created_at,
  };
}

async function hydrateTicket(row, user = null) {
  const ticket = mapTicketRow(row);
  const [commentRows, attachmentRows, historyRows] = await Promise.all([
    getComments(ticket.id),
    getAttachments(ticket.id),
    getHistory(ticket.id),
  ]);

  const attachmentsByComment = new Map();
  const topLevelAttachments = [];
  attachmentRows.forEach((rowItem) => {
    const attachment = mapAttachmentRow(rowItem);
    if (rowItem.comment_id) {
      if (!attachmentsByComment.has(rowItem.comment_id)) attachmentsByComment.set(rowItem.comment_id, []);
      attachmentsByComment.get(rowItem.comment_id).push(attachment);
    } else {
      topLevelAttachments.push(attachment);
    }
  });

  ticket.attachments = topLevelAttachments;
  ticket.comments = commentRows
    .map((commentRow) => mapCommentRow(commentRow, attachmentsByComment.get(commentRow.id) || [], user?.role))
    .filter(Boolean);
  ticket.history = historyRows.map(mapHistoryRow);

  return ticket;
}

function getPermissionContext(user) {
  const ticketRole = normalizeTicketRoleKey(user?.role);
  const permissions = buildPermissionSet(user?.role);
  return { ticketRole, permissions };
}

async function canAccessTicket(ticket, user) {
  const { ticketRole, permissions } = getPermissionContext(user);
  if (!ticketRole) return false;
  if (permissions.readAll) return true;

  const isDirectlyInvolved = [
    ticket.assigned_to,
    ticket.created_by_user_id,
    ticket.escalated_to_user_id,
    ticket.requested_for_user_id,
    ticket.requester_user_id
  ].some((value) => Number(value) === Number(user._id));

  if (isDirectlyInvolved) return true;

  const tenantId = user.tenant_id || 1;

  if (ticketRole === TICKET_ROLE_KEYS.REGIONAL_IT_MANAGER) {
    const mappings = await query(
      'SELECT state_id, region_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1',
      [tenantId, user._id]
    );
    const stateIds = mappings.map(m => m.state_id).filter(Boolean);
    const regionIds = mappings.map(m => m.region_id).filter(Boolean);

    return (
      (ticket.location?.stateId && stateIds.includes(Number(ticket.location.stateId))) ||
      (ticket.location?.regionId && regionIds.includes(Number(ticket.location.regionId)))
    );
  }

  if (ticketRole === TICKET_ROLE_KEYS.L2_ENGINEER) {
    const mappings = await query(
      'SELECT cluster_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1',
      [tenantId, user._id]
    );
    const clusterIds = mappings.map(m => m.cluster_id).filter(Boolean);

    return ticket.location?.clusterId && clusterIds.includes(Number(ticket.location.clusterId));
  }

  if (ticketRole === TICKET_ROLE_KEYS.L1_ENGINEER) {
    const mappings = await query(
      'SELECT branch_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1',
      [tenantId, user._id]
    );
    const branchIds = mappings.map(m => m.branch_id).filter(Boolean);

    return ticket.location?.branchId && branchIds.includes(Number(ticket.location.branchId));
  }

  return false;
}

async function assertTicketAccess(ticket, user) {
  if (!(await canAccessTicket(ticket, user))) {
    throw new HttpError(403, 'Not allowed to access this ticket', 'TICKET_ACCESS_FORBIDDEN');
  }
}

async function buildScopeWhere(user) {
  const { ticketRole, permissions } = getPermissionContext(user);
  if (!ticketRole) {
    throw new HttpError(403, 'Ticket role not configured', 'TICKET_ROLE_FORBIDDEN');
  }

  if (permissions.readAll) {
    return { where: [], params: [] };
  }

  const tenantId = user.tenant_id || 1;

  const directConditions = [
    't.assigned_to = ?',
    't.created_by_user_id = ?',
    't.escalated_to_user_id = ?',
    't.requested_for_user_id = ?',
    't.requester_user_id = ?'
  ];
  const directParams = [user._id, user._id, user._id, user._id, user._id];

  if (ticketRole === TICKET_ROLE_KEYS.REGIONAL_IT_MANAGER) {
    const mappings = await query(
      'SELECT state_id, region_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1',
      [tenantId, user._id]
    );
    const stateIds = mappings.map(m => m.state_id).filter(Boolean);
    const regionIds = mappings.map(m => m.region_id).filter(Boolean);

    const conditions = [...directConditions];
    const params = [...directParams];

    if (stateIds.length > 0) {
      conditions.push(`t.state_id IN (${stateIds.map(() => '?').join(',')})`);
      params.push(...stateIds);
    }
    if (regionIds.length > 0) {
      conditions.push(`t.region_id IN (${regionIds.map(() => '?').join(',')})`);
      params.push(...regionIds);
    }

    return {
      where: [`(${conditions.join(' OR ')})`],
      params
    };
  }

  if (ticketRole === TICKET_ROLE_KEYS.L2_ENGINEER) {
    const mappings = await query(
      'SELECT cluster_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1',
      [tenantId, user._id]
    );
    const clusterIds = mappings.map(m => m.cluster_id).filter(Boolean);

    const conditions = [...directConditions];
    const params = [...directParams];

    if (clusterIds.length > 0) {
      conditions.push(`t.cluster_id IN (${clusterIds.map(() => '?').join(',')})`);
      params.push(...clusterIds);
    }

    return {
      where: [`(${conditions.join(' OR ')})`],
      params
    };
  }

  if (ticketRole === TICKET_ROLE_KEYS.L1_ENGINEER) {
    const mappings = await query(
      'SELECT branch_id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? AND is_active = 1',
      [tenantId, user._id]
    );
    const branchIds = mappings.map(m => m.branch_id).filter(Boolean);

    const conditions = [...directConditions];
    const params = [...directParams];

    if (branchIds.length > 0) {
      conditions.push(`t.branch_id IN (${branchIds.map(() => '?').join(',')})`);
      params.push(...branchIds);
    }

    return {
      where: [`(${conditions.join(' OR ')})`],
      params
    };
  }

  return {
    where: ['(t.requested_for_user_id = ? OR t.requester_user_id = ? OR t.created_by_user_id = ?)'],
    params: [user._id, user._id, user._id],
  };
}

function normalizeEmailList(value) {
  return asArray(value)
    .map((item) => String(item || '').trim())
    .filter((item) => item && validator.isEmail(item))
    .map((item) => validator.normalizeEmail(item));
}

function normalizeLocation(payload = {}) {
  const location = payload.location || {};
  const toId = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
  };
  return {
    stateId: toId(payload.stateId || payload.state_id || location.stateId || location.state_id),
    regionId: toId(payload.regionId || payload.region_id || location.regionId || location.region_id),
    clusterId: toId(payload.clusterId || payload.cluster_id || location.clusterId || location.cluster_id),
    branchId: toId(payload.branchId || payload.branch_id || location.branchId || location.branch_id),
  };
}

function normalizeLocationNames(payload = {}) {
  const location = payload.location || {};
  const pick = (...values) => {
    for (const value of values) {
      if (value == null) continue;
      const next = String(value).trim();
      if (next) return next;
    }
    return null;
  };

  return {
    stateName: pick(payload.stateName, payload.state, location.stateName, location.state),
    regionName: pick(payload.regionName, payload.region, location.regionName, location.region),
    clusterName: pick(payload.clusterName, payload.cluster, location.clusterName, location.cluster),
    branchName: pick(payload.branchName, payload.branch, location.branchName, location.branch),
  };
}

async function resolveLocationIdentifiers(tenantId, payload = {}, txQuery = query) {
  const resolved = normalizeLocation(payload);
  const names = normalizeLocationNames(payload);

  if (!resolved.stateId && names.stateName) {
    const stateRows = await txQuery(
      `SELECT id FROM states WHERE tenant_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?)) LIMIT 1`,
      [tenantId, names.stateName]
    );
    resolved.stateId = stateRows[0]?.id || null;
  }

  if (!resolved.regionId && names.regionName) {
    const params = [tenantId, names.regionName];
    const regionRows = await txQuery(
      `SELECT id, state_id FROM regions WHERE tenant_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?))${resolved.stateId ? ' AND state_id = ?' : ''} LIMIT 1`,
      resolved.stateId ? params.concat([resolved.stateId]) : params
    );
    resolved.regionId = regionRows[0]?.id || null;
    if (!resolved.stateId) resolved.stateId = regionRows[0]?.state_id || null;
  }

  if (!resolved.clusterId && names.clusterName) {
    const params = [tenantId, names.clusterName];
    const clusterRows = await txQuery(
      `SELECT id, region_id FROM clusters WHERE tenant_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?))${resolved.regionId ? ' AND region_id = ?' : ''} LIMIT 1`,
      resolved.regionId ? params.concat([resolved.regionId]) : params
    );
    resolved.clusterId = clusterRows[0]?.id || null;
    if (!resolved.regionId) resolved.regionId = clusterRows[0]?.region_id || null;
  }

  if (!resolved.branchId && names.branchName) {
    const params = [tenantId, names.branchName];
    const branchRows = await txQuery(
      `SELECT id, cluster_id FROM branches WHERE tenant_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?))${resolved.clusterId ? ' AND cluster_id = ?' : ''} LIMIT 1`,
      resolved.clusterId ? params.concat([resolved.clusterId]) : params
    );
    resolved.branchId = branchRows[0]?.id || null;
    if (!resolved.clusterId) resolved.clusterId = branchRows[0]?.cluster_id || null;
  }

  if (resolved.branchId && !resolved.clusterId) {
    const rows = await txQuery(`SELECT cluster_id FROM branches WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenantId, resolved.branchId]);
    resolved.clusterId = rows[0]?.cluster_id || null;
  }
  if (resolved.clusterId && !resolved.regionId) {
    const rows = await txQuery(`SELECT region_id FROM clusters WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenantId, resolved.clusterId]);
    resolved.regionId = rows[0]?.region_id || null;
  }
  if (resolved.regionId && !resolved.stateId) {
    const rows = await txQuery(`SELECT state_id FROM regions WHERE tenant_id = ? AND id = ? LIMIT 1`, [tenantId, resolved.regionId]);
    resolved.stateId = rows[0]?.state_id || null;
  }

  if ((names.stateName || names.regionName || names.clusterName || names.branchName) && !(resolved.stateId || resolved.regionId || resolved.clusterId || resolved.branchId)) {
    logger.warn('ticket location resolution failed from names', {
      tenantId,
      stateName: names.stateName,
      regionName: names.regionName,
      clusterName: names.clusterName,
      branchName: names.branchName,
    });
  }

  return resolved;
}

async function persistAttachments(ticketId, ticketPublicId, attachments = [], commentId = null, txQuery) {
  for (const attachment of attachments) {
    const stored = await saveAttachment(attachment, { ticketPublicId });
    await txQuery(
      `
        INSERT INTO ticket_attachments
          (ticket_id, comment_id, file_name, content_type, size_bytes, storage_path, checksum_sha256, content_id, is_inline, source_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ticketId,
        commentId,
        stored.file_name,
        stored.content_type,
        stored.size_bytes,
        stored.storage_path,
        stored.checksum_sha256,
        stored.content_id,
        Number(Boolean(stored.is_inline)),
        attachment.source_message_id || attachment.message_id || null,
      ]
    );
  }
}

async function writeHistory(txQuery, payload) {
  await txQuery(
    `
      INSERT INTO ticket_history
        (ticket_id, actor_user_id, action, field_name, from_value, to_value, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.ticketId,
      payload.actorUserId || null,
      payload.action,
      payload.fieldName || null,
      payload.fromValue == null ? null : String(payload.fromValue),
      payload.toValue == null ? null : String(payload.toValue),
      payload.notes || null,
    ]
  );
}

async function createTicket(input, user) {
  user = await resolveActorUser(input, user);
  const tenantId = user?.tenant_id;
  if (!tenantId) throw new HttpError(400, 'tenant_id is required for ticket creation', 'TENANT_REQUIRED');

  const { ticketRole, permissions } = getPermissionContext(user);
  if (!ticketRole || !permissions.create) throw new HttpError(403, 'Not allowed to create tickets', 'TICKET_CREATE_FORBIDDEN');

  const requestedForId = input.requestedFor || input.requested_for_user_id || user._id;
  const requestedForUser = await findUserByIdOrPublicId(tenantId, requestedForId);
  if (!requestedForUser) {
    throw new HttpError(404, 'requestedFor user not found', 'REQUESTED_FOR_NOT_FOUND');
  }

  if (ticketRole === TICKET_ROLE_KEYS.END_USER && Number(requestedForUser._id) !== Number(user._id)) {
    throw new HttpError(403, 'End users can only create tickets for themselves', 'TICKET_CREATE_SELF_ONLY');
  }

  const requesterEmail = input.requesterEmail || input.requester_email || requestedForUser.email || user.email;
  if (!requesterEmail || !validator.isEmail(String(requesterEmail))) {
    throw new HttpError(400, 'A valid requesterEmail is required', 'REQUESTER_EMAIL_INVALID');
  }

  const status = normalizeTicketStatus(input.status, input.saveAsDraft || input.isDraft ? 'DRAFT' : null)
    || (input.saveAsDraft || input.isDraft ? 'DRAFT' : 'OPEN');
  const isDraft = status === 'DRAFT';
  const subject = String(input.subject || input.title || 'IT Support Request').trim();
  const description = String(input.description || input.body || '').trim();
  if (!subject) throw new HttpError(400, 'subject is required', 'TICKET_SUBJECT_REQUIRED');
  if (!description && !isDraft) throw new HttpError(400, 'description is required', 'TICKET_DESCRIPTION_REQUIRED');

  const priority = normalizePriority(input.priority, null) || detectPriority(subject, description);
  const explicitAssigneeId = input.assignedTo || input.assigned_to || null;
  if (explicitAssigneeId && !permissions.assign) {
    throw new HttpError(403, 'Not allowed to assign tickets during creation', 'TICKET_ASSIGN_FORBIDDEN');
  }
  const explicitAssignee = explicitAssigneeId ? await findUserByIdOrPublicId(tenantId, explicitAssigneeId) : null;
  if (explicitAssigneeId && !explicitAssignee) {
    throw new HttpError(404, 'Assigned engineer not found', 'ASSIGNEE_NOT_FOUND');
  }
  const initialStatus = !isDraft && explicitAssignee && status === 'OPEN' ? 'ASSIGNED' : status;
  const location = await resolveLocationIdentifiers(tenantId, input);
  const rawCategoryId = input.categoryId || input.category_id || null;
  const rawSubcategoryId = input.subcategoryId || input.subcategory_id || null;
  const validatedCategorySelection = await validateCategorySelection(tenantId, rawCategoryId, rawSubcategoryId);
  const resolvedCategoryId =
    validatedCategorySelection?.category?.id ||
    validatedCategorySelection?.subcategory?.category_id ||
    rawCategoryId ||
    null;
  const resolvedSubcategoryId = validatedCategorySelection?.subcategory?.id || rawSubcategoryId || null;

  // Duplicate ticket validation
  let duplicateCheck = [];
  // Duplicate detection should be category-aware only. If category is not resolved,
  // do not force a synthetic category (like 0), which can cause false positives.
  if (resolvedCategoryId) {
    duplicateCheck = await query(
      `SELECT id, ticket_id, title, status, category_id, subcategory_id FROM tickets 
       WHERE tenant_id = ? 
         AND requester_user_id = ? 
         AND category_id = ? 
         AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'REOPENED')
       LIMIT 1`,
      [tenantId, requestedForUser._id, resolvedCategoryId]
    );
  }

  if (duplicateCheck && duplicateCheck.length > 0) {
    if (!input.overrideReason && !input.override_reason) {
      throw new HttpError(409, 'Duplicate ticket detected', 'DUPLICATE_TICKET_DETECTED', {
        existingTicketId: duplicateCheck[0].ticket_id,
        existingTicketTitle: duplicateCheck[0].title,
        existingTicketStatus: duplicateCheck[0].status,
        duplicateCategoryId: duplicateCheck[0].category_id,
        duplicateSubcategoryId: duplicateCheck[0].subcategory_id,
        requestedCategoryId: resolvedCategoryId,
        requestedSubcategoryId: resolvedSubcategoryId,
      });
    }
  }

  // Reopen workflow validation
  let reopenStatus = initialStatus;
  let reopenAssignee = explicitAssignee ? explicitAssignee._id : null;
  const referencedTicketId = input.referencedTicketId || input.referenced_ticket_id || null;

  if (referencedTicketId) {
    const oldTicket = await query(
      `SELECT id, ticket_id, status, assigned_to FROM tickets WHERE tenant_id = ? AND (id = ? OR ticket_id = ?) LIMIT 1`,
      [tenantId, referencedTicketId, String(referencedTicketId)]
    );
    if (!oldTicket || oldTicket.length === 0) {
      throw new HttpError(404, 'Referenced ticket not found', 'REFERENCED_TICKET_NOT_FOUND');
    }
    const ot = oldTicket[0];
    if (ot.status !== 'RESOLVED' && ot.status !== 'CLOSED') {
      throw new HttpError(400, 'Referenced ticket is not resolved or closed', 'REFERENCED_TICKET_NOT_RESOLVED_OR_CLOSED');
    }
    reopenStatus = 'REOPEN_REQUESTED';
    reopenAssignee = ot.assigned_to || reopenAssignee;
  }

  const ccRecipients = normalizeEmailList(input.ccRecipients || input.cc_recipients);
  const policy = await getSlaPolicy(tenantId, priority);
  const dueDates = isDraft ? {
    responseDueAt: null,
    resolutionDueAt: null,
    escalationDueAt: null,
    nextEscalationAt: null,
  } : computeDueDates(policy);

  const result = await withTransaction(async (tx) => {
    const pendingTicketId = `PENDING-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const insertResult = await tx.query(
      `
        INSERT INTO tickets
          (
            tenant_id,
            ticket_id,
            title,
            description,
            requester_user_id,
            requested_for_user_id,
            created_by_user_id,
            requester_email,
            status,
            priority,
            assigned_to,
            assigned_queue,
            module,
            source,
            source_message_id,
            department,
            state_id,
            region_id,
            cluster_id,
            branch_id,
            category_id,
            subcategory_id,
            cc_recipients_json,
            response_due_at,
            resolution_due_at,
            escalation_due_at,
            next_escalation_at,
            last_activity_at,
            last_status_change_at,
            is_draft,
            referenced_ticket_id,
            override_reason
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?)
      `,
      [
        tenantId,
        pendingTicketId,
        subject,
        description || '(No description provided)',
        user._id,
        requestedForUser._id,
        user._id,
        validator.normalizeEmail(String(requesterEmail)),
        reopenStatus,
        priority,
        reopenAssignee,
        'IT Support',
        'ticketing',
        input.source || 'api',
        input.source_message_id || input.message_id || null,
        input.department || null,
        location.stateId,
        location.regionId,
        location.clusterId,
        location.branchId,
        resolvedCategoryId,
        resolvedSubcategoryId,
        safeJsonStringify(ccRecipients, '[]'),
        dueDates.responseDueAt,
        dueDates.resolutionDueAt,
        dueDates.escalationDueAt,
        dueDates.nextEscalationAt,
        Number(isDraft),
        referencedTicketId ? (typeof referencedTicketId === 'number' ? referencedTicketId : null) : null,
        input.overrideReason || input.override_reason || null,
      ]
    );

    const publicTicketId = `TCK-${String(insertResult.insertId).padStart(6, '0')}`;
    await tx.query(`UPDATE tickets SET ticket_id = ? WHERE id = ?`, [publicTicketId, insertResult.insertId]);

    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    await persistAttachments(insertResult.insertId, publicTicketId, attachments, null, tx.query);

    await writeHistory(tx.query, {
      ticketId: insertResult.insertId,
      actorUserId: user._id,
      action: isDraft ? 'DRAFT_SAVED' : 'TICKET_CREATED',
      notes: isDraft ? 'Draft saved' : 'Ticket created',
    });

    await ticketActivityService.logActivity({
      ticketId: insertResult.insertId,
      action: isDraft ? 'DRAFT_SAVED' : 'CREATED',
      oldValue: null,
      newValue: isDraft ? 'DRAFT' : 'OPEN',
      performedBy: user._id,
      remarks: isDraft ? 'Draft saved' : 'Ticket created',
    }, tx.query);

    return {
      id: insertResult.insertId,
      publicTicketId,
    };
  });

  const createdRow = await getTicketOrThrow(tenantId, result.publicTicketId);
  let hydrated = await hydrateTicket(createdRow, user);

  await auditLogger.logAudit({
    action: isDraft ? 'TICKET_DRAFT_CREATED' : 'TICKET_CREATED',
    tenant_id: tenantId,
    actor_id: user._id,
    entity: 'Ticket',
    entity_id: hydrated.ticketId,
    module: 'Ticketing',
    details: {
      requestedFor: requestedForUser.public_id || requestedForUser._id,
      priority: hydrated.priority,
      categoryId: hydrated.categoryId,
      subcategoryId: hydrated.subcategoryId,
      isDraft,
    },
  });

  if (!isDraft) {
    const autoAssigned = await autoAssignTicket(createdRow, user);
    if (autoAssigned && autoAssigned.id) {
      const refreshed = await getTicketOrThrow(tenantId, result.publicTicketId);
      hydrated = await hydrateTicket(refreshed, user);
    }

    await dispatchTicketNotifications(hydrated, 'created', {
      message: `${hydrated.ticketId} created for ${hydrated.requestedFor?.name || hydrated.requester_email}`,
    });
    if (explicitAssignee) {
      await dispatchTicketNotifications(hydrated, 'assigned', {
        message: `${hydrated.ticketId} assigned to ${explicitAssignee.name}`,
      });
    }
  }

  return {
    duplicate: false,
    ticket: hydrated,
  };
}

async function updateDraft(id, input, user) {
  const tenantId = user?.tenant_id;
  const row = await getTicketOrThrow(tenantId, id);
  const ticket = mapTicketRow(row);

  if (!ticket.isDraft) throw new HttpError(400, 'Ticket is not a draft', 'TICKET_NOT_DRAFT');
  if (Number(ticket.created_by_user_id) !== Number(user._id)) {
    throw new HttpError(403, 'Only the draft creator can update this draft', 'DRAFT_UPDATE_FORBIDDEN');
  }

  const requestedForId = input.requestedFor || input.requested_for_user_id || ticket.requested_for_user_id;
  const requestedForUser = await findUserByIdOrPublicId(tenantId, requestedForId);
  if (!requestedForUser) throw new HttpError(404, 'requestedFor user not found', 'REQUESTED_FOR_NOT_FOUND');

  const requesterEmail = input.requesterEmail || input.requester_email || ticket.requester_email || requestedForUser.email;
  if (!validator.isEmail(String(requesterEmail || ''))) {
    throw new HttpError(400, 'A valid requesterEmail is required', 'REQUESTER_EMAIL_INVALID');
  }

  await validateCategorySelection(tenantId, input.categoryId || input.category_id || ticket.categoryId, input.subcategoryId || input.subcategory_id || ticket.subcategoryId);
  const location = await resolveLocationIdentifiers(tenantId, { ...ticket.location, ...input });
  const ccRecipients = input.ccRecipients || input.cc_recipients ? normalizeEmailList(input.ccRecipients || input.cc_recipients) : ticket.ccRecipients;

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET
          title = ?,
          description = ?,
          requested_for_user_id = ?,
          requester_email = ?,
          department = ?,
          state_id = ?,
          region_id = ?,
          cluster_id = ?,
          branch_id = ?,
          category_id = ?,
          subcategory_id = ?,
          cc_recipients_json = ?,
          last_activity_at = NOW()
        WHERE id = ? AND tenant_id = ? AND is_draft = 1
      `,
      [
        input.subject || input.title || ticket.subject,
        input.description || input.body || ticket.description,
        requestedForUser._id,
        validator.normalizeEmail(String(requesterEmail)),
        input.department !== undefined ? input.department : ticket.department,
        location.stateId,
        location.regionId,
        location.clusterId,
        location.branchId,
        input.categoryId || input.category_id || ticket.categoryId || null,
        input.subcategoryId || input.subcategory_id || ticket.subcategoryId || null,
        safeJsonStringify(ccRecipients, '[]'),
        ticket.id,
        tenantId,
      ]
    );

    const attachments = Array.isArray(input.attachments) ? input.attachments : [];
    if (attachments.length) {
      await persistAttachments(ticket.id, ticket.ticketId, attachments, null, tx.query);
    }

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user._id,
      action: 'DRAFT_UPDATED',
      notes: 'Draft updated',
    });
  });

  const refreshed = await getTicketOrThrow(tenantId, id);
  return hydrateTicket(refreshed, user);
}

async function listDrafts(user) {
  const rows = await query(
    `
      ${baseTicketSelect}
      WHERE t.tenant_id = ?
        AND t.is_draft = 1
        AND t.created_by_user_id = ?
      ORDER BY t.updated_at DESC
    `,
    [user.tenant_id, user._id]
  );

  return Promise.all(rows.map((row) => hydrateTicket(row, user)));
}

async function deleteDraft(id, user) {
  const row = await getTicketOrThrow(user.tenant_id, id);
  const ticket = mapTicketRow(row);
  if (!ticket.isDraft) throw new HttpError(400, 'Ticket is not a draft', 'TICKET_NOT_DRAFT');
  if (Number(ticket.created_by_user_id) !== Number(user._id)) {
    throw new HttpError(403, 'Only the draft creator can delete this draft', 'DRAFT_DELETE_FORBIDDEN');
  }

  await query(`DELETE FROM tickets WHERE id = ? AND tenant_id = ? AND is_draft = 1`, [ticket.id, user.tenant_id]);
  await auditLogger.logAudit({
    action: 'TICKET_DRAFT_DELETED',
    tenant_id: user.tenant_id,
    actor_id: user._id,
    entity: 'Ticket',
    entity_id: ticket.ticketId,
    module: 'Ticketing',
  });
  return { id: ticket.ticketId, deleted: true };
}

async function listTickets(filters, user) {
  const scope = await buildScopeWhere(user);
  const where = ['t.tenant_id = ?'].concat(scope.where);
  const params = [user.tenant_id].concat(scope.params);
  const includeDrafts = String(filters.includeDrafts || filters.include_drafts || 'false').toLowerCase() === 'true';

  if (!includeDrafts) {
    where.push('COALESCE(t.is_draft, 0) = 0');
  }

  if (filters.status) {
    const statuses = asArray(filters.status).map((item) => normalizeTicketStatus(item)).filter(Boolean);
    if (statuses.length === 1) {
      where.push('UPPER(t.status) = ?');
      params.push(statuses[0]);
    } else if (statuses.length > 1) {
      where.push(`UPPER(t.status) IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
  }

  if (filters.priority) {
    const priorities = asArray(filters.priority).map((item) => normalizePriority(item)).filter(Boolean);
    if (priorities.length === 1) {
      where.push('UPPER(t.priority) = ?');
      params.push(priorities[0]);
    } else if (priorities.length > 1) {
      where.push(`UPPER(t.priority) IN (${priorities.map(() => '?').join(',')})`);
      params.push(...priorities);
    }
  }

  const assignedFilter =
    filters.assignedEngineerId ||
    filters.assigned_engineer_id ||
    filters.assignedTo ||
    filters.assigned_to;

  if (assignedFilter) {
    where.push('(t.assigned_to = ? OR assigned.public_id = ?)');
    params.push(assignedFilter, String(assignedFilter));
  }

  if (filters.requestedFor || filters.requested_for_user_id) {
    where.push('(t.requested_for_user_id = ? OR requested_for.public_id = ?)');
    params.push(filters.requestedFor || filters.requested_for_user_id, String(filters.requestedFor || filters.requested_for_user_id));
  }

  if (filters.categoryId || filters.category_id) {
    where.push('t.category_id = ?');
    params.push(filters.categoryId || filters.category_id);
  }

  if (filters.subcategoryId || filters.subcategory_id) {
    where.push('t.subcategory_id = ?');
    params.push(filters.subcategoryId || filters.subcategory_id);
  }

  if (filters.search) {
    where.push(`(
      t.ticket_id LIKE ?
      OR t.title LIKE ?
      OR t.description LIKE ?
      OR requester.name LIKE ?
      OR requested_for.name LIKE ?
      OR assigned.name LIKE ?
    )`);
    const searchTerm = `%${String(filters.search).trim()}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }

  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const offset = Math.max(Number(filters.offset || 0), 0);

  const rows = await query(
    `
      ${baseTicketSelect}
      WHERE ${where.join(' AND ')}
      ORDER BY t.updated_at DESC, t.id DESC
      LIMIT ? OFFSET ?
    `,
    params.concat([limit, offset])
  );

  const totalRows = await query(
    `
      SELECT COUNT(*) AS total
      FROM tickets t
      LEFT JOIN users requester ON requester._id = t.requester_user_id
      LEFT JOIN users requested_for ON requested_for._id = t.requested_for_user_id
      LEFT JOIN users creator ON creator._id = t.created_by_user_id
      LEFT JOIN users assigned ON assigned._id = t.assigned_to
      WHERE ${where.join(' AND ')}
    `,
    params
  );

  const items = rows.map(mapTicketRow);
  return {
    items,
    total: Number(totalRows[0]?.total || 0),
    limit,
    offset,
  };
}

async function getDashboard(user, filters = {}) {
  const scope = await buildScopeWhere(user);
  // keep a version with ticket alias (t.) for queries that join other tables,
  // and an unaliased version for simple FROM tickets queries.
  const whereWithT = ['t.tenant_id = ?'].concat(scope.where);
  const params = [user.tenant_id].concat(scope.params);

  // Apply optional dashboard filters: category, state, region, engineer
  const f = filters || {};

  // Assigned engineer filter (accepts internal id or public_id)
  const assignedFilter = f.assignedEngineerId || f.assigned_engineer_id || f.assignedTo || f.assigned_to || f.engineer;
  if (assignedFilter) {
    // try to resolve to internal _id
    try {
      const assignee = await findUserByIdOrPublicId(user.tenant_id, assignedFilter);
      if (assignee && assignee._id) {
        whereWithT.push('t.assigned_to = ?');
        params.push(assignee._id);
      } else if (!Number.isNaN(Number(assignedFilter))) {
        whereWithT.push('t.assigned_to = ?');
        params.push(Number(assignedFilter));
      } else {
        // no matching assignee -> force empty result
        whereWithT.push('1 = 0');
      }
    } catch (e) {
      whereWithT.push('1 = 0');
    }
  }

  // Category filter (accept id or exact name)
  if (f.categoryId || f.category_id) {
    whereWithT.push('t.category_id = ?');
    params.push(f.categoryId || f.category_id);
  } else if (f.category) {
    whereWithT.push('t.category_id IN (SELECT id FROM categories WHERE tenant_id = ? AND UPPER(TRIM(category_name)) = UPPER(TRIM(?)))');
    params.push(user.tenant_id, String(f.category).trim());
  }

  // State filter (accept id or exact name)
  if (f.stateId || f.state_id) {
    whereWithT.push('t.state_id = ?');
    params.push(f.stateId || f.state_id);
  } else if (f.state) {
    whereWithT.push('t.state_id IN (SELECT id FROM states WHERE tenant_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?)))');
    params.push(user.tenant_id, String(f.state).trim());
  }

  // Region filter (accept id or exact name)
  if (f.regionId || f.region_id) {
    whereWithT.push('t.region_id = ?');
    params.push(f.regionId || f.region_id);
  } else if (f.region) {
    whereWithT.push('t.region_id IN (SELECT id FROM regions WHERE tenant_id = ? AND UPPER(TRIM(name)) = UPPER(TRIM(?)))');
    params.push(user.tenant_id, String(f.region).trim());
  }

  const whereNoAlias = whereWithT.map((item) => item.replace(/\bt\./g, ''));
  // summary counts
  const countsRows = await query(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN UPPER(status) = 'OPEN' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN UPPER(status) = 'ASSIGNED' THEN 1 ELSE 0 END) AS assigned_count,
        SUM(CASE WHEN UPPER(status) = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS in_progress_count,
        SUM(CASE WHEN UPPER(status) = 'PENDING_USER' THEN 1 ELSE 0 END) AS pending_user_count,
        SUM(CASE WHEN UPPER(status) = 'ON_HOLD' THEN 1 ELSE 0 END) AS on_hold_count,
        SUM(CASE WHEN UPPER(status) = 'RESOLVED' THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN UPPER(status) = 'CLOSED' THEN 1 ELSE 0 END) AS closed_count,
        SUM(CASE WHEN response_due_at IS NOT NULL AND responded_at IS NULL AND NOW() > response_due_at THEN 1 ELSE 0 END) AS response_breached_count,
        SUM(CASE WHEN resolution_due_at IS NOT NULL AND UPPER(status) NOT IN ('RESOLVED', 'CLOSED', 'DRAFT') AND NOW() > resolution_due_at THEN 1 ELSE 0 END) AS resolution_breached_count
      FROM tickets
      WHERE ${whereNoAlias.join(' AND ')}
        AND COALESCE(is_draft, 0) = 0
    `,
    params
  );

  const counts = countsRows[0] || {};

  const summary = {
    total: Number(counts.total || 0),
    open: Number(counts.open_count || 0),
    assigned: Number(counts.assigned_count || 0),
    inProgress: Number(counts.in_progress_count || 0),
    pendingUser: Number(counts.pending_user_count || 0),
    resolved: Number(counts.resolved_count || 0),
    closed: Number(counts.closed_count || 0),
    responseBreached: Number(counts.response_breached_count || 0),
    resolutionBreached: Number(counts.resolution_breached_count || 0),
  };

  // ticket status distribution (include ON_HOLD)
  const ticketStatusDistribution = {
    open: summary.open,
    inProgress: summary.inProgress,
    onHold: Number(counts.on_hold_count || 0),
    resolved: summary.resolved,
    closed: summary.closed,
  };

  // recent tickets (minimal shape for dashboard)
  const recentRows = await query(
    `
      ${baseTicketSelect}
      WHERE ${whereWithT.join(' AND ')}
        AND COALESCE(t.is_draft, 0) = 0
      ORDER BY t.created_at DESC
      LIMIT 10
    `,
    params
  );

  const recentTickets = (recentRows || []).map((r) => ({
    ticketId: r.ticket_id,
    title: r.title,
    status: normalizeTicketStatus(r.status, 'OPEN'),
    priority: normalizePriority(r.priority, 'MEDIUM'),
    createdBy: r.created_by_name || r.created_by_public_id || null,
    assignedTo: r.assigned_to_name || null,
    createdAt: r.created_at,
  }));

  // priority-wise counts
  const priorityRows = await query(
    `
      SELECT UPPER(COALESCE(priority, 'MEDIUM')) AS priority, COUNT(*) AS count
      FROM tickets
      WHERE ${whereNoAlias.join(' AND ')}
        AND COALESCE(is_draft, 0) = 0
      GROUP BY UPPER(COALESCE(priority, 'MEDIUM'))
    `,
    params
  );

  const priorityWise = {};
  (priorityRows || []).forEach((r) => {
    priorityWise[String(r.priority || 'MEDIUM').toLowerCase()] = Number(r.count || 0);
  });

  // category-wise counts
  const categoryRows = await query(
    `
      SELECT COALESCE(c.category_name, 'Uncategorized') AS category, COUNT(*) AS count
      FROM tickets t
      LEFT JOIN categories c ON c.id = t.category_id
      WHERE ${whereWithT.join(' AND ')}
        AND COALESCE(t.is_draft, 0) = 0
      GROUP BY COALESCE(c.category_name, 'Uncategorized')
    `,
    params
  );

  const categoryWise = {};
  (categoryRows || []).forEach((r) => {
    categoryWise[String(r.category || 'Uncategorized')] = Number(r.count || 0);
  });

  // SLA summary
  const breached = Number(counts.response_breached_count || 0) + Number(counts.resolution_breached_count || 0);
  const sla = {
    withinSLA: Math.max(0, summary.total - breached),
    breached,
  };

  // resolution trends (last 30 days) - resolved tickets per day
  const resolutionRows = await query(
    `
      SELECT DATE(t.resolved_at) AS date, COUNT(*) AS count
      FROM tickets t
      WHERE ${whereWithT.join(' AND ')}
        AND t.resolved_at IS NOT NULL
        AND t.resolved_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(t.resolved_at)
      ORDER BY DATE(t.resolved_at) ASC
    `,
    params
  );

  const resolutionTrends = (resolutionRows || []).length === 0
    ? { message: 'No chart data available', data: [] }
    : (resolutionRows || []).map((r) => ({ date: r.date, resolved: Number(r.count || 0) }));

  // recent ticket activity - last 10 history entries scoped to user
  const activityRows = await query(
    `
      SELECT
        h.action,
        h.field_name,
        h.from_value,
        h.to_value,
        h.notes,
        h.created_at,
        u.public_id AS actor_public_id,
        u.name AS actor_name,
        t.ticket_id
      FROM ticket_history h
      LEFT JOIN users u ON u._id = h.actor_user_id
      INNER JOIN tickets t ON t.id = h.ticket_id
      WHERE ${whereWithT.join(' AND ')}
      ORDER BY h.created_at DESC
      LIMIT 10
    `,
    params
  );

  const recentTicketActivityItems = (activityRows || []).map((a) => ({
    action: a.action,
    performedBy: a.actor_name || a.actor_public_id || null,
    timestamp: a.created_at,
    details: a.notes || (a.field_name ? `${a.field_name}: ${a.from_value || ''} -> ${a.to_value || ''}` : null),
    ticketId: a.ticket_id,
  }));

  const recentTicketActivity = (recentTicketActivityItems.length === 0)
    ? { headers: ['Action', 'Performed By', 'Timestamp', 'Details'], items: [], message: 'No activity found.' }
    : { headers: ['Action', 'Performed By', 'Timestamp', 'Details'], items: recentTicketActivityItems };

  return {
    summary,
    recentTickets,
    priorityWise,
    categoryWise,
    sla,
    ticketStatusDistribution,
    resolutionTrends,
    recentTicketActivity,
  };
}

async function getTicket(id, user) {
  const row = await getTicketOrThrow(user.tenant_id, id);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);
  return hydrateTicket(row, user);
}

async function updateTicket(id, input, user) {
  const tenantId = user.tenant_id;
  const existingRow = await getTicketOrThrow(tenantId, id);
  const existing = mapTicketRow(existingRow);
  await assertTicketAccess(existing, user);

  const { ticketRole, permissions } = getPermissionContext(user);
  if (!permissions.update) {
    const editableKeys = Object.keys(input || {}).filter((key) => input[key] !== undefined);
    const allowedKeys = new Set(['status']);
    const invalidKeys = editableKeys.filter((key) => !allowedKeys.has(key));
    if (invalidKeys.length) {
      throw new HttpError(403, 'Only ticket reopen is allowed for this role', 'TICKET_UPDATE_FORBIDDEN');
    }
  }

  const nextStatus = input.status !== undefined ? normalizeTicketStatus(input.status, null) : existing.status;
  if (input.status !== undefined && !nextStatus) {
    throw new HttpError(400, 'Invalid ticket status', 'INVALID_TICKET_STATUS');
  }

  if (input.status !== undefined) {
    const allowed = allowedStatusTransitions(ticketRole, existing.status);
    if (nextStatus !== existing.status && !allowed.includes(nextStatus)) {
      throw new HttpError(400, `Invalid status transition from ${existing.status} to ${nextStatus}`, 'INVALID_TICKET_STATUS_TRANSITION');
    }
  }

  if (!permissions.update && nextStatus !== 'REOPENED') {
    throw new HttpError(403, 'Only ticket reopen is allowed for this role', 'TICKET_REOPEN_ONLY');
  }

  const newPriority = input.priority !== undefined ? normalizePriority(input.priority, null) : existing.priority;
  if (input.priority !== undefined && !newPriority) {
    throw new HttpError(400, 'Invalid ticket priority', 'INVALID_TICKET_PRIORITY');
  }

  if ((input.assignedTo !== undefined || input.assigned_to !== undefined) && !permissions.assign) {
    throw new HttpError(403, 'Not allowed to assign tickets', 'TICKET_ASSIGN_FORBIDDEN');
  }

  const assignedToInput = input.assignedTo !== undefined ? input.assignedTo : input.assigned_to;
  const assignee = assignedToInput ? await findUserByIdOrPublicId(tenantId, assignedToInput) : null;
  if (assignedToInput && !assignee) {
    throw new HttpError(404, 'Assigned engineer not found', 'ASSIGNEE_NOT_FOUND');
  }

  const requestedForId = input.requestedFor || input.requested_for_user_id || existing.requested_for_user_id;
  const requestedForUser = await findUserByIdOrPublicId(tenantId, requestedForId);
  if (!requestedForUser) throw new HttpError(404, 'requestedFor user not found', 'REQUESTED_FOR_NOT_FOUND');

  const requesterEmail = input.requesterEmail || input.requester_email || existing.requester_email;
  if (!validator.isEmail(String(requesterEmail || ''))) {
    throw new HttpError(400, 'A valid requesterEmail is required', 'REQUESTER_EMAIL_INVALID');
  }

  await validateCategorySelection(
    tenantId,
    input.categoryId || input.category_id || existing.categoryId,
    input.subcategoryId || input.subcategory_id || existing.subcategoryId
  );

  const location = await resolveLocationIdentifiers(tenantId, {
    ...existing.location,
    ...input,
    location: { ...existing.location, ...(input.location || {}) },
  });
  const ccRecipients = input.ccRecipients || input.cc_recipients
    ? normalizeEmailList(input.ccRecipients || input.cc_recipients)
    : existing.ccRecipients;
  const categoryId = input.categoryId !== undefined || input.category_id !== undefined ? (input.categoryId || input.category_id || null) : existing.categoryId;
  const subcategoryId = input.subcategoryId !== undefined || input.subcategory_id !== undefined ? (input.subcategoryId || input.subcategory_id || null) : existing.subcategoryId;

  const now = new Date();
  let workStartAt = existing.workStartAt;
  let workDurationSeconds = existing.workDurationSeconds || 0;
  let holdDurationSeconds = existing.holdDurationSeconds || 0;
  let resolutionDurationSeconds = existing.resolutionDurationSeconds;
  let closureDurationSeconds = existing.closureDurationSeconds;

  if (nextStatus !== existing.status) {
    const lastChange = existing.lastStatusChangeAt ? new Date(existing.lastStatusChangeAt) : new Date(existing.createdAt);
    const delta = Math.max(0, Math.floor((now - lastChange) / 1000));

    if (existing.status === 'IN_PROGRESS') {
      workDurationSeconds += delta;
    }
    if (existing.status === 'ON_HOLD') {
      holdDurationSeconds += delta;
    }

    if (nextStatus === 'IN_PROGRESS') {
      if (!workStartAt) {
        workStartAt = now;
      }
    }
    if (nextStatus === 'RESOLVED') {
      if (!resolutionDurationSeconds) {
        const createdTime = new Date(existing.createdAt);
        resolutionDurationSeconds = Math.max(0, Math.floor((now - createdTime) / 1000));
      }
    }
    if (nextStatus === 'CLOSED') {
      if (!closureDurationSeconds) {
        const createdTime = new Date(existing.createdAt);
        closureDurationSeconds = Math.max(0, Math.floor((now - createdTime) / 1000));
      }
    }
  }

  // Mandatory fields check on status transitions
  if (nextStatus === 'ON_HOLD') {
    const holdReason = input.holdReason || input.hold_reason;
    const holdRemarks = input.holdRemarks || input.hold_remarks || input.remarks;
    if (!holdReason) {
      throw new HttpError(400, 'Hold reason is mandatory', 'HOLD_REASON_REQUIRED');
    }
    if (!holdRemarks || !String(holdRemarks).trim()) {
      throw new HttpError(400, 'Hold remarks are mandatory', 'HOLD_REMARKS_REQUIRED');
    }
  }
  if (nextStatus === 'RESOLVED') {
    const resSummary = input.resolutionSummary || input.resolution_summary || input.summary;
    const resNotes = input.resolutionNotes || input.resolution_notes || input.notes || input.resolution;
    if (!resSummary || !String(resSummary).trim()) {
      throw new HttpError(400, 'Resolution summary is mandatory', 'RESOLUTION_SUMMARY_REQUIRED');
    }
    if (!resNotes || !String(resNotes).trim()) {
      throw new HttpError(400, 'Resolution notes are mandatory', 'RESOLUTION_NOTES_REQUIRED');
    }
  }
  if (nextStatus === 'CLOSED') {
    const cloRemarks = input.closureRemarks || input.closure_remarks || input.remarks || input.feedback;
    if (!cloRemarks || !String(cloRemarks).trim()) {
      throw new HttpError(400, 'Closure remarks are mandatory', 'CLOSURE_REMARKS_REQUIRED');
    }
  }

  const updates = {
    title: input.subject !== undefined || input.title !== undefined ? String(input.subject || input.title || existing.subject).trim() : existing.subject,
    description: input.description !== undefined || input.body !== undefined ? String(input.description || input.body || existing.description).trim() : existing.description,
    requested_for_user_id: requestedForUser._id,
    requester_email: validator.normalizeEmail(String(requesterEmail)),
    department: input.department !== undefined ? input.department : existing.department,
    state_id: location.stateId,
    region_id: location.regionId,
    cluster_id: location.clusterId,
    branch_id: location.branchId,
    category_id: categoryId,
    subcategory_id: subcategoryId,
    cc_recipients_json: safeJsonStringify(ccRecipients, '[]'),
    priority: newPriority,
    status: nextStatus,
    assigned_to: assignee ? assignee._id : (assignedToInput === null || assignedToInput === '' ? null : existing.assigned_to),
    resolution_notes: input.resolutionNotes !== undefined || input.resolution_notes !== undefined || input.resolution !== undefined || input.notes !== undefined
      ? (input.resolutionNotes || input.resolution_notes || input.resolution || input.notes || null)
      : existing.resolutionNotes || null,
    work_start_at: workStartAt,
    work_duration_seconds: workDurationSeconds,
    hold_duration_seconds: holdDurationSeconds,
    resolution_duration_seconds: resolutionDurationSeconds,
    closure_duration_seconds: closureDurationSeconds,
    hold_reason: input.holdReason !== undefined ? input.holdReason : (input.hold_reason !== undefined ? input.hold_reason : (nextStatus === 'ON_HOLD' ? input.holdReason || input.hold_reason || null : existing.holdReason)),
    hold_remarks: input.holdRemarks !== undefined ? input.holdRemarks : (input.hold_remarks !== undefined ? input.hold_remarks : (input.remarks !== undefined ? input.remarks : (nextStatus === 'ON_HOLD' ? input.holdRemarks || input.hold_remarks || input.remarks || null : existing.holdRemarks))),
    resolution_summary: input.resolutionSummary !== undefined ? input.resolutionSummary : (input.resolution_summary !== undefined ? input.resolution_summary : (input.summary !== undefined ? input.summary : (nextStatus === 'RESOLVED' ? input.resolutionSummary || input.resolution_summary || input.summary || null : existing.resolutionSummary))),
    closure_remarks: input.closureRemarks !== undefined ? input.closureRemarks : (input.closure_remarks !== undefined ? input.closure_remarks : (input.remarks !== undefined ? input.remarks : (input.feedback !== undefined ? input.feedback : (nextStatus === 'CLOSED' ? input.closureRemarks || input.closure_remarks || input.remarks || input.feedback || null : existing.closureRemarks)))),
  };

  if (updates.assigned_to && updates.status === 'OPEN') {
    updates.status = 'ASSIGNED';
  }

  if (ACTIVE_TICKET_STATUSES.includes(updates.status) && !existing.respondedAt && ticketRole !== TICKET_ROLE_KEYS.END_USER) {
    updates.responded_at = new Date();
  }

  if (updates.status === 'RESOLVED') {
    updates.resolved_at = new Date();
  }
  if (updates.status === 'CLOSED') {
    updates.closed_at = new Date();
  }
  if (updates.status === 'REOPENED') {
    updates.closed_at = null;
    updates.resolved_at = null;
    updates.reopened_count = Number(existing.reopened_count || 0) + 1;
  }

  updates.last_activity_at = new Date();
  if (updates.status !== existing.status) {
    updates.last_status_change_at = new Date();
  }

  await withTransaction(async (tx) => {
    await tx.query(
      `
        UPDATE tickets
        SET
          title = ?,
          description = ?,
          requested_for_user_id = ?,
          requester_email = ?,
          department = ?,
          state_id = ?,
          region_id = ?,
          cluster_id = ?,
          branch_id = ?,
          category_id = ?,
          subcategory_id = ?,
          cc_recipients_json = ?,
          priority = ?,
          status = ?,
          assigned_to = ?,
          resolution_notes = ?,
          responded_at = ?,
          resolved_at = ?,
          closed_at = ?,
          reopened_count = COALESCE(?, reopened_count),
          last_activity_at = ?,
          last_status_change_at = COALESCE(?, last_status_change_at),
          work_start_at = ?,
          work_duration_seconds = ?,
          hold_duration_seconds = ?,
          resolution_duration_seconds = ?,
          closure_duration_seconds = ?,
          hold_reason = ?,
          hold_remarks = ?,
          resolution_summary = ?,
          closure_remarks = ?
        WHERE id = ? AND tenant_id = ?
      `,
      [
        updates.title,
        updates.description,
        updates.requested_for_user_id,
        updates.requester_email,
        updates.department,
        updates.state_id,
        updates.region_id,
        updates.cluster_id,
        updates.branch_id,
        updates.category_id,
        updates.subcategory_id,
        updates.cc_recipients_json,
        updates.priority,
        updates.status,
        updates.assigned_to,
        updates.resolution_notes,
        updates.responded_at || existing.respondedAt || null,
        updates.resolved_at || (updates.status === 'RESOLVED' ? new Date() : existing.resolvedAt || null),
        updates.closed_at !== undefined ? updates.closed_at : existing.closedAt || null,
        updates.reopened_count !== undefined ? updates.reopened_count : null,
        updates.last_activity_at,
        updates.last_status_change_at || null,
        updates.work_start_at,
        updates.work_duration_seconds,
        updates.hold_duration_seconds,
        updates.resolution_duration_seconds,
        updates.closure_duration_seconds,
        updates.hold_reason,
        updates.hold_remarks,
        updates.resolution_summary,
        updates.closure_remarks,
        existing.id,
        tenantId,
      ]
    );

    const comparisons = [
      ['status', existing.status, updates.status],
      ['priority', existing.priority, updates.priority],
      ['assigned_to', existing.assigned_to, updates.assigned_to],
      ['category_id', existing.categoryId, updates.category_id],
      ['subcategory_id', existing.subcategoryId, updates.subcategory_id],
      ['department', existing.department, updates.department],
      ['hold_reason', existing.holdReason, updates.hold_reason],
      ['hold_remarks', existing.holdRemarks, updates.hold_remarks],
      ['resolution_summary', existing.resolutionSummary, updates.resolution_summary],
      ['closure_remarks', existing.closureRemarks, updates.closure_remarks],
    ];

    for (const [fieldName, fromValue, toValue] of comparisons) {
      if (String(fromValue ?? '') === String(toValue ?? '')) continue;
      await writeHistory(tx.query, {
        ticketId: existing.id,
        actorUserId: user._id,
        action: 'TICKET_UPDATED',
        fieldName,
        fromValue,
        toValue,
        notes: `${fieldName} updated`,
      });
    }

    if (String(existing.status) !== String(updates.status)) {
      await ticketActivityService.logActivity({
        ticketId: existing.id,
        action: 'STATUS_CHANGED',
        oldValue: existing.status,
        newValue: updates.status,
        performedBy: user._id,
        remarks: 'Status updated',
      }, tx.query);
    }
  });

  const refreshedRow = await getTicketOrThrow(tenantId, id);
  const hydrated = await hydrateTicket(refreshedRow, user);
  await auditLogger.logAudit({
    action: 'TICKET_UPDATED',
    tenant_id: tenantId,
    actor_id: user._id,
    entity: 'Ticket',
    entity_id: hydrated.ticketId,
    module: 'Ticketing',
    previous_value: existing,
    new_value: hydrated,
  });

  const eventType = existing.assigned_to !== hydrated.assigned_to
    ? (existing.assigned_to ? 'reassigned' : 'assigned')
    : (hydrated.status === 'CLOSED' ? 'closed' : (hydrated.status === 'REOPENED' ? 'reopened' : (hydrated.status === 'ON_HOLD' ? 'on_hold' : (hydrated.status === 'RESOLVED' ? 'resolved' : 'updated'))));

  await dispatchTicketNotifications(hydrated, eventType, {
    message: `${hydrated.ticketId} updated to ${hydrated.status}`,
  });

  return hydrated;
}

async function addComment(ticketId, input, user) {
  user = await resolveActorUser(input, user);
  const tenantId = user.tenant_id;
  const existingRow = await getTicketOrThrow(tenantId, ticketId);
  const ticket = mapTicketRow(existingRow);
  await assertTicketAccess(ticket, user);

  const commentType = normalizeCommentType(input.commentType || input.comment_type, 'PUBLIC');
  const commentBody = String(input.body || input.comment || input.message || '').trim();
  if (!commentBody) {
    throw new HttpError(400, 'Comment body is required', 'COMMENT_BODY_REQUIRED');
  }

  if (commentType === 'INTERNAL' && normalizeTicketRoleKey(user.role) === TICKET_ROLE_KEYS.END_USER) {
    throw new HttpError(403, 'End users cannot create internal comments', 'COMMENT_INTERNAL_FORBIDDEN');
  }

  const mentions = asArray(input.mentions || input.mentionUserIds || input.mention_user_ids).filter(Boolean);
  const attachments = Array.isArray(input.attachments) ? input.attachments : [];

  const result = await withTransaction(async (tx) => {
    const insertResult = await tx.query(
      `
        INSERT INTO ticket_comments
          (ticket_id, author_user_id, author_email, comment_type, body, mentions_json, source, source_message_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        ticket.id,
        user._id,
        user.email || input.author_email || null,
        commentType,
        commentBody,
        safeJsonStringify(mentions, '[]'),
        input.source || 'api',
        input.source_message_id || input.message_id || null,
      ]
    );

    if (attachments.length) {
      await persistAttachments(ticket.id, ticket.ticketId, attachments, insertResult.insertId, tx.query);
    }

    await writeHistory(tx.query, {
      ticketId: ticket.id,
      actorUserId: user._id,
      action: 'COMMENT_ADDED',
      notes: `${commentType} comment added`,
    });

    await ticketActivityService.logActivity({
      ticketId: ticket.id,
      action: 'COMMENT_ADDED',
      oldValue: null,
      newValue: commentType,
      performedBy: user._id,
      remarks: commentType === 'INTERNAL' ? 'Internal comment' : 'Public comment',
    }, tx.query);

    if (normalizeTicketRoleKey(user.role) !== TICKET_ROLE_KEYS.END_USER && ['OPEN', 'ASSIGNED', 'PENDING_USER'].includes(ticket.status)) {
      await tx.query(
        `
          UPDATE tickets
          SET status = 'IN_PROGRESS', responded_at = COALESCE(responded_at, NOW()), last_activity_at = NOW(), last_status_change_at = NOW()
          WHERE id = ? AND tenant_id = ?
        `,
        [ticket.id, tenantId]
      );
    } else {
      await tx.query(`UPDATE tickets SET last_activity_at = NOW() WHERE id = ? AND tenant_id = ?`, [ticket.id, tenantId]);
    }

    return insertResult.insertId;
  });

  const refreshed = await getTicketOrThrow(tenantId, ticketId);
  const hydrated = await hydrateTicket(refreshed, user);
  await auditLogger.logAudit({
    action: 'TICKET_COMMENT_ADDED',
    tenant_id: tenantId,
    actor_id: user._id,
    entity: 'Ticket',
    entity_id: hydrated.ticketId,
    module: 'Ticketing',
    details: { commentType, commentId: result },
  });
  await dispatchTicketNotifications(hydrated, 'commented', {
    message: `New ${commentType.toLowerCase()} comment on ${hydrated.ticketId}`,
  });

  return {
    duplicate: false,
    ticket: hydrated,
  };
}

async function listComments(ticketId, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const [commentRows, attachmentRows] = await Promise.all([
    getComments(ticket.id),
    getAttachments(ticket.id),
  ]);

  const attachmentsByComment = new Map();
  attachmentRows.forEach((rowItem) => {
    if (!rowItem.comment_id) return;
    const attachment = mapAttachmentRow(rowItem);
    if (!attachmentsByComment.has(rowItem.comment_id)) attachmentsByComment.set(rowItem.comment_id, []);
    attachmentsByComment.get(rowItem.comment_id).push(attachment);
  });

  return commentRows
    .map((commentRow) => mapCommentRow(commentRow, attachmentsByComment.get(commentRow.id) || [], user?.role))
    .filter(Boolean);
}

async function updateComment(commentId, input, user) {
  const rows = await query(
    `
      SELECT c.*, t.tenant_id, t.ticket_id
      FROM ticket_comments c
      INNER JOIN tickets t ON t.id = c.ticket_id
      WHERE c.id = ? AND t.tenant_id = ?
      LIMIT 1
    `,
    [commentId, user.tenant_id]
  );
  const comment = rows[0];
  if (!comment) throw new HttpError(404, 'Comment not found', 'COMMENT_NOT_FOUND');

  const ticket = mapTicketRow(await getTicketOrThrow(user.tenant_id, comment.ticket_id));
  await assertTicketAccess(ticket, user);

  const { permissions } = getPermissionContext(user);
  const isAuthor = Number(comment.author_user_id || 0) === Number(user._id);
  if (!isAuthor && !permissions.update) {
    throw new HttpError(403, 'Not allowed to update this comment', 'COMMENT_UPDATE_FORBIDDEN');
  }

  const body = input.body || input.comment || input.message;
  if (!body) throw new HttpError(400, 'Comment body is required', 'COMMENT_BODY_REQUIRED');
  const commentType = normalizeCommentType(input.commentType || input.comment_type || comment.comment_type, comment.comment_type);

  await query(
    `UPDATE ticket_comments SET body = ?, comment_type = ? WHERE id = ?`,
    [String(body).trim(), commentType, commentId]
  );

  await ticketActivityService.logActivity({
    ticketId: comment.ticket_id,
    action: 'COMMENT_UPDATED',
    oldValue: null,
    newValue: commentType,
    performedBy: user._id,
    remarks: 'Comment updated',
  });

  return { id: Number(commentId), updated: true };
}

async function deleteComment(commentId, user) {
  const rows = await query(
    `
      SELECT c.ticket_id, t.tenant_id
      FROM ticket_comments c
      INNER JOIN tickets t ON t.id = c.ticket_id
      WHERE c.id = ? AND t.tenant_id = ?
      LIMIT 1
    `,
    [commentId, user.tenant_id]
  );
  const comment = rows[0];
  if (!comment) throw new HttpError(404, 'Comment not found', 'COMMENT_NOT_FOUND');

  const ticket = mapTicketRow(await getTicketOrThrow(user.tenant_id, comment.ticket_id));
  await assertTicketAccess(ticket, user);

  await withTransaction(async (tx) => {
    await tx.query('DELETE FROM ticket_attachments WHERE comment_id = ?', [commentId]);
    await tx.query('DELETE FROM ticket_comments WHERE id = ?', [commentId]);
  });

  await ticketActivityService.logActivity({
    ticketId: comment.ticket_id,
    action: 'COMMENT_DELETED',
    oldValue: null,
    newValue: null,
    performedBy: user._id,
    remarks: 'Comment deleted',
  });

  return { id: Number(commentId), deleted: true };
}

async function listAttachments(ticketId, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);
  const rows = await getAttachments(ticket.id);
  return rows.map(mapAttachmentRow);
}

async function addAttachment(ticketId, input, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const attachments = Array.isArray(input.attachments) ? input.attachments : [];
  if (!attachments.length) {
    throw new HttpError(400, 'attachments are required', 'ATTACHMENTS_REQUIRED');
  }

  await persistAttachments(ticket.id, ticket.ticketId, attachments, null, query);

  await ticketActivityService.logActivity({
    ticketId: ticket.id,
    action: 'ATTACHMENT_ADDED',
    oldValue: null,
    newValue: String(attachments.length),
    performedBy: user._id,
    remarks: 'Attachment added',
  });

  return listAttachments(ticketId, user);
}

async function deleteAttachment(ticketId, attachmentId, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const existing = await query(
    `SELECT id FROM ticket_attachments WHERE id = ? AND ticket_id = ? LIMIT 1`,
    [attachmentId, ticket.id]
  );
  if (!existing.length) throw new HttpError(404, 'Attachment not found', 'ATTACHMENT_NOT_FOUND');

  await query('DELETE FROM ticket_attachments WHERE id = ? AND ticket_id = ?', [attachmentId, ticket.id]);

  await ticketActivityService.logActivity({
    ticketId: ticket.id,
    action: 'ATTACHMENT_DELETED',
    oldValue: null,
    newValue: null,
    performedBy: user._id,
    remarks: 'Attachment deleted',
  });

  return { id: Number(attachmentId), deleted: true };
}

async function listWatchers(ticketId, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const rows = await query(
    `
      SELECT w.user_id, u.public_id, u.name, u.email
      FROM ticket_watchers w
      LEFT JOIN users u ON u._id = w.user_id
      WHERE w.ticket_id = ? AND w.tenant_id = ?
      ORDER BY u.name ASC
    `,
    [ticket.id, user.tenant_id]
  );

  return rows.map((rowItem) => ({
    id: rowItem.public_id || rowItem.user_id,
    internalId: rowItem.user_id,
    publicId: rowItem.public_id || null,
    name: rowItem.name || null,
    email: rowItem.email || null,
  }));
}

async function addWatcher(ticketId, input, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const watcherInput = input.userId || input.user_id || input.watcherId || null;
  if (!watcherInput) throw new HttpError(400, 'userId is required', 'WATCHER_REQUIRED');

  const watcher = await findUserByIdOrPublicId(user.tenant_id, watcherInput);
  if (!watcher) throw new HttpError(404, 'Watcher not found', 'WATCHER_NOT_FOUND');

  await query(
    `INSERT IGNORE INTO ticket_watchers (tenant_id, ticket_id, user_id) VALUES (?, ?, ?)`,
    [user.tenant_id, ticket.id, watcher._id]
  );

  await dispatchTicketNotifications(ticket, 'updated', {
    message: `${ticket.ticketId} watcher added`,
    userIds: [watcher._id],
  }).catch(() => null);

  return listWatchers(ticketId, user);
}

async function removeWatcher(ticketId, watcherId, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const watcher = await findUserByIdOrPublicId(user.tenant_id, watcherId);
  if (!watcher) throw new HttpError(404, 'Watcher not found', 'WATCHER_NOT_FOUND');

  await query(
    `DELETE FROM ticket_watchers WHERE tenant_id = ? AND ticket_id = ? AND user_id = ?`,
    [user.tenant_id, ticket.id, watcher._id]
  );

  return listWatchers(ticketId, user);
}

async function getTicketSla(ticketId, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  const policy = await getSlaPolicy(user.tenant_id, ticket.priority);
  return {
    ticketId: ticket.ticketId,
    priority: ticket.priority,
    policy,
    responseDueAt: row.response_due_at || null,
    resolutionDueAt: row.resolution_due_at || null,
    escalationDueAt: row.escalation_due_at || null,
    nextEscalationAt: row.next_escalation_at || null,
  };
}

async function updateTicketSla(ticketId, input, user) {
  const row = await getTicketOrThrow(user.tenant_id, ticketId);
  const ticket = mapTicketRow(row);
  await assertTicketAccess(ticket, user);

  let policy = null;
  if (input.policyId) {
    const policyRows = await query(
      'SELECT * FROM ticket_sla_policies WHERE tenant_id = ? AND id = ? LIMIT 1',
      [user.tenant_id, input.policyId]
    );
    policy = policyRows[0] || null;
  } else {
    policy = await getSlaPolicy(user.tenant_id, ticket.priority);
  }

  const computed = computeDueDates(policy);
  const responseDueAt = input.responseDueAt || input.response_due_at || computed.responseDueAt;
  const resolutionDueAt = input.resolutionDueAt || input.resolution_due_at || computed.resolutionDueAt;
  const escalationDueAt = input.escalationDueAt || input.escalation_due_at || computed.escalationDueAt;
  const nextEscalationAt = input.nextEscalationAt || input.next_escalation_at || computed.nextEscalationAt;

  await query(
    `
      UPDATE tickets
      SET response_due_at = ?, resolution_due_at = ?, escalation_due_at = ?, next_escalation_at = ?, last_activity_at = NOW()
      WHERE id = ? AND tenant_id = ?
    `,
    [responseDueAt, resolutionDueAt, escalationDueAt, nextEscalationAt, ticket.id, user.tenant_id]
  );

  await ticketActivityService.logActivity({
    ticketId: ticket.id,
    action: 'SLA_UPDATED',
    oldValue: null,
    newValue: ticket.priority,
    performedBy: user._id,
    remarks: 'SLA updated',
  });

  return getTicketSla(ticketId, user);
}

async function getITSupportAssignees(user) {
  const rows = await query(
    `
      SELECT _id, public_id, name, email, role, title
      FROM users
      WHERE tenant_id = ?
        AND COALESCE(isActive, 1) = 1
      ORDER BY name ASC
    `,
    [user.tenant_id]
  );

  return rows
    .filter((row) => normalizeTicketRoleKey(row.role) && normalizeTicketRoleKey(row.role) !== TICKET_ROLE_KEYS.END_USER)
    .map((row) => ({
      id: row.public_id || row._id,
      internalId: row._id,
      publicId: row.public_id || null,
      name: row.name,
      email: row.email,
      role: row.role,
      title: row.title || row.role,
    }));
}

function getSession(user) {
  const { ticketRole, permissions } = getPermissionContext(user);
  return {
    user: {
      id: user.id,
      internalId: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      ticketRole,
      tenantId: user.tenant_id,
    },
    permissions,
  };
}

module.exports = {
  createTicket,
  updateDraft,
  listDrafts,
  deleteDraft,
  listTickets,
  getDashboard,
  getTicket,
  updateTicket,
  addComment,
  listComments,
  updateComment,
  deleteComment,
  listAttachments,
  addAttachment,
  deleteAttachment,
  listWatchers,
  addWatcher,
  removeWatcher,
  getTicketSla,
  updateTicketSla,
  getITSupportAssignees,
  getSession,
};
