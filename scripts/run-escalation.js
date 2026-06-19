#!/usr/bin/env node
require('dotenv').config();
const logger = require('../src/logger');
const { monitorSlaBreaches } = require('../src/modules/tickets/services/ticketAutomationService');

(async function runOnce() {
  try {
    logger.info('Running escalation processor (one-shot)');
    await monitorSlaBreaches();
    logger.info('Escalation one-shot completed');
    process.exit(0);
  } catch (err) {
    logger.error('Escalation one-shot failed: ' + (err && err.message ? err.message : String(err)));
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
