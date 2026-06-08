const { normalizeRole } = require('../../../config/rbac');
const {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  COMMENT_TYPES,
  TICKET_ROLE_ALIASES,
  TICKET_ROLE_KEYS,
} = require('../constants');

function normalizeTicketStatus(status, fallback = null) {
  if (!status && fallback) return fallback;
  const normalized = String(status || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return fallback;
  return TICKET_STATUSES.includes(normalized) ? normalized : fallback;
}

function normalizePriority(priority, fallback = null) {
  if (!priority && fallback) return fallback;
  const normalized = String(priority || '').trim().toUpperCase();
  if (!normalized) return fallback;
  return TICKET_PRIORITIES.includes(normalized) ? normalized : fallback;
}

function normalizeCommentType(type, fallback = 'PUBLIC') {
  const normalized = String(type || '').trim().toUpperCase();
  return COMMENT_TYPES.includes(normalized) ? normalized : fallback;
}

function safeJsonParse(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function safeJsonStringify(value, fallback = '[]') {
  if (value == null) return fallback;
  return JSON.stringify(value);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === '') return [];
  return [value];
}

function slugifyCategoryCode(value) {
  const input = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return input || `CAT_${Date.now()}`;
}

function normalizeTicketRoleKey(role) {
  const normalizedRole = normalizeRole(role);
  if (!normalizedRole) return null;
  for (const [ticketRoleKey, aliases] of Object.entries(TICKET_ROLE_ALIASES)) {
    if (aliases.includes(normalizedRole)) {
      return ticketRoleKey;
    }
  }
  return normalizedRole === TICKET_ROLE_KEYS.SUPER_ADMIN ? TICKET_ROLE_KEYS.SUPER_ADMIN : null;
}

function buildPermissionSet(role) {
  const ticketRole = normalizeTicketRoleKey(role);

  if (ticketRole === TICKET_ROLE_KEYS.SUPER_ADMIN || ticketRole === TICKET_ROLE_KEYS.CENTRAL_IT_ADMIN) {
    return {
      readAll: true,
      create: true,
      comment: true,
      update: true,
      assign: true,
      manageCatalog: true,
      manageSla: true,
      manageMappings: true,
      readReports: true,
    };
  }

  if (ticketRole === TICKET_ROLE_KEYS.REGIONAL_IT_MANAGER || ticketRole === TICKET_ROLE_KEYS.L2_ENGINEER) {
    return {
      readAll: true,
      create: true,
      comment: true,
      update: true,
      assign: true,
      manageCatalog: false,
      manageSla: false,
      manageMappings: false,
      readReports: true,
    };
  }

  if (ticketRole === TICKET_ROLE_KEYS.L1_ENGINEER) {
    return {
      readAssigned: true,
      create: true,
      comment: true,
      update: true,
      assign: true,
      readReports: false,
    };
  }

  return {
    readOwn: true,
    create: true,
    comment: true,
    updateOwn: true,
    readReports: false,
  };
}

function allowedStatusTransitions(ticketRole, currentStatus) {
  const transitions = {
    DRAFT: ['OPEN'],
    OPEN: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED'],
    ASSIGNED: ['IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED'],
    IN_PROGRESS: ['PENDING_USER', 'RESOLVED', 'CLOSED'],
    PENDING_USER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED', 'REOPENED'],
    CLOSED: ['REOPENED'],
    REOPENED: ['ASSIGNED', 'IN_PROGRESS', 'PENDING_USER', 'RESOLVED', 'CLOSED'],
  };

  if (ticketRole === TICKET_ROLE_KEYS.END_USER) {
    if (currentStatus === 'RESOLVED' || currentStatus === 'CLOSED') return ['REOPENED'];
    return [];
  }

  return transitions[currentStatus] || [];
}

function isInternalCommentVisibleToUser(commentType, role) {
  const ticketRole = normalizeTicketRoleKey(role);
  if (commentType !== 'INTERNAL') return true;
  return ticketRole !== TICKET_ROLE_KEYS.END_USER;
}

module.exports = {
  normalizeTicketStatus,
  normalizePriority,
  normalizeCommentType,
  safeJsonParse,
  safeJsonStringify,
  asArray,
  slugifyCategoryCode,
  normalizeTicketRoleKey,
  buildPermissionSet,
  allowedStatusTransitions,
  isInternalCommentVisibleToUser,
};
