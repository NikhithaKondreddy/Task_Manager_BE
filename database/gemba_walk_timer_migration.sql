ALTER TABLE tm_tasks
  ADD COLUMN started_at datetime DEFAULT NULL AFTER completed_at,
  ADD COLUMN paused_at datetime DEFAULT NULL AFTER started_at,
  ADD COLUMN resumed_at datetime DEFAULT NULL AFTER paused_at,
  ADD COLUMN total_duration_seconds int NOT NULL DEFAULT 0 AFTER resumed_at,
  ADD COLUMN timer_status enum('Not Started','Running','Paused','Completed') NOT NULL DEFAULT 'Not Started' AFTER total_duration_seconds;

ALTER TABLE tm_task_occurrences
  ADD COLUMN started_at datetime DEFAULT NULL AFTER completed_at,
  ADD COLUMN paused_at datetime DEFAULT NULL AFTER started_at,
  ADD COLUMN resumed_at datetime DEFAULT NULL AFTER paused_at,
  ADD COLUMN total_duration_seconds int NOT NULL DEFAULT 0 AFTER resumed_at,
  ADD COLUMN timer_status enum('Not Started','Running','Paused','Completed') NOT NULL DEFAULT 'Not Started' AFTER total_duration_seconds;

ALTER TABLE tm_gemba_details
  ADD COLUMN walk_type varchar(100) DEFAULT NULL AFTER location,
  ADD COLUMN start_time time DEFAULT NULL AFTER walk_type,
  ADD COLUMN end_time time DEFAULT NULL AFTER start_time,
  ADD COLUMN reference_document varchar(500) DEFAULT NULL AFTER end_time,
  ADD COLUMN checklist_template_id varchar(100) DEFAULT NULL AFTER reference_document,
  ADD COLUMN manager_id int DEFAULT NULL AFTER checklist_template_id,
  ADD COLUMN team_members json DEFAULT NULL AFTER manager_id;

CREATE TABLE IF NOT EXISTS task_timer_history (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id int DEFAULT NULL,
  entity_type enum('task','occurrence') NOT NULL,
  entity_id int NOT NULL,
  action enum('Start','Pause','Resume','Stop') NOT NULL,
  action_time datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  performed_by int DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_timer_history_entity (entity_type, entity_id),
  KEY idx_timer_history_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
