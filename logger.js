const { createLogger, format, transports } = require('winston');
const { combine, timestamp, printf, errors, json } = format;
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logDirectory = path.join(__dirname, 'logs');
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

// Custom format to structure the log output natively as JSON
// This ensures that Logstash can easily parse it
const logFormat = printf((info) => {
  const { timestamp, level, message, stack, requestId, userId, ...meta } = info;
  return JSON.stringify({
    timestamp,
    level,
    message,
    requestId: requestId || null,
    userId: userId || null,
    stack, // Included if it's an error
    ...meta
  });
});

const logger = createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    errors({ stack: true }), // capture stack traces
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    logFormat
  ),
  defaultMeta: { service: 'task-backend' }, // identify the service
  transports: [
    // Requirement: Save logs to logs/app.log
    new transports.File({ filename: path.join(logDirectory, 'app.log') }),
    // Optional: Separate error file for easier local debugging
    new transports.File({ filename: path.join(logDirectory, 'error.log'), level: 'error' })
  ]
});

// Also log to console if not in production
if (process.env.NODE_ENV !== 'production') {
  logger.add(new transports.Console({
    format: combine(
      format.colorize(),
      timestamp({ format: 'HH:mm:ss' }),
      printf((info) => `[${info.timestamp}] ${info.level}: ${info.message} ` + 
        (Object.keys(info).length > 3 ? JSON.stringify(info) : ''))
    )
  }));
}

module.exports = logger;
