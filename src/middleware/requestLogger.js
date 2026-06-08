const { v4: uuidv4 } = require('uuid');
const logger = require('../../logger');

/**
 * Express middleware to log incoming requests and attach a requestId to req
 */
const requestLogger = (req, res, next) => {
    // Generate a unique ID for each request to track logs end-to-end
    req.requestId = req.headers['x-request-id'] || uuidv4();

    // Assume req.user is populated by some auth middleware earlier
    const userId = req.user ? req.user.id : null;

    // Log the incoming request
    logger.info(`Received ${req.method} ${req.originalUrl}`, {
        requestId: req.requestId,
        userId: userId,
        ip: req.ip,
        method: req.method,
        url: req.originalUrl,
        userAgent: req.headers['user-agent']
    });

    // Capture response finish to log response status and time
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info(`Completed ${req.method} ${req.originalUrl} - ${res.statusCode}`, {
            requestId: req.requestId,
            userId: userId,
            statusCode: res.statusCode,
            durationMs: duration
        });
    });

    next();
};

module.exports = requestLogger;
