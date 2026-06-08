const worker = require('./services/supportEmailWorker');
const { ensureTicketingSchema } = require('./bootstrap');
const { startTicketAutomationJobs, stopTicketAutomationJobs } = require('./services/ticketAutomationService');

module.exports = {
  ticketRoutes: require('./routes/ticketRoutes'),
  itTeamRoutes: require('./routes/itTeamRoutes'),
  categoryRoutes: require('./routes/categoryRoutes'),
  engineerMappingRoutes: require('./routes/engineerMappingRoutes'),
  slaRoutes: require('./routes/slaRoutes'),
  userSearchRoutes: require('./routes/userSearchRoutes'),
  escalationRoutes: require('./routes/escalationRoutes'),
  subcategoryRoutes: require('./routes/subcategoryRoutes'),
  startSupportEmailWorker: worker.startSupportEmailWorker,
  stopSupportEmailWorker: worker.stopSupportEmailWorker,
  startTicketAutomationJobs,
  stopTicketAutomationJobs,
  ensureTicketingSchema,
};
