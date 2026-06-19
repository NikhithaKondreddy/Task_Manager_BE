#!/usr/bin/env node
require('dotenv').config();
const logger = require('../src/logger');
const { startTicketAutomationJobs } = require('../src/modules/tickets');

async function start() {
  try {
    logger.info('Starting escalation processor (ticket SLA monitor)');
    startTicketAutomationJobs();

    // keep the process alive
    setInterval(() => {}, 60 * 60 * 1000);
  } catch (err) {
    logger.error('Escalation processor failed to start: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }
}

start();
