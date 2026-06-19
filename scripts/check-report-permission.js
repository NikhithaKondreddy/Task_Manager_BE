#!/usr/bin/env node
require('dotenv').config();
const { query } = require('../src/modules/tickets/repositories/mysql');
const { requireTicketReportAccess } = require('../src/modules/tickets/middleware/ticketPermissions');

(async function main() {
  try {
    // find an L1 user
    const rows = await query('SELECT _id, public_id, email, role, tenant_id, name FROM users WHERE LOWER(role) LIKE "%l1%" LIMIT 1');
    const user = rows && rows.length ? rows[0] : null;
    if (!user) {
      console.log('No L1 user found to check');
      process.exit(1);
    }

    const req = { user };
    let status = null;
    let body = null;
    const res = {
      status: (s) => { status = s; return res; },
      json: (b) => { body = b; return res; }
    };
    let nextCalled = false;
    await new Promise((resolve) => {
      requireTicketReportAccess(req, res, () => { nextCalled = true; resolve(); });
      // if middleware called deny, resolve immediately
      if (status) resolve();
    });

    if (nextCalled) {
      console.log('Middleware allowed access for user:', user.email, user.role);
      process.exit(0);
    }

    console.log('Middleware denied access:', status, body);
    process.exit(status === 403 ? 2 : 1);
  } catch (err) {
    console.error('Check failed:', err && err.message);
    process.exit(1);
  }
})();
