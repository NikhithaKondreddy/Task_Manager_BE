#!/usr/bin/env node

/**
 * Production-Ready Express App Wrapper
 * Adds comprehensive error handling and safety guards
 * 
 * Usage: Use this as a wrapper or mount it during app initialization
 */

const HttpError = require('../errors/HttpError');
const env = require('../config/env');

let logger;
try {
  logger = require(global.__root + 'logger');
} catch (e) {
  logger = console;
}

/**
 * Global error catcher for unhandled promises and exceptions
 */
const setupGlobalErrorHandlers = () => {
  // Catch unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('[UNHANDLED_REJECTION]', {
      reason: reason && reason.message ? reason.message : String(reason),
      stack: reason && reason.stack ? reason.stack : undefined,
      timestamp: new Date().toISOString()
    });
  });

  // Catch uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('[UNCAUGHT_EXCEPTION]', {
      message: err && err.message ? err.message : String(err),
      stack: err && err.stack ? err.stack : undefined,
      timestamp: new Date().toISOString()
    });
    // Don't exit - let the system recover
  });
};

/**
 * Middleware to catch all errors and ensure they're handled
 */
const catchAllErrorHandler = (err, req, res, next) => {
  if (!err) return next();

  // Log all errors
  logger.error('[CATCH_ALL_ERROR]', {
    message: err.message,
    code: err.code,
    status: err.status,
    path: req.path,
    method: req.method,
    userId: req.user ? (req.user.id || req.user._id) : null,
    stack: env.NODE_ENV === 'production' ? undefined : err.stack
  });

  // Ensure response is sent
  if (!res.headersSent) {
    const status = err.status || 500;
    const message = env.NODE_ENV === 'production' 
      ? 'Internal Server Error' 
      : (err.message || 'Internal Server Error');

    res.status(status).json({
      success: false,
      message,
      code: err.code || 'INTERNAL_ERROR'
    });
  } else {
    next(err);
  }
};

/**
 * Production-safe version of async handler
 */
const safeAsyncHandler = (fn) => {
  return (req, res, next) => {
    try {
      const result = fn(req, res, next);
      
      // If it's a promise, attach catch handler
      if (result && typeof result.catch === 'function') {
        result.catch((err) => {
          logger.error('[ASYNC_HANDLER_ERROR]', {
            message: err && err.message ? err.message : String(err),
            path: req.path,
            stack: env.NODE_ENV === 'production' ? undefined : (err && err.stack)
          });
          next(err);
        });
      }
    } catch (err) {
      logger.error('[SYNC_ERROR_IN_HANDLER]', {
        message: err && err.message ? err.message : String(err),
        path: req.path,
        stack: env.NODE_ENV === 'production' ? undefined : (err && err.stack)
      });
      next(err);
    }
  };
};

/**
 * Wrapper for database queries
 */
const safeDbQuery = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    try {
      db.query(sql, params, (err, results) => {
        if (err) {
          logger.error('[DB_QUERY_ERROR]', {
            message: err.message,
            code: err.code || 'DB_ERROR',
            sql: sql.substring(0, 200)
          });
          reject(err);
        } else {
          resolve(results);
        }
      });
    } catch (err) {
      logger.error('[DB_QUERY_EXCEPTION]', {
        message: err && err.message ? err.message : String(err),
        sql: sql.substring(0, 200)
      });
      reject(err);
    }
  });
};

/**
 * Wrapper to add safety to Express app
 */
const makeProductionSafe = (app) => {
  // Setup global error handlers
  setupGlobalErrorHandlers();

  // Add catch-all error handler at the very end
  // This should be called AFTER all routes are registered
  app.use((req, res, next) => {
    // 404 handler
    const err = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
    err.status = 404;
    next(err);
  });

  // Final error handler
  app.use(catchAllErrorHandler);

  return app;
};

/**
 * Helper to wrap Express Router methods
 */
const wrapRouter = (router) => {
  const methodsToWrap = ['get', 'post', 'put', 'delete', 'patch'];
  
  methodsToWrap.forEach(method => {
    const originalMethod = router[method].bind(router);
    
    router[method] = function(path, ...handlers) {
      // Wrap all async handlers
      const wrappedHandlers = handlers.map(handler => {
        if (typeof handler !== 'function') return handler;
        if (handler.length === 4) return handler;  // Error handler
        
        return safeAsyncHandler(handler);
      });
      
      return originalMethod(path, ...wrappedHandlers);
    };
  });
  
  return router;
};

module.exports = {
  setupGlobalErrorHandlers,
  catchAllErrorHandler,
  safeAsyncHandler,
  safeDbQuery,
  makeProductionSafe,
  wrapRouter
};
