const logger = require('../../logger');

/**
 * Express error-handling middleware to log uncaught exceptions or next(err) calls
 * MUST have 4 parameters: (err, req, res, next)
 * Placed BEFORE errorHandler in middleware stack
 */
const errorLogger = (err, req, res, next) => {
    // If headers are already sent, delegate to next error handler
    if (res.headersSent) {
        return next(err);
    }

    // Capture useful context
    const userId = req.user ? (req.user.id || req.user._id) : null;
    const statusCode = err.status || err.statusCode || 500;
    const timestamp = new Date().toISOString();

    // Build comprehensive log object
    const logContext = {
        timestamp,
        requestId: req.requestId || req.id,
        userId,
        method: req.method,
        url: req.originalUrl,
        path: req.path,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        statusCode,
        errorCode: err.code || 'UNKNOWN',
        errorMessage: err.message,
        stack: err.stack
    };

    // Log with full context
    if (process.env.NODE_ENV === 'production') {
        // In production, log only key information without stack trace
        logger.error('API Error', {
            timestamp,
            requestId: logContext.requestId,
            userId,
            method: req.method,
            url: req.originalUrl,
            statusCode,
            errorCode: err.code || 'UNKNOWN',
            errorMessage: err.message
        });
    } else {
        // In development, log detailed information including stack
        logger.error('API Error', logContext);
    }

    // Pass error to next handler
    next(err);
};

module.exports = errorLogger;
