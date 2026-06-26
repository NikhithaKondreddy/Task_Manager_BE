let logger;
try {
  logger = require(__root + 'logger');
} catch (error) {
  logger = require('../logger');
}

const db = require('../db');
const { ensureTenantPublicId } = require('../utils/tenantId');
const { seedUsers } = require('../seed/seedUsers');

let migrateDatabase;
try {
  const migrationService = require('./migrationService');
  migrateDatabase = migrationService.migrateDatabase;
} catch (error) {
  logger.error('Failed to import migrationService:', error.message);
  migrateDatabase = null;
}

const tableCache = new Map();
const columnCache = new Map();
const indexCache = new Map();
const triggerCache = new Map();

const transientDbErrorCodes = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ETIMEOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN'
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function q(sql, params = []) {
  const maxAttempts = 4;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await new Promise((resolve, reject) => {
        db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
      });
    } catch (error) {
      const message = error && error.message ? error.message : '';
      const isTransient = transientDbErrorCodes.has(error.code) || /connect ETIMEDOUT|ETIMEDOUT|ECONNREFUSED|Connection lost|Lost connection|timeout/i.test(message);

      if (!isTransient || attempt >= maxAttempts) {
        throw error;
      }

      const delayMs = 500 * Math.pow(2, attempt - 1);
      logger.warn(`bootstrapService: transient DB error (${error.code || 'UNKNOWN'}) on attempt ${attempt}. Retrying in ${delayMs}ms...`);
      await sleep(delayMs);
    }
  }
}

async function tableExists(tableName) {
  if (tableCache.has(tableName)) return tableCache.get(tableName);
  const rows = await q(
    `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName]
  );
  const exists = Array.isArray(rows) && rows.length > 0;
  tableCache.set(tableName, exists);
  return exists;
}

async function columnExists(tableName, columnName) {
  const cacheKey = `${tableName}::${columnName}`;
  if (columnCache.has(cacheKey)) return columnCache.get(cacheKey);
  const rows = await q(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
    `,
    [tableName, columnName]
  );
  const exists = Array.isArray(rows) && rows.length > 0;
  columnCache.set(cacheKey, exists);
  return exists;
}

async function indexExists(tableName, indexName) {
  const cacheKey = `${tableName}::${indexName}`;
  if (indexCache.has(cacheKey)) return indexCache.get(cacheKey);
  const rows = await q(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
  const exists = Array.isArray(rows) && rows.length > 0;
  indexCache.set(cacheKey, exists);
  return exists;
}

async function triggerExists(triggerName) {
  if (triggerCache.has(triggerName)) return triggerCache.get(triggerName);
  const rows = await q(
    `
      SELECT TRIGGER_NAME
      FROM INFORMATION_SCHEMA.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE()
        AND TRIGGER_NAME = ?
    `,
    [triggerName]
  );
  const exists = Array.isArray(rows) && rows.length > 0;
  triggerCache.set(triggerName, exists);
  return exists;
}

async function ensureColumn(tableName, columnSql) {
  const parts = columnSql.trim().split(/\s+/);
  const columnName = parts[0].replace(/`/g, '');
  if (!await tableExists(tableName)) return;
  if (await columnExists(tableName, columnName)) return;
  await q(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
  columnCache.set(`${tableName}::${columnName}`, true);
}

async function ensureIndex(tableName, indexName, indexSql) {
  if (!await tableExists(tableName)) return;
  if (await indexExists(tableName, indexName)) return;
  await q(`ALTER TABLE ${tableName} ADD ${indexSql}`);
  indexCache.set(`${tableName}::${indexName}`, true);
}

async function ensureTenantColumns() {
  const tenantTables = [
    'users',
    'departments',
    'clients',
    'projects',
    'tasks',
    'documents',
    'audit_logs',
    'notifications',
    'task_assignments',
    'subtasks',
    'client_contacts',
    'client_viewers',
    'project_departments',
    'files',
    'task_escalations'
  ];

  for (const tableName of tenantTables) {
    if (!await tableExists(tableName)) continue;
    await ensureColumn(tableName, 'tenant_id INT NULL');
    await ensureIndex(tableName, `idx_${tableName}_tenant`, `INDEX idx_${tableName}_tenant (tenant_id)`);
  }

  await ensureIndex('users', 'idx_users_tenant_email', 'INDEX idx_users_tenant_email (tenant_id, email)');
  await ensureIndex('projects', 'idx_projects_tenant_status', 'INDEX idx_projects_tenant_status (tenant_id, status)');
  await ensureIndex('tasks', 'idx_tasks_tenant_project_status', 'INDEX idx_tasks_tenant_project_status (tenant_id, project_id, status)');
  await ensureIndex('clients', 'idx_clients_tenant_status', 'INDEX idx_clients_tenant_status (tenant_id, status)');
  await ensureIndex('documents', 'idx_documents_tenant_entity', 'INDEX idx_documents_tenant_entity (tenant_id, entityType, entityId)');
  await ensureIndex('audit_logs', 'idx_audit_logs_tenant_createdAt', 'INDEX idx_audit_logs_tenant_createdAt (tenant_id, createdAt)');

  const backfills = [
    `UPDATE users SET tenant_id = COALESCE(tenant_id, 1) WHERE tenant_id IS NULL`,
    `UPDATE departments d LEFT JOIN users u ON d.manager_id = u._id SET d.tenant_id = COALESCE(d.tenant_id, u.tenant_id, 1) WHERE d.tenant_id IS NULL`,
    `UPDATE clients c LEFT JOIN users u ON c.manager_id = u._id SET c.tenant_id = COALESCE(c.tenant_id, u.tenant_id, 1) WHERE c.tenant_id IS NULL`,
    `UPDATE projects p LEFT JOIN clients c ON p.client_id = c.id LEFT JOIN users u ON p.project_manager_id = u._id SET p.tenant_id = COALESCE(p.tenant_id, c.tenant_id, u.tenant_id, 1) WHERE p.tenant_id IS NULL`,
    `UPDATE tasks t LEFT JOIN projects p ON t.project_id = p.id LEFT JOIN clients c ON t.client_id = c.id SET t.tenant_id = COALESCE(t.tenant_id, p.tenant_id, c.tenant_id, 1) WHERE t.tenant_id IS NULL`,
    `UPDATE documents d LEFT JOIN projects p ON d.projectId = p.id LEFT JOIN clients c ON d.clientId = c.id SET d.tenant_id = COALESCE(d.tenant_id, p.tenant_id, c.tenant_id, 1) WHERE d.tenant_id IS NULL`,
    `UPDATE task_assignments ta LEFT JOIN tasks t ON ta.task_id = t.id SET ta.tenant_id = COALESCE(ta.tenant_id, t.tenant_id, 1) WHERE ta.tenant_id IS NULL`,
    `UPDATE subtasks s LEFT JOIN tasks t ON COALESCE(s.task_id, s.task_id) = t.id SET s.tenant_id = COALESCE(s.tenant_id, t.tenant_id, 1) WHERE s.tenant_id IS NULL`,
    `UPDATE client_contacts cc LEFT JOIN clients c ON cc.client_id = c.id SET cc.tenant_id = COALESCE(cc.tenant_id, c.tenant_id, 1) WHERE cc.tenant_id IS NULL`,
    `UPDATE client_viewers cv LEFT JOIN clients c ON cv.client_id = c.id SET cv.tenant_id = COALESCE(cv.tenant_id, c.tenant_id, 1) WHERE cv.tenant_id IS NULL`,
    `UPDATE project_departments pd LEFT JOIN projects p ON pd.project_id = p.id SET pd.tenant_id = COALESCE(pd.tenant_id, p.tenant_id, 1) WHERE pd.tenant_id IS NULL`
  ];

  for (const sql of backfills) {
    try {
      await q(sql);
    } catch (error) {
      logger.warn(`bootstrapService: skipped tenant backfill: ${error.message}`);
    }
  }
}

async function ensureCoreTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INT AUTO_INCREMENT PRIMARY KEY,
      public_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) NULL,
      domain VARCHAR(255) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_tenants_public_id (public_id),
      UNIQUE KEY uniq_tenants_slug (slug)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    INSERT INTO tenants (id, public_id, name, slug, domain, is_active)
    VALUES (1, 'tenant_default', 'Default Tenant', 'default-tenant', 'nivarahousing.com', 1)
    ON DUPLICATE KEY UPDATE name = VALUES(name), domain = VALUES(domain), is_active = VALUES(is_active)
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS invite_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      user_id INT NULL,
      email VARCHAR(255) NOT NULL,
      role_key VARCHAR(50) NOT NULL,
      department_public_id VARCHAR(64) NULL,
      invited_by INT NULL,
      token VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      accepted_at DATETIME NULL,
      metadata JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_invite_tokens_token (token),
      INDEX idx_invite_tokens_tenant_email (tenant_id, email),
      INDEX idx_invite_tokens_expiry (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS admin_modules (
      id INT AUTO_INCREMENT PRIMARY KEY,
      admin_id INT NOT NULL,
      module_id VARCHAR(32) NULL,
      name VARCHAR(100) NOT NULL,
      access ENUM('full','limited','view') NOT NULL DEFAULT 'full',
      path VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_admin_modules_admin (admin_id),
      CONSTRAINT fk_admin_modules_user FOREIGN KEY (admin_id) REFERENCES users(_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Create task_occurrences table to store generated occurrences, photos and independent status
  await q(`
    CREATE TABLE IF NOT EXISTS task_occurrences (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      occurrence_date DATE NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'Pending',
      completed_at DATETIME NULL,
      remarks TEXT NULL,
      photo_path VARCHAR(1024) NULL,
      created_by INT NULL,
      tenant_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_task_occurrence_task_date (task_id, occurrence_date),
      INDEX idx_task_occurrences_task (task_id),
      INDEX idx_task_occurrences_tenant (tenant_id),
      CONSTRAINT fk_task_occurrences_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Ensure reminder_sent column exists for task_occurrences (backfill safe)
  await ensureColumn('task_occurrences', 'reminder_sent TINYINT(1) DEFAULT 0');
  await ensureIndex('task_occurrences', 'idx_task_occurrences_reminder_sent', 'INDEX idx_task_occurrences_reminder_sent (reminder_sent)');

  // Create task_escalations table to store escalation history
  await q(`
    CREATE TABLE IF NOT EXISTS task_escalations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      task_id INT NOT NULL,
      escalated_by VARCHAR(255) NULL,
      escalated_to VARCHAR(255) NULL,
      escalation_level INT NOT NULL DEFAULT 1,
      reason TEXT NULL,
      comments TEXT NULL,
      escalated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_task_escalations_task (task_id),
      CONSTRAINT fk_task_escalations_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureAuditLogShape() {
  if (!await tableExists('audit_logs')) return;

  await ensureColumn('audit_logs', 'tenant_id INT NULL');
  await ensureColumn('audit_logs', 'module VARCHAR(100) NULL');
  await ensureColumn('audit_logs', 'ip_address VARCHAR(255) NULL');
  await ensureColumn('audit_logs', 'user_agent TEXT NULL');
  await ensureColumn('audit_logs', 'correlation_id VARCHAR(100) NULL');
  await ensureColumn('audit_logs', 'previous_value JSON NULL');
  await ensureColumn('audit_logs', 'new_value JSON NULL');

  await ensureIndex('audit_logs', 'idx_audit_logs_module_action', 'INDEX idx_audit_logs_module_action (module, action)');
  await ensureIndex('audit_logs', 'idx_audit_logs_entity', 'INDEX idx_audit_logs_entity (entity, entity_id)');

  if (!await triggerExists('audit_logs_block_update')) {
    await q(`
      CREATE TRIGGER audit_logs_block_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'
    `);
  }

  if (!await triggerExists('audit_logs_block_delete')) {
    await q(`
      CREATE TRIGGER audit_logs_block_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'
    `);
  }
}

async function ensureSettingsShape() {
  if (!await tableExists('platform_settings')) return;
  await ensureColumn('platform_settings', 'tenant_id INT NULL');
  await ensureColumn('platform_settings', "module_key VARCHAR(50) NOT NULL DEFAULT 'general'");
  await ensureColumn('platform_settings', 'is_core TINYINT(1) NOT NULL DEFAULT 0');
  await ensureIndex('platform_settings', 'idx_platform_settings_tenant_key', 'INDEX idx_platform_settings_tenant_key (tenant_id, setting_key)');
}

async function ensureSoftDeleteColumns() {
  if (await tableExists('clients')) {
    await ensureColumn('clients', 'isDeleted TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('clients', 'archived_at DATETIME NULL');
    await ensureColumn('clients', 'archived_by INT NULL');
  }
  if (await tableExists('projects')) {
    await ensureColumn('projects', 'deleted_at DATETIME NULL');
    await ensureColumn('projects', 'deleted_by INT NULL');
    await ensureColumn('projects', 'is_active TINYINT(1) NOT NULL DEFAULT 1');
  }
  if (await tableExists('tasks')) {
    await ensureColumn('tasks', 'approved_by INT NULL');
    await ensureColumn('tasks', 'approved_at DATETIME NULL');
    await ensureColumn('tasks', 'rejection_reason TEXT NULL');
    await ensureColumn('tasks', 'rejected_by INT NULL');
    await ensureColumn('tasks', 'rejected_at DATETIME NULL');
    await ensureColumn('tasks', 'isDeleted TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn('tasks', 'deleted_at DATETIME NULL');
    await ensureColumn('tasks', 'deleted_by INT NULL');
    
    // Future scalability and recurrence columns
    await ensureColumn('tasks', 'parent_id INT NULL');
    await ensureColumn('tasks', 'checkpoints JSON NULL');
    await ensureColumn('tasks', 'dependencies JSON NULL');
    await ensureColumn('tasks', 'progress INT DEFAULT 0');
    await ensureColumn('tasks', 'auto_progress_calculation TINYINT(1) DEFAULT 0');
    await ensureColumn('tasks', "recurrence ENUM('Individual', 'Daily', 'Weekly', 'Monthly') NOT NULL DEFAULT 'Individual'");
    await ensureColumn('tasks', 'recurrence_parent_id INT NULL');

    // Recurrence scheduling and reminders
    await ensureColumn('tasks', 'start_date DATETIME NULL');
    await ensureColumn('tasks', 'end_date DATETIME NULL');
    await ensureColumn('tasks', 'day_of_week TINYINT NULL');
    await ensureColumn('tasks', 'day_of_month TINYINT NULL');
    await ensureColumn('tasks', 'next_due_date DATETIME NULL');
    await ensureColumn('tasks', 'reminder_enabled TINYINT(1) DEFAULT 0');
    await ensureColumn('tasks', 'reminder_time TIME NULL');
    await ensureColumn('tasks', 'reminder_offset_days INT DEFAULT 0');
    await ensureColumn('tasks', 'allow_photo_upload TINYINT(1) DEFAULT 0');
    await ensureColumn('tasks', "task_type VARCHAR(50) NOT NULL DEFAULT 'Project'");
    await ensureIndex('tasks', 'idx_tasks_task_type', 'INDEX idx_tasks_task_type (task_type)');

    // High performance indexes
    await ensureIndex('tasks', 'idx_tasks_status', 'INDEX idx_tasks_status (status)');
    await ensureIndex('tasks', 'idx_tasks_taskDate', 'INDEX idx_tasks_taskDate (taskDate)');
    await ensureIndex('tasks', 'idx_tasks_parent_id', 'INDEX idx_tasks_parent_id (parent_id)');
    await ensureIndex('tasks', 'idx_tasks_recurrence_parent_id', 'INDEX idx_tasks_recurrence_parent_id (recurrence_parent_id)');
    await ensureIndex('tasks', 'idx_tasks_createdAt', 'INDEX idx_tasks_createdAt (createdAt)');
    await ensureIndex('tasks', 'idx_tasks_next_due_date', 'INDEX idx_tasks_next_due_date (next_due_date)');
    await ensureIndex('tasks', 'idx_tasks_reminder_enabled', 'INDEX idx_tasks_reminder_enabled (reminder_enabled)');
    
    if (await tableExists('files')) {
      await ensureIndex('files', 'idx_files_task_id', 'INDEX idx_files_task_id (task_id)');
    }
  }
}

let bootstrapPromise = null;
let bootstrapRetryInterval = null;

async function retryBootstrapInBackground() {
  if (bootstrapRetryInterval) return; // Already retrying

  bootstrapRetryInterval = setInterval(async () => {
    try {
      // First, ensure all required tables exist
      if (migrateDatabase) {
        const migrationResult = await migrateDatabase();
        if (!migrationResult.success) {
          logger.warn('bootstrapService: database migration had errors during retry, but continuing...');
        }
      }

      await ensureCoreTables();
      await ensureSettingsShape();
      await ensureSoftDeleteColumns();
      await ensureTenantColumns();
      await ensureAuditLogShape();
      // Upgrade default tenant public_id from legacy 'tenant_default' to a real UUID
      await ensureTenantPublicId(1).catch(e =>
        logger.warn('bootstrapService: could not upgrade tenant public_id: ' + e.message)
      );
      await seedUsers().catch(e =>
        logger.warn('bootstrapService: seedUsers failed: ' + e.message)
      );
      logger.info('bootstrapService: multi-tenant bootstrap complete (retried)');
      clearInterval(bootstrapRetryInterval);
      bootstrapRetryInterval = null;
    } catch (error) {
      logger.warn('bootstrapService: retry failed: ' + error.message + ' - will retry again');
    }
  }, 30000); // Retry every 30 seconds
}

async function ensureBootstrap() {
  if (bootstrapPromise) return bootstrapPromise;

  bootstrapPromise = (async () => {
    try {
      // First, ensure all required tables exist
      if (migrateDatabase) {
        logger.info('bootstrapService: starting database migration...');
        const migrationResult = await migrateDatabase();
        if (!migrationResult.success) {
          logger.warn('bootstrapService: database migration had errors, but continuing...');
        } else {
          logger.info('bootstrapService: database migration completed successfully');
        }
      } else {
        logger.warn('bootstrapService: migration service not available, skipping migration');
      }

      await ensureCoreTables();
      await ensureSettingsShape();
      await ensureSoftDeleteColumns();
      await ensureTenantColumns();
      await ensureAuditLogShape();
      // Upgrade default tenant public_id from legacy 'tenant_default' to a real UUID
      await ensureTenantPublicId(1).catch(e =>
        logger.warn('bootstrapService: could not upgrade tenant public_id: ' + e.message)
      );
      await seedUsers().catch(e =>
        logger.warn('bootstrapService: seedUsers failed: ' + e.message)
      );
      logger.info('bootstrapService: multi-tenant bootstrap complete');
      return { success: true };
    } catch (error) {
      logger.error('bootstrapService: initial bootstrap failed: ' + error.message + ' - starting background retry');
      // Start background retry instead of throwing
      retryBootstrapInBackground();
      return { success: false, error };
    }
  })();

  return bootstrapPromise;
}

module.exports = {
  ensureBootstrap
};
