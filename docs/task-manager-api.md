# Task Management API

Base URL: `/api/task-manager` (also mounted without the `/api` prefix at `/task-manager`).

All endpoints require `Authorization: Bearer <JWT>` (obtained from `POST /api/auth/login`). Role gating uses the
existing role hierarchy: `SuperAdmin > Admin > Manager > Employee`. SuperAdmin always passes every check.

Standard response envelope:
```json
{ "success": true, "message": "OK", "data": { ... } }
```
Errors:
```json
{ "success": false, "message": "...", "code": "VALIDATION_ERROR", "details": null }
```

## Conventions

- All entities are addressed externally by `public_id` (e.g. `tmt_xxxxxxxxxxxxxxxx` for tasks, `tmp_...` for
  projects, `tmo_...` for occurrences), never the internal numeric `id`.
- User references in request bodies (`assignedTo`, `userId`, `managerId`, `memberIds`) use the numeric internal
  user id (`users._id`), the same value returned by `/task-manager/users/assignable` and `/task-manager/users/team`
  — matching the convention already used by the legacy `task_assignments` table.
- Pagination: `?page=1&limit=20` (`limit` capped at 100). Sorting: `?sortBy=<column>&sortDir=asc|desc`. Filtering:
  `?status=&priority=&search=` etc., documented per endpoint.
- Dates: `YYYY-MM-DD` for date-only fields, `YYYY-MM-DD HH:mm:ss` for datetimes.

## Task lifecycle (status state machine)

`Pending → In Progress → Completed (approval_status=Pending) → Approved` (final) or `→ Rejected` (employee edits and
resubmits via `complete` again → back to `Completed`/pending approval). `Overdue` is set automatically by a cron
sweep when `due_date` passes while the task is still `Pending`/`In Progress`. Dashboards count `Completed` +
`Approved` together as "completed".

## Photo-required completion rule

`POST /tasks/:id/complete` and `POST /occurrences/:id/complete` accept `multipart/form-data` with a `remarks` field
and up to 5 files under the `photos` field. If the task's `photo_required=true` and no photo is attached (and none
exists yet for that task/occurrence), the API returns `422 PHOTO_REQUIRED`. If `multiple_photos=false`, attaching
more than one file returns `422 PHOTO_LIMIT_EXCEEDED`.

---

## 1. Dashboard

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/dashboard/admin` | Admin+ | Tenant-wide counts, 7-day trend, by-status/priority, recent tasks, overdue list, pending approvals |
| GET | `/dashboard/manager` | Manager+ | Scoped to the manager's team (derived from `departments.manager_id`/`head_id`); team task summary, my approvals, upcoming deadlines |
| GET | `/dashboard/employee` | Employee+ | Own tasks only; counts, task progress, upcoming reminders, recent notifications, recent photos |

## 2. Projects

| Method | Path | Roles | Body / Query |
|---|---|---|---|
| GET | `/projects` | Employee+ | `?status=&priority=&search=&page=&limit=` (Employee sees only projects they manage or are a member of) |
| GET | `/projects/:id` | Employee+ | Returns project + `members[]` |
| POST | `/projects` | Manager+ | `{ name*, description, priority, startDate, endDate, managerId, memberIds[] }` |
| PUT | `/projects/:id` | Manager+ | Any subset of `{ name, description, status, priority, startDate, endDate, managerId }` |
| DELETE | `/projects/:id` | Admin | Soft delete |
| POST | `/projects/:id/members` | Manager+ | `{ userId*, roleInProject }` |
| DELETE | `/projects/:id/members/:userId` | Manager+ | |
| POST | `/projects/:id/request-closure` | Employee+ | 409 `TASKS_INCOMPLETE` if any task isn't `Completed`/`Approved`; otherwise creates a `PROJECT_CLOSURE` approval |

## 3. Tasks (Individual + Project)

`task_type` is `INDIVIDUAL` unless `projectId` is supplied, in which case it's `PROJECT`.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/tasks` | Employee+ | `?taskType=&status=&priority=&projectId=&assignedTo=&search=&dueBefore=&dueAfter=&page=&limit=&sortBy=&sortDir=` — Employee sees only their own |
| GET | `/tasks/:id` | Employee+ | Employee may only fetch their own task (403 otherwise) |
| POST | `/tasks` | Manager+ | `{ title*, assignedTo*, description, projectId, priority, startDate, dueDate, allowPhoto, photoRequired, multiplePhotos, reminderEnabled, reminderTime }` |
| PUT | `/tasks/:id` | Manager+ | Any subset of task fields incl. `assignedTo`, `status` |
| DELETE | `/tasks/:id` | Manager+ | Soft delete |
| POST | `/tasks/:id/start` | Employee (owner) | `Pending → In Progress` |
| POST | `/tasks/:id/complete` | Employee (owner) | multipart: `remarks`, `photos[]` — see photo rule above |
| GET | `/tasks/:id/history` | Manager+ | Reads `audit_logs` filtered to this task (module=`TaskManager`) |
| GET/POST | `/tasks/:id/comments` | Employee+ | `{ comment* }` |

## 4. Recurring Tasks

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/recurring-tasks` | Employee+ | Same filters as `/tasks`, `task_type=RECURRING` |
| GET | `/recurring-tasks/:id` | Employee+ | Returns task + `recurrence` rule + `occurrenceSummary` (latest 10) |
| POST | `/recurring-tasks` | Manager+ | `{ title*, assignedTo*, frequency* (Daily/Weekly/Monthly), startDate*, repeatEvery, daysOfWeek[] (Weekly), dayOfMonth (Monthly), endDate, priority, photoRequired, multiplePhotos, reminderEnabled, reminderTime }` — pre-generates the first 5 occurrences |
| PUT | `/recurring-tasks/:id` | Manager+ | Updates task and/or recurrence fields |
| DELETE | `/recurring-tasks/:id` | Manager+ | Soft delete |
| GET | `/recurring-tasks/:id/occurrences` | Employee+ | Paginated occurrence history |

A background job (`00:05` daily) generates each rule's next occurrence; another sweep (every 15 min) flips overdue
items; a reminder sweep (every 30 min) notifies assignees within 24h of `due_date` when `reminder_enabled=true`.

## 5. Gemba Walk

Implemented as a `RECURRING`-style task with `task_type=GEMBA_WALK`, extra `department/area/location` fields, and a
checklist.

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/gemba-walks` | Employee+ | |
| GET | `/gemba-walks/:id` | Employee+ | Returns task + recurrence + `details` (department/area/location) + `checklist[]` + `occurrenceSummary` |
| POST | `/gemba-walks` | Manager+ | Same body as recurring tasks plus `{ department, area, location, checklist: string[] }` |
| PUT | `/gemba-walks/:id` | Manager+ | |
| DELETE | `/gemba-walks/:id` | Manager+ | |
| GET | `/gemba-walks/:id/occurrences` | Employee+ | |

## 6. Occurrences (shared by Recurring Tasks & Gemba Walk)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/occurrences/:id` | Employee (owner) | Includes `photos[]` and `checklist[]` |
| POST | `/occurrences/:id/complete` | Employee (owner) | multipart `remarks` + `photos[]`, same photo rule |
| GET | `/occurrences/:id/checklist` | Employee+ | |
| PUT | `/occurrences/:id/checklist/:itemId` | Employee+ | `{ isCompleted* }` |

## 7. Approvals

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/approvals` | Manager+ | `?status=&type=(TASK_COMPLETION\|OCCURRENCE_COMPLETION\|PROJECT_CLOSURE)` — Manager scoped to their team |
| GET | `/approvals/:id` | Manager+ | |
| POST | `/approvals/:id/approve` | Manager+ | Sets entity to `Approved`/`Closed`, notifies requester |
| POST | `/approvals/:id/reject` | Manager+ | `{ reason* }` — sets entity to `Rejected`/reopens project |

`409 ALREADY_DECIDED` if the approval isn't `Pending` anymore.

## 8. Photos

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/photos/mine` | Employee+ | "My Photos" gallery, paginated |
| POST | `/photos` | Employee+ | multipart `{ taskId*, caption }` + `photos[]` — standalone attach, independent of task completion |
| DELETE | `/photos/:id` | Manager+ | |

## 9. Notifications

Reused as-is from the existing `/api/notifications` endpoints (not duplicated) — `GET /`, `PATCH /:id/read`,
`PATCH /read-all`, etc. Task Manager events use `entity_type='tm_task'` / `'tm_project'`.

## 10. Reports

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/reports/task-summary` | Employee+ | `?fromDate=&toDate=` — counts by status/priority/type |
| GET | `/reports/employee-performance` | Manager+ | Per-employee assigned/completed/overdue/completion-rate/avg-completion-hours; `?format=xlsx` to export |
| GET | `/reports/completion` | Employee+ | `?days=30` daily trend series |
| GET | `/reports/recurring` | Manager+ | Per recurring task: total/completed/overdue occurrences; `?format=xlsx` |
| GET | `/reports/gemba-walk` | Manager+ | Per gemba walk: department/area/location + completion counts; `?format=xlsx` |
| GET | `/reports/approvals` | Manager+ | Approve/reject counts, avg turnaround minutes, by-approver breakdown |

## 11. Audit Logs

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/audit-logs` | Manager+ | Reads the shared `audit_logs` table filtered to `module='TaskManager'`; `?entity=&entityId=&action=&page=&limit=` |

## 12. Users (thin, read-only — full user CRUD stays on `/api/users`)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/users/assignable` | Manager+ | All active users in the tenant, for assignment dropdowns |
| GET | `/users/team` | Manager+ | The calling manager's derived team (employees in departments they manage) |

---

## Error codes

| Code | Status | Meaning |
|---|---|---|
| `AUTH_MISSING` | 401 | No/invalid Authorization header |
| `AUTH_FORBIDDEN` | 403 | Role/permission check failed, or an Employee accessed a task/occurrence not assigned to them |
| `VALIDATION_ERROR` | 400 | Missing/invalid required field |
| `NOT_FOUND` | 404 | Entity not found (or not in the caller's tenant) |
| `INVALID_STATE` | 409 | Action not valid for the entity's current status (e.g. completing an already-completed task) |
| `ALREADY_DECIDED` | 409 | Approval already approved/rejected |
| `TASKS_INCOMPLETE` | 409 | Project closure requested before all tasks are done |
| `PHOTO_REQUIRED` | 422 | `photo_required=true` and no photo attached/on file |
| `PHOTO_LIMIT_EXCEEDED` | 422 | More than one photo attached when `multiple_photos=false` |

## Parent/Child/Checkpoint (schema-only, not exposed yet)

`tm_tasks.parent_task_id` (self-FK) and the `tm_checkpoints` table exist so a future release can support
parent/child tasks with checkpoints without a schema migration. No routes currently read/write `tm_checkpoints`.

## Testing

Run `npm run seed:task-manager` once against a running MySQL instance (also seeds users not already created by
`npm run seed:users`), start the server, then run `node scripts/test-task-manager-api.js` — an end-to-end script
that logs in as Admin/Manager/Employee and exercises every endpoint above (60 assertions covering happy paths,
validation errors, state-machine edge cases, and role-based 403s).
