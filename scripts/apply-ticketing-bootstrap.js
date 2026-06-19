#!/usr/bin/env node
const { ensureTicketingSchema } = require('../src/modules/tickets/bootstrap');
const logger = require('../logger');

(async () => {
  try {
    logger.info('Applying tickets bootstrap/migrations...');
    const res = await ensureTicketingSchema();
    if (res && res.success) {
      logger.info('Tickets bootstrap applied successfully');
      console.log('Tickets bootstrap applied successfully');
      process.exit(0);
    }
    logger.error('Tickets bootstrap reported failure', res && res.error);
    console.error('Tickets bootstrap reported failure', res && res.error && res.error.message ? res.error.message : res);
    process.exit(1);
  } catch (err) {
    logger.error('Tickets bootstrap failed', err && err.message ? err.message : err);
    console.error('Tickets bootstrap failed', err && err.message ? err.message : err);
    process.exit(1);
  }
})();
