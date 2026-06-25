-- phpMyAdmin SQL Dump
-- version 5.2.3
-- https://www.phpmyadmin.net/
--
-- Host: mysql:3306
-- Generation Time: Apr 22, 2026 at 11:43 AM
-- Server version: 8.0.45
-- PHP Version: 8.3.26

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `market_task_db`
--

-- --------------------------------------------------------

--
-- Table structure for table `admin_modules`
--

CREATE TABLE `admin_modules` (
  `id` int NOT NULL,
  `admin_id` int NOT NULL,
  `module_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `access` enum('full','limited','view') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'full',
  `path` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `admin_modules`
--

INSERT INTO `admin_modules` (`id`, `admin_id`, `module_id`, `name`, `access`, `path`, `created_at`) VALUES
(7, 92, 'ce90b43190979277', 'Dashboard', 'full', '/admin/dashboard', '2026-04-06 15:33:41'),
(8, 92, 'dbe1d04d896f2bed', 'Projects', 'full', '/admin/projects', '2026-04-06 15:33:41'),
(9, 92, 'a4e027bd41fcf3e8', 'Tasks', 'full', '/admin/tasks', '2026-04-06 15:33:41'),
(10, 92, 'fcd36ff3075a2016', 'Users', 'full', '/admin/users', '2026-04-06 15:33:41'),
(11, 92, '8afa4c4ab7a6f773', 'Clients', 'full', '/admin/clients', '2026-04-06 15:33:41'),
(12, 92, '2ac9e85d3784d9b0', 'Departments', 'full', '/admin/departments', '2026-04-06 15:33:41'),
(13, 92, '70f8f327c38796ba', 'Reports & Analytics', 'full', '/admin/reports', '2026-04-06 15:33:41'),
(14, 92, '6563eee13b2a290d', 'Document Management', 'full', '/admin/document-management', '2026-04-06 15:33:41'),
(15, 92, 'f4cb7cf637e88508', 'Chat', 'full', '/admin/chat', '2026-04-06 15:33:41'),
(16, 92, '04f65ee23acbfd26', 'Workflow', 'full', '/admin/workflow', '2026-04-06 15:33:41'),
(17, 92, '0a26ce2d4512fc78', 'Settings', 'full', '/admin/settings', '2026-04-06 15:33:41'),
(18, 92, '50437515b5a5a7a9', 'Notifications', 'full', '/admin/notifications', '2026-04-06 15:33:41'),
(19, 23, 'c22786746f3072d6', 'User Management', 'full', '/admin/users', '2026-04-06 15:33:50'),
(20, 23, '6a2ef6584bce3025', 'Dashboard', 'full', '/admin/dashboard', '2026-04-06 15:33:50'),
(21, 23, '45bb31719857f4b3', 'Clients', 'full', '/admin/clients', '2026-04-06 15:33:50'),
(22, 23, '39d338c671d58e03', 'Departments', 'full', '/admin/departments', '2026-04-06 15:33:50'),
(23, 23, '43a793d6fea2f370', 'Tasks', 'full', '/admin/tasks', '2026-04-06 15:33:50'),
(24, 23, '793756e1d0997601', 'Projects', 'full', '/admin/projects', '2026-04-06 15:33:50'),
(25, 23, 'c826110014caa10e', 'Workflow (Project & Task Flow)', 'full', '/admin/workflow', '2026-04-06 15:33:50'),
(26, 23, '8bde69403e370854', 'Notifications', 'full', '/admin/notifications', '2026-04-06 15:33:50'),
(27, 23, '63c9ab2ec626ee63', 'Reports & Analytics', 'full', '/admin/reports', '2026-04-06 15:33:50'),
(28, 23, '45fb8742255ce2f7', 'Document & File Management', 'full', '/admin/document-file-management', '2026-04-06 15:33:50'),
(29, 23, '435f640487c33b57', 'Settings & Master Configuration', 'full', '/admin/settings', '2026-04-06 15:33:50'),
(30, 23, 'a814d9abf691c2f9', 'Chat / Real-Time Collaboration', 'full', '/admin/chat', '2026-04-06 15:33:50'),
(31, 23, 'b32e298a4d889334', 'Approval Workflows', 'full', '/admin/approval-workflows', '2026-04-06 15:33:50'),
(297, 145, 'ce90b43190979277', 'Dashboard', 'full', '/admin/dashboard', '2026-04-22 09:54:49'),
(298, 145, '8afa4c4ab7a6f773', 'Clients', 'full', '/admin/clients', '2026-04-22 09:54:49'),
(299, 145, '2ac9e85d3784d9b0', 'Departments', 'full', '/admin/departments', '2026-04-22 09:54:49'),
(300, 145, 'a4e027bd41fcf3e8', 'Tasks', 'full', '/admin/tasks', '2026-04-22 09:54:49'),
(301, 145, 'dbe1d04d896f2bed', 'Projects', 'full', '/admin/projects', '2026-04-22 09:54:49'),
(302, 145, '50437515b5a5a7a9', 'Notifications', 'full', '/admin/notifications', '2026-04-22 09:54:49'),
(303, 145, '70f8f327c38796ba', 'Reports & Analytics', 'full', '/admin/reports', '2026-04-22 09:54:49'),
(304, 145, 'fcd36ff3075a2016', 'Users', 'full', '/admin/users', '2026-04-22 09:54:49'),
(305, 145, '6563eee13b2a290d', 'Document Management', 'full', '/admin/document-management', '2026-04-22 09:54:49'),
(306, 145, 'f4cb7cf637e88508', 'Chat', 'full', '/admin/chat', '2026-04-22 09:54:49'),
(307, 145, '04f65ee23acbfd26', 'Workflow', 'full', '/admin/workflow', '2026-04-22 09:54:49'),
(308, 145, '0a26ce2d4512fc78', 'Settings', 'full', '/admin/settings', '2026-04-22 09:54:49'),
(321, 154, 'ce90b43190979277', 'Dashboard', 'full', '/admin/dashboard', '2026-04-22 10:06:42'),
(322, 154, '8afa4c4ab7a6f773', 'Clients', 'full', '/admin/clients', '2026-04-22 10:06:42'),
(323, 154, '2ac9e85d3784d9b0', 'Departments', 'full', '/admin/departments', '2026-04-22 10:06:42'),
(324, 154, 'a4e027bd41fcf3e8', 'Tasks', 'full', '/admin/tasks', '2026-04-22 10:06:42'),
(325, 154, 'dbe1d04d896f2bed', 'Projects', 'full', '/admin/projects', '2026-04-22 10:06:42'),
(326, 154, '50437515b5a5a7a9', 'Notifications', 'full', '/admin/notifications', '2026-04-22 10:06:42'),
(327, 154, '70f8f327c38796ba', 'Reports & Analytics', 'full', '/admin/reports', '2026-04-22 10:06:42'),
(328, 154, 'fcd36ff3075a2016', 'Users', 'full', '/admin/users', '2026-04-22 10:06:42'),
(329, 154, '6563eee13b2a290d', 'Document Management', 'full', '/admin/document-management', '2026-04-22 10:06:42'),
(330, 154, 'f4cb7cf637e88508', 'Chat', 'full', '/admin/chat', '2026-04-22 10:06:42'),
(331, 154, '04f65ee23acbfd26', 'Workflow', 'full', '/admin/workflow', '2026-04-22 10:06:42'),
(332, 154, '0a26ce2d4512fc78', 'Settings', 'full', '/admin/settings', '2026-04-22 10:06:42');

-- --------------------------------------------------------

--
-- Table structure for table `attachments`
--

CREATE TABLE `attachments` (
  `id` bigint UNSIGNED NOT NULL,
  `ticket_id` bigint UNSIGNED NOT NULL,
  `comment_id` bigint UNSIGNED DEFAULT NULL,
  `file_name` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `content_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size_bytes` bigint DEFAULT NULL,
  `storage_path` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum_sha256` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content_id` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_inline` tinyint(1) NOT NULL DEFAULT '0',
  `source_message_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `audit_logs`
--

CREATE TABLE `audit_logs` (
  `id` int NOT NULL,
  `actor_id` int DEFAULT NULL,
  `tenant_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `action` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `entity` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `entity_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `module` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Module name: Auth, Tasks, Projects, etc.',
  `ip_address` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'IP address of actor',
  `user_agent` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci COMMENT 'User agent string',
  `correlation_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Request correlation ID',
  `previous_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin COMMENT 'Previous state before change',
  `new_value` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin COMMENT 'New state after change'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `audit_logs`
--

INSERT INTO `audit_logs` (`id`, `actor_id`, `tenant_id`, `action`, `entity`, `entity_id`, `details`, `createdAt`, `module`, `ip_address`, `user_agent`, `correlation_id`, `previous_value`, `new_value`) VALUES
(3699, 23, 'tenant_1', 'LOGIN', 'User', 'ac510b2dd0e311f088c200155daedf50', '{\"email\":\"korapatiashwini@gmail.com\",\"ip\":\"::1\"}', '2026-04-02 04:55:06', NULL, NULL, NULL, NULL, NULL, NULL),
--
-- Triggers `audit_logs`
--
DELIMITER $$
CREATE TRIGGER `audit_logs_block_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'
$$
DELIMITER ;
DELIMITER $$
CREATE TRIGGER `audit_logs_block_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `business_rules`
--

CREATE TABLE `business_rules` (
  `id` int NOT NULL,
  `rule_code` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `conditions` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `action` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `priority` int NOT NULL,
  `active` tinyint(1) DEFAULT '1',
  `version` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT '1.0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `business_rules`
--

INSERT INTO `business_rules` (`id`, `rule_code`, `description`, `conditions`, `action`, `priority`, `active`, `version`, `created_at`, `updated_at`) VALUES
(1, 'ACCESS_OWN_RECORDS_ONLY', 'Users can only access their own records unless role is ADMIN', '{\"userRole\":{\"$ne\":\"ADMIN\"},\"resourceOwnerId\":{\"$ne\":\"{{userId}}\"}}', 'DENY', 1, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(2, 'ADMIN_FULL_ACCESS', 'Admins have full access', '{\"userRole\":\"ADMIN\"}', 'ALLOW', 2, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(3, 'EMPLOYEE_CANNOT_APPROVE_OWN_REQUEST', 'Employees cannot approve their own requests', '{\"userRole\":\"EMPLOYEE\",\"action\":\"APPROVE\",\"resourceOwnerId\":\"{{userId}}\"}', 'DENY', 3, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(4, 'LEAVE_DAYS_REQUIRE_APPROVAL', 'Leave days exceeding limit require manager approval', '{\"action\":\"LEAVE_APPLY\",\"leaveDays\":{\"$gt\":\"{{LEAVE_MAX_DAYS}}\"}}', 'REQUIRE_APPROVAL', 4, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(5, 'APPROVED_RECORDS_IMMUTABLE', 'Approved or locked records cannot be modified', '{\"action\":{\"$in\":[\"UPDATE\",\"DELETE\"]},\"recordStatus\":{\"$in\":[\"APPROVED\",\"LOCKED\"]}}', 'DENY', 5, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(6, 'SALARY_NON_NEGATIVE', 'Salary and financial fields must not be negative', '{\"action\":{\"$in\":[\"CREATE\",\"UPDATE\"]},\"payload\":{\"$or\":[{\"salary\":{\"$lt\":0}},{\"budget\":{\"$lt\":0}},{\"amount\":{\"$lt\":0}}]}}', 'DENY', 6, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(7, 'OTP_RATE_LIMIT', 'Rate limit OTP requests', '{\"action\":\"OTP_REQUEST\",\"recentRequests\":{\"$gte\":\"{{OTP_MAX_REQUESTS}}\"}}', 'DENY', 7, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(8, 'task_creation', 'Validate task creation permissions and data', '{\"userRole\":\"MANAGER\",\"action\":\"POST__TASKS_CREATEJSON\",\"payload\":{\"title\":{\"$exists\":true},\"projectId\":{\"$exists\":true}}}', 'ALLOW', 8, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(9, 'task_update', 'Validate task update permissions', '{\"userRole\":\"MANAGER\",\"action\":\"PUT_:ID\"}', 'ALLOW', 9, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(10, 'task_reassign', 'Validate task reassignment permissions', '{\"userRole\":{\"$in\":[\"MANAGER\",\"ADMIN\"]},\"action\":\"PATCH_:TASKID_REASSIGN_:USERID\"}', 'ALLOW', 10, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(11, 'task_status_update', 'Validate task status update permissions', '{\"userRole\":{\"$in\":[\"EMPLOYEE\",\"MANAGER\",\"ADMIN\"]},\"action\":\"PATCH_:ID_STATUS\"}', 'ALLOW', 11, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(12, 'task_delete', 'Validate task deletion permissions', '{\"userRole\":{\"$in\":[\"MANAGER\",\"ADMIN\"]},\"action\":\"DELETE_:ID\"}', 'ALLOW', 12, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(13, 'project_creation', 'Validate project creation permissions and data', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"POST_\",\"payload\":{\"name\":{\"$exists\":true},\"client_id\":{\"$exists\":true}}}', 'ALLOW', 13, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(14, 'project_update', 'Validate project update permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"PUT_:ID\"}', 'ALLOW', 14, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(15, 'project_delete', 'Validate project deletion permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"DELETE_:ID\"}', 'ALLOW', 15, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(16, 'project_department_add', 'Validate adding departments to projects', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"POST_:ID_DEPARTMENTS\"}', 'ALLOW', 16, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(17, 'project_department_delete', 'Validate removing departments from projects', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"DELETE_:ID_DEPARTMENTS_:DEPTID\"}', 'ALLOW', 17, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(18, 'client_creation', 'Validate client creation permissions', '{\"userRole\":\"ADMIN\",\"action\":\"POST_\",\"payload\":{\"name\":{\"$exists\":true}}}', 'ALLOW', 18, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(19, 'client_update', 'Validate client update permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"PUT_:ID\"}', 'ALLOW', 19, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(20, 'client_delete', 'Validate client deletion permissions', '{\"userRole\":\"ADMIN\",\"action\":\"DELETE_:ID\"}', 'ALLOW', 20, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(21, 'client_permanent_delete', 'Validate permanent client deletion permissions', '{\"userRole\":\"ADMIN\",\"action\":\"DELETE_:ID_PERMANENT\"}', 'ALLOW', 21, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(22, 'client_assign_manager', 'Validate assigning manager to client', '{\"userRole\":\"ADMIN\",\"action\":\"POST_:ID_ASSIGN_MANAGER\"}', 'ALLOW', 22, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(23, 'client_create_viewer', 'Validate creating client viewer', '{\"userRole\":\"ADMIN\",\"action\":\"POST_:ID_CREATE_VIEWER\"}', 'ALLOW', 23, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(24, 'client_contact_add', 'Validate adding client contacts', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"POST_:ID_CONTACTS\"}', 'ALLOW', 24, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(25, 'client_contact_update', 'Validate updating client contacts', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"PUT_:ID_CONTACTS_:CONTACTID\"}', 'ALLOW', 25, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:31'),
(26, 'client_contact_delete', 'Validate deleting client contacts', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"DELETE_:ID_CONTACTS_:CONTACTID\"}', 'ALLOW', 26, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(27, 'user_creation', 'Validate user creation permissions', '{\"userRole\":\"ADMIN\",\"action\":\"POST_CREATE\"}', 'ALLOW', 27, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(28, 'user_update', 'Validate user update permissions', '{\"userRole\":\"ADMIN\",\"action\":\"PUT_UPDATE_:ID\"}', 'ALLOW', 28, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(29, 'user_delete', 'Validate user deletion permissions', '{\"userRole\":\"ADMIN\",\"action\":\"DELETE_DELETE_:USER_ID\"}', 'ALLOW', 29, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(30, 'user_list', 'Validate user listing permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"GET_GETUSERS\"}', 'ALLOW', 30, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(31, 'user_view', 'Validate viewing user details permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"GET_GETUSERBYID_:ID\"}', 'ALLOW', 31, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(32, 'subtask_creation', 'Validate subtask creation permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\",\"EMPLOYEE\"]},\"action\":\"POST_\"}', 'ALLOW', 32, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(33, 'subtask_update', 'Validate subtask update permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\",\"EMPLOYEE\"]},\"action\":\"PUT_:ID\"}', 'ALLOW', 33, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(34, 'subtask_delete', 'Validate subtask deletion permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\"]},\"action\":\"DELETE_:ID\"}', 'ALLOW', 34, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(35, 'upload_file', 'Validate file upload permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\",\"EMPLOYEE\"]},\"action\":\"POST_UPLOAD\"}', 'ALLOW', 35, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(36, 'upload_list', 'Validate viewing uploads permissions', '{\"userRole\":{\"$in\":[\"ADMIN\",\"MANAGER\",\"EMPLOYEE\"]},\"action\":\"GET_GETUPLOADS_:ID\"}', 'ALLOW', 36, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32'),
(37, 'DEFAULT_ALLOW', 'Allow by default if no rules match', '{}', 'ALLOW', 999, 1, '1.0', '2026-01-08 06:29:39', '2026-01-19 09:25:32');

-- --------------------------------------------------------

--
-- Table structure for table `chat_messages`
--

CREATE TABLE `chat_messages` (
  `id` int NOT NULL,
  `project_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `sender_id` int DEFAULT NULL,
  `sender_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `message_type` enum('text','system','bot') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'text',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `chat_participants`
--

CREATE TABLE `chat_participants` (
  `id` int NOT NULL,
  `project_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `user_id` int NOT NULL,
  `user_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `user_role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_online` tinyint(1) DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `clients`
--

CREATE TABLE `clients` (
  `id` int NOT NULL,
  `ref` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `company` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `district` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `state` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `pincode` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active` tinyint(1) DEFAULT '1',
  `tenant_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `isDeleted` tinyint(1) DEFAULT '0',
  `deleted_at` datetime DEFAULT NULL,
  `billing_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `office_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `gst_number` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tax_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `industry` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `status` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'Active',
  `manager_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `bank_details` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `industry_type` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `updated_by` int DEFAULT NULL,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `user_id` int DEFAULT NULL,
  `archived_at` datetime DEFAULT NULL,
  `archived_by` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `clients`
--

INSERT INTO `clients` (`id`, `ref`, `name`, `email`, `phone`, `company`, `address`, `district`, `state`, `pincode`, `createdAt`, `updatedAt`, `active`, `tenant_id`, `isDeleted`, `deleted_at`, `billing_address`, `office_address`, `gst_number`, `tax_id`, `industry`, `notes`, `status`, `manager_id`, `created_at`, `bank_details`, `industry_type`, `created_by`, `updated_by`, `updated_at`, `user_id`, `archived_at`, `archived_by`) VALUES
(88, 'XXX0001', 'client', 'client1@gmail.com', '6788878787', 'xxx', NULL, NULL, NULL, NULL, '2026-04-22 10:21:33', '2026-04-22 10:21:33', 1, '5', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Active', NULL, '2026-04-22 10:21:33', NULL, NULL, NULL, NULL, '2026-04-22 10:21:33', 160, NULL, NULL),
(89, 'XXY0001', 'Client2', 'Client2@gmail.com', '6788878787', 'xxy', NULL, '', '', '', '2026-04-22 10:27:55', '2026-04-22 10:33:27', 1, '5', 0, NULL, '', NULL, NULL, '', '', '', 'Active', NULL, '2026-04-22 10:27:55', NULL, NULL, NULL, NULL, '2026-04-22 10:27:55', 163, NULL, NULL),
(90, 'XXZ0001', 'ccc', 'c@gmail.com', '5433444444', 'xxz', NULL, NULL, NULL, NULL, '2026-04-22 10:33:10', '2026-04-22 10:33:10', 1, '5', 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'Active', NULL, '2026-04-22 10:33:10', NULL, NULL, NULL, NULL, '2026-04-22 10:33:10', NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `client_activity_logs`
--

CREATE TABLE `client_activity_logs` (
  `id` int NOT NULL,
  `client_id` int NOT NULL,
  `actor_id` int DEFAULT NULL,
  `action` varchar(255) DEFAULT NULL,
  `details` text,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `client_activity_logs`
--

INSERT INTO `client_activity_logs` (`id`, `client_id`, `actor_id`, `action`, `details`, `created_at`, `tenant_id`) VALUES
(1, 89, 145, 'create', '{\"createdBy\":\"4edb18ff-4a47-43d1-827c-ed571cef7d82\"}', '2026-04-22 10:28:00', 5),
(2, 90, 145, 'create', '{\"createdBy\":\"4edb18ff-4a47-43d1-827c-ed571cef7d82\"}', '2026-04-22 10:33:14', 5),
(3, 89, 145, 'update', '{\"name\":\"Client2\",\"email\":\"Client2@gmail.com\",\"phone\":\"6788878787\",\"company\":\"xxy\",\"district\":\"\",\"state\":\"\",\"pincode\":\"\",\"industry\":\"\",\"notes\":\"\",\"status\":\"Active\",\"manager_id\":null,\"tax_id\":\"\",\"billing_address\":\"\"}', '2026-04-22 10:33:27', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `client_contacts`
--

CREATE TABLE `client_contacts` (
  `id` int NOT NULL,
  `client_id` int NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `phone` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `designation` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_primary` tinyint(1) DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `email_validated` tinyint(1) DEFAULT '0',
  `phone_validated` tinyint(1) DEFAULT '0',
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `client_viewers`
--

CREATE TABLE `client_viewers` (
  `id` int NOT NULL,
  `client_id` int NOT NULL,
  `user_id` int NOT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `is_active` tinyint(1) DEFAULT '1',
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `client_viewers`
--

INSERT INTO `client_viewers` (`id`, `client_id`, `user_id`, `created_at`, `is_active`, `tenant_id`) VALUES
(28, 88, 160, '2026-04-22 10:21:33', 1, 5),
(29, 89, 163, '2026-04-22 10:27:55', 1, 5);

-- --------------------------------------------------------

--
-- Table structure for table `comments`
--

CREATE TABLE `comments` (
  `id` bigint UNSIGNED NOT NULL,
  `ticket_id` bigint UNSIGNED NOT NULL,
  `user_id` int DEFAULT NULL,
  `author_email` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `body` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'api',
  `source_message_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `departments`
--

CREATE TABLE `departments` (
  `id` int NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `parent_department_id` int DEFAULT NULL,
  `responsibilities` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `manager_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `head_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `manager_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `head_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `departments`
--

INSERT INTO `departments` (`id`, `name`, `parent_department_id`, `responsibilities`, `created_at`, `updated_at`, `public_id`, `manager_name`, `head_name`, `manager_id`, `head_id`, `tenant_id`) VALUES
(49, 'dev', NULL, NULL, '2026-04-22 10:10:07', '2026-04-22 10:11:35', '7b9716d59706dcac', NULL, NULL, '155', '155', 5),
(50, 'devops', NULL, NULL, '2026-04-22 10:10:20', '2026-04-22 10:10:20', '46249c60b2650ca8', NULL, NULL, NULL, NULL, 5),
(51, 'IT', NULL, NULL, '2026-04-22 10:10:43', '2026-04-22 10:10:48', 'af0a78101c841b3d', NULL, NULL, NULL, NULL, 5);

-- --------------------------------------------------------

--
-- Table structure for table `documents`
--

CREATE TABLE `documents` (
  `documentId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entityType` enum('CLIENT','PROJECT','TASK') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `entityId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `uploadedBy` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `storageProvider` enum('s3','local') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'local',
  `filePath` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `encrypted` tinyint(1) DEFAULT '0',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `fileName` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fileSize` bigint DEFAULT NULL,
  `mimeType` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `clientId` int DEFAULT NULL,
  `projectId` int DEFAULT NULL,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `documents`
--

INSERT INTO `documents` (`documentId`, `entityType`, `entityId`, `uploadedBy`, `storageProvider`, `filePath`, `encrypted`, `createdAt`, `updatedAt`, `fileName`, `fileSize`, `mimeType`, `clientId`, `projectId`, `tenant_id`) VALUES
('ea52fae7b665bd15249923ed', 'CLIENT', '90', '145', 'local', '/uploads/ea52fae7b665bd15249923ed.pdf', 0, '2026-04-22 16:03:15', '2026-04-22 10:33:15', 'Taskmanager Application.pdf', 681091, 'application/pdf', 90, NULL, 5);

-- --------------------------------------------------------

--
-- Table structure for table `document_access`
--

CREATE TABLE `document_access` (
  `id` int NOT NULL,
  `documentId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `userId` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `accessType` enum('READ','WRITE','ADMIN') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'READ',
  `grantedBy` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `grantedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expiresAt` timestamp NULL DEFAULT NULL,
  `isActive` tinyint(1) DEFAULT '1'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `document_access`
--

INSERT INTO `document_access` (`id`, `documentId`, `userId`, `accessType`, `grantedBy`, `grantedAt`, `expiresAt`, `isActive`) VALUES
(26, 'ea52fae7b665bd15249923ed', '145', 'READ', '145', '2026-04-22 16:03:15', NULL, 1);

-- --------------------------------------------------------

--
-- Table structure for table `invite_tokens`
--

CREATE TABLE `invite_tokens` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `role_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `department_public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `invited_by` int DEFAULT NULL,
  `token` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `expires_at` datetime NOT NULL,
  `accepted_at` datetime DEFAULT NULL,
  `metadata` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `invite_tokens`
--

INSERT INTO `invite_tokens` (`id`, `tenant_id`, `user_id`, `email`, `role_key`, `department_public_id`, `invited_by`, `token`, `expires_at`, `accepted_at`, `metadata`, `created_at`) VALUES
(11, 5, 155, 'manager@gmail.com', 'MANAGER', '7b9716d59706dcac', 145, '6085d7182413728f6ac8060bea6723a7ed57eb5d839b7680', '2026-04-29 10:11:35', NULL, '{\"setupToken\":\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjczNjhiNjg1OTY3YjJkNTMiLCJzdGVwIjoic2V0dXAiLCJ0ZW5hbnRfaWQiOjUsImlhdCI6MTc3Njg1MjY5NSwiZXhwIjoxNzc3NDU3NDk1fQ.ppL3l_cIPKp7np4l9mrC8tpQYII9zH6gI9nv6WSLmOg\"}', '2026-04-22 10:11:35'),
(12, 5, 156, 'employee@gmail.com', 'EMPLOYEE', '7b9716d59706dcac', 145, '5f0250391b1076399a765bb857bd10c1fae46e0c9bc63391', '2026-04-29 10:13:56', NULL, '{\"setupToken\":\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjUzODFmNjMyNjc0ZWY2MmIiLCJzdGVwIjoic2V0dXAiLCJ0ZW5hbnRfaWQiOjUsImlhdCI6MTc3Njg1MjgzNiwiZXhwIjoxNzc3NDU3NjM2fQ.r4ZLJdtSvU2B3BEWCySiPzmXdr_Va4sgk3HzHybrsmk\"}', '2026-04-22 10:13:56'),
(13, 5, 157, 'user@gmail.com', 'EMPLOYEE', '46249c60b2650ca8', 145, '7e8db2dffd50dc3da989d4593db0697b7780ebac28329308', '2026-04-29 10:15:17', NULL, '{\"setupToken\":\"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjQ1MDAwNTI3MTA5MWIxOTkiLCJzdGVwIjoic2V0dXAiLCJ0ZW5hbnRfaWQiOjUsImlhdCI6MTc3Njg1MjkxNywiZXhwIjoxNzc3NDU3NzE3fQ.hfN3udKteu1pujY87WlJFDB7Owy60hStrNIbWNUtUk0\"}', '2026-04-22 10:15:17');

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `entity_type` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `entity_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `user_id`, `title`, `message`, `type`, `entity_type`, `entity_id`, `is_read`, `created_at`, `tenant_id`) VALUES
(1384, 145, 'Department Created', 'New department \"dev\" has been created', 'DEPARTMENT_CREATED', 'department', '49', 1, '2026-04-22 10:10:08', 5),
(1385, 145, 'Department Created', 'New department \"devops\" has been created', 'DEPARTMENT_CREATED', 'department', '50', 1, '2026-04-22 10:10:20', 5),
(1386, 145, 'Department Created', 'New department \"it\" has been created', 'DEPARTMENT_CREATED', 'department', '51', 1, '2026-04-22 10:10:43', 5),
(1387, 145, 'Department Updated', 'Department \"IT\" has been updated', 'DEPARTMENT_UPDATED', 'department', '51', 1, '2026-04-22 10:10:48', 5),
(1388, 145, 'Client Added', 'New client \"jcx\" has been added', 'CLIENT_ADDED', 'client', '89', 1, '2026-04-22 10:28:00', 5),
(1389, 145, 'Client Added', 'New client \"ccc\" has been added', 'CLIENT_ADDED', 'client', '90', 1, '2026-04-22 10:33:14', 5),
(1390, 145, 'Client Updated', 'Client \"Client2\" was updated', 'CLIENT_UPDATED', 'client', '89', 1, '2026-04-22 10:33:27', 5),
(1391, 145, 'Project Created', 'New project \"pro 1\" has been created', 'PROJECT_CREATED', 'project', '58', 1, '2026-04-22 10:34:05', 5),
(1392, 155, 'Project Created', 'New project \"pro 1\" has been created', 'PROJECT_CREATED', 'project', '58', 0, '2026-04-22 10:34:05', 5),
(1393, 145, 'Project Updated', 'Project \"pro 1\" has been updated', 'PROJECT_UPDATED', 'project', '58', 0, '2026-04-22 10:35:01', 5),
(1394, 155, 'Project Updated', 'Project \"pro 1\" has been updated', 'PROJECT_UPDATED', 'project', '58', 0, '2026-04-22 10:35:01', 5),
(1395, 156, 'Task Assigned', 'You have been assigned to task \"task1\"', 'TASK_ASSIGNED', 'task', 'tsk_7a0a489f29e79f01', 0, '2026-04-22 10:39:26', 5),
(1396, 156, 'Task Reassigned', 'Task \"task1\" has updated assignees', 'TASK_REASSIGNED', 'task', 'tsk_7a0a489f29e79f01', 0, '2026-04-22 10:39:52', 5),
(1397, 145, 'Project Created', 'New project \"pro 2\" has been created', 'PROJECT_CREATED', 'project', '59', 0, '2026-04-22 10:47:28', 5),
(1398, 155, 'Project Created', 'New project \"pro 2\" has been created', 'PROJECT_CREATED', 'project', '59', 0, '2026-04-22 10:47:28', 5),
(1399, 156, 'Task Assigned', 'You have been assigned to task \"ttttt\"', 'TASK_ASSIGNED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:48:10', 5),
(1400, 157, 'Task Assigned', 'You have been assigned to task \"ttttt\"', 'TASK_ASSIGNED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:48:10', 5),
(1401, 156, 'Task Assigned', 'You have been assigned to task \"task 2\"', 'TASK_ASSIGNED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:48:37', 5),
(1402, 156, 'Task Assigned', 'You have been assigned to task \"task 3\"', 'TASK_ASSIGNED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:48:59', 5),
(1403, 157, 'Task Assigned', 'You have been assigned to task \"task 3\"', 'TASK_ASSIGNED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:48:59', 5),
(1404, 156, 'Task Status Updated', 'Task \"task 3\" — user moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:50:33', 5),
(1405, 157, 'Task Status Updated', 'Task \"task 3\" — user moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:50:33', 5),
(1406, 156, 'Task Status Updated', 'Task \"ttttt\" — user moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:50:38', 5),
(1407, 157, 'Task Status Updated', 'Task \"ttttt\" — user moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:50:38', 5),
(1408, 156, 'Task Status Updated', 'Task \"ttttt\" — employee moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:51:33', 5),
(1409, 157, 'Task Status Updated', 'Task \"ttttt\" — employee moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:51:33', 5),
(1410, 156, 'Task Status Updated', 'Task \"task 3\" — employee moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:52:03', 5),
(1411, 157, 'Task Status Updated', 'Task \"task 3\" — employee moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:52:03', 5),
(1412, 156, 'Task Status Updated', 'Task \"task 2\" — employee moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:52:36', 5),
(1413, 145, 'Review Requested', 'Employee employee has requested review for task \"task 3\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:55:05', 5),
(1414, 155, 'Review Requested', 'Employee employee has requested review for task \"task 3\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:55:05', 5),
(1415, 156, 'Task Status Updated', 'Task \"task 3\" — employee moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:55:05', 5),
(1416, 157, 'Task Status Updated', 'Task \"task 3\" — employee moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:55:05', 5),
(1417, 145, 'Review Requested', 'Employee employee has requested review for task \"task 2\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:55:07', 5),
(1418, 155, 'Review Requested', 'Employee employee has requested review for task \"task 2\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:55:07', 5),
(1419, 156, 'Task Status Updated', 'Task \"task 2\" — employee moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:55:07', 5),
(1420, 145, 'Review Requested', 'Employee employee has requested review for task \"ttttt\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:55:09', 5),
(1421, 155, 'Review Requested', 'Employee employee has requested review for task \"ttttt\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:55:09', 5),
(1422, 156, 'Task Status Updated', 'Task \"ttttt\" — employee moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:55:09', 5),
(1423, 157, 'Task Status Updated', 'Task \"ttttt\" — employee moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:55:09', 5),
(1424, 156, 'TASK Request Approved', 'Your task request #104 has been approved. Status: Completed', 'TASK_APPROVAL', 'task', '371', 0, '2026-04-22 10:55:19', NULL),
(1425, 145, 'Approval Workflow: TASK APPROVEED', 'TASK request #104 has been approved by Manager.', 'TASK_APPROVAL', 'task', '371', 0, '2026-04-22 10:55:19', 5),
(1426, 156, 'TASK Request Approved', 'Your task request #102 has been approved. Status: Completed', 'TASK_APPROVAL', 'task', '373', 0, '2026-04-22 10:55:21', NULL),
(1427, 145, 'Approval Workflow: TASK APPROVEED', 'TASK request #102 has been approved by Manager.', 'TASK_APPROVAL', 'task', '373', 0, '2026-04-22 10:55:21', 5),
(1428, 156, 'TASK Request Rejected', 'Your task request #103 has been rejected. Status: In Progress', 'TASK_APPROVAL', 'task', '372', 0, '2026-04-22 10:55:25', NULL),
(1429, 145, 'Approval Workflow: TASK REJECTED', 'TASK request #103 has been rejected by Manager.', 'TASK_APPROVAL', 'task', '372', 0, '2026-04-22 10:55:25', 5),
(1430, 145, 'Review Requested', 'Employee employee has requested review for task \"task 2\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:55:33', 5),
(1431, 155, 'Review Requested', 'Employee employee has requested review for task \"task 2\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:55:33', 5),
(1432, 156, 'Task Status Updated', 'Task \"task 2\" — employee moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_670b12c8a70143da', 0, '2026-04-22 10:55:33', 5),
(1433, 156, 'TASK Request Approved', 'Your task request #105 has been approved. Status: Completed', 'TASK_APPROVAL', 'task', '372', 0, '2026-04-22 10:55:43', NULL),
(1434, 145, 'Approval Workflow: TASK APPROVEED', 'TASK request #105 has been approved by Manager.', 'TASK_APPROVAL', 'task', '372', 0, '2026-04-22 10:55:43', 5),
(1435, 157, 'Task Status Updated', 'Task \"task1\" — user moved to In Progress', 'TASK_STATUS_CHANGED', 'task', 'tsk_7a0a489f29e79f01', 0, '2026-04-22 10:56:13', 5),
(1436, 145, 'Review Requested', 'Employee user has requested review for task \"task1\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_7a0a489f29e79f01', 0, '2026-04-22 10:56:16', 5),
(1437, 155, 'Review Requested', 'Employee user has requested review for task \"task1\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_7a0a489f29e79f01', 0, '2026-04-22 10:56:16', 5),
(1438, 157, 'Task Status Updated', 'Task \"task1\" — user moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_7a0a489f29e79f01', 0, '2026-04-22 10:56:16', 5),
(1439, 145, 'Review Requested', 'Employee user has requested review for task \"ttttt\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:56:19', 5),
(1440, 155, 'Review Requested', 'Employee user has requested review for task \"ttttt\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:56:19', 5),
(1441, 156, 'Task Status Updated', 'Task \"ttttt\" — user moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:56:19', 5),
(1442, 157, 'Task Status Updated', 'Task \"ttttt\" — user moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_c895658e3a59a798', 0, '2026-04-22 10:56:19', 5),
(1443, 145, 'Review Requested', 'Employee user has requested review for task \"task 3\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:56:22', 5),
(1444, 155, 'Review Requested', 'Employee user has requested review for task \"task 3\"', 'TASK_REVIEW_REQUESTED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:56:22', 5),
(1445, 156, 'Task Status Updated', 'Task \"task 3\" — user moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:56:22', 5),
(1446, 157, 'Task Status Updated', 'Task \"task 3\" — user moved to REVIEW', 'TASK_STATUS_CHANGED', 'task', 'tsk_481bd1efff8c8876', 0, '2026-04-22 10:56:22', 5),
(1447, 157, 'TASK Request Approved', 'Your task request #108 has been approved. Status: Completed', 'TASK_APPROVAL', 'task', '373', 0, '2026-04-22 10:56:29', NULL),
(1448, 145, 'Approval Workflow: TASK APPROVEED', 'TASK request #108 has been approved by Manager.', 'TASK_APPROVAL', 'task', '373', 0, '2026-04-22 10:56:29', 5),
(1449, 157, 'TASK Request Approved', 'Your task request #106 has been approved. Status: Completed', 'TASK_APPROVAL', 'task', '370', 0, '2026-04-22 10:56:30', NULL),
(1450, 145, 'Approval Workflow: TASK APPROVEED', 'TASK request #106 has been approved by Manager.', 'TASK_APPROVAL', 'task', '370', 0, '2026-04-22 10:56:30', 5),
(1451, 157, 'TASK Request Approved', 'Your task request #107 has been approved. Status: Completed', 'TASK_APPROVAL', 'task', '371', 0, '2026-04-22 10:56:32', NULL),
(1452, 145, 'Approval Workflow: TASK APPROVEED', 'TASK request #107 has been approved by Manager.', 'TASK_APPROVAL', 'task', '371', 0, '2026-04-22 10:56:32', 5),
(1453, 145, 'Project Closure Requested', 'Project 59 submitted for final approval.', 'PROJECT_CLOSE_REQUEST', 'project', '59', 0, '2026-04-22 10:56:40', 5),
(1454, 145, 'Project Closure Requested', 'Project 58 submitted for final approval.', 'PROJECT_CLOSE_REQUEST', 'project', '58', 0, '2026-04-22 10:56:46', 5),
(1455, 155, 'PROJECT Request Rejected', 'Your project request #109 has been rejected. Status: ACTIVE', 'PROJECT_APPROVAL', 'project', '59', 0, '2026-04-22 10:56:58', NULL),
(1456, 145, 'Approval Workflow: PROJECT REJECTED', 'PROJECT request #109 has been rejected by Admin.', 'PROJECT_APPROVAL', 'project', '59', 0, '2026-04-22 10:56:58', 5),
(1457, 155, 'PROJECT Request Approved', 'Your project request #110 has been approved. Status: CLOSED', 'PROJECT_APPROVAL', 'project', '58', 0, '2026-04-22 10:57:00', NULL),
(1458, 145, 'Approval Workflow: PROJECT APPROVEED', 'PROJECT request #110 has been approved by Admin.', 'PROJECT_APPROVAL', 'project', '58', 0, '2026-04-22 10:57:00', 5),
(1459, 145, 'Project Closure Requested', 'Project 59 submitted for final approval.', 'PROJECT_CLOSE_REQUEST', 'project', '59', 0, '2026-04-22 10:58:42', 5),
(1460, 155, 'PROJECT Request Approved', 'Your project request #111 has been approved. Status: CLOSED', 'PROJECT_APPROVAL', 'project', '59', 0, '2026-04-22 10:58:53', NULL),
(1461, 145, 'Approval Workflow: PROJECT APPROVEED', 'PROJECT request #111 has been approved by Admin.', 'PROJECT_APPROVAL', 'project', '59', 0, '2026-04-22 10:58:53', 5),
(1462, 145, 'Project Created', 'New project \"dgf\" has been created', 'PROJECT_CREATED', 'project', '60', 0, '2026-04-22 11:14:58', 5),
(1463, 155, 'Project Created', 'New project \"dgf\" has been created', 'PROJECT_CREATED', 'project', '60', 0, '2026-04-22 11:14:58', 5),
(1464, 156, 'Task Assigned', 'You have been assigned to task \"thd\"', 'TASK_ASSIGNED', 'task', 'tsk_43a6afc458a4f987', 0, '2026-04-22 11:15:26', 5);

-- --------------------------------------------------------

--
-- Table structure for table `password_history`
--

CREATE TABLE `password_history` (
  `id` int NOT NULL,
  `user_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `password_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `changed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `password_history`
--

INSERT INTO `password_history` (`id`, `user_id`, `password_hash`, `changed_at`) VALUES
(32, '145', '$2a$10$dAkjzlu.OwBgzDPmkq/tQera24u4vb55xYZwOd62Rj34iGgqXs8US', '2026-04-22 10:08:21'),
(33, '155', '$2a$10$FcnHlwsGc74vU/tepX7IheeE57HH/9Wj4.I99TbeG0v9HAORENNIS', '2026-04-22 10:12:26'),
(34, '156', '$2a$10$spxywQxCHH7ei28Ftzv1M.9URtKN0iyO3SJB6JZmqTI0wxt/mcnCS', '2026-04-22 10:14:39'),
(35, '157', '$2a$10$RiobEY3fnrATMu/JARUHuOC0L5SBRMsRONTE/R3hBX7ZpLgFz3dWu', '2026-04-22 10:15:56');

-- --------------------------------------------------------

--
-- Table structure for table `permissions`
--

CREATE TABLE `permissions` (
  `id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `module` varchar(100) NOT NULL,
  `action` varchar(100) NOT NULL,
  `is_system_permission` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `platform_settings`
--

CREATE TABLE `platform_settings` (
  `id` int NOT NULL,
  `setting_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `setting_value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tenant_id` int DEFAULT NULL,
  `module_key` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'general',
  `is_core` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `projects`
--

CREATE TABLE `projects` (
  `id` int NOT NULL,
  `public_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `client_id` int NOT NULL,
  `project_manager_id` int DEFAULT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `priority` enum('Low','Medium','High','Critical') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'Medium',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `budget` decimal(15,2) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `is_locked` tinyint(1) DEFAULT '0',
  `closed_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `deleted_by` int DEFAULT NULL,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `projects`
--

INSERT INTO `projects` (`id`, `public_id`, `client_id`, `project_manager_id`, `name`, `description`, `status`, `priority`, `start_date`, `end_date`, `budget`, `is_active`, `created_by`, `created_at`, `updated_at`, `is_locked`, `closed_at`, `deleted_at`, `deleted_by`, `tenant_id`) VALUES
(58, '189b624535989af1', 88, 155, 'pro 1', '3cea7ff29351', 'CLOSED', 'High', '2026-04-21', '2026-05-06', NULL, 1, 145, '2026-04-22 10:33:57', '2026-04-22 10:57:00', 1, NULL, NULL, NULL, 5),
(59, 'c1c38b91c35d57ed', 88, 155, 'pro 2', 'wetrhnoh hghjg huh iuhkuo  yuih ygh uhu ', 'CLOSED', 'Medium', '2026-04-22', '2026-06-19', NULL, 1, 155, '2026-04-22 10:47:20', '2026-04-22 10:58:53', 1, NULL, NULL, NULL, 5),
(60, '8fe91796b7a0834a', 88, 155, 'dgf', 'ff', 'ACTIVE', 'High', '2026-04-22', '2026-05-07', NULL, 1, 155, '2026-04-22 11:14:49', '2026-04-22 11:15:25', 0, NULL, NULL, NULL, 5);

-- --------------------------------------------------------

--
-- Table structure for table `project_chats`
--

CREATE TABLE `project_chats` (
  `id` int NOT NULL,
  `project_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `room_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `project_departments`
--

CREATE TABLE `project_departments` (
  `id` int NOT NULL,
  `project_id` int NOT NULL,
  `department_id` int NOT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `project_departments`
--

INSERT INTO `project_departments` (`id`, `project_id`, `department_id`, `assigned_at`, `tenant_id`) VALUES
(116, 58, 49, '2026-04-22 10:35:00', 5),
(117, 58, 50, '2026-04-22 10:35:00', 5),
(118, 59, 49, '2026-04-22 10:47:20', 5),
(119, 59, 50, '2026-04-22 10:47:20', 5),
(122, 59, 51, '2026-04-22 10:47:20', 5),
(123, 60, 49, '2026-04-22 11:14:49', 5),
(124, 60, 50, '2026-04-22 11:14:49', 5);

-- --------------------------------------------------------

--
-- Table structure for table `settings`
--

CREATE TABLE `settings` (
  `id` int NOT NULL,
  `section` varchar(50) NOT NULL,
  `key_name` varchar(100) NOT NULL,
  `value` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `subtasks`
--

CREATE TABLE `subtasks` (
  `id` int NOT NULL,
  `task_Id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `due_date` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tag` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `estimated_hours` decimal(8,2) DEFAULT NULL,
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'PENDING',
  `isDeleted` tinyint(1) DEFAULT '0',
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `tasks`
--

CREATE TABLE `tasks` (
  `id` int NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `description` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `stage` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `taskDate` datetime DEFAULT NULL,
  `priority` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  `time_alloted` decimal(5,2) DEFAULT NULL,
  `client_id` int DEFAULT NULL,
  `valid_until` datetime DEFAULT NULL,
  `public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `estimated_hours` decimal(8,2) DEFAULT NULL,
  `status` enum('Pending','In Progress','On Hold','Completed','REVIEW','CLOSED') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'Pending',
  `project_id` int DEFAULT NULL,
  `project_public_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total_duration` int DEFAULT '0',
  `started_at` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `live_timer` datetime DEFAULT NULL,
  `is_locked` tinyint(1) DEFAULT '0',
  `pending_assignee` int DEFAULT NULL,
  `task_day` date DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `rejected_by` int DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `isDeleted` tinyint(1) DEFAULT '0',
  `tenant_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tasks`
--

INSERT INTO `tasks` (`id`, `title`, `description`, `stage`, `taskDate`, `priority`, `createdAt`, `updatedAt`, `time_alloted`, `client_id`, `valid_until`, `public_id`, `estimated_hours`, `status`, `project_id`, `project_public_id`, `total_duration`, `started_at`, `completed_at`, `live_timer`, `is_locked`, `pending_assignee`, `task_day`, `approved_by`, `approved_at`, `rejection_reason`, `rejected_by`, `rejected_at`, `tenant_id`) VALUES
(370, 'task1', 'complete the task as soon as possible\ngo through it', 'TODO', '2026-04-23 05:30:00', 'MEDIUM', '2026-04-22 16:09:26', '2026-04-22 16:26:16', 9.00, 88, NULL, 'tsk_7a0a489f29e79f01', 9.00, 'Completed', 58, '189b624535989af1', 0, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 5),
(371, 'ttttt', 'vcccccccccccccccccc', 'TODO', '2026-04-28 05:30:00', 'HIGH', '2026-04-22 16:18:10', '2026-04-22 16:26:19', 8.00, 88, NULL, 'tsk_c895658e3a59a798', 8.00, 'Completed', 59, 'c1c38b91c35d57ed', 0, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 5),
(372, 'task 2', 'rrrrrrrrrrrrrrrrr', 'TODO', '2026-04-23 05:30:00', 'MEDIUM', '2026-04-22 16:18:37', '2026-04-22 16:25:33', 8.00, 88, NULL, 'tsk_670b12c8a70143da', 8.00, 'Completed', 58, '189b624535989af1', 0, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 5),
(373, 'task 3', '{\n    \"success\": true,\n    \"data\": [\n        {\n            \"id\": 49,\n            \"name\": \"dev\",\n            \"created_at\": \"2026-04-22T04:40:07.000Z\",\n            \"manager_id\": \"7368b685967b2d53\",\n            \"head_id\": \"7368b685967b2d53\",\n            \"manager_name\": \"Manager User\",\n            \"head_name\": \"Manager User\"\n        }\n    ]\n}', 'TODO', '2026-04-24 05:30:00', 'MEDIUM', '2026-04-22 16:18:58', '2026-04-22 16:26:22', 8.00, 88, NULL, 'tsk_481bd1efff8c8876', 8.00, 'Completed', 58, '189b624535989af1', 0, NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 5),
(374, 'thd', 'dd', 'TODO', '2026-04-23 05:30:00', 'MEDIUM', '2026-04-22 16:45:25', '2026-04-22 16:45:25', 8.00, 88, NULL, 'tsk_43a6afc458a4f987', 8.00, 'Pending', 60, '8fe91796b7a0834a', 0, NULL, NULL, NULL, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 5);

-- --------------------------------------------------------

--
-- Table structure for table `task_assignments`
--

CREATE TABLE `task_assignments` (
  `id` int NOT NULL,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `assigned_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `tenant_id` int DEFAULT NULL,
  `is_read_only` tinyint DEFAULT '0',
  `checklist` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `task_assignments`
--

INSERT INTO `task_assignments` (`id`, `task_id`, `user_id`, `assigned_at`, `tenant_id`, `is_read_only`, `checklist`, `updated_at`) VALUES
(18, 371, 156, '2026-04-22 10:48:10', 5, 0, '[{\"id\":1776855103526,\"title\":\"eeeeeeeeee\",\"completed\":true,\"due_date\":\"2026-04-22\"},{\"id\":1776855112586,\"title\":\"rr\",\"completed\":true,\"due_date\":\"2026-04-23\"}]', '2026-04-22 10:51:54'),
(19, 371, 157, '2026-04-22 10:48:10', 5, 0, '[{\"id\":1776855048314,\"title\":\"cd\",\"completed\":true,\"due_date\":\"2026-04-22\"},{\"id\":1776855052631,\"title\":\"df\",\"completed\":true,\"due_date\":\"2026-04-22\"}]', '2026-04-22 10:50:59'),
(20, 372, 156, '2026-04-22 10:48:37', 5, 0, '[{\"id\":1776855163272,\"title\":\"e\",\"completed\":true,\"due_date\":\"2026-04-23\"}]', '2026-04-22 10:52:44'),
(21, 373, 156, '2026-04-22 10:48:59', 5, 0, NULL, NULL),
(22, 373, 157, '2026-04-22 10:48:59', 5, 0, '[{\"id\":1776855028567,\"title\":\"cccccccc\",\"completed\":true,\"due_date\":\"2026-04-22\"}]', '2026-04-22 10:50:29'),
(23, 370, 157, '2026-04-22 10:53:08', 5, 0, NULL, NULL),
(24, 374, 156, '2026-04-22 11:15:25', 5, 0, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `task_assignment_status`
--

CREATE TABLE `task_assignment_status` (
  `id` int NOT NULL,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING',
  `started_at` datetime DEFAULT NULL,
  `live_timer` datetime DEFAULT NULL,
  `completed_at` datetime DEFAULT NULL,
  `approved_at` datetime DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `total_duration` int DEFAULT '0',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `review_requested` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `task_assignment_status`
--

INSERT INTO `task_assignment_status` (`id`, `task_id`, `user_id`, `tenant_id`, `status`, `started_at`, `live_timer`, `completed_at`, `approved_at`, `rejected_at`, `rejection_reason`, `total_duration`, `created_at`, `updated_at`, `review_requested`) VALUES
(167, 371, 156, 5, 'COMPLETED', '2026-04-22 16:21:33', NULL, NULL, '2026-04-22 10:55:19', NULL, NULL, 216, '2026-04-22 10:48:10', '2026-04-22 10:55:19', 0),
(168, 371, 157, 5, 'COMPLETED', '2026-04-22 16:20:38', NULL, NULL, '2026-04-22 10:56:32', NULL, NULL, 341, '2026-04-22 10:48:10', '2026-04-22 10:56:32', 0),
(169, 372, 156, 5, 'COMPLETED', '2026-04-22 16:22:36', NULL, NULL, '2026-04-22 10:55:43', '2026-04-22 10:55:25', NULL, 151, '2026-04-22 10:48:37', '2026-04-22 10:55:43', 0),
(170, 373, 156, 5, 'COMPLETED', '2026-04-22 16:22:03', NULL, NULL, '2026-04-22 10:55:21', NULL, NULL, 182, '2026-04-22 10:48:59', '2026-04-22 10:55:21', 0),
(171, 373, 157, 5, 'COMPLETED', '2026-04-22 16:20:33', NULL, NULL, '2026-04-22 10:56:29', NULL, NULL, 349, '2026-04-22 10:48:59', '2026-04-22 10:56:29', 0),
(179, 370, 157, 5, 'COMPLETED', '2026-04-22 16:26:12', NULL, NULL, '2026-04-22 10:56:30', NULL, NULL, 4, '2026-04-22 10:53:08', '2026-04-22 10:56:30', 0),
(188, 374, 156, 5, 'PENDING', NULL, NULL, NULL, NULL, NULL, NULL, 0, '2026-04-22 11:15:25', '2026-04-22 11:15:25', 0);

-- --------------------------------------------------------

--
-- Table structure for table `task_logs`
--

CREATE TABLE `task_logs` (
  `id` int NOT NULL,
  `task_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `type` varchar(50) DEFAULT NULL,
  `activity_text` text,
  `status_action` varchar(50) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `task_resign_requests`
--

CREATE TABLE `task_resign_requests` (
  `id` int NOT NULL,
  `task_id` int NOT NULL,
  `requested_by` int NOT NULL,
  `reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'PENDING',
  `requested_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `responded_at` datetime DEFAULT NULL,
  `responded_by` int DEFAULT NULL COMMENT 'Manager who approved/rejected',
  `responder_name` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `tenant_id` int DEFAULT NULL,
  `new_assignee_id` int DEFAULT NULL,
  `previous_status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `previous_started_at` datetime DEFAULT NULL,
  `previous_completed_at` datetime DEFAULT NULL,
  `previous_total_duration` int DEFAULT '0',
  `previous_rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `task_resign_requests`
--

INSERT INTO `task_resign_requests` (`id`, `task_id`, `requested_by`, `reason`, `status`, `requested_at`, `responded_at`, `responded_by`, `responder_name`, `tenant_id`, `new_assignee_id`, `previous_status`, `previous_started_at`, `previous_completed_at`, `previous_total_duration`, `previous_rejection_reason`) VALUES
(49, 370, 156, 'hjgnhbfvcx', 'APPROVED', '2026-04-22 10:52:49', '2026-04-22 16:23:09', 155, 'Manager User', 5, 157, 'PENDING', NULL, NULL, 0, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `task_time_entries`
--

CREATE TABLE `task_time_entries` (
  `id` int NOT NULL,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` enum('start','pause','resume','complete','reassign') NOT NULL,
  `timestamp` datetime NOT NULL,
  `duration_seconds` int DEFAULT NULL,
  `entry_type` enum('event','daily_summary') DEFAULT 'event',
  `date` date DEFAULT NULL,
  `hours` decimal(5,2) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

--
-- Dumping data for table `task_time_entries`
--

INSERT INTO `task_time_entries` (`id`, `task_id`, `user_id`, `action`, `timestamp`, `duration_seconds`, `entry_type`, `date`, `hours`, `created_at`, `updated_at`) VALUES
(23, 373, 157, 'start', '2026-04-22 16:20:33', NULL, 'event', NULL, NULL, '2026-04-22 10:50:33', '2026-04-22 10:50:33'),
(24, 371, 157, 'start', '2026-04-22 16:20:38', NULL, 'event', NULL, NULL, '2026-04-22 10:50:38', '2026-04-22 10:50:38'),
(25, 371, 156, 'start', '2026-04-22 16:21:33', NULL, 'event', NULL, NULL, '2026-04-22 10:51:33', '2026-04-22 10:51:33'),
(26, 373, 156, 'start', '2026-04-22 16:22:03', NULL, 'event', NULL, NULL, '2026-04-22 10:52:03', '2026-04-22 10:52:03'),
(27, 372, 156, 'start', '2026-04-22 16:22:36', NULL, 'event', NULL, NULL, '2026-04-22 10:52:36', '2026-04-22 10:52:36'),
(28, 370, 157, 'start', '2026-04-22 16:26:12', NULL, 'event', NULL, NULL, '2026-04-22 10:56:12', '2026-04-22 10:56:12');

-- --------------------------------------------------------

--
-- Table structure for table `tenants`
--

CREATE TABLE `tenants` (
  `id` int NOT NULL,
  `public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `slug` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `domain` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_by` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `tenants`
--

INSERT INTO `tenants` (`id`, `public_id`, `name`, `slug`, `domain`, `is_active`, `created_at`, `updated_at`, `created_by`) VALUES
(1, '97497d14-7b94-40a8-8157-16dd382cb943', 'Default Tenant', 'default-tenant', 'nivarahousing.com', 1, '2026-04-22 07:21:53', '2026-04-22 07:30:15', NULL),
(2, '614541ee-0a4d-4e29-8542-924e30e4e352', 'Myadmin\'s Organization', 'admin-myadmin-1776851548125', 'admin-myadmin-1776851548125.nivarahousing.com', 1, '2026-04-22 09:52:28', '2026-04-22 09:52:28', NULL),
(3, '623e3d7e-6063-43ea-80cb-b57a80317f0a', 'Admin User\'s Organization', 'admin-admin-user-1776851548172', 'admin-admin-user-1776851548172.nivarahousing.com', 1, '2026-04-22 09:52:28', '2026-04-22 09:52:28', NULL),
(4, '32725376-5929-4e80-b8b5-a8f8bd5567db', 'Nikhitha\'s Organization', 'admin-nikhitha-1776851548202', 'admin-nikhitha-1776851548202.nivarahousing.com', 1, '2026-04-22 09:52:28', '2026-04-22 09:52:28', NULL),
(5, '38d737f3-901f-49b9-8728-0b109757114a', 'Nikhitha\'s Organization', 'admin-nikhitha-1776851689438', 'admin-nikhitha-1776851689438.nivarahousing.com', 1, '2026-04-22 09:54:49', '2026-04-22 09:54:49', NULL),
(6, 'c75e7ac9-8890-4267-9ee9-d13adc43caaa', 'c@gmail.com\'s Organization', 'admin-c-gmail-com-1776852385151', 'admin-c-gmail-com-1776852385151.nivarahousing.com', 1, '2026-04-22 10:06:25', '2026-04-22 10:06:25', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `tickets`
--

CREATE TABLE `tickets` (
  `id` bigint UNSIGNED NOT NULL,
  `ticket_id` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `requester_user_id` int DEFAULT NULL,
  `requester_email` varchar(320) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('Open','In Progress','Closed') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Open',
  `priority` enum('Low','Medium','High') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Medium',
  `assigned_to` int DEFAULT NULL,
  `assigned_queue` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IT Support',
  `module` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'general',
  `source` varchar(30) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'api',
  `source_message_id` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `timelogs`
--

CREATE TABLE `timelogs` (
  `id` int NOT NULL,
  `user_id` int NOT NULL,
  `task_id` int DEFAULT NULL,
  `start_time` datetime NOT NULL,
  `end_time` datetime DEFAULT NULL,
  `duration_seconds` int DEFAULT NULL,
  `notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `_id` int NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_general_ci DEFAULT '',
  `role` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `department_public_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `email` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `password` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `isAdmin` tinyint(1) DEFAULT '0',
  `tasks` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `__v` int DEFAULT '0',
  `isActive` tinyint(1) DEFAULT '1',
  `isGuest` tinyint(1) DEFAULT '0',
  `password_changed_at` datetime DEFAULT NULL,
  `last_login` datetime DEFAULT NULL,
  `inactivity_count` int DEFAULT '0',
  `is_active` tinyint(1) DEFAULT '1',
  `phone` varchar(25) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reset_token` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reset_token_expiry` datetime DEFAULT NULL,
  `tenant_id` int DEFAULT NULL,
  `is_locked` tinyint(1) DEFAULT '0',
  `modules` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `public_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `twofa_secret` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is2fa_enabled` tinyint DEFAULT '0',
  `photo` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_online` tinyint(1) DEFAULT '0',
  `created_by` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`_id`, `name`, `title`, `role`, `department_public_id`, `email`, `password`, `isAdmin`, `tasks`, `createdAt`, `updatedAt`, `__v`, `isActive`, `isGuest`, `password_changed_at`, `last_login`, `inactivity_count`, `is_active`, `phone`, `reset_token`, `reset_token_expiry`, `tenant_id`, `is_locked`, `modules`, `public_id`, `twofa_secret`, `is2fa_enabled`, `photo`, `is_online`, `created_by`) VALUES
(23, 'Myadmin', 'User', 'Admin', NULL, 'korapatiashwini@gmail.com', '$2a$10$/mNrYWUwFkslo2ivwxZoTerB6xoOumP7FyR87VA8hWCMAbBreKOhm', 1, '[]', '2025-12-03 06:27:52', '2026-04-22 09:52:28', 0, 0, 0, '2026-02-09 15:32:54', NULL, 0, 0, '9513035255', NULL, NULL, 2, 0, '[{\"moduleId\":\"c22786746f3072d6\",\"name\":\"User Management\",\"access\":\"full\"},{\"moduleId\":\"6a2ef6584bce3025\",\"name\":\"Dashboard\",\"access\":\"full\"},{\"moduleId\":\"45bb31719857f4b3\",\"name\":\"Clients\",\"access\":\"full\"},{\"moduleId\":\"39d338c671d58e03\",\"name\":\"Departments\",\"access\":\"full\"},{\"moduleId\":\"43a793d6fea2f370\",\"name\":\"Tasks\",\"access\":\"full\"},{\"moduleId\":\"793756e1d0997601\",\"name\":\"Projects\",\"access\":\"full\"},{\"moduleId\":\"c826110014caa10e\",\"name\":\"Workflow (Project & Task Flow)\",\"access\":\"full\"},{\"moduleId\":\"8bde69403e370854\",\"name\":\"Notifications\",\"access\":\"full\"},{\"moduleId\":\"63c9ab2ec626ee63\",\"name\":\"Reports & Analytics\",\"access\":\"full\"},{\"moduleId\":\"45fb8742255ce2f7\",\"name\":\"Document & File Management\",\"access\":\"full\"},{\"moduleId\":\"435f640487c33b57\",\"name\":\"Settings & Master Configuration\",\"access\":\"full\"},{\"moduleId\":\"a814d9abf691c2f9\",\"name\":\"Chat / Real-Time Collaboration\",\"access\":\"full\"},{\"moduleId\":\"b32e298a4d889334\",\"name\":\"Approval Workflows\",\"access\":\"full\"}]', 'ac510b2dd0e311f088c200155daedf50', 'PFUFIZT5KNQTC3JRMNGSGMKMMF3SIQTD', 0, '/uploads/profiles/23-1770203953970.png', 0, NULL),
(91, 'Super Admin', '', 'SuperAdmin', NULL, 'superadmin@nivarahousing.com', '$2a$10$DtwJ7pD/j5WtauruoVRSAunvVHpdZU2Jq/22pAnr7ULGkBnyoCkk.', 0, NULL, '2026-04-02 05:52:26', '2026-04-21 10:34:36', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 1, 0, NULL, '7fdf476b-dca2-41d7-b144-f346f592b8cf', NULL, 0, NULL, 0, NULL),
(92, 'Admin User', '', 'Admin', NULL, 'admin@nivarahousing.com', '$2a$10$DQdxrXM2m0/LMPLnogRQmO94g7woZ0nPKHZ.19Rw1N3WgJkEpCeDW', 0, NULL, '2026-04-02 05:52:26', '2026-04-22 09:52:28', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 3, 0, NULL, '3cb1d802-d6d5-45b7-a0e9-b18e3015a3ef', NULL, 0, NULL, 0, NULL),
(94, 'Employee User', 'Dev', 'Employee', '7dab8a7ae8e0979b', 'employee@nivarahousing.com', '$2a$10$5Xmt2edHIEPwBI9UhCrHp..Qzh.bXOoOWrtbqnGaYdPHnTRA3/Kiq', 0, NULL, '2026-04-02 05:52:26', '2026-04-20 12:15:03', 0, 1, 0, NULL, NULL, 0, 1, '9876543210', NULL, NULL, 1, 0, NULL, '2ad607a1-ec96-4d45-ab9f-77ab2c572e90', 'NZ4TOYRXI5RVEMLHONLUMZKXOMSFG22A', 0, NULL, 0, NULL),
(136, 'Manager User', 'dev', 'Manager', 'acaccddc12e59b0e', 'manager@nivarahousing.com', '$2a$10$GGN7VQ9GVd2rYXaOq0PwkuUKOVSNtwyxKLmknSA7TY02hWWe4Rzjq', 0, NULL, '2026-04-22 06:57:42', '2026-04-22 10:58:05', 0, 1, 0, '2026-04-22 06:59:17', NULL, 0, 1, '6787878787', NULL, NULL, 1, 0, NULL, 'a4700143b29a9c0c', NULL, 0, NULL, 0, NULL),
(137, 'Client Viewer', '', 'Client-Viewer', NULL, 'viewer@nivarahousing.com', '$2a$10$9EY293w7kRrbIu276pyy7.y6GdsxWIlJ65OTxT3J2oTkHXIcszSHy', 0, NULL, '2026-04-22 08:40:32', '2026-04-22 08:40:32', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 1, 0, NULL, 'ce7e1598-d6cd-49da-be1f-7651f0af7b2b', NULL, 0, NULL, 0, NULL),
(138, 'IT Support User', 'Support team', 'IT Support', NULL, 'ashwini.m@nmit-solutions.com', '$2a$10$a7qJUFhJpcz2io1FUQQrkOIWebFe6WdjsqX/X4BKjZdAgizagsMgO', 0, NULL, '2026-04-22 08:40:33', '2026-04-22 09:45:18', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 1, 0, NULL, '65278c8f-372d-4d7d-b52c-86f4a1fab55a', NULL, 0, NULL, 0, NULL),
(145, 'Nikhitha', 'Administrator', 'Admin', NULL, 'n11443547@gmail.com', '$2a$10$dAkjzlu.OwBgzDPmkq/tQera24u4vb55xYZwOd62Rj34iGgqXs8US', 0, NULL, '2026-04-22 09:54:49', '2026-04-22 10:08:31', 0, 1, 0, '2026-04-22 10:08:21', NULL, 0, 1, NULL, NULL, NULL, 5, 0, NULL, '4edb18ff-4a47-43d1-827c-ed571cef7d82', NULL, 0, NULL, 1, '91'),
(154, 'ccc', 'Administrator', 'Admin', NULL, 'c@gmail.com', '$2a$12$JOQVfzvQSzxIdOzcAn1lr.5YgMfxpngZ/FgHbHgrQ7qFa.wfImWCS', 0, NULL, '2026-04-22 10:06:25', '2026-04-22 10:06:42', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 6, 0, NULL, '268f9496-7d4a-4f76-9698-71b37286d163', NULL, 0, NULL, 0, '91'),
(155, 'Manager User', 'dev', 'Manager', '7b9716d59706dcac', 'manager@gmail.com', '$2a$10$FcnHlwsGc74vU/tepX7IheeE57HH/9Wj4.I99TbeG0v9HAORENNIS', 0, NULL, '2026-04-22 10:11:35', '2026-04-22 10:58:09', 0, 1, 0, '2026-04-22 10:12:26', NULL, 0, 1, '6787878787', NULL, NULL, 5, 0, NULL, '7368b685967b2d53', NULL, 0, NULL, 1, NULL),
(156, 'employee', 'devv', 'Employee', '7b9716d59706dcac', 'employee@gmail.com', '$2a$10$spxywQxCHH7ei28Ftzv1M.9URtKN0iyO3SJB6JZmqTI0wxt/mcnCS', 0, NULL, '2026-04-22 10:13:56', '2026-04-22 10:56:00', 0, 1, 0, '2026-04-22 10:14:39', NULL, 0, 1, '6787878788', NULL, NULL, 5, 0, NULL, '5381f632674ef62b', NULL, 0, NULL, 0, NULL),
(157, 'user', 'devops', 'Employee', '46249c60b2650ca8', 'user@gmail.com', '$2a$10$RiobEY3fnrATMu/JARUHuOC0L5SBRMsRONTE/R3hBX7ZpLgFz3dWu', 0, NULL, '2026-04-22 10:15:17', '2026-04-22 10:56:04', 0, 1, 0, '2026-04-22 10:15:56', NULL, 0, 1, '6788878787', NULL, NULL, 5, 0, NULL, '450005271091b199', NULL, 0, NULL, 1, NULL),
(160, 'client', 'Client Viewer', 'Client-Viewer', NULL, 'client1@gmail.com', '$2a$10$SRRsarTtbaGUC0Xkx.dC6uva26reO9Q7VLWRjNBmHJpDDgVAYCI7.', 0, NULL, '2026-04-22 10:21:33', '2026-04-22 10:21:33', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 5, 0, NULL, '2593ed28141952c3', NULL, 0, NULL, 0, NULL),
(163, 'jcx', 'Client Viewer', 'Client-Viewer', NULL, 'Client2@gmail.com', '$2a$10$IlHKFAYWOb3saAW1A/ZFNe0UDJZP7G7PUkqBdcMDhXnWf6YNW08b2', 0, NULL, '2026-04-22 10:27:55', '2026-04-22 10:27:55', 0, 1, 0, NULL, NULL, 0, 1, NULL, NULL, NULL, 5, 0, NULL, '92cf5f7c01720912', NULL, 0, NULL, 0, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `user_checklist_progress`
--

CREATE TABLE `user_checklist_progress` (
  `id` int NOT NULL,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `subtask_id` int NOT NULL,
  `tenant_id` int DEFAULT NULL,
  `status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PENDING',
  `completed_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `workflow`
--

CREATE TABLE `workflow` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `task_id` int NOT NULL,
  `user_id` int NOT NULL,
  `action` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `stage` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `workflow`
--

INSERT INTO `workflow` (`id`, `tenant_id`, `task_id`, `user_id`, `action`, `stage`, `comment`, `created_at`) VALUES
(9, 1, 358, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-13 11:50:07'),
(10, 1, 359, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-13 11:52:18'),
(11, 1, 360, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-13 12:30:03'),
(12, 1, 360, 94, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-13 12:31:18'),
(13, 1, 361, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-13 12:36:33'),
(14, 1, 361, 94, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-13 12:36:51'),
(15, 1, 363, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 06:09:56'),
(16, 1, 363, 94, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 06:10:05'),
(17, 1, 363, 93, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 06:13:30'),
(18, 1, 363, 93, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 06:13:37'),
(19, 1, 361, 93, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 06:13:41'),
(20, 1, 361, 93, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 06:15:15'),
(21, 1, 359, 94, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 06:16:04'),
(22, 1, 358, 94, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 06:16:11'),
(23, 1, 358, 93, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 06:16:24'),
(24, 1, 359, 93, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 06:16:31'),
(25, 1, 365, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 08:43:49'),
(26, 1, 365, 98, 'REJECTED', 'IN_PROGRESS', 'fd', '2026-04-16 08:44:37'),
(27, 1, 365, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 08:44:55'),
(28, 1, 365, 98, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 08:45:04'),
(29, 1, 365, 94, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 08:46:42'),
(30, 1, 365, 98, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 08:46:55'),
(31, 1, 364, 100, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-16 08:48:13'),
(32, 1, 364, 98, 'APPROVED', 'COMPLETED', NULL, '2026-04-16 08:48:21'),
(33, 5, 367, 133, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 05:29:21'),
(34, 5, 367, 131, 'REJECTED', 'IN_PROGRESS', 'check it once before sending to the review state', '2026-04-22 05:33:02'),
(35, 5, 367, 133, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 05:36:03'),
(36, 5, 367, 131, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 05:37:21'),
(37, 5, 368, 133, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 05:37:34'),
(38, 5, 368, 132, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 05:39:19'),
(39, 5, 368, 131, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 05:40:56'),
(40, 5, 368, 131, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 05:40:59'),
(41, 5, 369, 133, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 05:45:35'),
(42, 5, 369, 131, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 05:45:45'),
(43, 5, 373, 156, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:55:05'),
(44, 5, 372, 156, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:55:07'),
(45, 5, 371, 156, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:55:09'),
(46, 5, 371, 155, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 10:55:19'),
(47, 5, 373, 155, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 10:55:21'),
(48, 5, 372, 155, 'REJECTED', 'IN_PROGRESS', 'rdtfryui', '2026-04-22 10:55:25'),
(49, 5, 372, 156, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:55:33'),
(50, 5, 372, 155, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 10:55:43'),
(51, 5, 370, 157, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:56:16'),
(52, 5, 371, 157, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:56:19'),
(53, 5, 373, 157, 'REQUEST_REVIEW', 'REVIEW', 'Employee requesting task review', '2026-04-22 10:56:22'),
(54, 5, 373, 155, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 10:56:29'),
(55, 5, 370, 155, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 10:56:30'),
(56, 5, 371, 155, 'APPROVED', 'COMPLETED', NULL, '2026-04-22 10:56:32');

-- --------------------------------------------------------

--
-- Table structure for table `workflow_definitions`
--

CREATE TABLE `workflow_definitions` (
  `id` int NOT NULL,
  `tenant_id` int NOT NULL,
  `entity_type` enum('TASK','PROJECT') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `states` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `rules` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `workflow_requests`
--

CREATE TABLE `workflow_requests` (
  `id` int NOT NULL,
  `tenant_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `entity_type` enum('TASK','PROJECT') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `entity_id` int NOT NULL,
  `from_state` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `to_state` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `requested_by_id` int NOT NULL,
  `approver_role` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `approver_id` int DEFAULT NULL,
  `requested_by` int DEFAULT NULL,
  `approved_by` int DEFAULT NULL,
  `status` enum('PENDING','APPROVED','REJECTED') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT 'PENDING',
  `reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `rejection_reason` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `rejected_at` datetime DEFAULT NULL,
  `project_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `workflow_requests`
--

INSERT INTO `workflow_requests` (`id`, `tenant_id`, `entity_type`, `entity_id`, `from_state`, `to_state`, `requested_by_id`, `approver_role`, `approver_id`, `requested_by`, `approved_by`, `status`, `reason`, `created_at`, `updated_at`, `rejection_reason`, `rejected_at`, `project_id`) VALUES
(102, '5', 'TASK', 373, 'IN_PROGRESS', 'REVIEW', 156, 'Manager', 155, NULL, 155, 'APPROVED', NULL, '2026-04-22 10:55:05', '2026-04-22 10:55:21', NULL, NULL, NULL),
(103, '5', 'TASK', 372, 'IN_PROGRESS', 'REVIEW', 156, 'Manager', 155, NULL, 155, 'REJECTED', NULL, '2026-04-22 10:55:07', '2026-04-22 10:55:25', NULL, NULL, NULL),
(104, '5', 'TASK', 371, 'IN_PROGRESS', 'REVIEW', 156, 'Manager', 155, NULL, 155, 'APPROVED', NULL, '2026-04-22 10:55:09', '2026-04-22 10:55:19', NULL, NULL, NULL),
(105, '5', 'TASK', 372, 'IN_PROGRESS', 'REVIEW', 156, 'Manager', 155, NULL, 155, 'APPROVED', NULL, '2026-04-22 10:55:33', '2026-04-22 10:55:43', NULL, NULL, NULL),
(106, '5', 'TASK', 370, 'IN_PROGRESS', 'REVIEW', 157, 'Manager', 155, NULL, 155, 'APPROVED', NULL, '2026-04-22 10:56:16', '2026-04-22 10:56:30', NULL, NULL, NULL),
(107, '5', 'TASK', 371, 'IN_PROGRESS', 'REVIEW', 157, 'Manager', 155, NULL, 155, 'APPROVED', NULL, '2026-04-22 10:56:19', '2026-04-22 10:56:32', NULL, NULL, NULL),
(108, '5', 'TASK', 373, 'IN_PROGRESS', 'REVIEW', 157, 'Manager', 155, NULL, 155, 'APPROVED', NULL, '2026-04-22 10:56:22', '2026-04-22 10:56:29', NULL, NULL, NULL),
(109, '5', 'PROJECT', 59, 'ACTIVE', 'CLOSED', 155, 'Admin', NULL, NULL, 145, 'REJECTED', 'fds', '2026-04-22 10:56:40', '2026-04-22 10:56:58', NULL, NULL, 59),
(110, '5', 'PROJECT', 58, 'ACTIVE', 'CLOSED', 155, 'Admin', NULL, NULL, 145, 'APPROVED', 'efdsa', '2026-04-22 10:56:46', '2026-04-22 10:57:00', NULL, NULL, 58),
(111, '5', 'PROJECT', 59, 'ACTIVE', 'CLOSED', 155, 'Admin', NULL, NULL, 145, 'APPROVED', 'grgte', '2026-04-22 10:58:42', '2026-04-22 10:58:53', NULL, NULL, 59);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `admin_modules`
--
ALTER TABLE `admin_modules`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_admin_modules_admin` (`admin_id`);

--
-- Indexes for table `attachments`
--
ALTER TABLE `attachments`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_attachments_ticket_id` (`ticket_id`),
  ADD KEY `idx_attachments_comment_id` (`comment_id`);

--
-- Indexes for table `audit_logs`
--
ALTER TABLE `audit_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_audit_createdAt` (`createdAt`),
  ADD KEY `idx_audit_actor` (`actor_id`),
  ADD KEY `idx_audit_logs_tenant_action` (`tenant_id`,`action`),
  ADD KEY `idx_audit_logs_tenant` (`tenant_id`),
  ADD KEY `idx_audit_logs_tenant_createdAt` (`tenant_id`,`createdAt`),
  ADD KEY `idx_audit_logs_module_action` (`module`,`action`),
  ADD KEY `idx_audit_logs_entity` (`entity`,`entity_id`);

--
-- Indexes for table `business_rules`
--
ALTER TABLE `business_rules`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `rule_code` (`rule_code`);

--
-- Indexes for table `chat_messages`
--
ALTER TABLE `chat_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_sender_id` (`sender_id`),
  ADD KEY `idx_created_at` (`created_at`),
  ADD KEY `idx_message_type` (`message_type`);

--
-- Indexes for table `chat_participants`
--
ALTER TABLE `chat_participants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_project_user` (`project_id`,`user_id`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_is_online` (`is_online`);

--
-- Indexes for table `clients`
--
ALTER TABLE `clients`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `idx_clientss_isDeleted` (`isDeleted`),
  ADD KEY `idx_clientss_status` (`status`),
  ADD KEY `idx_clientss_manager_id` (`manager_id`),
  ADD KEY `idx_clientss_ref` (`ref`),
  ADD KEY `idx_clientss_tenant_id` (`tenant_id`),
  ADD KEY `idx_clientss_gst` (`gst_number`),
  ADD KEY `fk_client_user` (`user_id`),
  ADD KEY `idx_clientss_tenant` (`tenant_id`),
  ADD KEY `idx_clientss_tenant_status` (`tenant_id`,`status`);

--
-- Indexes for table `client_activity_logs`
--
ALTER TABLE `client_activity_logs`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `client_contacts`
--
ALTER TABLE `client_contacts`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_client_contacts_email` (`email`),
  ADD KEY `idx_client_contacts_phone` (`phone`),
  ADD KEY `idx_client_contacts_tenant` (`tenant_id`);

--
-- Indexes for table `client_viewers`
--
ALTER TABLE `client_viewers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_client_user` (`client_id`,`user_id`),
  ADD KEY `idx_client_viewers_user` (`user_id`),
  ADD KEY `idx_client_viewers_active` (`is_active`),
  ADD KEY `idx_client_viewers_tenant` (`tenant_id`);

--
-- Indexes for table `comments`
--
ALTER TABLE `comments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `source_message_id` (`source_message_id`),
  ADD KEY `idx_comments_ticket_id` (`ticket_id`);

--
-- Indexes for table `departments`
--
ALTER TABLE `departments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `public_id` (`public_id`),
  ADD KEY `idx_departments_tenant` (`tenant_id`);

--
-- Indexes for table `documents`
--
ALTER TABLE `documents`
  ADD PRIMARY KEY (`documentId`),
  ADD KEY `idx_entity` (`entityType`,`entityId`),
  ADD KEY `idx_uploaded_by` (`uploadedBy`),
  ADD KEY `idx_created_at` (`createdAt`),
  ADD KEY `idx_documents_clientId` (`clientId`),
  ADD KEY `idx_documents_projectId` (`projectId`),
  ADD KEY `idx_documents_tenant` (`tenant_id`),
  ADD KEY `idx_documents_tenant_entity` (`tenant_id`,`entityType`,`entityId`);

--
-- Indexes for table `document_access`
--
ALTER TABLE `document_access`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_document_user` (`documentId`,`userId`),
  ADD KEY `idx_user` (`userId`),
  ADD KEY `idx_document` (`documentId`),
  ADD KEY `idx_active` (`isActive`);

--
-- Indexes for table `invite_tokens`
--
ALTER TABLE `invite_tokens`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_invite_tokens_token` (`token`),
  ADD KEY `idx_invite_tokens_tenant_email` (`tenant_id`,`email`),
  ADD KEY `idx_invite_tokens_expiry` (`expires_at`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_notifications_user_id` (`user_id`),
  ADD KEY `idx_notifications_is_read` (`is_read`),
  ADD KEY `idx_notifications_created_at` (`created_at`),
  ADD KEY `idx_notifications_tenant` (`tenant_id`);

--
-- Indexes for table `password_history`
--
ALTER TABLE `password_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `permissions`
--
ALTER TABLE `permissions`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_permissions_tenant_name` (`tenant_id`,`name`),
  ADD KEY `idx_permissions_tenant_module` (`tenant_id`,`module`),
  ADD KEY `idx_permissions_active` (`is_active`);

--
-- Indexes for table `platform_settings`
--
ALTER TABLE `platform_settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `setting_key` (`setting_key`),
  ADD KEY `idx_platform_settings_tenant_key` (`tenant_id`,`setting_key`);

--
-- Indexes for table `projects`
--
ALTER TABLE `projects`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `public_id` (`public_id`),
  ADD KEY `idx_client` (`client_id`),
  ADD KEY `idx_manager` (`project_manager_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `created_by` (`created_by`),
  ADD KEY `idx_projects_tenant` (`tenant_id`),
  ADD KEY `idx_projects_tenant_status` (`tenant_id`,`status`);

--
-- Indexes for table `project_chats`
--
ALTER TABLE `project_chats`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `room_name` (`room_name`),
  ADD KEY `idx_project_id` (`project_id`),
  ADD KEY `idx_room_name` (`room_name`);

--
-- Indexes for table `project_departments`
--
ALTER TABLE `project_departments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_project_dept` (`project_id`,`department_id`),
  ADD KEY `department_id` (`department_id`),
  ADD KEY `idx_project_departments_tenant` (`tenant_id`);

--
-- Indexes for table `settings`
--
ALTER TABLE `settings`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_section_key` (`section`,`key_name`);

--
-- Indexes for table `subtasks`
--
ALTER TABLE `subtasks`
  ADD PRIMARY KEY (`id`),
  ADD KEY `task_Id` (`task_Id`),
  ADD KEY `idx_subtasks_tenant` (`tenant_id`);

--
-- Indexes for table `tasks`
--
ALTER TABLE `tasks`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `public_id` (`public_id`),
  ADD KEY `fk_client_id` (`client_id`),
  ADD KEY `idx_tasks_status` (`status`),
  ADD KEY `idx_tasks_project_id` (`project_id`),
  ADD KEY `idx_tasks_task_day` (`task_day`),
  ADD KEY `idx_tasks_tenant` (`tenant_id`),
  ADD KEY `idx_tasks_tenant_project_status` (`tenant_id`,`project_id`,`status`);

--
-- Indexes for table `task_assignments`
--
ALTER TABLE `task_assignments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_task_user` (`task_id`,`user_id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `idx_task_assignments_tenant` (`tenant_id`);

--
-- Indexes for table `task_assignment_status`
--
ALTER TABLE `task_assignment_status`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_tas_task_user` (`task_id`,`user_id`),
  ADD KEY `idx_tas_task_id` (`task_id`),
  ADD KEY `idx_tas_user_id` (`user_id`);

--
-- Indexes for table `task_logs`
--
ALTER TABLE `task_logs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_task_activities_task_id` (`task_id`),
  ADD KEY `idx_task_activities_created_at` (`created_at`);

--
-- Indexes for table `task_resign_requests`
--
ALTER TABLE `task_resign_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `task_id` (`task_id`),
  ADD KEY `requested_by` (`requested_by`),
  ADD KEY `idx_responded_by` (`responded_by`);

--
-- Indexes for table `task_time_entries`
--
ALTER TABLE `task_time_entries`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_task_time_logs_task_id` (`task_id`),
  ADD KEY `idx_task_time_logs_timestamp` (`timestamp`);

--
-- Indexes for table `tenants`
--
ALTER TABLE `tenants`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uniq_tenants_public_id` (`public_id`),
  ADD UNIQUE KEY `uniq_tenants_slug` (`slug`);

--
-- Indexes for table `tickets`
--
ALTER TABLE `tickets`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `ticket_id` (`ticket_id`),
  ADD UNIQUE KEY `source_message_id` (`source_message_id`),
  ADD KEY `idx_tickets_status` (`status`),
  ADD KEY `idx_tickets_priority` (`priority`),
  ADD KEY `idx_tickets_requester_email` (`requester_email`),
  ADD KEY `idx_tickets_assigned_to` (`assigned_to`);

--
-- Indexes for table `timelogs`
--
ALTER TABLE `timelogs`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user` (`user_id`),
  ADD KEY `idx_task` (`task_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`_id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD UNIQUE KEY `public_id` (`public_id`),
  ADD UNIQUE KEY `public_id_2` (`public_id`),
  ADD UNIQUE KEY `public_id_3` (`public_id`),
  ADD KEY `idx_users_tenant` (`tenant_id`),
  ADD KEY `idx_users_tenant_email` (`tenant_id`,`email`);

--
-- Indexes for table `user_checklist_progress`
--
ALTER TABLE `user_checklist_progress`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_ucp_task_user_subtask` (`task_id`,`user_id`,`subtask_id`),
  ADD KEY `idx_ucp_task_user` (`task_id`,`user_id`),
  ADD KEY `idx_ucp_subtask` (`subtask_id`);

--
-- Indexes for table `workflow`
--
ALTER TABLE `workflow`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_workflow_task` (`task_id`),
  ADD KEY `idx_workflow_user` (`user_id`),
  ADD KEY `idx_workflow_stage` (`stage`),
  ADD KEY `idx_workflow_tenant_task` (`tenant_id`,`task_id`);

--
-- Indexes for table `workflow_definitions`
--
ALTER TABLE `workflow_definitions`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_entity` (`tenant_id`,`entity_type`);

--
-- Indexes for table `workflow_requests`
--
ALTER TABLE `workflow_requests`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_tenant_status` (`tenant_id`,`status`),
  ADD KEY `idx_entity` (`entity_type`,`entity_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `admin_modules`
--
ALTER TABLE `admin_modules`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=333;

--
-- AUTO_INCREMENT for table `attachments`
--
ALTER TABLE `attachments`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `audit_logs`
--
ALTER TABLE `audit_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=53527;

--
-- AUTO_INCREMENT for table `business_rules`
--
ALTER TABLE `business_rules`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=38;

--
-- AUTO_INCREMENT for table `chat_messages`
--
ALTER TABLE `chat_messages`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=258;

--
-- AUTO_INCREMENT for table `chat_participants`
--
ALTER TABLE `chat_participants`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=80;

--
-- AUTO_INCREMENT for table `clients`
--
ALTER TABLE `clients`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=91;

--
-- AUTO_INCREMENT for table `client_activity_logs`
--
ALTER TABLE `client_activity_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `client_contacts`
--
ALTER TABLE `client_contacts`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `client_viewers`
--
ALTER TABLE `client_viewers`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=30;

--
-- AUTO_INCREMENT for table `comments`
--
ALTER TABLE `comments`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=7;

--
-- AUTO_INCREMENT for table `departments`
--
ALTER TABLE `departments`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=52;

--
-- AUTO_INCREMENT for table `document_access`
--
ALTER TABLE `document_access`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=27;

--
-- AUTO_INCREMENT for table `invite_tokens`
--
ALTER TABLE `invite_tokens`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=1465;

--
-- AUTO_INCREMENT for table `password_history`
--
ALTER TABLE `password_history`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=36;

--
-- AUTO_INCREMENT for table `permissions`
--
ALTER TABLE `permissions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `platform_settings`
--
ALTER TABLE `platform_settings`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=24;

--
-- AUTO_INCREMENT for table `projects`
--
ALTER TABLE `projects`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=61;

--
-- AUTO_INCREMENT for table `project_chats`
--
ALTER TABLE `project_chats`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

--
-- AUTO_INCREMENT for table `project_departments`
--
ALTER TABLE `project_departments`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=125;

--
-- AUTO_INCREMENT for table `settings`
--
ALTER TABLE `settings`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `subtasks`
--
ALTER TABLE `subtasks`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=58;

--
-- AUTO_INCREMENT for table `tasks`
--
ALTER TABLE `tasks`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=375;

--
-- AUTO_INCREMENT for table `task_assignments`
--
ALTER TABLE `task_assignments`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=25;

--
-- AUTO_INCREMENT for table `task_assignment_status`
--
ALTER TABLE `task_assignment_status`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=189;

--
-- AUTO_INCREMENT for table `task_logs`
--
ALTER TABLE `task_logs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `task_resign_requests`
--
ALTER TABLE `task_resign_requests`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=50;

--
-- AUTO_INCREMENT for table `task_time_entries`
--
ALTER TABLE `task_time_entries`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=29;

--
-- AUTO_INCREMENT for table `tenants`
--
ALTER TABLE `tenants`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=14;

--
-- AUTO_INCREMENT for table `tickets`
--
ALTER TABLE `tickets`
  MODIFY `id` bigint UNSIGNED NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=11;

--
-- AUTO_INCREMENT for table `timelogs`
--
ALTER TABLE `timelogs`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `users`
--
ALTER TABLE `users`
  MODIFY `_id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=175;

--
-- AUTO_INCREMENT for table `user_checklist_progress`
--
ALTER TABLE `user_checklist_progress`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=25;

--
-- AUTO_INCREMENT for table `workflow`
--
ALTER TABLE `workflow`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=57;

--
-- AUTO_INCREMENT for table `workflow_definitions`
--
ALTER TABLE `workflow_definitions`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `workflow_requests`
--
ALTER TABLE `workflow_requests`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=112;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `admin_modules`
--
ALTER TABLE `admin_modules`
  ADD CONSTRAINT `fk_admin_modules_user` FOREIGN KEY (`admin_id`) REFERENCES `users` (`_id`) ON DELETE CASCADE;

--
-- Constraints for table `attachments`
--
ALTER TABLE `attachments`
  ADD CONSTRAINT `fk_attachments_comment_id` FOREIGN KEY (`comment_id`) REFERENCES `comments` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_attachments_ticket_id` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `audit_logs`
--
ALTER TABLE `audit_logs`
  ADD CONSTRAINT `fk_audit_actor` FOREIGN KEY (`actor_id`) REFERENCES `users` (`_id`) ON DELETE SET NULL;

--
-- Constraints for table `chat_participants`
--
ALTER TABLE `chat_participants`
  ADD CONSTRAINT `chat_participants_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`_id`) ON DELETE CASCADE;

--
-- Constraints for table `client_viewers`
--
ALTER TABLE `client_viewers`
  ADD CONSTRAINT `fk_client_viewers_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `comments`
--
ALTER TABLE `comments`
  ADD CONSTRAINT `fk_comments_ticket_id` FOREIGN KEY (`ticket_id`) REFERENCES `tickets` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `document_access`
--
ALTER TABLE `document_access`
  ADD CONSTRAINT `document_access_ibfk_1` FOREIGN KEY (`documentId`) REFERENCES `documents` (`documentId`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`_id`) ON DELETE CASCADE;

--
-- Constraints for table `projects`
--
ALTER TABLE `projects`
  ADD CONSTRAINT `projects_ibfk_1` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `projects_ibfk_2` FOREIGN KEY (`project_manager_id`) REFERENCES `users` (`_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `projects_ibfk_3` FOREIGN KEY (`created_by`) REFERENCES `users` (`_id`) ON DELETE SET NULL;

--
-- Constraints for table `project_departments`
--
ALTER TABLE `project_departments`
  ADD CONSTRAINT `project_departments_ibfk_1` FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `project_departments_ibfk_2` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `subtasks`
--
ALTER TABLE `subtasks`
  ADD CONSTRAINT `subtasks_ibfk_1` FOREIGN KEY (`task_Id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `tasks`
--
ALTER TABLE `tasks`
  ADD CONSTRAINT `fk_client_id` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `task_assignments`
--
ALTER TABLE `task_assignments`
  ADD CONSTRAINT `task_assignments_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `task_assignments_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`_id`) ON DELETE CASCADE;

--
-- Constraints for table `task_resign_requests`
--
ALTER TABLE `task_resign_requests`
  ADD CONSTRAINT `task_resign_requests_ibfk_1` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `task_resign_requests_ibfk_2` FOREIGN KEY (`requested_by`) REFERENCES `users` (`_id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
