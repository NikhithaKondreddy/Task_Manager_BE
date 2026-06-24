const HttpError = require('../errors/HttpError');
const env = require('../config/env');

/**
 * Express Error Handler Middleware
 * MUST have 4 parameters: (err, req, res, next)
 * Should be the LAST middleware in the app
 */
function errorHandler(err, req, res, next) {
  // Prevent infinite loops
  if (!err) return next();

  // Wrap non-HttpError errors
  if (!(err instanceof HttpError)) {
    const status = err.status || err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';
    const message = err.message || 'Internal Server Error';

    const wrapped = new HttpError(status, message, code);
    
    // Include stack trace only in development
    if (env.NODE_ENV !== 'production') {
      wrapped.details = err.stack || (err.details && typeof err.details === 'object' ? err.details : null);
    }
    
    err = wrapped;
  }

  // Log the error
  try {
    const logObj = {
      status: err.status || 500,
      code: err.code || 'INTERNAL_ERROR',
      message: err.message,
      timestamp: new Date().toISOString(),
      path: req.path || req.url,
      method: req.method,
      userId: req.user ? (req.user.id || req.user._id) : null
    };

    if (env.NODE_ENV !== 'production' && err.details) {
      logObj.details = err.details;
    }

    let logger;
    try {
      logger = require(global.__root + 'logger');
    } catch (e) {
      try {
        logger = require('../../logger');
      } catch (e2) {
        logger = console;
      }
    }

    if (logger && typeof logger.error === 'function') {
      logger.error(logObj);
    } else {
      console.error('[ERROR]', logObj);
    }
  } catch (logErr) {
    console.error('[LOGGER_ERROR]', logErr && logErr.message);
  }

  // Send response only if headers haven't been sent
  if (!res.headersSent) {
    const payload = {
      success: false,
      message: err.message || 'Internal Server Error',
      code: err.code || 'INTERNAL_ERROR'
    };

    // Include details in development only
    if (env.NODE_ENV !== 'production' && err.details) {
      payload.details = err.details;
    }

    const statusCode = err.status || 500;
    res.status(statusCode).json(payload);
  } else {
    // If headers already sent, pass to Express default handler
    next(err);
  }
}

module.exports = errorHandler;
