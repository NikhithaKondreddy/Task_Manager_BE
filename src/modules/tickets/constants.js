const TICKET_STATUSES = [
  'DRAFT',
  'OPEN',
  'ASSIGNED',
  'IN_PROGRESS',
  'PENDING_USER',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
  'REOPENED',
  'REOPEN_REQUESTED',
  'ESCALATED',
  'CANCELLED'
];

const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const COMMENT_TYPES = ['PUBLIC', 'INTERNAL'];

const DEFAULT_SLA_POLICIES = [
  { priority: 'LOW', response_time_minutes: 240, resolution_time_minutes: 1440, escalation_time_minutes: 480 },
  { priority: 'MEDIUM', response_time_minutes: 120, resolution_time_minutes: 720, escalation_time_minutes: 240 },
  { priority: 'HIGH', response_time_minutes: 60, resolution_time_minutes: 240, escalation_time_minutes: 120 },
  { priority: 'CRITICAL', response_time_minutes: 15, resolution_time_minutes: 60, escalation_time_minutes: 30 },
];

const TICKET_ROLE_KEYS = {
  END_USER: 'END_USER',
  L1_ENGINEER: 'L1_ENGINEER',
  L2_ENGINEER: 'L2_ENGINEER',
  REGIONAL_IT_MANAGER: 'REGIONAL_IT_MANAGER',
  CENTRAL_IT_ADMIN: 'CENTRAL_IT_ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
};

const TICKET_ROLE_ALIASES = {
  END_USER: ['END_USER', 'EMPLOYEE'],
  L1_ENGINEER: ['L1_ENGINEER', 'IT_SUPPORT', 'BRANCH_ENGINEER'],
  L2_ENGINEER: ['L2_ENGINEER', 'MANAGER', 'CLUSTER_ENGINEER'],
  REGIONAL_IT_MANAGER: ['REGIONAL_IT_MANAGER', 'REGIONAL_ENGINEER', 'STATE_ENGINEER'],
  CENTRAL_IT_ADMIN: ['CENTRAL_IT_ADMIN', 'ADMIN', 'IT_ADMIN'],
  SUPER_ADMIN: ['SUPER_ADMIN'],
};

const ESCALATION_CHAIN = [
  { level: 1, roleKey: TICKET_ROLE_KEYS.L2_ENGINEER, label: 'Cluster Lead / L2 Engineer' },
  { level: 2, roleKey: TICKET_ROLE_KEYS.REGIONAL_IT_MANAGER, label: 'Regional IT Manager' },
  { level: 3, roleKey: TICKET_ROLE_KEYS.CENTRAL_IT_ADMIN, label: 'Central IT Admin' },
];

const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

module.exports = {
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  COMMENT_TYPES,
  DEFAULT_SLA_POLICIES,
  TICKET_ROLE_KEYS,
  TICKET_ROLE_ALIASES,
  ESCALATION_CHAIN,
  ALLOWED_ATTACHMENT_MIME_TYPES,
};
