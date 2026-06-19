#!/usr/bin/env node
require('dotenv').config();
const logger = require('../src/logger');
const db = require('../src/db');
const ticketService = require('../src/modules/tickets/services/ticketService');
const ticketAutomation = require('../src/modules/tickets/services/ticketAutomationService');
const { query } = require('../src/modules/tickets/repositories/mysql');

(async function main() {
  try {
    logger.info('E2E Test: creating ticket as employee-employee@nivarahousing.com');

    const input = {
      subject: `E2E Test Ticket - SLA Escalation ${Date.now()}`,
      description: 'Automated test - force SLA breach and run monitor.',
      priority: 'High',
      requester_email: 'employee-employee@nivarahousing.com',
    };

    // Find an existing employee user to act as creator (fallback to common employee email)
    const candidates = ['employee-employee@nivarahousing.com', 'employee@nivarahousing.com', 'employee@gmail.com'];
    let actorUser = null;
    for (const em of candidates) {
      const rows = await query('SELECT _id, public_id, email, tenant_id, role FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1', [em]);
      if (rows && rows.length) {
        const r = rows[0];
        actorUser = { _id: r._id, public_id: r.public_id, email: r.email, role: r.role, tenant_id: r.tenant_id };
        console.log('Using existing user for ticket creation:', actorUser.email, 'id', actorUser._id);
        break;
      }
    }

    const result = await ticketService.createTicket(input, actorUser);
    if (!result || !result.ticket) {
      throw new Error('Ticket creation failed or returned unexpected result');
    }

    const ticket = result.ticket;
    console.log('CREATED TICKET:', ticket.ticketId || ticket.id || ticket.ticket_id, 'internal id', ticket.id);

    // Try explicit auto-assign (if mappings present)
    try {
      const assigned = await ticketAutomation.autoAssignTicket(ticket, { _id: null });
      console.log('AutoAssign result:', assigned && assigned.assigned_to ? `assigned_to=${assigned.assigned_to}` : 'no assignment');
    } catch (e) {
      console.warn('autoAssign failed:', e && e.message);
    }

    // Backdate SLA timers to force escalation
    await query(
      `UPDATE tickets SET response_due_at = DATE_SUB(NOW(), INTERVAL 2 HOUR), resolution_due_at = DATE_SUB(NOW(), INTERVAL 1 HOUR), next_escalation_at = DATE_SUB(NOW(), INTERVAL 30 MINUTE) WHERE id = ?`,
      [ticket.id]
    );
    console.log('Backdated SLA fields for ticket id', ticket.id);

    // Run one-shot SLA monitor
    console.log('Running monitorSlaBreaches()...');
    await ticketAutomation.monitorSlaBreaches();
    console.log('Monitor run complete.');

    // Fetch results
    const esc = await query('SELECT * FROM ticket_escalations WHERE ticket_id = ? ORDER BY id DESC LIMIT 10', [ticket.id]);
    const history = await query('SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY id DESC LIMIT 20', [ticket.id]);
    const notifs = await query('SELECT * FROM notifications WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 20', ['Ticket', ticket.id]);
    const finalTicketRows = await query('SELECT * FROM tickets WHERE id = ? LIMIT 1', [ticket.id]);

    console.log('\n--- ESCALATIONS ---');
    console.log(JSON.stringify(esc, null, 2));
    console.log('\n--- HISTORY ---');
    console.log(JSON.stringify(history, null, 2));
    console.log('\n--- NOTIFICATIONS ---');
    console.log(JSON.stringify(notifs, null, 2));
    console.log('\n--- FINAL TICKET ROW ---');
    console.log(JSON.stringify(finalTicketRows[0] || {}, null, 2));

    process.exit(0);
  } catch (err) {
    logger.error('E2E test failed: ' + (err && err.message));
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  } finally {
    try { db.end(() => {}); } catch (e) {}
  }
})();
