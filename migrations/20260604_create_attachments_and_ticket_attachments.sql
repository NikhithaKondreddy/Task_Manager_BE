-- Migration: create attachments and ticket_attachments
CREATE TABLE IF NOT EXISTS attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  filename VARCHAR(512) NOT NULL,
  mime VARCHAR(128) DEFAULT NULL,
  size BIGINT UNSIGNED DEFAULT 0,
  storage_key VARCHAR(1024) NOT NULL,
  uploaded_by INT UNSIGNED DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  is_infected TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (uploaded_by),
  INDEX (created_at)
);

CREATE TABLE IF NOT EXISTS ticket_attachments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT UNSIGNED NOT NULL,
  attachment_id BIGINT UNSIGNED NOT NULL,
  is_public TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (ticket_id),
  INDEX (attachment_id)
);
