const worker = require('./services/supportEmailWorker');

module.exports = {
  ticketRoutes: require('./routes/ticketRoutes'),
  startSupportEmailWorker: worker.startSupportEmailWorker,
  stopSupportEmailWorker: worker.stopSupportEmailWorker,
};
