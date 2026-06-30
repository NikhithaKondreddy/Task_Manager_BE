-- =====================================================================
-- Task Management Module — New Schema (prefix tm_)
-- Parallel to the legacy `tasks`/`projects`/`subtasks` tables, which are
-- left untouched. Reuses existing shared tables: users, departments,
-- tenants, notifications, audit_logs.
-- Charset/collation matches the rest of market_task_db.sql.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- tm_projects
-- ---------------------------------------------------------------------
CREATE TABLE `tm_projects` (
  `id` int NOT NULL AUTO_INCREMENT,
  `public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `status` enum('Active','On Hold','Completed','Closed') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Active',
  `priority` enum('Low','Medium','High','Critical') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Medium',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `manager_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `completion_requested_at` datetime DEFAULT NULL,
  `completion_approved_by` int DEFAULT NULL,
  `completion_approved_at` datetime DEFAULT NULL,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_projects_public_id` (`public_id`),
  KEY `idx_tm_projects_tenant` (`tenant_id`),
  KEY `idx_tm_projects_manager` (`manager_id`),
  KEY `idx_tm_projects_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_project_members
-- ---------------------------------------------------------------------
CREATE TABLE `tm_project_members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `project_id` int NOT NULL,
  `user_id` int NOT NULL,
  `role_in_project` enum('Manager','Member') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Member',
  `tenant_id` int DEFAULT NULL,
  `added_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_project_members` (`project_id`,`user_id`),
  KEY `idx_tm_project_members_user` (`user_id`),
  KEY `idx_tm_project_members_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_task_recurrence (recurrence rule for a RECURRING / GEMBA_WALK template task)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_task_recurrence` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `frequency` enum('None','Daily','Weekly','Monthly') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'None',
  `repeat_every` int NOT NULL DEFAULT '1',
  `days_of_week` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'CSV of MON,TUE,WED,THU,FRI,SAT,SUN',
  `day_of_month` int DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `next_occurrence` date DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_task_recurrence_task` (`task_id`),
  KEY `idx_tm_task_recurrence_next` (`next_occurrence`),
  KEY `idx_tm_task_recurrence_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_tasks (Individual / Project / Recurring / Gemba Walk — template rows
-- for recurring types, standalone rows for individual/project types)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_tasks` (
  `id` int NOT NULL AUTO_INCREMENT,
  `public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `task_type` enum('INDIVIDUAL','PROJECT','RECURRING','GEMBA_WALK') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `project_id` int DEFAULT NULL,
  `parent_task_id` int DEFAULT NULL,
  `assigned_to` int DEFAULT NULL,
  `assigned_by` int DEFAULT NULL,
  `priority` enum('Low','Medium','High','Critical') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Medium',
  `status` enum('Pending','In Progress','Completed','Overdue','Rejected','Approved') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `start_date` date DEFAULT NULL,
  `due_date` datetime DEFAULT NULL,
  `allow_photo` tinyint(1) NOT NULL DEFAULT '0',
  `photo_required` tinyint(1) NOT NULL DEFAULT '0',
  `multiple_photos` tinyint(1) NOT NULL DEFAULT '0',
  `reminder_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `reminder_time` time DEFAULT NULL,
  `reminder_sent` tinyint(1) NOT NULL DEFAULT '0',
  `recurrence_id` int DEFAULT NULL,
  `is_starred` tinyint(1) NOT NULL DEFAULT '0',
  `completed_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `paused_at` datetime DEFAULT NULL,
  `resumed_at` datetime DEFAULT NULL,
  `total_duration_seconds` int NOT NULL DEFAULT '0',
  `timer_status` enum('Not Started','Running','Paused','Completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Not Started',
  `remarks` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `approval_status` enum('Not Required','Pending','Approved','Rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Not Required',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by` int DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_by` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_deleted` tinyint(1) NOT NULL DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_tasks_public_id` (`public_id`),
  KEY `idx_tm_tasks_tenant_assignee_status` (`tenant_id`,`assigned_to`,`status`),
  KEY `idx_tm_tasks_tenant_type` (`tenant_id`,`task_type`),
  KEY `idx_tm_tasks_project` (`project_id`),
  KEY `idx_tm_tasks_parent` (`parent_task_id`),
  KEY `idx_tm_tasks_due_date` (`due_date`),
  KEY `idx_tm_tasks_recurrence` (`recurrence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_task_occurrences (each generated instance of a RECURRING/GEMBA_WALK task)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_task_occurrences` (
  `id` int NOT NULL AUTO_INCREMENT,
  `public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `task_id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `due_date` datetime NOT NULL,
  `status` enum('Pending','In Progress','Completed','Overdue','Rejected','Approved') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `assigned_to` int DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `paused_at` datetime DEFAULT NULL,
  `resumed_at` datetime DEFAULT NULL,
  `total_duration_seconds` int NOT NULL DEFAULT '0',
  `timer_status` enum('Not Started','Running','Paused','Completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Not Started',
  `remarks` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `approval_status` enum('Not Required','Pending','Approved','Rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_by` int DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_occurrences_public_id` (`public_id`),
  UNIQUE KEY `uq_tm_occurrences_task_due` (`task_id`,`due_date`),
  KEY `idx_tm_occurrences_tenant_status` (`tenant_id`,`status`),
  KEY `idx_tm_occurrences_due_date` (`due_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_gemba_details (extra fields specific to a GEMBA_WALK template task)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_gemba_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `department` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `area` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `location` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `walk_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `start_time` time DEFAULT NULL,
  `end_time` time DEFAULT NULL,
  `reference_document` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `checklist_template_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `manager_id` int DEFAULT NULL,
  `team_members` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tm_gemba_details_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- task_timer_history (Employee real-time timer audit)
-- ---------------------------------------------------------------------
CREATE TABLE `task_timer_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int DEFAULT NULL,
  `entity_type` enum('task','occurrence') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `entity_id` int NOT NULL,
  `action` enum('Start','Pause','Resume','Stop') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `action_time` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `performed_by` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_timer_history_entity` (`entity_type`,`entity_id`),
  KEY `idx_timer_history_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_checklist_items (Gemba Walk / generic checklist, attachable to a
-- template task or a specific occurrence)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_checklist_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int DEFAULT NULL,
  `occurrence_id` int DEFAULT NULL,
  `tenant_id` int DEFAULT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `is_completed` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tm_checklist_task` (`task_id`),
  KEY `idx_tm_checklist_occurrence` (`occurrence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_task_photos (photo_history — multiple photos per task or occurrence)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_task_photos` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int DEFAULT NULL,
  `occurrence_id` int DEFAULT NULL,
  `tenant_id` int DEFAULT NULL,
  `uploaded_by` int DEFAULT NULL,
  `storage_path` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `storage_provider` enum('local','s3') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'local',
  `file_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `file_size` bigint DEFAULT NULL,
  `mime_type` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `caption` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tm_photos_task` (`task_id`),
  KEY `idx_tm_photos_occurrence` (`occurrence_id`),
  KEY `idx_tm_photos_uploader` (`uploaded_by`),
  KEY `idx_tm_photos_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_task_comments
-- ---------------------------------------------------------------------
CREATE TABLE `tm_task_comments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tm_comments_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_checkpoints — schema only, future expandable parent/child progress
-- checkpoints. No routes/controllers use this yet.
-- ---------------------------------------------------------------------
CREATE TABLE `tm_checkpoints` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parent_task_id` int NOT NULL,
  `child_task_id` int DEFAULT NULL,
  `tenant_id` int DEFAULT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('Pending','In Progress','Completed') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tm_checkpoints_parent` (`parent_task_id`),
  KEY `idx_tm_checkpoints_child` (`child_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- tm_approvals — unified approval queue (task / occurrence / project)
-- ---------------------------------------------------------------------
CREATE TABLE `tm_approvals` (
  `id` int NOT NULL AUTO_INCREMENT,
  `tenant_id` int DEFAULT NULL,
  `approval_type` enum('TASK_COMPLETION','OCCURRENCE_COMPLETION','PROJECT_CLOSURE') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `entity_id` int NOT NULL,
  `requested_by` int DEFAULT NULL,
  `requested_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `status` enum('Pending','Approved','Rejected') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `decided_by` int DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_tm_approvals_tenant_status_type` (`tenant_id`,`status`,`approval_type`),
  KEY `idx_tm_approvals_entity` (`approval_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =====================================================================
-- Foreign keys (added after all tables exist; mirrors the FK style used
-- elsewhere in market_task_db.sql — named constraints referencing users(_id)
-- and the new tm_ tables; tenant_id columns are left unconstrained, matching
-- the existing convention).
-- =====================================================================

ALTER TABLE `tm_projects`
  ADD CONSTRAINT `fk_tm_projects_manager` FOREIGN KEY (`manager_id`) REFERENCES `users` (`_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_tm_projects_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`_id`) ON DELETE SET NULL;

ALTER TABLE `tm_project_members`
  ADD CONSTRAINT `fk_tm_project_members_project` FOREIGN KEY (`project_id`) REFERENCES `tm_projects` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_project_members_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`_id`) ON DELETE CASCADE;

ALTER TABLE `tm_task_recurrence`
  ADD CONSTRAINT `fk_tm_recurrence_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE;

ALTER TABLE `tm_tasks`
  ADD CONSTRAINT `fk_tm_tasks_project` FOREIGN KEY (`project_id`) REFERENCES `tm_projects` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_tasks_parent` FOREIGN KEY (`parent_task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_tm_tasks_assigned_to` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_tm_tasks_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_tm_tasks_recurrence` FOREIGN KEY (`recurrence_id`) REFERENCES `tm_task_recurrence` (`id`) ON DELETE SET NULL;

ALTER TABLE `tm_task_occurrences`
  ADD CONSTRAINT `fk_tm_occurrences_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_occurrences_assigned_to` FOREIGN KEY (`assigned_to`) REFERENCES `users` (`_id`) ON DELETE SET NULL;

ALTER TABLE `tm_gemba_details`
  ADD CONSTRAINT `fk_tm_gemba_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE;

ALTER TABLE `tm_checklist_items`
  ADD CONSTRAINT `fk_tm_checklist_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_checklist_occurrence` FOREIGN KEY (`occurrence_id`) REFERENCES `tm_task_occurrences` (`id`) ON DELETE CASCADE;

ALTER TABLE `tm_task_photos`
  ADD CONSTRAINT `fk_tm_photos_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_photos_occurrence` FOREIGN KEY (`occurrence_id`) REFERENCES `tm_task_occurrences` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_photos_uploader` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`_id`) ON DELETE SET NULL;

ALTER TABLE `tm_task_comments`
  ADD CONSTRAINT `fk_tm_comments_task` FOREIGN KEY (`task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_comments_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`_id`) ON DELETE CASCADE;

ALTER TABLE `tm_checkpoints`
  ADD CONSTRAINT `fk_tm_checkpoints_parent` FOREIGN KEY (`parent_task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_tm_checkpoints_child` FOREIGN KEY (`child_task_id`) REFERENCES `tm_tasks` (`id`) ON DELETE SET NULL;

SET FOREIGN_KEY_CHECKS = 1;
