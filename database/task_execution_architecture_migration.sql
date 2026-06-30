-- New execution architecture for Individual Task, Recurring Task occurrences, and Gemba Walks.
-- CRUD tables remain in place for backward compatibility; execution state moves here.

CREATE TABLE IF NOT EXISTS task_execution (
  id int NOT NULL AUTO_INCREMENT,
  task_id int NOT NULL,
  occurrence_id int DEFAULT NULL,
  employee_id int NOT NULL,
  started_at datetime DEFAULT NULL,
  paused_at datetime DEFAULT NULL,
  resumed_at datetime DEFAULT NULL,
  completed_at datetime DEFAULT NULL,
  total_duration int NOT NULL DEFAULT 0,
  sla_status enum('On Track','Warning','Breached') NOT NULL DEFAULT 'On Track',
  execution_status enum('Not Started','Running','Paused','Draft','Completed') NOT NULL DEFAULT 'Not Started',
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_execution_task (task_id),
  KEY idx_task_execution_occurrence (occurrence_id),
  KEY idx_task_execution_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS task_execution_photos (
  id int NOT NULL AUTO_INCREMENT,
  execution_id int NOT NULL,
  image_path varchar(1024) NOT NULL,
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_execution_photos_execution (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS task_execution_remarks (
  id int NOT NULL AUTO_INCREMENT,
  execution_id int NOT NULL,
  remarks text,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_execution_remarks_execution (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS task_execution_checklist (
  id int NOT NULL AUTO_INCREMENT,
  execution_id int NOT NULL,
  checkpoint_name varchar(255) NOT NULL,
  description text,
  sequence int NOT NULL DEFAULT 0,
  mandatory tinyint(1) NOT NULL DEFAULT 1,
  is_completed tinyint(1) NOT NULL DEFAULT 0,
  completed_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_task_execution_checklist_execution (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS gemba_execution (
  id int NOT NULL AUTO_INCREMENT,
  gemba_walk_id int NOT NULL,
  occurrence_id int DEFAULT NULL,
  employee_id int NOT NULL,
  started_at datetime DEFAULT NULL,
  paused_at datetime DEFAULT NULL,
  resumed_at datetime DEFAULT NULL,
  completed_at datetime DEFAULT NULL,
  total_duration int NOT NULL DEFAULT 0,
  execution_status enum('Not Started','Running','Paused','Draft','Completed') NOT NULL DEFAULT 'Not Started',
  remarks text,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gemba_execution_walk (gemba_walk_id),
  KEY idx_gemba_execution_occurrence (occurrence_id),
  KEY idx_gemba_execution_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS gemba_checklists (
  id int NOT NULL AUTO_INCREMENT,
  execution_id int NOT NULL,
  checkpoint_name varchar(255) NOT NULL,
  description text,
  sequence int NOT NULL DEFAULT 0,
  mandatory tinyint(1) NOT NULL DEFAULT 1,
  status enum('Pending','In Progress','Completed') NOT NULL DEFAULT 'Pending',
  remarks text,
  completed_at datetime DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gemba_checklists_execution (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS gemba_photos (
  id int NOT NULL AUTO_INCREMENT,
  execution_id int NOT NULL,
  checklist_id int DEFAULT NULL,
  image_path varchar(1024) NOT NULL,
  uploaded_by int DEFAULT NULL,
  uploaded_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gemba_photos_execution (execution_id),
  KEY idx_gemba_photos_checklist (checklist_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS gemba_history (
  id int NOT NULL AUTO_INCREMENT,
  execution_id int NOT NULL,
  action varchar(100) NOT NULL,
  remarks text,
  performed_by int DEFAULT NULL,
  created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gemba_history_execution (execution_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
