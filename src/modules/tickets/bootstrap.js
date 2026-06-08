const db = require('../../config/db');
const logger = require('../../logger');
const { DEFAULT_SLA_POLICIES } = require('./constants');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

async function tableExists(tableName) {
  const rows = await q(
    `
      SELECT TABLE_NAME
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function columnExists(tableName, columnName) {
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
  return Array.isArray(rows) && rows.length > 0;
}

async function indexExists(tableName, indexName) {
  if (!await tableExists(tableName)) return false;
  const rows = await q(`SHOW INDEX FROM ${tableName} WHERE Key_name = ?`, [indexName]);
  return Array.isArray(rows) && rows.length > 0;
}

async function primaryKeyExists(tableName) {
  if (!await tableExists(tableName)) return false;
  const rows = await q(`SHOW INDEX FROM ${tableName} WHERE Key_name = 'PRIMARY'`);
  return Array.isArray(rows) && rows.length > 0;
}

async function getColumnInfo(tableName, columnName) {
  const rows = await q(
    `
      SELECT COLUMN_NAME, COLUMN_TYPE, EXTRA, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = ?
      LIMIT 1
    `,
    [tableName, columnName]
  );
  return rows[0] || null;
}

async function assertDistinctNonNullKey(tableName, columnName) {
  const rows = await q(
    `
      SELECT
        COUNT(*) AS total_count,
        COUNT(DISTINCT ${columnName}) AS distinct_count,
        SUM(CASE WHEN ${columnName} IS NULL THEN 1 ELSE 0 END) AS null_count
      FROM ${tableName}
    `
  );
  const row = rows[0] || {};
  const total = Number(row.total_count || 0);
  const distinct = Number(row.distinct_count || 0);
  const nullCount = Number(row.null_count || 0);
  if (nullCount > 0 || total !== distinct) {
    throw new Error(`${tableName}.${columnName} cannot be promoted to key because it contains duplicate or null values`);
  }
}

async function ensurePrimaryKeyAndAutoIncrement(tableName, columnName, columnSql, fallbackIndexName) {
  if (!await tableExists(tableName)) return;

  await assertDistinctNonNullKey(tableName, columnName);

  const hasPrimaryKey = await primaryKeyExists(tableName);
  if (!hasPrimaryKey) {
    await q(`ALTER TABLE ${tableName} ADD PRIMARY KEY (${columnName})`);
  } else if (fallbackIndexName && !await indexExists(tableName, fallbackIndexName)) {
    await q(`ALTER TABLE ${tableName} ADD INDEX ${fallbackIndexName} (${columnName})`);
  }

  const column = await getColumnInfo(tableName, columnName);
  const hasAutoIncrement = column && /auto_increment/i.test(String(column.EXTRA || ''));
  if (!hasAutoIncrement) {
    await q(`ALTER TABLE ${tableName} MODIFY COLUMN ${columnSql}`);
  }
}

async function ensureColumn(tableName, columnSql) {
  const columnName = columnSql.trim().split(/\s+/)[0].replace(/`/g, '');
  if (!await tableExists(tableName)) return;
  if (await columnExists(tableName, columnName)) return;
  await q(`ALTER TABLE ${tableName} ADD COLUMN ${columnSql}`);
}

async function ensureIndex(tableName, indexName, indexSql) {
  if (!await tableExists(tableName)) return;
  if (await indexExists(tableName, indexName)) return;
  await q(`ALTER TABLE ${tableName} ADD ${indexSql}`);
}

async function ensureBaseTables() {
  await q(`
    CREATE TABLE IF NOT EXISTS categories (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      category_name VARCHAR(150) NOT NULL,
      category_code VARCHAR(50) NOT NULL,
      description TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_categories_tenant_code (tenant_id, category_code),
      UNIQUE KEY uniq_categories_tenant_name (tenant_id, category_name),
      INDEX idx_categories_tenant_status (tenant_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS subcategories (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      category_id INT NOT NULL,
      subcategory_name VARCHAR(150) NOT NULL,
      description TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_subcategories_name (tenant_id, category_id, subcategory_name),
      INDEX idx_subcategories_tenant_category (tenant_id, category_id),
      CONSTRAINT fk_subcategories_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS engineer_mapping (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      engineer_id INT NOT NULL,
      state_id INT NULL,
      region_id INT NULL,
      cluster_id INT NULL,
      branch_id INT NULL,
      skills_json JSON NULL,
      supported_categories_json JSON NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_engineer_mapping_tenant_engineer (tenant_id, engineer_id),
      INDEX idx_engineer_mapping_tenant_location (tenant_id, state_id, region_id, cluster_id, branch_id),
      CONSTRAINT fk_engineer_mapping_user FOREIGN KEY (engineer_id) REFERENCES users(_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS it_teams (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      team_name VARCHAR(150) NOT NULL,
      description TEXT NULL,
      team_lead_id INT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_it_teams_tenant_name (tenant_id, team_name),
      INDEX idx_it_teams_tenant_status (tenant_id, status),
      INDEX idx_it_teams_lead (team_lead_id),
      CONSTRAINT fk_it_teams_lead FOREIGN KEY (team_lead_id) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS team_members (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      team_id INT NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_team_membership (team_id, user_id),
      INDEX idx_team_members_team (team_id),
      INDEX idx_team_members_user (user_id),
      CONSTRAINT fk_team_members_team FOREIGN KEY (team_id) REFERENCES it_teams(id) ON DELETE CASCADE,
      CONSTRAINT fk_team_members_user FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS team_categories (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      team_id INT NOT NULL,
      category_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_team_category (team_id, category_id),
      INDEX idx_team_categories_team (team_id),
      INDEX idx_team_categories_category (category_id),
      CONSTRAINT fk_team_categories_team FOREIGN KEY (team_id) REFERENCES it_teams(id) ON DELETE CASCADE,
      CONSTRAINT fk_team_categories_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_assignments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      assigned_to_user_id INT NULL,
      assigned_to_team_id INT NULL,
      assigned_by INT NULL,
      assignment_type VARCHAR(20) NOT NULL,
      remarks VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_assignments_ticket (ticket_id),
      INDEX idx_ticket_assignments_user (assigned_to_user_id),
      INDEX idx_ticket_assignments_team (assigned_to_team_id),
      CONSTRAINT fk_ticket_assignments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_assignments_user FOREIGN KEY (assigned_to_user_id) REFERENCES users(_id) ON DELETE SET NULL,
      CONSTRAINT fk_ticket_assignments_team FOREIGN KEY (assigned_to_team_id) REFERENCES it_teams(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_sla_policies (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      priority VARCHAR(20) NOT NULL,
      response_time_minutes INT NOT NULL,
      resolution_time_minutes INT NOT NULL,
      escalation_time_minutes INT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ticket_sla_policies_tenant_priority (tenant_id, priority)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_comments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      legacy_comment_id BIGINT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      author_user_id INT NULL,
      author_email VARCHAR(320) NULL,
      comment_type VARCHAR(20) NOT NULL DEFAULT 'PUBLIC',
      body TEXT NOT NULL,
      mentions_json JSON NULL,
      source VARCHAR(30) NOT NULL DEFAULT 'api',
      source_message_id VARCHAR(512) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ticket_comments_legacy (legacy_comment_id),
      UNIQUE KEY uniq_ticket_comments_message (source_message_id),
      INDEX idx_ticket_comments_ticket (ticket_id),
      CONSTRAINT fk_ticket_comments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_comments_user FOREIGN KEY (author_user_id) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      legacy_attachment_id BIGINT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      comment_id BIGINT UNSIGNED NULL,
      file_name VARCHAR(255) NOT NULL,
      content_type VARCHAR(255) NULL,
      size_bytes BIGINT NULL,
      storage_path TEXT NOT NULL,
      checksum_sha256 VARCHAR(64) NULL,
      content_id VARCHAR(255) NULL,
      is_inline TINYINT(1) NOT NULL DEFAULT 0,
      source_message_id VARCHAR(512) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ticket_attachments_legacy (legacy_attachment_id),
      INDEX idx_ticket_attachments_ticket (ticket_id),
      INDEX idx_ticket_attachments_comment (comment_id),
      CONSTRAINT fk_ticket_attachments_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_attachments_comment FOREIGN KEY (comment_id) REFERENCES ticket_comments(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      actor_user_id INT NULL,
      action VARCHAR(100) NOT NULL,
      field_name VARCHAR(100) NULL,
      from_value TEXT NULL,
      to_value TEXT NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_history_ticket (ticket_id),
      CONSTRAINT fk_ticket_history_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_history_user FOREIGN KEY (actor_user_id) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_escalations (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      escalation_level INT NOT NULL,
      from_user_id INT NULL,
      to_user_id INT NULL,
      reason VARCHAR(255) NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME NULL,
      INDEX idx_ticket_escalations_ticket (ticket_id),
      INDEX idx_ticket_escalations_level (escalation_level, status),
      CONSTRAINT fk_ticket_escalations_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_approvals (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      approval_type VARCHAR(40) NOT NULL,
      status VARCHAR(30) NOT NULL,
      approved_by INT NULL,
      remarks VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_approvals_ticket (ticket_id),
      INDEX idx_ticket_approvals_status (status),
      CONSTRAINT fk_ticket_approvals_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_approvals_user FOREIGN KEY (approved_by) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_activity_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      ticket_id BIGINT UNSIGNED NOT NULL,
      action VARCHAR(100) NOT NULL,
      old_value TEXT NULL,
      new_value TEXT NULL,
      performed_by INT NULL,
      remarks VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ticket_activity_logs_ticket (ticket_id),
      CONSTRAINT fk_ticket_activity_logs_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_activity_logs_user FOREIGN KEY (performed_by) REFERENCES users(_id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS states (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_states_tenant_name (tenant_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS regions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      state_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_regions_tenant_name (tenant_id, state_id, name),
      INDEX idx_regions_state (state_id),
      CONSTRAINT fk_regions_state FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS clusters (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      region_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_clusters_tenant_name (tenant_id, region_id, name),
      INDEX idx_clusters_region (region_id),
      CONSTRAINT fk_clusters_region FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS branches (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      cluster_id INT NOT NULL,
      name VARCHAR(120) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_branches_tenant_name (tenant_id, cluster_id, name),
      INDEX idx_branches_cluster (cluster_id),
      CONSTRAINT fk_branches_cluster FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS role_permissions (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NULL,
      role_key VARCHAR(50) NOT NULL,
      module_key VARCHAR(100) NOT NULL,
      permission_key VARCHAR(100) NOT NULL,
      allowed TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_role_permissions_scope (tenant_id, role_key, module_key, permission_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS ticket_watchers (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      ticket_id BIGINT UNSIGNED NOT NULL,
      user_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_ticket_watchers (ticket_id, user_id),
      INDEX idx_ticket_watchers_ticket (ticket_id),
      INDEX idx_ticket_watchers_user (user_id),
      CONSTRAINT fk_ticket_watchers_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
      CONSTRAINT fk_ticket_watchers_user FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      user_id INT NOT NULL,
      channels_json JSON NULL,
      events_json JSON NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_notification_prefs (tenant_id, user_id),
      INDEX idx_notification_prefs_user (user_id),
      CONSTRAINT fk_notification_prefs_user FOREIGN KEY (user_id) REFERENCES users(_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      subject VARCHAR(255) NOT NULL,
      body TEXT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_email_templates (tenant_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      tenant_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(120) NULL,
      tags_json JSON NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
      created_by INT NULL,
      updated_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

async function ensureLegacyCompatibility() {
  if (await tableExists('users')) {
    await ensurePrimaryKeyAndAutoIncrement('users', '_id', '_id INT NOT NULL AUTO_INCREMENT', 'idx_users_internal_id');
  }

  if (await tableExists('tickets')) {
    await ensurePrimaryKeyAndAutoIncrement('tickets', 'id', 'id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT', 'idx_tickets_id');
    if (!await indexExists('tickets', 'uniq_tickets_ticket_id')) {
      await q(`ALTER TABLE tickets ADD UNIQUE KEY uniq_tickets_ticket_id (ticket_id)`);
    }
  }

  if (await tableExists('permissions')) {
    await ensurePrimaryKeyAndAutoIncrement('permissions', 'id', 'id INT NOT NULL AUTO_INCREMENT', 'idx_permissions_id');
  }
}

async function ensureTicketColumns() {
  if (!await tableExists('tickets')) return;

  await q(`
    ALTER TABLE tickets
    MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'OPEN',
    MODIFY COLUMN priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM'
  `).catch((error) => {
    logger.warn(`tickets bootstrap: status/priority modify skipped: ${error.message}`);
  });

  await ensureColumn('tickets', 'tenant_id INT NULL');
  await ensureColumn('tickets', 'requested_for_user_id INT NULL');
  await ensureColumn('tickets', 'created_by_user_id INT NULL');
  await ensureColumn('tickets', 'department VARCHAR(255) NULL');
  await ensureColumn('tickets', 'state_id INT NULL');
  await ensureColumn('tickets', 'region_id INT NULL');
  await ensureColumn('tickets', 'cluster_id INT NULL');
  await ensureColumn('tickets', 'branch_id INT NULL');
  await ensureColumn('tickets', 'assigned_team_id INT NULL');
  await ensureColumn('tickets', 'category_id INT NULL');
  await ensureColumn('tickets', 'subcategory_id INT NULL');
  await ensureColumn('tickets', 'cc_recipients_json JSON NULL');
  await ensureColumn('tickets', 'response_due_at DATETIME NULL');
  await ensureColumn('tickets', 'resolution_due_at DATETIME NULL');
  await ensureColumn('tickets', 'escalation_due_at DATETIME NULL');
  await ensureColumn('tickets', 'next_escalation_at DATETIME NULL');
  await ensureColumn('tickets', 'assigned_at DATETIME NULL');
  await ensureColumn('tickets', 'responded_at DATETIME NULL');
  await ensureColumn('tickets', 'resolved_at DATETIME NULL');
  await ensureColumn('tickets', 'closed_at DATETIME NULL');
  await ensureColumn('tickets', 'resolution_notes TEXT NULL');
  await ensureColumn('tickets', 'current_escalation_level INT NOT NULL DEFAULT 0');
  await ensureColumn('tickets', 'escalated_to_user_id INT NULL');
  await ensureColumn('tickets', 'last_activity_at DATETIME NULL');
  await ensureColumn('tickets', 'last_status_change_at DATETIME NULL');
  await ensureColumn('tickets', 'reopened_count INT NOT NULL DEFAULT 0');
  await ensureColumn('tickets', 'is_draft TINYINT(1) NOT NULL DEFAULT 0');
  await ensureColumn('tickets', 'assignment_mode VARCHAR(30) NULL');
  await ensureColumn('tickets', 'assignment_reason TEXT NULL');
  await ensureColumn('tickets', 'workload_snapshot INT NULL');

  await ensureIndex('tickets', 'idx_tickets_tenant_status', 'INDEX idx_tickets_tenant_status (tenant_id, status)');
  await ensureIndex('tickets', 'idx_tickets_tenant_priority', 'INDEX idx_tickets_tenant_priority (tenant_id, priority)');
  await ensureIndex('tickets', 'idx_tickets_tenant_category', 'INDEX idx_tickets_tenant_category (tenant_id, category_id, subcategory_id)');
  await ensureIndex('tickets', 'idx_tickets_tenant_assignee', 'INDEX idx_tickets_tenant_assignee (tenant_id, assigned_to)');
  await ensureIndex('tickets', 'idx_tickets_tenant_location', 'INDEX idx_tickets_tenant_location (tenant_id, state_id, region_id, cluster_id, branch_id)');
  await ensureIndex('tickets', 'idx_tickets_tenant_draft', 'INDEX idx_tickets_tenant_draft (tenant_id, is_draft, created_by_user_id)');
  await ensureIndex('tickets', 'idx_tickets_next_escalation', 'INDEX idx_tickets_next_escalation (next_escalation_at, status)');

  await q('UPDATE tickets SET tenant_id = COALESCE(tenant_id, 1) WHERE tenant_id IS NULL').catch(() => null);
  await q(`UPDATE tickets SET is_draft = CASE WHEN UPPER(status) = 'DRAFT' THEN 1 ELSE COALESCE(is_draft, 0) END`).catch(() => null);
  await q(`UPDATE tickets SET status = UPPER(REPLACE(status, ' ', '_'))`).catch(() => null);
  await q(`UPDATE tickets SET priority = UPPER(priority)`).catch(() => null);
  await q(`UPDATE tickets SET last_activity_at = COALESCE(last_activity_at, updated_at, created_at)`).catch(() => null);
  await q(`UPDATE tickets SET last_status_change_at = COALESCE(last_status_change_at, updated_at, created_at)`).catch(() => null);

  await q(`
    UPDATE tickets t
    LEFT JOIN users u ON u._id = t.requester_user_id
    SET t.created_by_user_id = COALESCE(t.created_by_user_id, t.requester_user_id),
        t.requested_for_user_id = COALESCE(t.requested_for_user_id, t.requester_user_id),
        t.requester_email = COALESCE(NULLIF(t.requester_email, ''), u.email)
    WHERE t.created_by_user_id IS NULL
       OR t.requested_for_user_id IS NULL
  `).catch(() => null);
}

async function ensureAttachmentColumns() {
  if (!await tableExists('attachments')) return;
  await ensureColumn('attachments', 'original_name VARCHAR(255) NULL');
  await ensureColumn('attachments', 'mime_type VARCHAR(255) NULL');
  await ensureColumn('attachments', 'file_size BIGINT NULL');
  await ensureColumn('attachments', 'uploaded_by INT NULL');
  await ensureColumn('attachments', 'uploaded_at DATETIME NULL');
}

async function migrateLegacyTicketData() {
  if (await tableExists('comments')) {
    await q(`
      INSERT IGNORE INTO ticket_comments
      (legacy_comment_id, ticket_id, author_user_id, author_email, comment_type, body, source, source_message_id, created_at)
      SELECT id, ticket_id, user_id, author_email, 'PUBLIC', body, COALESCE(source, 'api'), source_message_id, COALESCE(created_at, NOW())
      FROM comments
    `).catch((error) => logger.warn(`tickets bootstrap: comment migration skipped: ${error.message}`));
  }

  if (await tableExists('attachments')) {
    await q(`
      INSERT IGNORE INTO ticket_attachments
      (legacy_attachment_id, ticket_id, comment_id, file_name, content_type, size_bytes, storage_path, checksum_sha256, content_id, is_inline, source_message_id, created_at)
      SELECT
        a.id,
        a.ticket_id,
        tc.id,
        a.file_name,
        a.content_type,
        a.size_bytes,
        a.storage_path,
        a.checksum_sha256,
        a.content_id,
        COALESCE(a.is_inline, 0),
        a.source_message_id,
        COALESCE(a.created_at, NOW())
      FROM attachments a
      LEFT JOIN ticket_comments tc ON tc.legacy_comment_id = a.comment_id
    `).catch((error) => logger.warn(`tickets bootstrap: attachment migration skipped: ${error.message}`));
  }
}

async function seedDefaults() {
  for (const policy of DEFAULT_SLA_POLICIES) {
    await q(
      `
        INSERT INTO ticket_sla_policies
          (tenant_id, priority, response_time_minutes, resolution_time_minutes, escalation_time_minutes, is_active)
        VALUES (1, ?, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE
          response_time_minutes = VALUES(response_time_minutes),
          resolution_time_minutes = VALUES(resolution_time_minutes),
          escalation_time_minutes = VALUES(escalation_time_minutes),
          is_active = VALUES(is_active)
      `,
      [
        policy.priority,
        policy.response_time_minutes,
        policy.resolution_time_minutes,
        policy.escalation_time_minutes,
      ]
    ).catch(() => null);
  }

  if (await tableExists('roles')) {
    const roles = [
      ['End User', 'Ticket requester / employee'],
      ['L1 Engineer', 'First level IT engineer'],
      ['Cluster Lead', 'Second level escalation owner'],
      ['Regional IT Manager', 'Regional IT escalation owner'],
      ['Central IT Admin', 'Central IT administration role'],
    ];

    for (const [name, description] of roles) {
      await q(
        `
          INSERT INTO roles (tenant_id, name, description, is_system_role, is_active)
          VALUES (1, ?, ?, 1, 1)
          ON DUPLICATE KEY UPDATE description = VALUES(description), is_active = VALUES(is_active)
        `,
        [name, description]
      ).catch(() => null);
    }
  }

  if (await tableExists('permissions')) {
    const permissions = [
      ['ticket_read', 'Read tickets', 'tickets', 'read'],
      ['ticket_create', 'Create tickets', 'tickets', 'create'],
      ['ticket_update', 'Update tickets', 'tickets', 'update'],
      ['ticket_assign', 'Assign tickets', 'tickets', 'assign'],
      ['ticket_comment', 'Comment on tickets', 'tickets', 'comment'],
      ['ticket_close', 'Close tickets', 'tickets', 'close'],
      ['ticket_reopen', 'Reopen tickets', 'tickets', 'reopen'],
      ['ticket_dashboard', 'View ticket dashboard', 'tickets', 'dashboard'],
      ['ticket_category_manage', 'Manage categories', 'categories', 'manage'],
      ['ticket_mapping_manage', 'Manage engineer mappings', 'engineer_mapping', 'manage'],
      ['ticket_sla_manage', 'Manage SLA policies', 'ticket_sla', 'manage'],
      ['ticket_reports_read', 'Read ticket reports', 'ticket_reports', 'read'],
    ];

    for (const [name, description, module, action] of permissions) {
      await q(
        `
          INSERT INTO permissions (tenant_id, name, description, module, action, is_system_permission, is_active)
          VALUES (1, ?, ?, ?, ?, 1, 1)
          ON DUPLICATE KEY UPDATE description = VALUES(description), action = VALUES(action), is_active = VALUES(is_active)
        `,
        [name, description, module, action]
      ).catch(() => null);
    }
  }

  const rolePermissions = [
    ['ADMIN', 'categories', 'manage'],
    ['ADMIN', 'engineer_mapping', 'manage'],
    ['ADMIN', 'ticket_sla', 'manage'],
    ['ADMIN', 'ticket_reports', 'read'],
    ['ADMIN', 'tickets', 'read'],
    ['ADMIN', 'tickets', 'create'],
    ['ADMIN', 'tickets', 'update'],
    ['ADMIN', 'tickets', 'assign'],
    ['ADMIN', 'tickets', 'comment'],
    ['ADMIN', 'tickets', 'close'],
    ['ADMIN', 'tickets', 'reopen'],
    ['ADMIN', 'tickets', 'dashboard'],
    ['IT_SUPPORT', 'tickets', 'read'],
    ['IT_SUPPORT', 'tickets', 'create'],
    ['IT_SUPPORT', 'tickets', 'update'],
    ['IT_SUPPORT', 'tickets', 'assign'],
    ['IT_SUPPORT', 'tickets', 'comment'],
    ['IT_SUPPORT', 'tickets', 'close'],
    ['IT_SUPPORT', 'tickets', 'reopen'],
    ['IT_SUPPORT', 'tickets', 'dashboard'],
    ['MANAGER', 'tickets', 'read'],
    ['MANAGER', 'tickets', 'update'],
    ['MANAGER', 'tickets', 'assign'],
    ['MANAGER', 'tickets', 'comment'],
    ['MANAGER', 'ticket_reports', 'read'],
    ['EMPLOYEE', 'tickets', 'read'],
    ['EMPLOYEE', 'tickets', 'create'],
    ['EMPLOYEE', 'tickets', 'comment'],
    ['END_USER', 'tickets', 'read'],
    ['END_USER', 'tickets', 'create'],
    ['END_USER', 'tickets', 'comment'],
    ['L1_ENGINEER', 'tickets', 'read'],
    ['L1_ENGINEER', 'tickets', 'create'],
    ['L1_ENGINEER', 'tickets', 'update'],
    ['L1_ENGINEER', 'tickets', 'assign'],
    ['L1_ENGINEER', 'tickets', 'comment'],
    ['L1_ENGINEER', 'tickets', 'dashboard'],
    ['L2_ENGINEER', 'tickets', 'read'],
    ['L2_ENGINEER', 'tickets', 'update'],
    ['L2_ENGINEER', 'tickets', 'assign'],
    ['L2_ENGINEER', 'tickets', 'comment'],
    ['L2_ENGINEER', 'ticket_reports', 'read'],
    ['REGIONAL_IT_MANAGER', 'tickets', 'read'],
    ['REGIONAL_IT_MANAGER', 'tickets', 'update'],
    ['REGIONAL_IT_MANAGER', 'tickets', 'assign'],
    ['REGIONAL_IT_MANAGER', 'tickets', 'comment'],
    ['REGIONAL_IT_MANAGER', 'ticket_reports', 'read'],
    ['CENTRAL_IT_ADMIN', 'categories', 'manage'],
    ['CENTRAL_IT_ADMIN', 'engineer_mapping', 'manage'],
    ['CENTRAL_IT_ADMIN', 'ticket_sla', 'manage'],
    ['CENTRAL_IT_ADMIN', 'ticket_reports', 'read'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'read'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'create'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'update'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'assign'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'comment'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'close'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'reopen'],
    ['CENTRAL_IT_ADMIN', 'tickets', 'dashboard'],
  ];

  for (const [roleKey, moduleKey, permissionKey] of rolePermissions) {
    await q(
      `
        INSERT INTO role_permissions (tenant_id, role_key, module_key, permission_key, allowed)
        VALUES (1, ?, ?, ?, 1)
        ON DUPLICATE KEY UPDATE allowed = VALUES(allowed)
      `,
      [roleKey, moduleKey, permissionKey]
    ).catch(() => null);
  }
}

let ensurePromise = null;

async function ensureTicketingSchema() {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    try {
      await ensureLegacyCompatibility();
      await ensureBaseTables();
      await ensureTicketColumns();
      await ensureAttachmentColumns();
      await migrateLegacyTicketData();
      await seedDefaults();
      logger.info('tickets bootstrap: schema ready');
      return { success: true };
    } catch (error) {
      logger.error('tickets bootstrap: failed to ensure schema: ' + (error && error.message ? error.message : String(error)));
      return { success: false, error };
    }
  })();

  return ensurePromise;
}

module.exports = {
  ensureTicketingSchema,
};
