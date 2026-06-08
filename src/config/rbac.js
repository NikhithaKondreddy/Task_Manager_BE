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
  REGIONAL_IT_MANAGER: {
    persisted: 'Regional IT Manager',
    level: 72,
    aliases: ['regional it manager', 'regional_it_manager']
  },
  IT_SUPPORT: {
    persisted: 'IT Support',
    level: 70,
    aliases: ['it support', 'itsupport', 'it_support', 'support']
  },
  L2_ENGINEER: {
    persisted: 'Cluster Lead',
    level: 68,
    aliases: ['cluster lead', 'cluster_lead', 'l2 engineer', 'l2_engineer', 'cluster lead / l2 engineer']
  },
  L1_ENGINEER: {
    persisted: 'L1 Engineer',
    level: 64,
    aliases: ['l1 engineer', 'l1_engineer']
  },
  AUDIT: {
    persisted: 'Audit',
    level: 65,
    aliases: ['audit', 'auditor']
  },
  MANAGER: {
    persisted: 'Manager',
    level: 60,
    aliases: ['manager']
  },
  EMPLOYEE: {
    persisted: 'Employee',
    level: 40,
    aliases: ['employee', 'staff']
  },
  END_USER: {
    persisted: 'End User',
    level: 38,
    aliases: ['end user', 'end_user']
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
  }
};

function normalizeRole(role) {
  if (!role) return null;
  const raw = String(role).trim();
  const lowered = raw.toLowerCase().replace(/[_\s]+/g, ' ');
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
