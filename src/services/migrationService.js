const db = require('../db');
const fs = require('fs');
const path = require('path');

let logger;
try {
  logger = require(__root + 'logger');
} catch (error) {
  logger = require('../logger');
}

const SQL_DUMP_FILE_PATH = process.env.MARKET_TASK_DB_SQL_PATH || path.resolve(__dirname, '../..', 'database', 'market_task_db.sql');

/**
 * Database Migration Service
 * Handles automatic creation of all required database tables on startup
 */

// Connection retry configuration
const MAX_RETRIES = 5;
const RETRY_DELAY = 2000; // 2 seconds
const CONNECTION_TIMEOUT = 30000; // 30 seconds

// Table creation order (important for foreign key constraints)
const MIGRATION_ORDER = [
  'tenants',
  'users',
  'roles',
  'permissions',
  'audit_logs',
  'notifications',
  'tickets',
  'comments',
  'attachments'
];

// Migration schemas
const MIGRATION_SCHEMAS = {
  tenants: `
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
  `,

  users: `
    CREATE TABLE IF NOT EXISTS users (
      _id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      public_id VARCHAR(64) UNIQUE,
      tenant_id INT NULL,
      email VARCHAR(320) NOT NULL UNIQUE,
      name VARCHAR(255),
      password VARCHAR(255),
      role VARCHAR(50) DEFAULT 'Employee',
      title VARCHAR(100),
      isActive TINYINT(1) DEFAULT 1,
      isGuest TINYINT(1) DEFAULT 1,
      createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_email (email),
      INDEX idx_users_tenant_email (tenant_id, email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,

  roles: `
    CREATE TABLE IF NOT EXISTS roles (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      is_system_role TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_roles_tenant_name (tenant_id, name),
      INDEX idx_roles_tenant (tenant_id),
      INDEX idx_roles_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,

  permissions: `
    CREATE TABLE IF NOT EXISTS permissions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      module VARCHAR(100) NOT NULL,
      action VARCHAR(100) NOT NULL,
      is_system_permission TINYINT(1) NOT NULL DEFAULT 0,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_permissions_tenant_name (tenant_id, name),
      INDEX idx_permissions_tenant_module (tenant_id, module),
      INDEX idx_permissions_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `,

  audit_logs: `
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      actor_id VARCHAR(100) DEFAULT NULL COMMENT 'User ID or system identifier',
      tenant_id INT NOT NULL COMMENT 'Tenant ID for multi-tenancy',
      action VARCHAR(100) NOT NULL COMMENT 'Action performed',
      entity VARCHAR(100) DEFAULT NULL COMMENT 'Entity type affected',
      entity_id VARCHAR(100) DEFAULT NULL COMMENT 'Entity ID affected',
      module VARCHAR(50) DEFAULT NULL COMMENT 'Module name: Auth, Tasks, Projects, etc.',
      ip_address VARCHAR(45) DEFAULT NULL COMMENT 'IP address of actor',
      user_agent TEXT DEFAULT NULL COMMENT 'User agent string',
      correlation_id VARCHAR(100) DEFAULT NULL COMMENT 'Request correlation ID',
      details JSON DEFAULT NULL COMMENT 'Additional metadata',
      previous_value JSON DEFAULT NULL COMMENT 'Previous state before change',
      new_value JSON DEFAULT NULL COMMENT 'New state after change',
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_tenant_created (tenant_id, createdAt DESC),
      INDEX idx_audit_module_action (module, action),
      INDEX idx_audit_created (createdAt DESC),
      INDEX idx_audit_actor (actor_id, createdAt DESC),
      INDEX idx_audit_entity (entity, entity_id),
      INDEX idx_audit_correlation (correlation_id),
      INDEX idx_audit_tenant_module (tenant_id, module, createdAt DESC),
      INDEX idx_audit_tenant_module_action_created (tenant_id, module, action, createdAt DESC)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,

  notifications: `
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      user_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(100) NOT NULL,
      entity_type VARCHAR(100) NULL,
      entity_id INT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_notifications_user (user_id),
      INDEX idx_notifications_tenant_user (tenant_id, user_id),
      INDEX idx_notifications_type (type),
      INDEX idx_notifications_read (is_read),
      INDEX idx_notifications_created (created_at DESC),
      CONSTRAINT fk_notifications_user FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,

  tickets: `
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id VARCHAR(32) NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      requester_user_id INT NULL,
      requester_email VARCHAR(320) NOT NULL,
      status ENUM('New', 'Open', 'In Progress', 'Closed') NOT NULL DEFAULT 'New',
      priority ENUM('Low', 'Medium', 'High') NOT NULL DEFAULT 'Medium',
      assigned_to INT NULL,
      assigned_queue VARCHAR(100) NOT NULL DEFAULT 'IT Support',
      module VARCHAR(100) DEFAULT 'general',
      source VARCHAR(30) NOT NULL DEFAULT 'api',
      source_message_id VARCHAR(512) UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_tickets_status (status),
      INDEX idx_tickets_priority (priority),
      INDEX idx_tickets_requester_email (requester_email),
      INDEX idx_tickets_assigned_to (assigned_to),
      INDEX idx_tickets_module (module),
      CONSTRAINT fk_tickets_requester FOREIGN KEY (requester_user_id) REFERENCES users(_id) ON DELETE SET NULL,
      CONSTRAINT fk_tickets_assigned FOREIGN KEY (assigned_to) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,

  comments: `
    CREATE TABLE IF NOT EXISTS comments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id INT NULL,
      author_email VARCHAR(320),
      body TEXT NOT NULL,
      source VARCHAR(30) NOT NULL DEFAULT 'api',
      source_message_id VARCHAR(512) UNIQUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_comments_ticket_id (ticket_id),
      CONSTRAINT fk_comments_ticket_id FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_comments_user FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `,

  attachments: `
    CREATE TABLE IF NOT EXISTS attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      comment_id BIGINT UNSIGNED NULL,
      file_name TEXT NOT NULL,
      content_type VARCHAR(255),
      size_bytes BIGINT,
      storage_path TEXT NOT NULL,
      checksum_sha256 VARCHAR(64),
      content_id TEXT,
      is_inline BOOLEAN NOT NULL DEFAULT FALSE,
      source_message_id VARCHAR(512),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_attachments_ticket_id (ticket_id),
      INDEX idx_attachments_comment_id (comment_id),
      CONSTRAINT fk_attachments_ticket_id FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_attachments_comment_id FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `
};

/**
 * Execute a single SQL query with retry logic
 */
async function executeQuery(sql, params = [], tableName = null, attempt = 1) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) {
        const isTransientError = err.code === 'PROTOCOL_CONNECTION_LOST' ||
                                err.code === 'ECONNREFUSED' ||
                                err.code === 'ETIMEDOUT' ||
                                err.code === 'ECONNRESET' ||
                                /connect ETIMEDOUT|ETIMEDOUT|ECONNREFUSED|Connection lost|Lost connection|timeout/i.test(err.message);

        if (isTransientError && attempt < MAX_RETRIES) {
          logger.warn(`Migration: transient DB error for table '${tableName || 'unknown'}' on attempt ${attempt}. Retrying in ${RETRY_DELAY}ms...`);
          setTimeout(() => {
            executeQuery(sql, params, tableName, attempt + 1)
              .then(resolve)
              .catch(reject);
          }, RETRY_DELAY);
          return;
        }

        reject(err);
        return;
      }

      resolve(results);
    });
  });
}

function parseCreateTableStatements(sqlText) {
  const normalized = sqlText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const createTableRegex = /CREATE TABLE\s+`([^`]+)`[\s\S]*?;\n?/gi;
  const statements = [];
  let match;

  while ((match = createTableRegex.exec(normalized)) !== null) {
    let createSql = match[0].trim();
    createSql = createSql.replace(/^CREATE TABLE\s+`/i, 'CREATE TABLE IF NOT EXISTS `');
    statements.push(createSql);
  }

  return statements;
}

async function importSchemaFromSqlDump() {
  if (!fs.existsSync(SQL_DUMP_FILE_PATH)) {
    logger.debug(`Migration: SQL dump not found at ${SQL_DUMP_FILE_PATH}`);
    return { createdTables: [], errors: [] };
  }

  let content;
  try {
    content = fs.readFileSync(SQL_DUMP_FILE_PATH, 'utf8');
  } catch (error) {
    logger.error(`Migration: failed to read SQL dump file at ${SQL_DUMP_FILE_PATH}: ${error.message}`);
    return { createdTables: [], errors: [{ table: 'sql_dump', error: error.message }] };
  }

  const statements = parseCreateTableStatements(content);
  const createdTables = [];
  const errors = [];

  for (const sql of statements) {
    const tableMatch = /CREATE TABLE IF NOT EXISTS `([^`]+)`/i.exec(sql);
    const tableName = tableMatch ? tableMatch[1] : null;
    if (!tableName) continue;

    try {
      const exists = await tableExists(tableName);
      if (exists) {
        logger.debug(`Migration: SQL dump table '${tableName}' already exists, skipping`);
        continue;
      }

      await executeQuery(sql, [], tableName);
      logger.info(`Migration: SQL dump created table '${tableName}'`);
      createdTables.push(tableName);
    } catch (error) {
      logger.warn(`Migration: failed to create SQL dump table '${tableName}': ${error.message}`);
      errors.push({ table: tableName, error: error.message });
    }
  }

  return { createdTables, errors };
}

/**
 * Check if a table exists
 */
async function tableExists(tableName) {
  try {
    const results = await executeQuery(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName],
      tableName
    );
    return Array.isArray(results) && results.length > 0;
  } catch (error) {
    logger.warn(`Migration: could not check if table '${tableName}' exists: ${error.message}`);
    return false;
  }
}

/**
 * Ensure a table's id column is AUTO_INCREMENT. Alters the column if needed.
 */
async function ensureAutoIncrement(tableName, columnName = 'id', columnDef = 'BIGINT') {
  try {
    const rows = await executeQuery(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, EXTRA
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [tableName, columnName],
      tableName
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      logger.debug(`Migration: column '${columnName}' not found on table '${tableName}', skipping AUTO_INCREMENT check`);
      return;
    }

    const info = rows[0];
    if (info.EXTRA && info.EXTRA.toLowerCase().includes('auto_increment')) {
      logger.debug(`Migration: table '${tableName}' column '${columnName}' already has AUTO_INCREMENT`);
      return;
    }

    // Check for duplicate values in the column to avoid ALTER failures (which can cause ER_DUP_ENTRY)
    try {
      const dupRows = await executeQuery(
        `SELECT COUNT(1) AS total_count, COUNT(DISTINCT \`${columnName}\`) AS distinct_count FROM \`${tableName}\``,
        [],
        tableName
      );
      const total = dupRows && dupRows[0] && Number(dupRows[0].total_count || dupRows[0].total) || 0;
      const distinct = dupRows && dupRows[0] && Number(dupRows[0].distinct_count || dupRows[0].distinct) || 0;
      if (total > distinct) {
        logger.warn(`Migration: table '${tableName}' has duplicate values in column '${columnName}', skipping AUTO_INCREMENT alteration to avoid data loss`);
        return;
      }
    } catch (e) {
      logger.warn(`Migration: could not verify duplicates for ${tableName}.${columnName}: ${e.message}`);
      // proceed to attempt ALTER as a last resort
    }

    // Attempt to alter the column to be AUTO_INCREMENT PRIMARY KEY
    const alterSql = `ALTER TABLE \`${tableName}\` MODIFY COLUMN \`${columnName}\` ${columnDef} NOT NULL AUTO_INCREMENT PRIMARY KEY`;
    await executeQuery(alterSql, [], tableName);
    logger.info(`Migration: altered table '${tableName}' to add AUTO_INCREMENT on '${columnName}'`);
  } catch (error) {
    logger.warn(`Migration: could not add AUTO_INCREMENT to ${tableName}.${columnName}: ${error.message}`);
  }
}

/**
 * Create a single table
 */
async function createTable(tableName) {
  const sql = MIGRATION_SCHEMAS[tableName];
  if (!sql) {
    throw new Error(`No migration schema found for table '${tableName}'`);
  }

  try {
    const existedBefore = await tableExists(tableName);
    await executeQuery(sql, [], tableName);

    if (!existedBefore) {
      logger.info(`Migration: created table '${tableName}'`);
      return true; // Table was created
    } else {
      logger.debug(`Migration: table '${tableName}' already exists`);
      return false; // Table already existed
    }
  } catch (error) {
    logger.error(`Migration: failed to create table '${tableName}': ${error.message}`);
    throw error;
  }
}

/**
 * Insert default tenant if it doesn't exist
 */
async function ensureDefaultTenant() {
  try {
    await executeQuery(`
      INSERT INTO tenants (id, public_id, name, slug, domain, is_active)
      VALUES (1, 'tenant_default', 'Default Tenant', 'default-tenant', 'localhost', 1)
      ON DUPLICATE KEY UPDATE name = VALUES(name), domain = VALUES(domain), is_active = VALUES(is_active)
    `, [], 'tenants');
    logger.debug('Migration: ensured default tenant exists');
  } catch (error) {
    logger.warn(`Migration: could not ensure default tenant: ${error.message}`);
  }
}

/**
 * Insert default roles if they don't exist
 */
async function ensureDefaultRoles() {
  const defaultRoles = [
    { name: 'SuperAdmin', description: 'System administrator with full access' },
    { name: 'Admin', description: 'Administrator with elevated privileges' },
    { name: 'Manager', description: 'Manager with team oversight capabilities' },
    { name: 'Employee', description: 'Standard employee user' },
    { name: 'Client-Viewer', description: 'Client with view-only access' },
    { name: 'IT Support', description: 'IT Support specialist' },
    { name: 'IT Admin', description: 'IT administration role' }
  ];

  for (const role of defaultRoles) {
    try {
      await executeQuery(`
        INSERT INTO roles (tenant_id, name, description, is_system_role, is_active)
        VALUES (1, ?, ?, 1, 1)
        ON DUPLICATE KEY UPDATE description = VALUES(description), is_active = VALUES(is_active)
      `, [role.name, role.description], 'roles');
    } catch (error) {
      logger.warn(`Migration: could not ensure default role '${role.name}': ${error.message}`);
    }
  }
  logger.debug('Migration: ensured default roles exist');
}

/**
 * Clean up duplicate tenants if any exist due to lack of primary key constraint in old dump schema
 */
async function cleanDuplicateTenants() {
  try {
    const tableExistsRows = await executeQuery(
      `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tenants'`
    );
    if (!Array.isArray(tableExistsRows) || tableExistsRows.length === 0) {
      return;
    }

    const dupRows = await executeQuery(
      `SELECT COUNT(1) AS total_count, COUNT(DISTINCT id) AS distinct_count FROM tenants`
    );
    const total = dupRows && dupRows[0] && Number(dupRows[0].total_count || dupRows[0].total) || 0;
    const distinct = dupRows && dupRows[0] && Number(dupRows[0].distinct_count || dupRows[0].distinct) || 0;
    
    if (total > distinct) {
      logger.info(`Migration: cleaning up duplicate rows in tenants table (total=${total}, distinct=${distinct})...`);
      
      // Create a temporary table with the clean unique rows structure
      await executeQuery(`CREATE TABLE IF NOT EXISTS tenants_clean (
        id INT NOT NULL,
        public_id VARCHAR(64) NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NULL,
        domain VARCHAR(255) NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      
      // Copy distinct values
      await executeQuery(`
        INSERT INTO tenants_clean (id, public_id, name, slug, domain, is_active, created_at, updated_at)
        SELECT id, public_id, name, slug, domain, is_active, MIN(created_at), MIN(updated_at)
        FROM tenants
        GROUP BY id, public_id, name, slug, domain, is_active
      `);
      
      // Drop old table
      await executeQuery(`DROP TABLE tenants`);
      
      // Re-create table with correct primary key and constraints
      await executeQuery(`CREATE TABLE tenants (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      
      // Insert distinct values back to tenants
      await executeQuery(`
        INSERT IGNORE INTO tenants (id, public_id, name, slug, domain, is_active, created_at, updated_at)
        SELECT id, public_id, name, slug, domain, is_active, created_at, updated_at
        FROM tenants_clean
      `);
      
      // Drop temp table
      await executeQuery(`DROP TABLE tenants_clean`);
      logger.info('Migration: tenants table cleaned up and constraints added successfully');
    }
  } catch (err) {
    logger.warn(`Migration: failed to clean up duplicate tenants: ${err.message}`);
  }
}

/**
 * Main migration function
 */
async function migrateDatabase() {
  logger.info('Migration: starting database migration...');

  const createdTables = [];
  const errors = [];

  // Import schema from SQL dump file if available
  if (fs.existsSync(SQL_DUMP_FILE_PATH)) {
    logger.info(`Migration: importing schema from SQL dump file at ${SQL_DUMP_FILE_PATH}`);
    const dumpResult = await importSchemaFromSqlDump();
    createdTables.push(...dumpResult.createdTables);
    errors.push(...dumpResult.errors);
  }

  // Clean duplicate tenants after import to prepare for AUTO_INCREMENT
  await cleanDuplicateTenants();

  for (const tableName of MIGRATION_ORDER) {
    logger.debug(`Migration: processing table '${tableName}'...`);
    try {
      const wasCreated = await createTable(tableName);
      if (wasCreated) {
        createdTables.push(tableName);
      }
    } catch (error) {
      logger.error(`Migration: failed to process table '${tableName}': ${error.message}`);
      errors.push({ table: tableName, error: error.message });
    }
  }

  // Ensure default data
  try {
    await ensureDefaultTenant();
    await ensureDefaultRoles();
  } catch (error) {
    logger.warn(`Migration: could not ensure default data: ${error.message}`);
  }

  // Ensure critical tables have AUTO_INCREMENT on `id` column
  try {
    await ensureAutoIncrement('audit_logs', 'id', 'BIGINT');
    await ensureAutoIncrement('notifications', 'id', 'BIGINT UNSIGNED');
    // Ensure common app tables created from SQL dump have AUTO_INCREMENT
    const autoIncrementTables = [
      'tasks',
      'subtasks',
      'task_assignment_status',
      'task_time_entries',
      'task_logs',
      'task_resign_requests',
      'user_checklist_progress',
      'attachments',
      'document_access',
      'tenants',
      'tickets'
    ];

    for (const tbl of autoIncrementTables) {
      try {
        await ensureAutoIncrement(tbl, 'id', 'INT');
      } catch (e) {
        logger.warn(`Migration: ensureAutoIncrement failed for ${tbl}: ${e.message}`);
      }
    }
  } catch (error) {
    logger.warn(`Migration: could not ensure AUTO_INCREMENT on id columns: ${error.message}`);
  }

  // Log results
  if (createdTables.length > 0) {
    logger.info(`Migration: successfully created ${createdTables.length} tables: ${createdTables.join(', ')}`);
  } else {
    logger.info('Migration: no new tables created (all tables already exist)');
  }

  if (errors.length > 0) {
    logger.error(`Migration: ${errors.length} tables failed to create:`);
    errors.forEach(({ table, error }) => {
      logger.error(`  - ${table}: ${error}`);
    });
  }

  logger.info('Migration: database migration completed');

  return {
    success: errors.length === 0,
    createdTables,
    errors
  };
}

module.exports = {
  migrateDatabase,
  MIGRATION_ORDER,
  MIGRATION_SCHEMAS
};