-- Migration: create sla_breaches, escalation_history, dashboard_widgets
CREATE TABLE IF NOT EXISTS sla_breaches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  policy_id INT UNSIGNED DEFAULT NULL,
  breach_type VARCHAR(64) NOT NULL,
  breached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  notified TINYINT(1) DEFAULT 0,
  INDEX (ticket_id),
  INDEX (policy_id)
);

CREATE TABLE IF NOT EXISTS escalation_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  level INT NOT NULL,
  escalated_to INT UNSIGNED DEFAULT NULL,
  reason TEXT,
  escalated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_by INT UNSIGNED DEFAULT NULL,
  resolved_at TIMESTAMP NULL,
  INDEX (ticket_id),
  INDEX (escalated_to)
);

CREATE TABLE IF NOT EXISTS dashboard_widgets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  widget_key VARCHAR(128) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  config JSON DEFAULT NULL,
  roles JSON DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
