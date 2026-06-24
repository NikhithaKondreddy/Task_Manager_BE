

const RULES = {

  TASK_CREATE: 'task_creation',
  TASK_VIEW: 'task_view',
  TASK_UPDATE: 'task_update',
  TASK_DELETE: 'task_delete',
  TASK_REASSIGN: 'task_reassign',

  PROJECT_CREATE: 'project_creation',
  PROJECT_VIEW: 'project_view',
  PROJECT_UPDATE: 'project_update',
  PROJECT_DELETE: 'project_delete',

  CLIENT_CREATE: 'client_creation',
  CLIENT_VIEW: 'client_view',
  CLIENT_UPDATE: 'client_update',
  CLIENT_DELETE: 'client_delete',
  CLIENT_PERMANENT_DELETE: 'client_permanent_delete',
  CLIENT_ASSIGN_MANAGER: 'client_assign_manager',
  CLIENT_CREATE_VIEWER: 'client_create_viewer',
  CLIENT_CONTACT_ADD: 'client_contact_add',
  CLIENT_CONTACT_UPDATE: 'client_contact_update',
  CLIENT_CONTACT_DELETE: 'client_contact_delete',

  USER_CREATE: 'user_creation',
  USER_VIEW: 'user_view',
  USER_LIST: 'user_list',
  USER_UPDATE: 'user_update',
  USER_DELETE: 'user_delete',

  SUBTASK_CREATE: 'subtask_creation',
  SUBTASK_VIEW: 'subtask_view',
  SUBTASK_UPDATE: 'subtask_update',
  SUBTASK_DELETE: 'subtask_delete',

  UPLOAD_CREATE: 'upload_file',
  UPLOAD_VIEW: 'upload_list',
  UPLOAD_DELETE: 'upload_delete'
};

module.exports = RULES;
