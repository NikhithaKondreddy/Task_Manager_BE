



const rules = [

  {
    ruleCode: 'ACCESS_OWN_RECORDS_ONLY',
    description: 'Users can only access their own records unless role is ADMIN',
    conditions: {
      userRole: { $ne: 'ADMIN' },
      resourceOwnerId: { $ne: '{{userId}}' }
    },
    action: 'DENY',
    priority: 1,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'ADMIN_FULL_ACCESS',
    description: 'Admins have full access',
    conditions: {
      userRole: 'ADMIN'
    },
    action: 'ALLOW',
    priority: 2,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'EMPLOYEE_CANNOT_APPROVE_OWN_REQUEST',
    description: 'Employees cannot approve their own requests',
    conditions: {
      userRole: 'EMPLOYEE',
      action: 'APPROVE',
      resourceOwnerId: '{{userId}}'
    },
    action: 'DENY',
    priority: 3,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'LEAVE_DAYS_REQUIRE_APPROVAL',
    description: 'Leave days exceeding limit require manager approval',
    conditions: {
      action: 'LEAVE_APPLY',
      leaveDays: { $gt: '{{LEAVE_MAX_DAYS}}' }
    },
    action: 'REQUIRE_APPROVAL',
    priority: 4,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'APPROVED_RECORDS_IMMUTABLE',
    description: 'Approved or locked records cannot be modified',
    conditions: {
      action: { $in: ['UPDATE', 'DELETE'] },
      recordStatus: { $in: ['APPROVED', 'LOCKED'] }
    },
    action: 'DENY',
    priority: 5,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'SALARY_NON_NEGATIVE',
    description: 'Salary and financial fields must not be negative',
    conditions: {
      action: { $in: ['CREATE', 'UPDATE'] },
      payload: {
        $or: [
          { salary: { $lt: 0 } },
          { budget: { $lt: 0 } },
          { amount: { $lt: 0 } }
        ]
      }
    },
    action: 'DENY',
    priority: 6,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'OTP_RATE_LIMIT',
    description: 'Rate limit OTP requests',
    conditions: {
      action: 'OTP_REQUEST',
      recentRequests: { $gte: '{{OTP_MAX_REQUESTS}}' }
    },
    action: 'DENY',
    priority: 7,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'task_creation',
    description: 'Validate task creation permissions and data',
    conditions: {
      userRole: 'MANAGER',
      action: 'POST__TASKS_CREATEJSON',
      payload: {
        title: { $exists: true },
        projectId: { $exists: true }
      }
    },
    action: 'ALLOW',
    priority: 8,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'task_update',
    description: 'Validate task update permissions',
    conditions: {
      userRole: 'MANAGER',
      action: 'PUT_:ID'
    },
    action: 'ALLOW',
    priority: 9,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'task_reassign',
    description: 'Validate task reassignment permissions',
    conditions: {
      userRole: { $in: ['MANAGER', 'ADMIN'] },
      action: 'PATCH_:TASKID_REASSIGN_:USERID'
    },
    action: 'ALLOW',
    priority: 10,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'task_status_update',
    description: 'Validate task status update permissions',
    conditions: {
      userRole: { $in: ['EMPLOYEE', 'MANAGER', 'ADMIN'] },
      action: 'PATCH_:ID_STATUS'
    },
    action: 'ALLOW',
    priority: 11,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'task_delete',
    description: 'Validate task deletion permissions',
    conditions: {
      userRole: { $in: ['MANAGER', 'ADMIN'] },
      action: 'DELETE_:ID'
    },
    action: 'ALLOW',
    priority: 12,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'project_creation',
    description: 'Validate project creation permissions and data',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'POST_',
      payload: {
        name: { $exists: true },
        client_id: { $exists: true }
      }
    },
    action: 'ALLOW',
    priority: 13,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'project_update',
    description: 'Validate project update permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'PUT_:ID'
    },
    action: 'ALLOW',
    priority: 14,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'project_delete',
    description: 'Validate project deletion permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'DELETE_:ID'
    },
    action: 'ALLOW',
    priority: 15,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'project_department_add',
    description: 'Validate adding departments to projects',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'POST_:ID_DEPARTMENTS'
    },
    action: 'ALLOW',
    priority: 16,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'project_department_delete',
    description: 'Validate removing departments from projects',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'DELETE_:ID_DEPARTMENTS_:DEPTID'
    },
    action: 'ALLOW',
    priority: 17,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'client_creation',
    description: 'Validate client creation permissions',
    conditions: {
      userRole: 'ADMIN',
      action: 'POST_',
      payload: {
        name: { $exists: true }
      }
    },
    action: 'ALLOW',
    priority: 18,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_update',
    description: 'Validate client update permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'PUT_:ID'
    },
    action: 'ALLOW',
    priority: 19,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_delete',
    description: 'Validate client deletion permissions',
    conditions: {
      userRole: 'ADMIN',
      action: 'DELETE_:ID'
    },
    action: 'ALLOW',
    priority: 20,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_permanent_delete',
    description: 'Validate permanent client deletion permissions',
    conditions: {
      userRole: 'ADMIN',
      action: 'DELETE_:ID_PERMANENT'
    },
    action: 'ALLOW',
    priority: 21,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_assign_manager',
    description: 'Validate assigning manager to client',
    conditions: {
      userRole: 'ADMIN',
      action: 'POST_:ID_ASSIGN_MANAGER'
    },
    action: 'ALLOW',
    priority: 22,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_create_viewer',
    description: 'Validate creating client viewer',
    conditions: {
      userRole: 'ADMIN',
      action: 'POST_:ID_CREATE_VIEWER'
    },
    action: 'ALLOW',
    priority: 23,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_contact_add',
    description: 'Validate adding client contacts',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'POST_:ID_CONTACTS'
    },
    action: 'ALLOW',
    priority: 24,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_contact_update',
    description: 'Validate updating client contacts',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'PUT_:ID_CONTACTS_:CONTACTID'
    },
    action: 'ALLOW',
    priority: 25,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'client_contact_delete',
    description: 'Validate deleting client contacts',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'DELETE_:ID_CONTACTS_:CONTACTID'
    },
    action: 'ALLOW',
    priority: 26,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'user_creation',
    description: 'Validate user creation permissions',
    conditions: {
      userRole: 'ADMIN',
      action: 'POST_CREATE'
    },
    action: 'ALLOW',
    priority: 27,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'user_update',
    description: 'Validate user update permissions',
    conditions: {
      userRole: 'ADMIN',
      action: 'PUT_UPDATE_:ID'
    },
    action: 'ALLOW',
    priority: 28,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'user_delete',
    description: 'Validate user deletion permissions',
    conditions: {
      userRole: 'ADMIN',
      action: 'DELETE_DELETE_:USER_ID'
    },
    action: 'ALLOW',
    priority: 29,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'user_list',
    description: 'Validate user listing permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'GET_GETUSERS'
    },
    action: 'ALLOW',
    priority: 30,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'user_view',
    description: 'Validate viewing user details permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'GET_GETUSERBYID_:ID'
    },
    action: 'ALLOW',
    priority: 31,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'subtask_creation',
    description: 'Validate subtask creation permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
      action: 'POST_'
    },
    action: 'ALLOW',
    priority: 32,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'subtask_update',
    description: 'Validate subtask update permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
      action: 'PUT_:ID'
    },
    action: 'ALLOW',
    priority: 33,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'subtask_delete',
    description: 'Validate subtask deletion permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER'] },
      action: 'DELETE_:ID'
    },
    action: 'ALLOW',
    priority: 34,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'upload_file',
    description: 'Validate file upload permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
      action: 'POST_UPLOAD'
    },
    action: 'ALLOW',
    priority: 35,
    active: true,
    version: '1.0'
  },
  {
    ruleCode: 'upload_list',
    description: 'Validate viewing uploads permissions',
    conditions: {
      userRole: { $in: ['ADMIN', 'MANAGER', 'EMPLOYEE'] },
      action: 'GET_GETUPLOADS_:ID'
    },
    action: 'ALLOW',
    priority: 36,
    active: true,
    version: '1.0'
  },

  {
    ruleCode: 'DEFAULT_ALLOW',
    description: 'Allow by default if no rules match',
    conditions: {},
    action: 'ALLOW',
    priority: 999,
    active: true,
    version: '1.0'
  }
];

module.exports = rules;