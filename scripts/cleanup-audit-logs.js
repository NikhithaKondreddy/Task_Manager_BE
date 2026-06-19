#!/usr/bin/env node
/**
 * scripts/cleanup-audit-logs.js
 * Backup and delete rows from `audit_logs` in batches, handling append-only triggers.
 * Usage examples:
 *  node scripts/cleanup-audit-logs.js --before 2026-01-01 --batch 10000 --backup-table audit_logs_backup
 *  node scripts/cleanup-audit-logs.js --before 2026-01-01 --dry-run
 */

require('dotenv').config();
const mysql = require('mysql');
const util = require('util');
const minimist = require('minimist');

const argv = minimist(process.argv.slice(2), {
  alias: { b: 'before', n: 'batch' },
  boolean: ['dry-run'],
  default: { batch: 10000, 'backup-table': 'audit_logs_backup', 'dry-run': false }
});

const before = argv.before;
const filter = argv.filter;
const batchSize = Math.max(1, parseInt(argv.batch, 10) || 10000);
const backupTable = argv['backup-table'];
const dryRun = argv['dry-run'];

if (!before && !filter) {
  console.error('Provide --before YYYY-MM-DD (or ISO) or --filter "<SQL condition>"');
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST || '127.0.0.1',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'taskmgr'
};

const conn = mysql.createConnection(dbConfig);
const query = util.promisify(conn.query).bind(conn);
const connect = util.promisify(conn.connect).bind(conn);
const end = util.promisify(conn.end).bind(conn);

(async function main() {
  try {
    await connect();
    console.log('Connected to DB', dbConfig.host, dbConfig.database);

    // count matching rows
    let countRow;
    if (before) {
      countRow = (await query('SELECT COUNT(*) AS cnt FROM audit_logs WHERE createdAt < ?', [before]))[0];
    } else {
      countRow = (await query(`SELECT COUNT(*) AS cnt FROM audit_logs WHERE ${filter}`))[0];
    }
    const total = countRow ? countRow.cnt : 0;
    console.log('Matching rows:', total);

    if (dryRun) {
      console.log('Dry run: exiting without changes.');
      await end();
      return;
    }

    // 1) Ensure backup table exists
    await query(`CREATE TABLE IF NOT EXISTS \`${backupTable}\` LIKE audit_logs`);
    console.log('Backup table ensured:', backupTable);

    // 2) Insert matching rows into backup
    console.log('Backing up rows...');
    if (before) {
      await query(`INSERT INTO \`${backupTable}\` SELECT * FROM audit_logs WHERE createdAt < ?`, [before]);
    } else {
      await query(`INSERT INTO \`${backupTable}\` SELECT * FROM audit_logs WHERE ${filter}`);
    }
    console.log('Backup complete.');

    // 3) Drop blocking triggers
    console.log('Dropping append-only triggers (if present)...');
    await query('DROP TRIGGER IF EXISTS audit_logs_block_delete');
    await query('DROP TRIGGER IF EXISTS audit_logs_block_update');

    // 4) Delete in batches
    console.log('Deleting rows in batches (batch size:', batchSize + ')');
    let deleted = 0;
    while (true) {
      let res;
      if (before) {
        res = await query(`DELETE FROM audit_logs WHERE createdAt < ? LIMIT ${batchSize}`, [before]);
      } else {
        res = await query(`DELETE FROM audit_logs WHERE ${filter} LIMIT ${batchSize}`);
      }
      const n = res && res.affectedRows ? res.affectedRows : 0;
      deleted += n;
      console.log(`Deleted ${n} rows (total ${deleted})`);
      if (n < batchSize) break;
    }

    // 5) Recreate triggers
    console.log('Recreating append-only triggers...');
    await query("CREATE TRIGGER `audit_logs_block_delete` BEFORE DELETE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'");
    await query("CREATE TRIGGER `audit_logs_block_update` BEFORE UPDATE ON `audit_logs` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_logs is append-only'");

    console.log('Done. Total deleted:', deleted);
    await end();
  } catch (err) {
    console.error('Error:', err && err.message ? err.message : err);
    try { await end(); } catch (e) {}
    process.exit(1);
  }
})();
