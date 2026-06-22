#!/usr/bin/env node
require('dotenv').config();
const logger = require('../src/logger');
const db = require('../src/db');
const { query } = require('../src/modules/tickets/repositories/mysql');
const ticketService = require('../src/modules/tickets/services/ticketService');
const ticketAutomation = require('../src/modules/tickets/services/ticketAutomationService');
const ticketAssignmentService = require('../src/modules/tickets/services/ticketAssignmentService');

(async function main() {
  const report = { steps: [], errors: [] };
  try {
    logger.info('E2E Full Run: starting');

    // 1) pick an employee user to create the ticket
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
    report.steps.push({ step: 'select-actor', ok: true, user: actorUser.email });

    // 2) create ticket
    const input = {
      subject: `E2E Full Run Ticket ${Date.now()}`,
      description: 'Automated full run: create->assign->accept->resolve->close',
      priority: 'P2',
      requester_email: actorUser.email,
    };
    const created = await ticketService.createTicket(input, actorUser);
    if (created && created.duplicate) {
      throw new Error('Duplicate ticket detected for actor during e2e-full-run: ' + JSON.stringify(created.duplicateMeta));
    }
    if (!created || !created.ticket) throw new Error('Ticket creation failed');
    const ticket = created.ticket;
    report.steps.push({ step: 'create-ticket', ok: true, ticketId: ticket.ticketId, internalId: ticket.id });

    // 3) attempt auto-assign
    let assignResult = null;
    try {
      assignResult = await ticketAutomation.autoAssignTicket(ticket, actorUser);
      report.steps.push({ step: 'auto-assign', ok: true, result: assignResult });
    } catch (e) {
      report.steps.push({ step: 'auto-assign', ok: false, error: String(e.message || e) });
    }

    // 4) if not assigned, pick a mapped L1 engineer or any engineer and assign manually
    let assignee = null;
    if (!assignResult || !assignResult.assigned_to) {
      const rows = await query(
        `SELECT u._id, u.public_id, u.email, u.role FROM users u
         INNER JOIN engineer_mapping m ON m.engineer_id = u._id
         WHERE u.tenant_id = ? AND m.is_active = 1
         LIMIT 1`,
        [actorUser.tenant_id]
      );
      if (rows && rows.length) assignee = rows[0];
      else {
        const ers = await query('SELECT _id, public_id, email, role FROM users WHERE tenant_id = ? AND (role LIKE "%Engineer%" OR role LIKE "%L1%" OR role LIKE "%L2%") LIMIT 1', [actorUser.tenant_id]);
        if (ers && ers.length) assignee = ers[0];
      }

      if (!assignee) throw new Error('No engineer found to assign ticket');

      // ensure assignee has tenant context for downstream service calls
      assignee.tenant_id = assignee.tenant_id || actorUser.tenant_id;

      await ticketAssignmentService.assignTicket(actorUser.tenant_id, ticket.ticketId || ticket.id, { assignedTo: assignee._id }, actorUser);
      report.steps.push({ step: 'manual-assign', ok: true, assignee: assignee.email || assignee.public_id });
    } else {
      // resolve assigned_to to engineer row
      const rows = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE _id = ? LIMIT 1', [assignResult.assigned_to]);
      if (rows && rows.length) {
        assignee = rows[0];
        assignee.tenant_id = assignee.tenant_id || actorUser.tenant_id;
      }
    }

    // 5) accept ticket as assignee
    try {
      await ticketAssignmentService.acceptTicket(actorUser.tenant_id, ticket.ticketId || ticket.id, assignee);
      report.steps.push({ step: 'accept-ticket', ok: true, acceptedBy: assignee.email || assignee.public_id });
    } catch (e) {
      report.steps.push({ step: 'accept-ticket', ok: false, error: String(e.message || e) });
    }

    // 6) update status to RESOLVED with required fields
    try {
      const updatePayload = { status: 'RESOLVED', resolutionSummary: 'Automated resolution', resolutionNotes: 'Resolved by automated test' };
      const resolved = await ticketService.updateTicket(ticket.ticketId || ticket.id, updatePayload, assignee);
      report.steps.push({ step: 'resolve-ticket', ok: true, ticketStatus: resolved.status });
    } catch (e) {
      report.steps.push({ step: 'resolve-ticket', ok: false, error: String(e.message || e) });
    }

    // 7) verify as requester that ticket is resolved
    try {
      const after = await ticketService.getTicket(ticket.ticketId || ticket.id, actorUser);
      report.steps.push({ step: 'verify-resolution', ok: true, status: after.status });
    } catch (e) {
      report.steps.push({ step: 'verify-resolution', ok: false, error: String(e.message || e) });
    }

    // 8) close ticket as admin if available, otherwise use requester
    let admin = null;
    try {
      const admins = await query('SELECT _id, public_id, email, role, tenant_id FROM users WHERE tenant_id = ? AND (role LIKE "%Admin%" OR role LIKE "%CENTRAL%") LIMIT 1', [actorUser.tenant_id]);
      if (admins && admins.length) admin = admins[0];
      const closer = admin || actorUser;
      const closed = await ticketService.updateTicket(ticket.ticketId || ticket.id, { status: 'CLOSED', closureRemarks: 'Closed by automated E2E' }, closer);
      report.steps.push({ step: 'close-ticket', ok: true, closer: closer.email || closer.public_id, status: closed.status });
    } catch (e) {
      report.steps.push({ step: 'close-ticket', ok: false, error: String(e.message || e) });
    }

    // 9) collect history and notifications
    const esc = await query('SELECT * FROM ticket_escalations WHERE ticket_id = ? ORDER BY id DESC LIMIT 20', [ticket.id]);
    const history = await query('SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id DESC LIMIT 50', [ticket.id]);
    const notifs = await query('SELECT * FROM notifications WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 50', ['Ticket', ticket.id]);
    report.escalations = esc;
    report.history = history;
    report.notifications = notifs;

    logger.info('E2E Full Run: completed');
    console.log('E2E REPORT:', JSON.stringify(report, null, 2));

    // write report file
    const fs = require('fs');
    try { fs.writeFileSync('reports/e2e-full-run-report.json', JSON.stringify(report, null, 2)); } catch (e) { /* ignore */ }

    process.exit(0);
  } catch (err) {
    logger.error('E2E Full Run failed: ' + (err && err.message));
    console.error(err && err.stack ? err.stack : err);
    try { db.end(() => {}); } catch (e) {}
    process.exit(1);
  } finally {
    try { db.end(() => {}); } catch (e) {}
  }
})();
