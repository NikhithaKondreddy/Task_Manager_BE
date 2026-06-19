const cron = require('node-cron');
const logger = require('../../../logger');
const auditLogger = require('../../../services/auditLogger');
const NotificationService = require('../../../services/notificationService');
const { sendEmail } = require('../../../services/emailService');
const { query } = require('../repositories/mysql');
const { ESCALATION_CHAIN } = require('../constants');
const { normalizeTicketRoleKey } = require('../helpers/ticketUtils');

let cronTask = null;

function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + (Number(minutes || 0) * 60 * 1000));
}

function computeDueDates(policy, baseDate = new Date()) {
  if (!policy) {
    return {
      responseDueAt: null,
      resolutionDueAt: null,
      escalationDueAt: null,
      nextEscalationAt: null,
    };
  }

  return {
    responseDueAt: addMinutes(baseDate, policy.response_time_minutes),
    resolutionDueAt: addMinutes(baseDate, policy.resolution_time_minutes),
    escalationDueAt: addMinutes(baseDate, policy.escalation_time_minutes),
    nextEscalationAt: addMinutes(baseDate, policy.escalation_time_minutes),
  };
}

async function loadActiveMappings(tenantId) {
  return query(
    `
      SELECT
        em.*,
        u.public_id AS engineer_public_id,
        u.name AS engineer_name,
        u.email AS engineer_email,
        u.role AS engineer_role
      FROM engineer_mapping em
      INNER JOIN users u ON u._id = em.engineer_id
      WHERE em.tenant_id = ?
        AND em.is_active = 1
        AND COALESCE(u.isActive, 1) = 1
    `,
    [tenantId]
  );
}

async function loadOpenWorkloads(tenantId, engineerIds = []) {
  if (!engineerIds.length) return new Map();
  const rows = await query(
    `
      SELECT assigned_to, COUNT(*) AS ticket_count
      FROM tickets
      WHERE tenant_id = ?
        AND assigned_to IN (?)
        AND UPPER(status) NOT IN ('DRAFT', 'RESOLVED', 'CLOSED')
      GROUP BY assigned_to
    `,
    [tenantId, engineerIds]
  );

  return new Map(rows.map((row) => [Number(row.assigned_to), Number(row.ticket_count)]));
}

function locationMatches(ticket, mapping) {
  const comparisons = [
    ['state_id', ticket.state_id],
    ['region_id', ticket.region_id],
    ['cluster_id', ticket.cluster_id],
    ['branch_id', ticket.branch_id],
  ];

  for (const [key, ticketValue] of comparisons) {
    if (mapping[key] != null && mapping[key] !== '' && Number(mapping[key]) !== Number(ticketValue || 0)) {
      return false;
    }
  }

  return true;
}

function hasAnyLocation(ticket = {}) {
  return Boolean(ticket.state_id || ticket.region_id || ticket.cluster_id || ticket.branch_id);
}

function categoryMatches(ticket, mapping) {
  if (!mapping.supported_categories_json) return true;
  let supportedCategories = [];
  try {
    supportedCategories = typeof mapping.supported_categories_json === 'string'
      ? JSON.parse(mapping.supported_categories_json)
      : (mapping.supported_categories_json || []);
  } catch (_) {
    supportedCategories = [];
  }

  if (!supportedCategories.length) return true;
  const identifiers = new Set(
    supportedCategories
      .map((value) => String(value))
      .filter(Boolean)
  );

  return identifiers.has(String(ticket.category_id))
    || identifiers.has(String(ticket.subcategory_id))
    || identifiers.has(String(ticket.category_id || '') + ':' + String(ticket.subcategory_id || ''));
}

function calculateMatchScore(ticket, mapping, workload) {
  const ticketHasLocation = hasAnyLocation(ticket);

  // Strict location matching when ticket has location data.
  // If ticket location is missing, fall back to category/workload matching
  // so tickets are still assignable instead of remaining unassigned.
  if (ticketHasLocation && !locationMatches(ticket, mapping)) return null;
  if (!categoryMatches(ticket, mapping)) return null;

  let score = 0;
  if (ticketHasLocation) {
    if (mapping.state_id && Number(mapping.state_id) === Number(ticket.state_id || 0)) score += 10;
    if (mapping.region_id && Number(mapping.region_id) === Number(ticket.region_id || 0)) score += 20;
    if (mapping.cluster_id && Number(mapping.cluster_id) === Number(ticket.cluster_id || 0)) score += 30;
    if (mapping.branch_id && Number(mapping.branch_id) === Number(ticket.branch_id || 0)) score += 40;
  } else {
    // Small base score for fallback-mode candidates when location is absent.
    score += 5;
  }
  score -= workload * 2;

  return score;
}

async function dispatchTicketNotifications(ticket, eventType, extra = {}) {
  const recipients = new Map();
  const addRecipient = (userId, email) => {
    if (!userId && !email) return;
    const key = userId ? `user:${userId}` : `email:${email}`;
    recipients.set(key, { userId, email });
  };

  addRecipient(ticket.requested_for_user_id, ticket.requested_for_email || ticket.requester_email);
  addRecipient(ticket.requester_user_id, ticket.requester_email);
  addRecipient(ticket.created_by_user_id, ticket.created_by_email);
  addRecipient(ticket.assigned_to, ticket.assigned_to_email);

  if (extra.userIds) {
    extra.userIds.forEach((userId) => addRecipient(userId, null));
  }

  const title = {
    created: `Ticket ${ticket.ticket_id} created`,
    assigned: `Ticket ${ticket.ticket_id} assigned`,
    reassigned: `Ticket ${ticket.ticket_id} reassigned`,
    updated: `Ticket ${ticket.ticket_id} updated`,
    escalated: `Ticket ${ticket.ticket_id} escalated`,
    closed: `Ticket ${ticket.ticket_id} closed`,
    reopened: `Ticket ${ticket.ticket_id} reopened`,
    commented: `New comment on ${ticket.ticket_id}`,
    accepted: `Ticket ${ticket.ticket_id} accepted`,
    resolved: `Ticket ${ticket.ticket_id} resolved`,
    on_hold: `Ticket ${ticket.ticket_id} put on hold`,
  }[eventType] || `Ticket ${ticket.ticket_id} updated`;

  const message = extra.message || `${ticket.title} [${ticket.status}]`;
  const userIds = Array.from(recipients.values()).map((item) => item.userId).filter(Boolean);

  if (userIds.length) {
    await NotificationService.createAndSend(
      userIds,
      title,
      message,
      `ticket_${eventType}`,
      'Ticket',
      ticket.id,
      ticket.tenant_id
    ).catch((error) => logger.warn(`ticket notification failed: ${error.message}`));
  }

  const emailRecipients = Array.from(recipients.values())
    .map((item) => item.email)
    .filter(Boolean);

  await Promise.allSettled(
    emailRecipients.map((email) => sendEmail({
      to: email,
      subject: title,
      text: `${message}\nTicket ID: ${ticket.ticket_id}\nStatus: ${ticket.status}\nPriority: ${ticket.priority}`,
    }))
  );

  // Broadcast full ticket payload over socket.io so frontend kanban/queues
  // can react to assignment/accept/update events in real time.
  try {
    if (global.io) {
      const socketEventMap = {
        created: 'ticket:created',
        assigned: 'ticket:assigned',
        reassigned: 'ticket:reassigned',
        updated: 'ticket:updated',
        escalated: 'ticket:escalated',
        closed: 'ticket:closed',
        reopened: 'ticket:reopened',
        commented: 'ticket:commented',
        accepted: 'ticket:accepted',
        resolved: 'ticket:resolved',
        on_hold: 'ticket:on_hold',
      };
      const eventName = socketEventMap[eventType] || 'ticket:updated';
      global.io.emit(eventName, ticket);
    }
  } catch (err) {
    logger.warn(`socket emit failed for ticket ${ticket.ticket_id || ticket.id}: ${err && err.message ? err.message : String(err)}`);
  }
}

async function autoAssignTicket(ticket, actorUser = null) {
  if (!ticket || !ticket.tenant_id || ticket.is_draft) {
    logger.info('ticket auto-assign skipped: invalid ticket, tenant missing, or draft', {
      ticketId: ticket?.ticket_id || ticket?.id || null,
      tenantId: ticket?.tenant_id || null,
      isDraft: Boolean(ticket?.is_draft),
    });
    return null;
  }
  if (ticket.assigned_to) {
    logger.info('ticket auto-assign skipped: ticket already assigned', {
      ticketId: ticket.ticket_id || ticket.id,
      tenantId: ticket.tenant_id,
      assignedTo: ticket.assigned_to,
    });
    return ticket;
  }

  const mappings = await loadActiveMappings(ticket.tenant_id);
  if (!mappings.length) {
    logger.warn('ticket auto-assign skipped: no active engineer mappings found', {
      ticketId: ticket.ticket_id || ticket.id,
      tenantId: ticket.tenant_id,
      stateId: ticket.state_id || null,
      regionId: ticket.region_id || null,
      clusterId: ticket.cluster_id || null,
      branchId: ticket.branch_id || null,
      categoryId: ticket.category_id || null,
      subcategoryId: ticket.subcategory_id || null,
    });
    return ticket;
  }

  const workloads = await loadOpenWorkloads(ticket.tenant_id, mappings.map((mapping) => mapping.engineer_id));
  const candidates = mappings
    .map((mapping) => ({
      mapping,
      workload: workloads.get(Number(mapping.engineer_id)) || 0,
      score: calculateMatchScore(ticket, mapping, workloads.get(Number(mapping.engineer_id)) || 0),
    }))
    // Keep negative scores as valid candidates (high workload), and
    // only drop non-eligible mappings (null score from hard mismatches).
    .filter((item) => item.score !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.workload !== right.workload) return left.workload - right.workload;
      return Number(left.mapping.id) - Number(right.mapping.id);
    });
  // If strict candidate selection yields nothing, attempt a permissive
  // fallback when the ticket lacks explicit location information so that
  // tickets do not remain unassigned in test/seeded environments.
  let chosen = null;
  if (!candidates.length) {
    logger.warn('ticket auto-assign: no strict candidates, attempting permissive fallback', {
      ticketId: ticket.ticket_id || ticket.id,
      tenantId: ticket.tenant_id,
      ticketHasLocation: hasAnyLocation(ticket),
      mappingCount: mappings.length,
    });

    // Only fallback when ticket has no explicit location; preserving strict
    // matching behavior for location-scoped tickets.
    if (!hasAnyLocation(ticket)) {
      const fallback = mappings
        .map((mapping) => ({
          mapping,
          workload: workloads.get(Number(mapping.engineer_id)) || 0,
          score: 5 - (workloads.get(Number(mapping.engineer_id)) || 0) * 2,
        }))
        .sort((left, right) => {
          if (right.score !== left.score) return right.score - left.score;
          if (left.workload !== right.workload) return left.workload - right.workload;
          return Number(left.mapping.id) - Number(right.mapping.id);
        });

      if (fallback.length) chosen = fallback[0];
    }
    if (!chosen) {
      logger.warn('ticket auto-assign skipped: no eligible mapping candidates (after fallback)', {
        ticketId: ticket.ticket_id || ticket.id,
        tenantId: ticket.tenant_id,
        mappingCount: mappings.length,
      });
      return ticket;
    }
  } else {
    chosen = candidates[0];
  }
  logger.info('ticket auto-assign candidate selected', {
    ticketId: ticket.ticket_id || ticket.id,
    tenantId: ticket.tenant_id,
    selectedEngineerId: chosen.mapping.engineer_id,
    selectedEngineerPublicId: chosen.mapping.engineer_public_id || null,
    selectedEngineerName: chosen.mapping.engineer_name || null,
    score: chosen.score,
    workload: chosen.workload,
  });
  await query(
    `
      UPDATE tickets
      SET assigned_to = ?, status = 'ASSIGNED', assigned_at = COALESCE(assigned_at, NOW()), assignment_mode = 'AUTO', assignment_reason = ?, workload_snapshot = ?, last_activity_at = NOW(), last_status_change_at = NOW()
      WHERE id = ? AND tenant_id = ?
    `,
    [
      chosen.mapping.engineer_id,
      `Auto assigned using location/category match (score ${chosen.score})`,
      chosen.workload,
      ticket.id,
      ticket.tenant_id,
    ]
  );

  await query(
    `
      INSERT INTO ticket_history (ticket_id, actor_user_id, action, field_name, from_value, to_value, notes)
      VALUES (?, ?, 'AUTO_ASSIGNED', 'assigned_to', ?, ?, ?)
    `,
    [
      ticket.id,
      actorUser?._id || null,
      ticket.assigned_to ? String(ticket.assigned_to) : null,
      String(chosen.mapping.engineer_id),
      `Auto assigned to ${chosen.mapping.engineer_name}`,
    ]
  );

  await auditLogger.logAudit({
    action: 'TICKET_AUTO_ASSIGNED',
    tenant_id: ticket.tenant_id,
    actor_id: actorUser?._id || null,
    entity: 'Ticket',
    entity_id: ticket.ticket_id,
    module: 'Ticketing',
    details: {
      assignedTo: chosen.mapping.engineer_public_id || chosen.mapping.engineer_id,
      assignmentMode: 'AUTO',
      workloadSnapshot: chosen.workload,
    },
  });

  const rows = await query(
    `
      SELECT
        t.*,
        assigned.email AS assigned_to_email,
        requester.email AS requested_for_email,
        creator.email AS created_by_email
      FROM tickets t
      LEFT JOIN users assigned ON assigned._id = t.assigned_to
      LEFT JOIN users requester ON requester._id = t.requested_for_user_id
      LEFT JOIN users creator ON creator._id = t.created_by_user_id
      WHERE t.id = ?
      LIMIT 1
    `,
    [ticket.id]
  );

  const updatedTicket = rows[0] || { ...ticket, assigned_to: chosen.mapping.engineer_id, status: 'ASSIGNED' };
  updatedTicket.ticket_id = updatedTicket.ticket_id || ticket.ticket_id;
  await dispatchTicketNotifications(updatedTicket, 'assigned', {
    message: `${updatedTicket.ticket_id} assigned to ${chosen.mapping.engineer_name}`,
  });

  return updatedTicket;
}

async function findUsersForEscalation(tenantId, roleKey) {
  const rows = await query(
    `
      SELECT _id, public_id, name, email, role
      FROM users
      WHERE tenant_id = ?
        AND COALESCE(isActive, 1) = 1
    `,
    [tenantId]
  );

  return rows.filter((row) => normalizeTicketRoleKey(row.role) === roleKey);
}

async function monitorSlaBreaches() {
  const rows = await query(
    `
      SELECT
        t.id,
        t.ticket_id,
        t.tenant_id,
        t.title,
        t.status,
        t.priority,
        t.assigned_to,
        t.requester_user_id,
        t.requested_for_user_id,
        t.created_by_user_id,
        t.requester_email,
        t.current_escalation_level,
        t.next_escalation_at,
        t.response_due_at,
        t.resolution_due_at,
        t.responded_at,
        t.last_activity_at,
        t.assigned_to AS assigned_to_id,
        assignee.email AS assigned_to_email,
        requester.email AS requested_for_email,
        creator.email AS created_by_email,
        p.escalation_time_minutes
      FROM tickets t
      LEFT JOIN users assignee ON assignee._id = t.assigned_to
      LEFT JOIN users requester ON requester._id = t.requested_for_user_id
      LEFT JOIN users creator ON creator._id = t.created_by_user_id
      LEFT JOIN ticket_sla_policies p ON p.tenant_id = t.tenant_id
        AND UPPER(p.priority COLLATE utf8mb4_unicode_ci) = UPPER(t.priority COLLATE utf8mb4_unicode_ci)
        AND p.is_active = 1
      WHERE UPPER(t.status COLLATE utf8mb4_unicode_ci) NOT IN ('DRAFT', 'RESOLVED', 'CLOSED')
    `
  );

  for (const ticket of rows) {
    const reasons = [];
    const now = new Date();

    if (ticket.response_due_at && !ticket.responded_at && now > new Date(ticket.response_due_at)) {
      reasons.push('Response SLA breached');
    }

    if (ticket.resolution_due_at && now > new Date(ticket.resolution_due_at)) {
      reasons.push('Resolution SLA breached');
    }

    if (ticket.next_escalation_at && now > new Date(ticket.next_escalation_at)) {
      reasons.push('Inactivity / escalation timer breached');
    }

    if (!reasons.length) continue;

    const nextEscalation = ESCALATION_CHAIN.find((entry) => entry.level > Number(ticket.current_escalation_level || 0));
    if (!nextEscalation) continue;

    const candidates = await findUsersForEscalation(ticket.tenant_id, nextEscalation.roleKey);
    const target = candidates[0] || null;

    await query(
      `
        UPDATE tickets
        SET current_escalation_level = ?, escalated_to_user_id = ?, next_escalation_at = ?, last_activity_at = NOW()
        WHERE id = ? AND tenant_id = ?
      `,
      [
        nextEscalation.level,
        target ? target._id : null,
        addMinutes(now, Number(ticket.escalation_time_minutes || 60)),
        ticket.id,
        ticket.tenant_id,
      ]
    );

    await query(
      `
        INSERT INTO ticket_escalations (ticket_id, escalation_level, from_user_id, to_user_id, reason, status)
        VALUES (?, ?, ?, ?, ?, 'OPEN')
      `,
      [ticket.id, nextEscalation.level, ticket.assigned_to_id || null, target ? target._id : null, reasons.join(', ')]
    );

    await query(
      `
        INSERT INTO ticket_history (ticket_id, actor_user_id, action, field_name, from_value, to_value, notes)
        VALUES (?, NULL, 'ESCALATED', 'current_escalation_level', ?, ?, ?)
      `,
      [ticket.id, String(ticket.current_escalation_level || 0), String(nextEscalation.level), reasons.join(', ')]
    );

    await auditLogger.logAudit({
      action: 'TICKET_ESCALATED',
      tenant_id: ticket.tenant_id,
      actor_id: null,
      entity: 'Ticket',
      entity_id: ticket.ticket_id,
      module: 'Ticketing',
      details: {
        escalationLevel: nextEscalation.level,
        escalationRole: nextEscalation.label,
        reasons,
        targetUserId: target ? target.public_id || target._id : null,
      },
    });

    await dispatchTicketNotifications(
      {
        ...ticket,
        escalated_to_user_id: target ? target._id : null,
      },
      'escalated',
      {
        userIds: target ? [target._id] : [],
        message: `${ticket.ticket_id} escalated to ${nextEscalation.label}: ${reasons.join(', ')}`,
      }
    );
  }
}

function startTicketAutomationJobs() {
  if (cronTask) return cronTask;
  const schedule = process.env.TICKET_SLA_MONITOR_CRON || '*/5 * * * *';
  cronTask = cron.schedule(schedule, () => {
    monitorSlaBreaches().catch((error) => logger.error(`ticket SLA monitor failed: ${error.message}`));
  });
  monitorSlaBreaches().catch((error) => logger.error(`ticket SLA monitor initial run failed: ${error.message}`));
  logger.info(`ticket automation: SLA monitor started with schedule ${schedule}`);
  return cronTask;
}

function stopTicketAutomationJobs() {
  if (!cronTask) return;
  cronTask.stop();
  cronTask = null;
}

module.exports = {
  computeDueDates,
  autoAssignTicket,
  dispatchTicketNotifications,
  monitorSlaBreaches,
  startTicketAutomationJobs,
  stopTicketAutomationJobs,
};
