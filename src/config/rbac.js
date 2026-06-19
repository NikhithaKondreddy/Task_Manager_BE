const ROLE_DEFINITIONS = {
  SUPER_ADMIN: {
    persisted: 'SuperAdmin',
    level: 100,
    aliases: ['super_admin', 'superadmin', 'super admin']
  },
  ADMIN: {
    persisted: 'Admin',
    level: 80,
    aliases: ['admin']
  },
  CENTRAL_IT_ADMIN: {
    persisted: 'Central IT Admin',
    level: 78,
    aliases: ['central it admin', 'central_it_admin']
  },
  IT_ADMIN: {
    persisted: 'IT Admin',
    level: 78,
    aliases: ['it admin', 'it_admin']
  },
  STATE_ENGINEER: {
    persisted: 'State Engineer',
    level: 74,
    aliases: ['state engineer', 'state_engineer', 'stateengineer']
  },
  REGIONAL_ENGINEER: {
    persisted: 'Regional Engineer',
    level: 72,
    aliases: ['regional engineer', 'regional_engineer', 'regionalengineer']
  },
  REGIONAL_IT_MANAGER: {
    persisted: 'Regional IT Manager',
    level: 72,
    aliases: ['regional it manager', 'regional_it_manager', 'it manager', 'it_manager']
  },
  IT_SUPPORT: {
    persisted: 'IT Support',
    level: 70,
    aliases: ['it support', 'itsupport', 'it_support', 'support', 'it support engineer', 'it_support_engineer']
  },
  CLUSTER_ENGINEER: {
    persisted: 'Cluster Engineer',
    level: 70,
    aliases: ['cluster engineer', 'cluster_engineer', 'clusterengineer']
  },
  L2_ENGINEER: {
    persisted: 'Cluster Lead',
    level: 68,
    aliases: ['cluster lead', 'cluster_lead', 'l2 engineer', 'l2_engineer', 'cluster lead / l2 engineer']
  },
  BRANCH_ENGINEER: {
    persisted: 'Branch Engineer',
    level: 68,
    aliases: ['branch engineer', 'branch_engineer', 'branchengineer']
  },
  L1_ENGINEER: {
    persisted: 'L1 Engineer',
    level: 64,
    aliases: ['l1 engineer', 'l1_engineer', 'l1 support engineer', 'l1_support_engineer', 'l1 support']
  },
  AUDIT: {
    persisted: 'Audit',
    level: 65,
    aliases: ['audit', 'auditor']
  },
  TICKET_APPROVER: {
    persisted: 'Ticket Approver',
    level: 60,
    aliases: ['ticket approver', 'ticket_approver', 'ticketapprover']
  },
  MANAGER: {
    persisted: 'Manager',
    level: 60,
    aliases: ['manager']
  },
  REQUESTER: {
    persisted: 'Requester',
    level: 40,
    aliases: ['requester']
  },
  EMPLOYEE: {
    persisted: 'Employee',
    level: 40,
    aliases: ['employee', 'staff']
  },
  END_USER: {
    persisted: 'End User',
    level: 38,
    aliases: ['end user', 'end_user', 'end user / branch user', 'branch user', 'branch_user']
  },
  CLIENT: {
    persisted: 'Client-Viewer',
    level: 20,
    aliases: ['client', 'client-viewer', 'client viewer', 'client_viewer', 'readonly_client']
  }
};


const DEFAULT_ROLE_PERMISSIONS = {
  SUPER_ADMIN: {
    '*': {
      '*': true
    }
  },
  ADMIN: {
    dashboard: { read: true },
    users: { read: true, create: true, update: true, invite: true, deactivate: true },
    departments: { read: true, create: true, update: true, assign: true },
    clients: { read: true, create: true, update: true, archive: true, delete: true },
    projects: { read: true, create: true, update: true, archive: true, delete: true },
    tasks: { read: true, create: true, update: true, assign: true, approve: true, reject: true, delete: true },
    documents: { read: true, upload: true, delete: true },
    notifications: { read: true, send: true },
    reports: { read: true },
    audit: { read: true },
    chat: { read: true, write: true },
    workflow: { read: true, approve: true },
    settings: { read: true, update: true, manage_core: false },
    tickets: { read: true, create: true, update: true, assign: true, comment: true, close: true, reopen: true, dashboard: true },
    categories: { manage: true, read: true },
    engineer_mapping: { manage: true, read: true },
    ticket_sla: { manage: true, read: true },
    ticket_reports: { read: true }
  },
  CENTRAL_IT_ADMIN: {
    dashboard: { read: true },
    users: {
      read: true,
      create: true,
      update: true,
      invite: true,
      deactivate: true,
      view: true,
      edit: true
    },
    tickets: { read: true, create: true, update: true, assign: true, comment: true, close: true, reopen: true, dashboard: true },
    categories: { manage: true, read: true },
    engineer_mapping: { manage: true, read: true },
    ticket_sla: { manage: true, read: true },
    ticket_reports: { read: true },
    notifications: { read: true, send: true }
  },
  REGIONAL_IT_MANAGER: {
    dashboard: { read: true },
    tickets: { read: true, create: true, update: true, assign: true, comment: true, dashboard: true },
    ticket_reports: { read: true },
    notifications: { read: true, send: true }
  },
  IT_SUPPORT: {
    dashboard: { read: true },
    tickets: { read: true, update: true, assign: true, comment: true, close: true, reopen: true, dashboard: true },
    notifications: { read: true, send: true },
    documents: { read: true, upload: true },
    reports: { read: true }
  },
  L2_ENGINEER: {
    dashboard: { read: true },
    tickets: { read: true, create: true, update: true, assign: true, comment: true, dashboard: true },
    ticket_reports: { read: true },
    notifications: { read: true, send: true }
  },
  L1_ENGINEER: {
    dashboard: { read: true },
    tickets: { read: true, create: true, update: true, assign: true, comment: true, dashboard: true },
    notifications: { read: true, send: true }
  },
  AUDIT: {
    dashboard: { read: true },
    audit: { read: true }
  },
  MANAGER: {
    dashboard: { read: true },
    users: { read: true, create: true, update: true, invite: true },
    departments: { read: true },
    clients: { read: true, create: true, update: true, archive: true },
    projects: { read: true, create: true, update: true, delete: false },
    tasks: { read: true, create: true, update: true, assign: true, approve: true, reject: true, delete: true },
    documents: { read: true, upload: true, delete: true },
    notifications: { read: true, send: true },
    reports: { read: true },
    audit: { read: true },
    chat: { read: true, write: true },
    workflow: { read: true, approve: true },
    settings: { read: true, update: false, manage_core: false },
    tickets: { read: true, create: true, update: true, assign: true, comment: true, dashboard: true },
    ticket_reports: { read: true }
  },
  EMPLOYEE: {
    dashboard: { read: true },
    tasks: { read: true, update: true, status: true, complete: true },
    projects: { read: true },
    clients: { read: true },
    documents: { read: true, upload: true },
    notifications: { read: true },
    reports: { read: true },
    chat: { read: true, write: true },
    workflow: { read: true },
    tickets: { read: true, create: true, comment: true, dashboard: true }
  },
  END_USER: {
    dashboard: { read: true },
    tickets: { read: true, create: true, comment: true, dashboard: true },
    notifications: { read: true }
  },
  CLIENT: {
    dashboard: { read: true },
    tasks: { read: true },
    projects: { read: true },
    documents: { read: true },
    notifications: { read: true },
    chat: { read: true },
    settings: { read: true }
  },
  REQUESTER: {
    dashboard: { read: true },
    tickets: { read: true, create: true, comment: true, upload_attachment: true, reopen: true, view: true },
    profile: { read: true, update: true },
    notifications: { read: true }
  },
  BRANCH_ENGINEER: {
    dashboard: { read: true },
    tickets: { read: true, accept: true, resolve: true, comment: true, upload_resolution: true, view: true },
    profile: { read: true, update: true },
    notifications: { read: true }
  },
  CLUSTER_ENGINEER: {
    dashboard: { read: true },
    tickets: { read: true, resolve: true, escalate: true, comment: true, view: true },
    reports: { read: true },
    notifications: { read: true }
  },
  REGIONAL_ENGINEER: {
    dashboard: { read: true },
    tickets: { read: true, resolve: true, escalate: true, monitor_regions: true, view: true },
    reports: { read: true },
    notifications: { read: true }
  },
  STATE_ENGINEER: {
    dashboard: { read: true },
    tickets: { read: true, resolve: true, escalate: true, monitor_state: true, view: true },
    reports: { read: true },
    notifications: { read: true }
  },
  TICKET_APPROVER: {
    dashboard: { read: true },
    tickets: { read: true, approve: true, reject: true, view_history: true, view: true },
    notifications: { read: true }
  }
};

// Explicitly define IT_ADMIN permissions
DEFAULT_ROLE_PERMISSIONS.IT_ADMIN = {
  dashboard: { read: true },
  users: {
    read: true,
    create: true,
    update: true,
    invite: true,
    deactivate: true,
    view: true,
    edit: true
  },
  categories: {
    create: true,
    edit: true,
    delete: true,
    view: true,
    manage: true,
    read: true
  },
  engineer_mapping: {
    create: true,
    edit: true,
    delete: true,
    view: true,
    manage: true,
    read: true
  },
  ticket_sla: {
    create: true,
    edit: true,
    delete: true,
    view: true,
    manage: true,
    read: true
  },
  sla_management: {
    create: true,
    edit: true,
    delete: true,
    view: true,
    manage: true,
    read: true
  },
  'sla-management': {
    create: true,
    edit: true,
    delete: true,
    view: true,
    manage: true,
    read: true
  },
  tickets: {
    read: true,
    create: true,
    update: true,
    assign: true,
    comment: true,
    close: true,
    reopen: true,
    dashboard: true,
    view_all: true,
    view_all_tickets: true
  },
  reports: {
    read: true,
    view: true,
    export: true
  },
  notifications: {
    read: true,
    send: true,
    view: true
  }
};

function normalizeRole(role) {
  if (!role) return null;
  const raw = String(role).trim();
  const lowered = raw.toLowerCase().replace(/[_\s-]+/g, ' ');
  for (const [key, definition] of Object.entries(ROLE_DEFINITIONS)) {
    if (definition.persisted.toLowerCase() === lowered) return key;
    if ((definition.aliases || []).includes(lowered)) return key;
  }
  return null;
}

function persistRole(role) {
  const normalized = normalizeRole(role);
  if (!normalized) return role;
  return ROLE_DEFINITIONS[normalized].persisted;
}

function roleLevel(role) {
  const normalized = normalizeRole(role);
  return normalized ? ROLE_DEFINITIONS[normalized].level : 0;
}

function clonePermissions(roleKey) {
  const matrix = DEFAULT_ROLE_PERMISSIONS[roleKey] || {};
  return JSON.parse(JSON.stringify(matrix));
}

function applyPermissionOverrides(permissionMatrix, overrides = []) {
  const merged = JSON.parse(JSON.stringify(permissionMatrix || {}));
  for (const override of overrides) {
    if (!override) continue;
    const moduleKey = String(override.module_key || override.moduleKey || '').trim().toLowerCase();
    const permissionKey = String(override.permission_key || override.permissionKey || '').trim().toLowerCase();
    if (!moduleKey || !permissionKey) continue;
    if (!merged[moduleKey]) merged[moduleKey] = {};
    merged[moduleKey][permissionKey] = Boolean(Number(override.allowed) || override.allowed === true || String(override.allowed).toLowerCase() === 'true');
  }
  return merged;
}

function buildPermissionMatrix(role, overrides = []) {
  const normalized = normalizeRole(role);
  const base = normalized ? clonePermissions(normalized) : {};
  return applyPermissionOverrides(base, overrides);
}

function hasPermission(role, moduleKey, permissionKey, overrides = []) {
  const normalized = normalizeRole(role);
  if (!normalized) return false;
  if (normalized === 'SUPER_ADMIN') return true;

  const matrix = Array.isArray(overrides) || overrides ? buildPermissionMatrix(normalized, overrides) : clonePermissions(normalized);
  const moduleId = String(moduleKey || '').trim().toLowerCase();
  const permissionId = String(permissionKey || '').trim().toLowerCase();

  if (matrix['*'] && matrix['*']['*']) return true;
  if (!moduleId || !permissionId) return false;
  return Boolean(
    matrix[moduleId] &&
    (matrix[moduleId][permissionId] === true || matrix[moduleId]['*'] === true)
  );
}

function canManageRole(actorRole, targetRole) {
  const actorNormalized = normalizeRole(actorRole);
  const targetNormalized = normalizeRole(targetRole);
  if (!actorNormalized || !targetNormalized) return false;
  if (actorNormalized === 'SUPER_ADMIN') return true;
  if (targetNormalized === 'SUPER_ADMIN') return false;
  return roleLevel(actorNormalized) > roleLevel(targetNormalized);
}

function expandAllowedRoles(roles) {
  const rawRoles = Array.isArray(roles) ? roles : Array.from(arguments);
  const normalized = rawRoles
    .flat()
    .map(normalizeRole)
    .filter(Boolean);

  if (!normalized.length) return [];

  const allowed = new Set(normalized);
  const threshold = Math.min(...normalized.map(roleLevel));

  Object.keys(ROLE_DEFINITIONS).forEach((roleKey) => {
    if (roleLevel(roleKey) >= threshold) {
      allowed.add(roleKey);
    }
  });

  return Array.from(allowed);
}

module.exports = {
  ROLE_DEFINITIONS,
  DEFAULT_ROLE_PERMISSIONS,
  normalizeRole,
  persistRole,
  roleLevel,
  buildPermissionMatrix,
  hasPermission,
  canManageRole,
  expandAllowedRoles
};
