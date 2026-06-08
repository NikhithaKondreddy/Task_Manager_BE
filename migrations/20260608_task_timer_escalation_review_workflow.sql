CREATE TABLE IF NOT EXISTS task_timer_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NULL,
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  started_by INT NULL,
  start_time DATETIME NULL,
  pause_time DATETIME NULL,
  resume_time DATETIME NULL,
  stop_time DATETIME NULL,
  end_time DATETIME NULL,
  duration_seconds INT NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'STOPPED',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_task_timer_sessions_task_user (task_id, user_id),
  INDEX idx_task_timer_sessions_status (status),
  INDEX idx_task_timer_sessions_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_escalation_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NULL,
  task_id INT NOT NULL,
  escalation_level INT NOT NULL,
  escalated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  escalated_to INT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'SENT',
  notification_type VARCHAR(80) NOT NULL,
  trigger_reason VARCHAR(255) NULL,
  overdue_minutes INT NULL,
  email_sent TINYINT(1) NOT NULL DEFAULT 0,
  notification_sent TINYINT(1) NOT NULL DEFAULT 0,
  dedupe_key VARCHAR(190) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_escalation_dedupe (dedupe_key),
  INDEX idx_task_escalation_task (task_id),
  INDEX idx_task_escalation_tenant_level (tenant_id, escalation_level),
  INDEX idx_task_escalation_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS task_review_alert_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NULL,
  task_id INT NOT NULL,
  employee_id INT NULL,
  manager_id INT NULL,
  alert_type VARCHAR(80) NOT NULL,
  alert_step INT NULL,
  sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(40) NOT NULL DEFAULT 'SENT',
  email_sent TINYINT(1) NOT NULL DEFAULT 0,
  notification_sent TINYINT(1) NOT NULL DEFAULT 0,
  dedupe_key VARCHAR(190) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_review_alert_dedupe (dedupe_key),
  INDEX idx_task_review_alert_task (task_id),
  INDEX idx_task_review_alert_tenant (tenant_id),
  INDEX idx_task_review_alert_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_escalated TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS escalation_level INT NULL,
  ADD COLUMN IF NOT EXISTS escalation_status VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS last_escalated_at DATETIME NULL;

ALTER TABLE task_assignment_status
  ADD COLUMN IF NOT EXISTS review_requested_at DATETIME NULL,
  ADD COLUMN IF NOT EXISTS last_review_reminder_at DATETIME NULL;

ALTER TABLE task_time_entries
  ADD COLUMN IF NOT EXISTS duration_seconds INT NULL,
  ADD COLUMN IF NOT EXISTS entry_type VARCHAR(30) DEFAULT 'event',
  ADD COLUMN IF NOT EXISTS date DATE NULL,
  ADD COLUMN IF NOT EXISTS hours DECIMAL(8,2) NULL;
