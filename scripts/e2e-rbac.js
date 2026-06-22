#!/usr/bin/env node
require('dotenv').config();
const logger = require('../src/logger');
const db = require('../src/db');
const { query } = require('../src/modules/tickets/repositories/mysql');
const ticketService = require('../src/modules/tickets/services/ticketService');
const ticketAssignmentService = require('../src/modules/tickets/services/ticketAssignmentService');

(async function main() {
  const report = { summary: [], tests: [], errors: [] };
  try {
    logger.info('E2E RBAC Run: starting');

    // pick an employee user to create tickets
    const candidateEmails = ['employee-employee@nivarahousing.com', 'employee@nivarahousing.com', 'employee@gmail.com'];
    let actorUser = null;
    for (const e of candidateEmails) {
      const rows = await query('SELECT _id, public_id, email, tenant_id, role, name FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [e]);
      if (rows && rows.length) { actorUser = rows[0]; break; }
    }
    if (!actorUser) {
      const rows = await query('SELECT _id, public_id, email, tenant_id, role, name FROM users WHERE tenant_id IS NOT NULL LIMIT 1');
      if (rows && rows.length) actorUser = rows[0];
    }
    if (!actorUser) throw new Error('No user found to act as ticket requester');
    report.summary.push({ step: 'actor', user: actorUser.email });

    // Create a ticket for view tests
    const inputView = { subject: `E2E RBAC View Ticket ${Date.now()}`, description: 'RBAC view test ticket', priority: 'P3', requester_email: actorUser.email };
    const createdView = await ticketService.createTicket(inputView, actorUser);
    if (createdView && createdView.duplicate) {
      report.errors.push({ step: 'ticket_view_duplicate', meta: createdView.duplicateMeta });
      throw new Error('Duplicate ticket detected for actor during e2e-rbac');
    }
    const ticketView = createdView.ticket;
    report.summary.push({ step: 'ticket_view_created', ticketId: ticketView.ticketId, id: ticketView.id });

    // Create a ticket for update tests (will be assigned)
    const inputUpd = { subject: `E2E RBAC Update Ticket ${Date.now()}`, description: 'RBAC update test ticket', priority: 'P3', requester_email: actorUser.email };
    const createdUpd = await ticketService.createTicket(inputUpd, actorUser);
    if (createdUpd && createdUpd.duplicate) {
      report.errors.push({ step: 'ticket_update_duplicate', meta: createdUpd.duplicateMeta });
      throw new Error('Duplicate ticket detected for actor during e2e-rbac');
    }
    const ticketUpd = createdUpd.ticket;
    report.summary.push({ step: 'ticket_update_created', ticketId: ticketUpd.ticketId, id: ticketUpd.id });

    // locate users for roles
    const adminRows = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE tenant_id = ? AND (role LIKE "%Admin%" OR role LIKE "%CENTRAL%") LIMIT 1', [actorUser.tenant_id]);
    const admin = adminRows && adminRows.length ? adminRows[0] : null;

    const engineerRows = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE tenant_id = ? AND (role LIKE "%Engineer%" OR role LIKE "%L1%" OR role LIKE "%L2%") LIMIT 1', [actorUser.tenant_id]);
    const engineer = engineerRows && engineerRows.length ? engineerRows[0] : null;

    const l1Rows = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE tenant_id = ? AND (role LIKE "%L1%" OR role LIKE "%Helpdesk%") LIMIT 1', [actorUser.tenant_id]);
    const l1 = l1Rows && l1Rows.length ? l1Rows[0] : null;

    const l2Rows = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE tenant_id = ? AND role LIKE "%L2%" LIMIT 1', [actorUser.tenant_id]);
    const l2 = l2Rows && l2Rows.length ? l2Rows[0] : null;

    const randomRows = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE tenant_id = ? AND _id NOT IN (?, ?, ?) LIMIT 1', [actorUser.tenant_id, actorUser._id, engineer ? engineer._id : 0, admin ? admin._id : 0]);
    const randomUser = randomRows && randomRows.length ? randomRows[0] : null;

    report.summary.push({ admin: admin ? admin.email : null, engineer: engineer ? engineer.email : null, l1: l1 ? l1.email : null, l2: l2 ? l2.email : null, random: randomUser ? randomUser.email : null });

    // Assign ticketUpd to engineer (if available)
    if (engineer) {
      engineer.tenant_id = engineer.tenant_id || actorUser.tenant_id;
      await ticketAssignmentService.assignTicket(actorUser.tenant_id, ticketUpd.ticketId || ticketUpd.id, { assignedTo: engineer._id }, actorUser);
      report.summary.push({ step: 'assigned_update_ticket', assignee: engineer.email });
    } else {
      report.summary.push({ step: 'assigned_update_ticket', skipped: true });
    }

    // View access tests
    const viewers = [
      { label: 'requester', user: actorUser },
      { label: 'admin', user: admin },
      { label: 'engineer', user: engineer },
      { label: 'l1', user: l1 },
      { label: 'l2', user: l2 },
      { label: 'random', user: randomUser },
    ];

    for (const v of viewers) {
      if (!v.user) { report.tests.push({ test: 'view', subject: v.label, ok: false, reason: 'no user' }); continue; }
      try {
        await ticketService.getTicket(ticketView.ticketId || ticketView.id, v.user);
        report.tests.push({ test: 'view', subject: v.label, user: v.user.email, ok: true });
      } catch (e) {
        report.tests.push({ test: 'view', subject: v.label, user: v.user.email, ok: false, error: e && e.message });
      }
    }

    // Update tests (on ticketUpd): try IN_PROGRESS by admin, by assigned engineer, and fail for random user
    if (admin) {
      try {
        const upd = await ticketService.updateTicket(ticketUpd.ticketId || ticketUpd.id, { status: 'IN_PROGRESS' }, admin);
        report.tests.push({ test: 'update', subject: 'admin->IN_PROGRESS', user: admin.email, ok: true, status: upd.status });
      } catch (e) {
        report.tests.push({ test: 'update', subject: 'admin->IN_PROGRESS', user: admin.email, ok: false, error: e && e.message });
      }
    }

    if (engineer) {
      try {
        const upd2 = await ticketService.updateTicket(ticketUpd.ticketId || ticketUpd.id, { status: 'RESOLVED', resolutionSummary: 'RBAC test', resolutionNotes: 'resolved by engineer' }, engineer);
        report.tests.push({ test: 'update', subject: 'engineer->RESOLVED', user: engineer.email, ok: true, status: upd2.status });
      } catch (e) {
        report.tests.push({ test: 'update', subject: 'engineer->RESOLVED', user: engineer.email, ok: false, error: e && e.message });
      }
    }

    if (randomUser) {
      try {
        await ticketService.updateTicket(ticketUpd.ticketId || ticketUpd.id, { status: 'IN_PROGRESS' }, randomUser);
        report.tests.push({ test: 'update', subject: 'random->IN_PROGRESS', user: randomUser.email, ok: false, note: 'unexpected success' });
      } catch (e) {
        report.tests.push({ test: 'update', subject: 'random->IN_PROGRESS', user: randomUser.email, ok: true, expectedError: e && e.message });
      }
    }

    logger.info('E2E RBAC Run: completed');
    console.log('E2E RBAC REPORT:', JSON.stringify(report, null, 2));
    try { require('fs').writeFileSync('reports/e2e-rbac-report.json', JSON.stringify(report, null, 2)); } catch (e) {}
    process.exit(0);
  } catch (err) {
    logger.error('E2E RBAC Run failed: ' + (err && err.message));
    console.error(err && err.stack ? err.stack : err);
    try { db.end(() => {}); } catch (e) {}
    process.exit(1);
  } finally {
    try { db.end(() => {}); } catch (e) {}
  }
})();
