/**
 * Standardized Error Response Format
 * 
 * Usage:
 * res.status(400).json(errorResponse.badRequest('Field is required', 'FIELD_REQUIRED', { field: 'email' }))
 * res.status(404).json(errorResponse.notFound('User not found', 'USER_NOT_FOUND'))
 * res.status(500).json(errorResponse.serverError('Database connection failed', 'DB_ERROR', { details: err.message }))
 */

const errorResponse = {
  /**
   * Format error response
   */
  format: (message, errorCode = 'INTERNAL_ERROR', details = null, field = null) => ({
    success: false,
    message,
    error: {
      code: errorCode,
      ...(details && { details }),
      ...(field && { field })
    }
  }),

  /**
   * Bad Request (400)
   */
  badRequest: (message, errorCode = 'BAD_REQUEST', details = null, field = null) =>
    errorResponse.format(message, errorCode, details, field),

  /**
   * Unauthorized (401)
   */
  unauthorized: (message = 'Authentication required', errorCode = 'UNAUTHORIZED', details = null) =>
    errorResponse.format(message, errorCode, details),

  /**
   * Forbidden (403)
   */
  forbidden: (message = 'Access denied', errorCode = 'FORBIDDEN', details = null) =>
    errorResponse.format(message, errorCode, details),

  /**
   * Not Found (404)
   */
  notFound: (message, errorCode = 'NOT_FOUND', details = null) =>
    errorResponse.format(message, errorCode, details),

  /**
   * Conflict (409)
   */
  conflict: (message, errorCode = 'CONFLICT', details = null, field = null) =>
    errorResponse.format(message, errorCode, details, field),

  /**
   * Unprocessable Entity (422)
   */
  unprocessable: (message, errorCode = 'UNPROCESSABLE', details = null, field = null) =>
    errorResponse.format(message, errorCode, details, field),

  /**
   * Internal Server Error (500)
   */
  serverError: (message = 'Internal server error', errorCode = 'INTERNAL_ERROR', details = null) =>
    errorResponse.format(message, errorCode, details),

  /**
   * Database Error (500)
   */
  databaseError: (message = 'Database operation failed', errorCode = 'DB_ERROR', details = null) =>
    errorResponse.format(message, errorCode, details),

  /**
   * Validation Error (400)
   */
  validationError: (message, field = null, errorCode = 'VALIDATION_ERROR', details = null) =>
    errorResponse.format(message, errorCode, details, field),

  /**
   * Permission/Assignment Error (400)
   */
  assignmentError: (message, errorCode = 'ASSIGNMENT_ERROR', details = null) =>
    errorResponse.format(message, errorCode, details),

  /**
   * State Conflict Error (400)
   */
  stateError: (message, errorCode = 'STATE_ERROR', details = null) =>
    errorResponse.format(message, errorCode, details)
};

module.exports = errorResponse;
