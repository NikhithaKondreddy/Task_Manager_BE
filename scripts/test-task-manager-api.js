/**
 * End-to-end smoke test for the Task Management module.
 * Requires the server running (npm run dev / npm start) and
 * `npm run seed:task-manager` already executed at least once.
 *
 * Run: node scripts/test-task-manager-api.js
 */
const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:4000/api';

const CREDS = {
  admin: { email: 'tm.admin@nivarahousing.com', password: 'TmAdmin@123' },
  manager: { email: 'manager@nivarahousing.com', password: 'Manager@123' },
  employee: { email: 'employee@nivarahousing.com', password: 'Employee@123' }
};

const results = [];
function record(name, pass, info) {
  results.push({ name, pass, info });
  console.log(`${pass ? 'PASS' : 'FAIL'} - ${name}${info ? ' :: ' + info : ''}`);
}

async function call(method, path, { token, data, params, isMultipart, files } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = data;

  if (isMultipart) {
    const form = new FormData();
    Object.entries(data || {}).forEach(([k, v]) => { if (v !== undefined) form.append(k, v); });
    (files || []).forEach((f) => form.append('photos', f.buffer, { filename: f.filename, contentType: f.contentType }));
    body = form;
    Object.assign(headers, form.getHeaders());
  }

  try {
    const res = await axios({ method, url: `${BASE_URL}${path}`, data: body, params, headers, validateStatus: () => true });
    return res;
  } catch (err) {
    return { status: 0, data: { message: err.message } };
  }
}

function tinyPngBuffer() {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
}

async function login(role) {
  const res = await call('post', '/auth/login', { data: CREDS[role] });
  if (res.status !== 200 || !res.data.token) throw new Error(`Login failed for ${role}: ${JSON.stringify(res.data)}`);
  return { token: res.data.token, userId: res.data.user._id || null, tenantId: res.data.user.tenant_id };
}

async function main() {
  const admin = await login('admin');
  const manager = await login('manager');
  const employee = await login('employee');

  // --- Users (assignable/team) ---
  let assignable = await call('get', '/task-manager/users/assignable', { token: manager.token });
  record('GET /users/assignable (manager)', assignable.status === 200 && Array.isArray(assignable.data.data), `count=${assignable.data.data && assignable.data.data.length}`);
  const byEmail = {};
  (assignable.data.data || []).forEach((u) => { byEmail[u.email] = u; });
  const employeeId = byEmail['employee@nivarahousing.com'] && byEmail['employee@nivarahousing.com']._id;
  const saraId = byEmail['sara.tm@nivarahousing.com'] && byEmail['sara.tm@nivarahousing.com']._id;
  const mikeId = byEmail['mike.tm@nivarahousing.com'] && byEmail['mike.tm@nivarahousing.com']._id;
  const managerId = byEmail['manager@nivarahousing.com'] && byEmail['manager@nivarahousing.com']._id;
  if (!employeeId || !managerId) throw new Error('Could not resolve seeded user ids — run npm run seed:task-manager first');

  let team = await call('get', '/task-manager/users/team', { token: manager.token });
  record('GET /users/team (manager)', team.status === 200 && Array.isArray(team.data.data), `count=${team.data.data && team.data.data.length}`);

  // --- Auth guard ---
  let noAuth = await call('get', '/task-manager/tasks');
  record('GET /tasks without token -> 401', noAuth.status === 401, `status=${noAuth.status}`);

  let forbiddenCreate = await call('post', '/task-manager/tasks', { token: employee.token, data: { title: 'x', assignedTo: employeeId } });
  record('Employee creating a task -> 403', forbiddenCreate.status === 403, `status=${forbiddenCreate.status}`);

  let forbiddenApprovals = await call('get', '/task-manager/approvals', { token: employee.token });
  record('Employee reading approvals -> 403', forbiddenApprovals.status === 403, `status=${forbiddenApprovals.status}`);

  // --- Projects ---
  let createProject = await call('post', '/task-manager/projects', {
    token: manager.token,
    data: { name: 'QA Test Project', description: 'Created by e2e test', priority: 'Medium', managerId, memberIds: [employeeId] }
  });
  record('POST /projects', createProject.status === 201, `status=${createProject.status}`);
  const project = createProject.data.data;

  let getProject = await call('get', `/task-manager/projects/${project.public_id}`, { token: employee.token });
  record('GET /projects/:id (member)', getProject.status === 200 && getProject.data.data.members.length === 2, `status=${getProject.status} members=${getProject.data.data && getProject.data.data.members.length}`);

  let updateProject = await call('put', `/task-manager/projects/${project.public_id}`, { token: manager.token, data: { description: 'Updated description' } });
  record('PUT /projects/:id', updateProject.status === 200 && updateProject.data.data.description === 'Updated description', `status=${updateProject.status}`);

  let addMember = await call('post', `/task-manager/projects/${project.public_id}/members`, { token: manager.token, data: { userId: saraId } });
  record('POST /projects/:id/members', addMember.status === 200 && addMember.data.data.length === 3, `status=${addMember.status} members=${addMember.data.data && addMember.data.data.length}`);

  let removeMember = await call('delete', `/task-manager/projects/${project.public_id}/members/${saraId}`, { token: manager.token });
  record('DELETE /projects/:id/members/:userId', removeMember.status === 200 && removeMember.data.data.length === 2, `status=${removeMember.status} members=${removeMember.data.data && removeMember.data.data.length}`);

  let listProjects = await call('get', '/task-manager/projects', { token: manager.token });
  record('GET /projects (list)', listProjects.status === 200 && listProjects.data.data.total >= 1, `total=${listProjects.data.data && listProjects.data.data.total}`);

  // --- Project task + closure flow ---
  let createProjectTask = await call('post', '/task-manager/tasks', {
    token: manager.token,
    data: { title: 'Setup QA Environment', assignedTo: employeeId, projectId: project.public_id, priority: 'High', dueDate: '2026-12-31 17:00:00' }
  });
  record('POST /tasks (project task)', createProjectTask.status === 201 && createProjectTask.data.data.task_type === 'PROJECT', `status=${createProjectTask.status}`);
  const projectTask = createProjectTask.data.data;

  let closeBeforeDone = await call('post', `/task-manager/projects/${project.public_id}/request-closure`, { token: manager.token });
  record('POST request-closure before tasks done -> 409', closeBeforeDone.status === 409, `status=${closeBeforeDone.status}`);

  let completeProjectTaskNoPhoto = await call('post', `/task-manager/tasks/${projectTask.public_id}/complete`, { token: employee.token, data: { remarks: 'Done' } });
  record('POST /tasks/:id/complete (no photo required)', completeProjectTaskNoPhoto.status === 200, `status=${completeProjectTaskNoPhoto.status}`);

  let closeAfterDone = await call('post', `/task-manager/projects/${project.public_id}/request-closure`, { token: manager.token });
  record('POST request-closure after tasks done -> 200', closeAfterDone.status === 200, `status=${closeAfterDone.status}`);

  let approvalsForManager = await call('get', '/task-manager/approvals', { token: manager.token, params: { status: 'Pending' } });
  const closureApproval = (approvalsForManager.data.data.rows || []).find((a) => a.approval_type === 'PROJECT_CLOSURE' && a.entity_id === project.id);
  record('GET /approvals contains pending project closure', !!closureApproval, `found=${!!closureApproval}`);

  if (closureApproval) {
    let approveClosure = await call('post', `/task-manager/approvals/${closureApproval.id}/approve`, { token: manager.token });
    record('POST /approvals/:id/approve (project closure)', approveClosure.status === 200, `status=${approveClosure.status}`);
  }

  // --- Individual task: photo-required completion + approve flow ---
  let createIndivTask = await call('post', '/task-manager/tasks', {
    token: manager.token,
    data: { title: 'Server Maintenance', assignedTo: employeeId, priority: 'High', photoRequired: true, dueDate: '2026-12-31 17:00:00' }
  });
  record('POST /tasks (individual, photoRequired)', createIndivTask.status === 201, `status=${createIndivTask.status}`);
  const indivTask = createIndivTask.data.data;

  let startTask = await call('post', `/task-manager/tasks/${indivTask.public_id}/start`, { token: employee.token });
  record('POST /tasks/:id/start', startTask.status === 200 && startTask.data.data.status === 'In Progress', `status=${startTask.status}`);

  let completeNoPhoto = await call('post', `/task-manager/tasks/${indivTask.public_id}/complete`, { token: employee.token, data: { remarks: 'done' } });
  record('POST /tasks/:id/complete without required photo -> 422', completeNoPhoto.status === 422 && completeNoPhoto.data.code === 'PHOTO_REQUIRED', `status=${completeNoPhoto.status} code=${completeNoPhoto.data.code}`);

  let completeWithPhoto = await call('post', `/task-manager/tasks/${indivTask.public_id}/complete`, {
    token: employee.token, isMultipart: true, data: { remarks: 'All good' },
    files: [{ buffer: tinyPngBuffer(), filename: 'photo.png', contentType: 'image/png' }]
  });
  record('POST /tasks/:id/complete with photo -> 200', completeWithPhoto.status === 200, `status=${completeWithPhoto.status}`);

  let doubleComplete = await call('post', `/task-manager/tasks/${indivTask.public_id}/complete`, {
    token: employee.token, isMultipart: true, data: { remarks: 'again' }, files: [{ buffer: tinyPngBuffer(), filename: 'p2.png', contentType: 'image/png' }]
  });
  record('POST /tasks/:id/complete again -> 409 INVALID_STATE', doubleComplete.status === 409, `status=${doubleComplete.status}`);

  let history = await call('get', `/task-manager/tasks/${indivTask.public_id}/history`, { token: manager.token });
  record('GET /tasks/:id/history', history.status === 200 && history.data.data.rows.length > 0, `rows=${history.data.data && history.data.data.rows.length}`);

  let addComment = await call('post', `/task-manager/tasks/${indivTask.public_id}/comments`, { token: employee.token, data: { comment: 'Looks good' } });
  record('POST /tasks/:id/comments', addComment.status === 201, `status=${addComment.status}`);

  let listComments = await call('get', `/task-manager/tasks/${indivTask.public_id}/comments`, { token: manager.token });
  record('GET /tasks/:id/comments', listComments.status === 200 && listComments.data.data.length === 1, `count=${listComments.data.data && listComments.data.data.length}`);

  let pendingApprovals = await call('get', '/task-manager/approvals', { token: manager.token, params: { status: 'Pending', type: 'TASK_COMPLETION' } });
  const taskApproval = (pendingApprovals.data.data.rows || []).find((a) => a.entity && a.entity.public_id === indivTask.public_id);
  record('GET /approvals contains task completion', !!taskApproval, `found=${!!taskApproval}`);

  if (taskApproval) {
    let approveTask = await call('post', `/task-manager/approvals/${taskApproval.id}/approve`, { token: manager.token });
    record('POST /approvals/:id/approve (task)', approveTask.status === 200, `status=${approveTask.status}`);

    let doubleApprove = await call('post', `/task-manager/approvals/${taskApproval.id}/approve`, { token: manager.token });
    record('POST /approvals/:id/approve again -> 409 ALREADY_DECIDED', doubleApprove.status === 409, `status=${doubleApprove.status}`);
  }

  // --- Reject flow on a second task (assigned to the employee test account, which has login creds) ---
  let createTask2 = await call('post', '/task-manager/tasks', { token: manager.token, data: { title: 'Security Patch Update', assignedTo: employeeId, priority: 'Medium' } });
  const task2 = createTask2.data.data;
  await call('post', `/task-manager/tasks/${task2.public_id}/complete`, { token: employee.token, data: { remarks: 'patched' } });

  let pendingApprovals2 = await call('get', '/task-manager/approvals', { token: manager.token, params: { status: 'Pending', type: 'TASK_COMPLETION' } });
  const task2Approval = (pendingApprovals2.data.data.rows || []).find((a) => a.entity && a.entity.public_id === task2.public_id);
  if (task2Approval) {
    let rejectNoReason = await call('post', `/task-manager/approvals/${task2Approval.id}/reject`, { token: manager.token, data: {} });
    record('POST /approvals/:id/reject without reason -> 400', rejectNoReason.status === 400, `status=${rejectNoReason.status}`);

    let reject = await call('post', `/task-manager/approvals/${task2Approval.id}/reject`, { token: manager.token, data: { reason: 'Incomplete patch notes' } });
    record('POST /approvals/:id/reject with reason -> 200', reject.status === 200, `status=${reject.status}`);
  } else {
    record('Reject-flow approval created', false, 'task2Approval not found (completion may have failed)');
  }

  // --- Recurring Tasks ---
  let createRecurring = await call('post', '/task-manager/recurring-tasks', {
    token: manager.token,
    data: { title: 'Daily Equipment Check', assignedTo: employeeId, priority: 'Medium', frequency: 'Daily', repeatEvery: 1, startDate: '2026-01-01', photoRequired: false }
  });
  record('POST /recurring-tasks', createRecurring.status === 201, `status=${createRecurring.status}`);
  const recurring = createRecurring.data.data;

  let getRecurring = await call('get', `/task-manager/recurring-tasks/${recurring.public_id}`, { token: employee.token });
  record('GET /recurring-tasks/:id', getRecurring.status === 200 && getRecurring.data.data.recurrence.frequency === 'Daily', `status=${getRecurring.status}`);

  let recurringOccurrences = await call('get', `/task-manager/recurring-tasks/${recurring.public_id}/occurrences`, { token: employee.token });
  record('GET /recurring-tasks/:id/occurrences', recurringOccurrences.status === 200 && recurringOccurrences.data.data.rows.length > 0, `count=${recurringOccurrences.data.data && recurringOccurrences.data.data.rows.length}`);
  const occurrence = recurringOccurrences.data.data.rows[0];

  let getOccurrence = await call('get', `/task-manager/occurrences/${occurrence.public_id}`, { token: employee.token });
  record('GET /occurrences/:id', getOccurrence.status === 200, `status=${getOccurrence.status}`);

  let completeOccurrence = await call('post', `/task-manager/occurrences/${occurrence.public_id}/complete`, { token: employee.token, data: { remarks: 'checked' } });
  record('POST /occurrences/:id/complete', completeOccurrence.status === 200, `status=${completeOccurrence.status}`);

  // --- Gemba Walk ---
  let createGemba = await call('post', '/task-manager/gemba-walks', {
    token: manager.token,
    data: {
      title: 'Gemba Walk - Line 2', assignedTo: employeeId, priority: 'Low', frequency: 'Weekly', repeatEvery: 1, daysOfWeek: ['MON'],
      startDate: '2026-01-05', department: 'Production', area: 'Line 2', location: 'Plant B', checklist: ['Check signage', 'Check PPE compliance']
    }
  });
  record('POST /gemba-walks', createGemba.status === 201, `status=${createGemba.status}`);
  const gemba = createGemba.data.data;

  let getGemba = await call('get', `/task-manager/gemba-walks/${gemba.public_id}`, { token: manager.token });
  record('GET /gemba-walks/:id', getGemba.status === 200 && getGemba.data.data.checklist.length === 2, `status=${getGemba.status}`);

  let gembaOccurrences = await call('get', `/task-manager/gemba-walks/${gemba.public_id}/occurrences`, { token: employee.token });
  record('GET /gemba-walks/:id/occurrences', gembaOccurrences.status === 200 && gembaOccurrences.data.data.rows.length > 0, `count=${gembaOccurrences.data.data && gembaOccurrences.data.data.rows.length}`);
  const gembaOccurrence = gembaOccurrences.data.data.rows[0];

  let gembaChecklist = await call('get', `/task-manager/occurrences/${gembaOccurrence.public_id}/checklist`, { token: employee.token });
  record('GET /occurrences/:id/checklist', gembaChecklist.status === 200 && gembaChecklist.data.data.length === 2, `count=${gembaChecklist.data.data && gembaChecklist.data.data.length}`);
  const checklistItem = gembaChecklist.data.data[0];

  let toggleChecklist = await call('put', `/task-manager/occurrences/${gembaOccurrence.public_id}/checklist/${checklistItem.id}`, { token: employee.token, data: { isCompleted: true } });
  record('PUT /occurrences/:id/checklist/:itemId', toggleChecklist.status === 200 && toggleChecklist.data.data[0].is_completed === 1, `status=${toggleChecklist.status}`);

  let completeGembaNoPhoto = await call('post', `/task-manager/occurrences/${gembaOccurrence.public_id}/complete`, { token: employee.token, data: { remarks: 'walked' } });
  record('POST gemba occurrence complete without photo -> 422', completeGembaNoPhoto.status === 422, `status=${completeGembaNoPhoto.status}`);

  let completeGembaWithPhoto = await call('post', `/task-manager/occurrences/${gembaOccurrence.public_id}/complete`, {
    token: employee.token, isMultipart: true, data: { remarks: 'walked' },
    files: [{ buffer: tinyPngBuffer(), filename: 'gemba.png', contentType: 'image/png' }]
  });
  record('POST gemba occurrence complete with photo -> 200', completeGembaWithPhoto.status === 200, `status=${completeGembaWithPhoto.status}`);

  // --- Photos ---
  let myPhotos = await call('get', '/task-manager/photos/mine', { token: employee.token });
  record('GET /photos/mine', myPhotos.status === 200 && myPhotos.data.data.length > 0, `count=${myPhotos.data.data && myPhotos.data.data.length}`);

  let uploadPhoto = await call('post', '/task-manager/photos', {
    token: employee.token, isMultipart: true, data: { taskId: indivTask.public_id, caption: 'extra evidence' },
    files: [{ buffer: tinyPngBuffer(), filename: 'extra.png', contentType: 'image/png' }]
  });
  record('POST /photos (standalone upload)', uploadPhoto.status === 201, `status=${uploadPhoto.status}`);
  const uploadedPhotoId = uploadPhoto.data.data && uploadPhoto.data.data[0] && uploadPhoto.data.data[0].id;

  if (uploadedPhotoId) {
    let deletePhoto = await call('delete', `/task-manager/photos/${uploadedPhotoId}`, { token: manager.token });
    record('DELETE /photos/:id', deletePhoto.status === 200, `status=${deletePhoto.status}`);
  }

  // --- Dashboards ---
  let dashAdmin = await call('get', '/task-manager/dashboard/admin', { token: admin.token });
  record('GET /dashboard/admin', dashAdmin.status === 200 && dashAdmin.data.data.counts.totalTasks >= 0, `status=${dashAdmin.status}`);

  let dashAdminForbidden = await call('get', '/task-manager/dashboard/admin', { token: employee.token });
  record('Employee hitting /dashboard/admin -> 403', dashAdminForbidden.status === 403, `status=${dashAdminForbidden.status}`);

  let dashManager = await call('get', '/task-manager/dashboard/manager', { token: manager.token });
  record('GET /dashboard/manager', dashManager.status === 200 && Array.isArray(dashManager.data.data.teamTaskSummary), `status=${dashManager.status}`);

  let dashEmployee = await call('get', '/task-manager/dashboard/employee', { token: employee.token });
  record('GET /dashboard/employee', dashEmployee.status === 200 && dashEmployee.data.data.counts.myTasks >= 0, `status=${dashEmployee.status}`);

  // --- Reports ---
  let reportSummary = await call('get', '/task-manager/reports/task-summary', { token: employee.token });
  record('GET /reports/task-summary', reportSummary.status === 200, `status=${reportSummary.status}`);

  let reportPerf = await call('get', '/task-manager/reports/employee-performance', { token: manager.token });
  record('GET /reports/employee-performance', reportPerf.status === 200 && Array.isArray(reportPerf.data.data), `status=${reportPerf.status}`);

  let reportCompletion = await call('get', '/task-manager/reports/completion', { token: employee.token });
  record('GET /reports/completion', reportCompletion.status === 200 && Array.isArray(reportCompletion.data.data), `status=${reportCompletion.status}`);

  let reportRecurring = await call('get', '/task-manager/reports/recurring', { token: manager.token });
  record('GET /reports/recurring', reportRecurring.status === 200, `status=${reportRecurring.status}`);

  let reportGemba = await call('get', '/task-manager/reports/gemba-walk', { token: manager.token });
  record('GET /reports/gemba-walk', reportGemba.status === 200, `status=${reportGemba.status}`);

  let reportApprovals = await call('get', '/task-manager/reports/approvals', { token: manager.token });
  record('GET /reports/approvals', reportApprovals.status === 200, `status=${reportApprovals.status}`);

  let reportXlsx = await call('get', '/task-manager/reports/employee-performance', { token: manager.token, params: { format: 'xlsx' } });
  record('GET /reports/employee-performance?format=xlsx', reportXlsx.status === 200, `status=${reportXlsx.status}`);

  // --- Audit logs ---
  let auditLogs = await call('get', '/task-manager/audit-logs', { token: manager.token });
  record('GET /audit-logs', auditLogs.status === 200 && auditLogs.data.data.rows.length > 0, `rows=${auditLogs.data.data && auditLogs.data.data.rows.length}`);

  let auditLogsForbidden = await call('get', '/task-manager/audit-logs', { token: employee.token });
  record('Employee hitting /audit-logs -> 403', auditLogsForbidden.status === 403, `status=${auditLogsForbidden.status}`);

  // --- Not found ---
  let notFoundTask = await call('get', '/task-manager/tasks/does-not-exist', { token: manager.token });
  record('GET /tasks/:id (invalid) -> 404', notFoundTask.status === 404, `status=${notFoundTask.status}`);

  // --- Cleanup: delete a disposable task ---
  let deleteTask = await call('delete', `/task-manager/tasks/${task2.public_id}`, { token: manager.token });
  record('DELETE /tasks/:id', deleteTask.status === 200, `status=${deleteTask.status}`);

  const failed = results.filter((r) => !r.pass);
  console.log('\n--------------------------------------------------');
  console.log(`TOTAL: ${results.length}  PASSED: ${results.length - failed.length}  FAILED: ${failed.length}`);
  if (failed.length) {
    console.log('\nFAILED TESTS:');
    failed.forEach((f) => console.log(` - ${f.name} :: ${f.info || ''}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exitCode = 1;
});
