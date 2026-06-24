/**
 * Async Handler Wrapper
 * Wraps async route handlers to automatically catch and pass errors to next()
 */

const HttpError = require('../errors/HttpError');
const env = require('../config/env');

/**
 * Wraps an async route handler to catch errors
 * Usage: router.get('/path', asyncHandler(async (req, res, next) => { ... }))
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((err) => {
      // Ensure we have a proper error object
      if (!(err instanceof HttpError)) {
        const status = err.status || err.statusCode || 500;
        const code = err.code || 'INTERNAL_ERROR';
        const message = err.message || 'Internal Server Error';
        
        const wrappedError = new HttpError(status, message, code);
        
        if (env.NODE_ENV !== 'production' && err.stack) {
          wrappedError.details = err.stack;
        }
        
        err = wrappedError;
      }
      
      next(err);
    });
  };
};

/**
 * Wraps an array-based middleware stack (for multer, validators, etc.)
 * Usage: router.post('/path', wrapArray([ multer, validator, asyncHandler(handler) ]))
 */
const wrapArray = (middlewares) => {
  return middlewares.map((mw) => {
    if (typeof mw !== 'function') return mw;
    if (mw.length === 4) return mw; // Skip error handlers (4 params)
    if (mw.length === 3) {
      // Async middleware with 3 params
      return (req, res, next) => {
        Promise.resolve(mw(req, res, next)).catch(next);
      };
    }
    return mw;
  });
};

module.exports = { asyncHandler, wrapArray };
