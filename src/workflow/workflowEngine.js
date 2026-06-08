

const TASK_STATES = {
  DRAFT: 'Draft',
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  REVIEW: 'Review',
  COMPLETED: 'Completed',
  CLOSED: 'Closed'
};

const PROJECT_STATES = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  ACTIVE: 'Active',
  ON_HOLD: 'On Hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived'
};

const ROLE_PERMISSIONS = {
  EMPLOYEE: {
    TASK: {
      [TASK_STATES.ASSIGNED]: [TASK_STATES.IN_PROGRESS],
      [TASK_STATES.IN_PROGRESS]: [TASK_STATES.REVIEW, TASK_STATES.COMPLETED],
      [TASK_STATES.REVIEW]: [TASK_STATES.COMPLETED]
    }
  },
  MANAGER: {
    TASK: {
      [TASK_STATES.DRAFT]: [TASK_STATES.ASSIGNED],
      [TASK_STATES.ASSIGNED]: [TASK_STATES.IN_PROGRESS],
      [TASK_STATES.IN_PROGRESS]: [TASK_STATES.REVIEW, TASK_STATES.COMPLETED],
      [TASK_STATES.REVIEW]: [TASK_STATES.COMPLETED],
      [TASK_STATES.COMPLETED]: [TASK_STATES.CLOSED]
    },
    PROJECT: {
      [PROJECT_STATES.DRAFT]: [PROJECT_STATES.PENDING_APPROVAL],
      [PROJECT_STATES.ACTIVE]: [PROJECT_STATES.ON_HOLD, PROJECT_STATES.COMPLETED],
      [PROJECT_STATES.ON_HOLD]: [PROJECT_STATES.ACTIVE],
      [PROJECT_STATES.COMPLETED]: [PROJECT_STATES.ARCHIVED]
    }
  },
  ADMIN: {
    TASK: Object.keys(TASK_STATES).reduce((acc, state) => {
      acc[state] = Object.values(TASK_STATES);
      return acc;
    }, {}),
    PROJECT: Object.keys(PROJECT_STATES).reduce((acc, state) => {
      acc[state] = Object.values(PROJECT_STATES);
      return acc;
    }, {})
  }
};

const APPROVAL_REQUIRED = {
  TASK: {
    [TASK_STATES.REVIEW]: [TASK_STATES.COMPLETED],
    [TASK_STATES.IN_PROGRESS]: [TASK_STATES.COMPLETED]
  },
  PROJECT: {
    [PROJECT_STATES.DRAFT]: [PROJECT_STATES.PENDING_APPROVAL], // MANAGER requests, ADMIN approves
    [PROJECT_STATES.ACTIVE]: [PROJECT_STATES.COMPLETED], // MANAGER requests, ADMIN approves

  }
};

function getStates(entityType) {
  return entityType === 'TASK' ? TASK_STATES : PROJECT_STATES;
}

function canTransition(entityType, fromState, toState, role) {
  const normalizedRole = role ? role.toUpperCase() : '';
  const permissions = ROLE_PERMISSIONS[normalizedRole] && ROLE_PERMISSIONS[normalizedRole][entityType];
  if (!permissions) return false;
  return permissions[fromState] && permissions[fromState].includes(toState);
}

function requiresApproval(entityType, fromState, toState) {
  const required = APPROVAL_REQUIRED[entityType];
  if (!required) return false;
  return required[fromState] && required[fromState].includes(toState);
}

function getNextStates(entityType, currentState, role) {
  const normalizedRole = role ? role.toUpperCase() : '';
  const permissions = ROLE_PERMISSIONS[normalizedRole] && ROLE_PERMISSIONS[normalizedRole][entityType];
  if (!permissions || !permissions[currentState]) return [];
  return permissions[currentState];
}

module.exports = {
  TASK_STATES,
  PROJECT_STATES,
  canTransition,
  requiresApproval,
  getStates,
  getNextStates
};