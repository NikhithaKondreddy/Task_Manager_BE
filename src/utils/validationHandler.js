/**
 * Request Validation Error Handler
 * Handles validation errors consistently
 */

const { validationResult } = require('express-validator');
const HttpError = require('../errors/HttpError');

/**
 * Extract validation errors and throw HttpError
 * @param {Object} req - Express request object
 * @throws {HttpError}
 */
const validateRequest = (req) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const firstError = errors.array()[0];
    throw new HttpError(
      400,
      firstError.msg || `Validation failed on field: ${firstError.param}`,
      'VALIDATION_ERROR'
    );
  }
};

/**
 * Validation error middleware
 * Use after validators to check for errors
 */
const validationErrorHandler = (req, res, next) => {
  try {
    validateRequest(req);
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = { validateRequest, validationErrorHandler };
