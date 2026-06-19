require('dotenv').config();
console.log("--- NODE SERVER RESTARTING FOR DEFAULTS SEEDING ---");
const Redis = require('ioredis');
const appServer = require('./src/app');
const env = require('./src/config/env');
const port = env.PORT || 4000;
const logger = require('./logger');
const { startSupportEmailWorker, startTicketAutomationJobs } = require('./src/modules/tickets');
const auditCleanupService = require('./src/services/auditCleanupService');
const notificationCleanupService = require('./src/services/notificationCleanupService');
const taskWorkflowAutomationService = require('./src/services/taskWorkflowAutomationService');

async function start() {
  const requireRedis = (process.env.REQUIRE_REDIS !== 'false') && !!env.REDIS_URL;

  let redis;
  if (requireRedis) {
    if (!env.REDIS_URL) {
      logger.error('REDIS_URL is required. Set REDIS_URL in your environment or .env file, or set REQUIRE_REDIS=false to skip.');
      process.exit(1);
    }

    try {
      redis = new Redis(env.REDIS_URL);

      redis.on('error', (err) => {
        logger.warn('Redis error (index):', err && err.message);
      });
      await redis.ping();
      logger.info('Connected to Redis');
    } catch (e) {
      logger.error('Failed to connect to Redis:', e.message || e);
      process.exit(1);
    }
  } else {
    if (process.env.REDIS_URL) logger.info('REQUIRE_REDIS is false — skipping Redis client creation (REDIS_URL present)');
    else logger.info('REQUIRE_REDIS is false — skipping Redis connectivity check');
  }

  try {
    await appServer.bootstrapReady;
  } catch (error) {
    logger.error('Bootstrap failed before starting server: ' + (error && error.message ? error.message : String(error)));
    // Continue starting server despite bootstrap failure
  }

  const server = appServer.listen(port, () => {
    const message = `Server is running on ${env.BASE_URL}`;
    logger.info(message);
    startSupportEmailWorker();
    startTicketAutomationJobs();
    auditCleanupService.start();
    notificationCleanupService.start();
    taskWorkflowAutomationService.start().catch((error) => {
      logger.error('Failed to start task workflow automation scheduler: ' + (error && error.message ? error.message : String(error)));
    });
  });

  process.on('SIGINT', async () => {
    try { if (redis) await redis.quit(); } catch (e) {}
    server.close(() => process.exit(0));
  });
}

start(); // server start
// Trigger nodemon restart to rerun database seeding after stable DB connection
