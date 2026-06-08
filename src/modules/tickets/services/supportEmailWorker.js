const logger = require('../../../logger');
const graphMailClient = require('../integrations/graphMailClient');
const ticketEmailProcessor = require('./ticketEmailProcessor');

let intervalHandle = null;
let running = false;

function isWorkerEnabled() {
  return String(process.env.SUPPORT_EMAIL_ENABLED || 'false').toLowerCase() === 'true';
}

async function pollSupportMailbox() {
  if (running) return;
  running = true;

  try {
    const limit = Number(process.env.SUPPORT_EMAIL_BATCH_SIZE || 10);
    const messages = await graphMailClient.fetchUnreadMessages(limit);

    for (const message of messages) {
      try {
        await ticketEmailProcessor.processInboundEmail(message);
        await graphMailClient.markMessageRead(message.provider_id);
        logger.info(`Processed support email ${message.message_id}`);
      } catch (error) {
        logger.error(`Failed to process support email ${message.message_id}: ${error.stack || error.message}`);
      }
    }
  } catch (error) {
    logger.error('Support mailbox polling failed: ' + (error.stack || error.message));
  } finally {
    running = false;
  }
}

function startSupportEmailWorker() {
  if (!isWorkerEnabled()) {
    logger.info('Support email worker disabled. Set SUPPORT_EMAIL_ENABLED=true to poll the common mailbox.');
    return null;
  }

  if (!graphMailClient.isConfigured()) {
    logger.warn('Support email worker enabled but Microsoft Graph settings are incomplete.');
    return null;
  }

  if (intervalHandle) return intervalHandle;

  const intervalMs = Number(process.env.SUPPORT_EMAIL_POLL_INTERVAL_MS || 60000);
  intervalHandle = setInterval(pollSupportMailbox, intervalMs);
  pollSupportMailbox();

  logger.info(`Support email worker started. Poll interval: ${intervalMs}ms`);
  return intervalHandle;
}

function stopSupportEmailWorker() {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

module.exports = {
  startSupportEmailWorker,
  stopSupportEmailWorker,
  pollSupportMailbox,
};
