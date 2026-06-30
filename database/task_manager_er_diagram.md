# Task Management Module — ER Diagram

New tables (`tm_*`) and the existing shared tables they reference. Renders as a diagram in any Mermaid-aware
viewer (GitHub, VS Code Markdown Preview Mermaid extension, mermaid.live, etc.).

```mermaid
erDiagram
    USERS ||--o{ TM_TASKS : "assigned_to / assigned_by"
    USERS ||--o{ TM_PROJECTS : "manager_id / created_by"
    USERS ||--o{ TM_PROJECT_MEMBERS : "user_id"
    USERS ||--o{ TM_TASK_PHOTOS : "uploaded_by"
    USERS ||--o{ TM_TASK_COMMENTS : "user_id"
    USERS ||--o{ TM_APPROVALS : "requested_by / decided_by"
    DEPARTMENTS ||--o{ USERS : "department_public_id (manager/head -> team derivation)"

    TM_PROJECTS ||--o{ TM_PROJECT_MEMBERS : "has"
    TM_PROJECTS ||--o{ TM_TASKS : "project_id (task_type=PROJECT)"

    TM_TASKS ||--o| TM_TASK_RECURRENCE : "recurrence_id (RECURRING / GEMBA_WALK)"
    TM_TASKS ||--o{ TM_TASK_OCCURRENCES : "task_id"
    TM_TASKS ||--o| TM_GEMBA_DETAILS : "task_id (GEMBA_WALK)"
    TM_TASKS ||--o{ TM_CHECKLIST_ITEMS : "task_id (template)"
    TM_TASKS ||--o{ TM_TASK_PHOTOS : "task_id"
    TM_TASKS ||--o{ TM_TASK_COMMENTS : "task_id"
    TM_TASKS ||--o{ TM_TASKS : "parent_task_id (self, future)"
    TM_TASKS ||--o{ TM_CHECKPOINTS : "parent_task_id (future, schema-only)"

    TM_TASK_OCCURRENCES ||--o{ TM_CHECKLIST_ITEMS : "occurrence_id (cloned per occurrence)"
    TM_TASK_OCCURRENCES ||--o{ TM_TASK_PHOTOS : "occurrence_id"

    AUDIT_LOGS }o--|| TM_TASKS : "entity='Task'/'TaskOccurrence', entity_id (shared table, reused as-is)"
    NOTIFICATIONS }o--|| USERS : "user_id (shared table, reused as-is)"

    TM_PROJECTS {
        int id PK
        varchar public_id UK
        int tenant_id
        varchar name
        enum status "Active, On Hold, Completed, Closed"
        enum priority "Low, Medium, High, Critical"
        date start_date
        date end_date
        int manager_id FK
        int created_by FK
        datetime completion_requested_at
        int completion_approved_by FK
        datetime completion_approved_at
        tinyint is_deleted
    }

    TM_PROJECT_MEMBERS {
        int id PK
        int project_id FK
        int user_id FK
        enum role_in_project "Manager, Member"
        int tenant_id
    }

    TM_TASKS {
        int id PK
        varchar public_id UK
        int tenant_id
        enum task_type "INDIVIDUAL, PROJECT, RECURRING, GEMBA_WALK"
        varchar title
        int project_id FK
        int parent_task_id FK "self, future"
        int assigned_to FK
        int assigned_by FK
        enum priority "Low, Medium, High, Critical"
        enum status "Pending, In Progress, Completed, Overdue, Rejected, Approved"
        date start_date
        datetime due_date
        tinyint allow_photo
        tinyint photo_required
        tinyint multiple_photos
        tinyint reminder_enabled
        time reminder_time
        tinyint reminder_sent
        int recurrence_id FK
        tinyint is_starred
        datetime completed_at
        text remarks
        enum approval_status "Not Required, Pending, Approved, Rejected"
        int approved_by FK
        int rejected_by FK
        text rejection_reason
        tinyint is_deleted
    }

    TM_TASK_RECURRENCE {
        int id PK
        int task_id FK UK
        int tenant_id
        enum frequency "None, Daily, Weekly, Monthly"
        int repeat_every
        varchar days_of_week "CSV: MON,WED,..."
        int day_of_month
        date start_date
        date end_date
        date next_occurrence
    }

    TM_TASK_OCCURRENCES {
        int id PK
        varchar public_id UK
        int task_id FK
        int tenant_id
        datetime due_date
        enum status "Pending, In Progress, Completed, Overdue, Rejected, Approved"
        int assigned_to FK
        datetime completed_at
        text remarks
        enum approval_status "Not Required, Pending, Approved, Rejected"
        int approved_by FK
        int rejected_by FK
        text rejection_reason
    }

    TM_GEMBA_DETAILS {
        int id PK
        int task_id FK UK
        int tenant_id
        varchar department
        varchar area
        varchar location
    }

    TM_CHECKLIST_ITEMS {
        int id PK
        int task_id FK "template, nullable"
        int occurrence_id FK "instance, nullable"
        int tenant_id
        varchar title
        tinyint is_completed
        int sort_order
    }

    TM_TASK_PHOTOS {
        int id PK
        int task_id FK "nullable"
        int occurrence_id FK "nullable"
        int tenant_id
        int uploaded_by FK
        varchar storage_path
        enum storage_provider "local, s3"
        varchar file_name
        bigint file_size
        varchar mime_type
        varchar caption
    }

    TM_TASK_COMMENTS {
        int id PK
        int task_id FK
        int user_id FK
        int tenant_id
        text comment
    }

    TM_CHECKPOINTS {
        int id PK
        int parent_task_id FK
        int child_task_id FK "nullable"
        int tenant_id
        varchar title
        enum status "Pending, In Progress, Completed"
        int sort_order
    }

    TM_APPROVALS {
        int id PK
        int tenant_id
        enum approval_type "TASK_COMPLETION, OCCURRENCE_COMPLETION, PROJECT_CLOSURE"
        int entity_id "polymorphic: tm_tasks.id / tm_task_occurrences.id / tm_projects.id"
        int requested_by FK
        datetime requested_at
        enum status "Pending, Approved, Rejected"
        int decided_by FK
        datetime decided_at
        text rejection_reason
    }

    USERS {
        int _id PK
        varchar public_id UK
        varchar name
        varchar role "SuperAdmin, Admin, Manager, Employee, ..."
        varchar department_public_id FK
        int tenant_id
    }

    DEPARTMENTS {
        int id PK
        varchar public_id UK
        varchar name
        varchar manager_id "users._id as string"
        varchar head_id "users._id as string"
        int tenant_id
    }

    AUDIT_LOGS {
        int id PK
        int actor_id FK
        varchar tenant_id
        varchar action
        varchar entity
        varchar entity_id
        varchar module "'TaskManager' for this module"
    }

    NOTIFICATIONS {
        int id PK
        int user_id FK
        varchar title
        varchar type
        varchar entity_type
        varchar entity_id
        tinyint is_read
    }
```

## Notes

- `tm_approvals.entity_id` is polymorphic (no single FK) — its target table is determined by `approval_type`.
  This mirrors how `audit_logs.entity` / `entity_id` already work elsewhere in this codebase.
- `tm_tasks` is intentionally one table for all 4 task types (`task_type` discriminator) rather than 4 separate
  tables, since they share ~90% of their columns (assignment, priority, status, photo policy, reminders) and the
  UI's "Task Details" view is identical across types apart from a few extra panels (recurrence, gemba fields).
- `audit_logs` and `notifications` are **existing, shared tables** — not new — reused via `auditLogger` and
  `NotificationService` rather than duplicated for this module.
