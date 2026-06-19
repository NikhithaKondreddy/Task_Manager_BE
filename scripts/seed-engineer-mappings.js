#!/usr/bin/env node
require('dotenv').config();
const logger = require('../src/logger');
const db = require('../src/db');
const { query } = require('../src/modules/tickets/repositories/mysql');

(async function main() {
  try {
    logger.info('Seeding engineer mappings for E2E tests');

    // pick a tenant id from existing users
    const trows = await query('SELECT tenant_id FROM users WHERE tenant_id IS NOT NULL LIMIT 1');
    const tenantId = trows && trows.length ? trows[0].tenant_id : 1;

    // find existing engineers (L1/L2/Engineer roles)
    const engineers = await query(
      `SELECT _id, email, role, tenant_id FROM users WHERE tenant_id = ? AND (role LIKE "%Engineer%" OR role LIKE "%L1%" OR role LIKE "%L2%")`,
      [tenantId]
    );

    if (!engineers || !engineers.length) {
      logger.warn('No engineers found to seed mappings for tenant ' + tenantId);
      console.log('No engineers found to seed mappings');
      process.exit(0);
    }

    for (const eng of engineers) {
      // check existing mapping
      const existing = await query('SELECT id FROM engineer_mapping WHERE tenant_id = ? AND engineer_id = ? LIMIT 1', [tenantId, eng._id]);
      if (existing && existing.length) {
        // ensure active
        await query('UPDATE engineer_mapping SET is_active = 1 WHERE id = ? LIMIT 1', [existing[0].id]);
        logger.info(`Mapping already exists for ${eng.email}, ensured active`);
        console.log(`Mapping exists: ${eng.email}`);
        continue;
      }

      // Insert a permissive mapping (no location filters, no categories) so auto-assign can match
      const res = await query(
        `INSERT INTO engineer_mapping (tenant_id, engineer_id, state_id, region_id, cluster_id, branch_id, skills_json, supported_categories_json, is_active, created_by)
         VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 1, NULL)`,
        [tenantId, eng._id]
      );
      logger.info(`Inserted engineer_mapping id=${res.insertId} for ${eng.email}`);
      console.log(`Inserted mapping for ${eng.email} (id=${res.insertId})`);
    }

    process.exit(0);
  } catch (err) {
    logger.error('Seeding mappings failed: ' + (err && err.message));
    console.error(err && err.stack ? err.stack : err);
    try { db.end(() => {}); } catch (e) {}
    process.exit(1);
  } finally {
    try { db.end(() => {}); } catch (e) {}
  }
})();
