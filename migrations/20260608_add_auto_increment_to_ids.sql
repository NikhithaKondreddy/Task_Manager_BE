-- Migration: add AUTO_INCREMENT primary keys to id columns used by the app
-- Run this against your MySQL database (take a backup first).

SET FOREIGN_KEY_CHECKS = 0;

-- admin modules
ALTER TABLE `admin_modules` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- attachments
ALTER TABLE `attachments` MODIFY COLUMN `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- clients and related
ALTER TABLE `clients` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;
ALTER TABLE `client_contacts` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;
ALTER TABLE `client_viewers` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;
ALTER TABLE `client_activity_logs` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- departments
ALTER TABLE `departments` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- tasks/subtasks
ALTER TABLE `tasks` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;
ALTER TABLE `subtasks` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- checklist/progress
ALTER TABLE `user_checklist_progress` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- settings and rules
ALTER TABLE `settings` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;
ALTER TABLE `business_rules` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- chat participants
ALTER TABLE `chat_participants` MODIFY COLUMN `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

-- users (note column name is `_id` in dump)
ALTER TABLE `users` MODIFY COLUMN `_id` int NOT NULL AUTO_INCREMENT PRIMARY KEY;

SET FOREIGN_KEY_CHECKS = 1;

-- NOTE: Review constraints/foreign keys before running. If any statement fails, inspect the table for
-- duplicate IDs or existing PRIMARY KEY/INDEX definitions. Run each ALTER manually if needed.
