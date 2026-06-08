require('dotenv').config();

const { ensureTicketingSchema } = require('../src/modules/tickets/bootstrap');
const db = require('../src/config/db');

async function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (error, rows) => (error ? reject(error) : resolve(rows)));
  });
}

async function main() {
  const result = await ensureTicketingSchema();
  if (!result || !result.success) {
    throw result?.error || new Error('Ticket schema bootstrap failed');
  }

  const tables = [
    'users',
    'tickets',
    'categories',
    'subcategories',
    'engineer_mapping',
    'ticket_sla_policies',
    'ticket_comments',
    'ticket_attachments',
    'ticket_history',
    'ticket_escalations',
    'role_permissions',
  ];

  const rows = await q(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tables.map(() => '?').join(',')})`,
    tables
  );

  console.log('Ticketing schema ready. Existing tables:');
  console.log(rows.map((row) => row.TABLE_NAME).join(', '));
}

main()
  .then(() => db.end(() => process.exit(0)))
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    db.end(() => process.exit(1));
  });
