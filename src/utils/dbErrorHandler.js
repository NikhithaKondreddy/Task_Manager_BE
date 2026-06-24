/**
 * Database Error Handler
 * Handles common database errors and returns standardized responses
 */

const HttpError = require('../errors/HttpError');
const errorResponse = require('./errorResponse');

/**
 * Handles database query errors
 * @param {Error} error - Database error object
 * @param {string} context - Context of the query (e.g., 'fetch user', 'create task')
 * @throws {HttpError}
 */
const handleDbError = (error, context = 'Database operation') => {
  if (!error) return;

  const message = error.message || '';
  const code = error.code || 'DB_ERROR';

  // Handle specific MySQL error codes
  if (error.errno || error.code) {
    switch (error.code) {
      case 'ER_DUP_ENTRY':
      case 'ER_DUP_KEY':
        throw new HttpError(409, `${context}: Duplicate entry. Please check unique constraints.`, 'DUPLICATE_ENTRY');

      case 'ER_BAD_FIELD_ERROR':
      case 'ER_NO_REFERENCED_TABLE':
        throw new HttpError(500, `${context}: Database schema error. Please contact support.`, 'SCHEMA_ERROR');

      case 'ER_PARSE_ERROR':
        throw new HttpError(500, `${context}: Invalid query. Please contact support.`, 'QUERY_ERROR');

      case 'ER_LOCK_WAIT_TIMEOUT':
        throw new HttpError(503, `${context}: Database is busy. Please retry.`, 'DB_LOCK_TIMEOUT');

      case 'ER_OUT_OF_MEMORY':
        throw new HttpError(503, `${context}: Database out of memory. Please retry.`, 'DB_OUT_OF_MEMORY');

      case 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR':
      case 'PROTOCOL_CONNECTION_LOST':
      case 'ER_UNKNOWN_COM_ERROR':
        throw new HttpError(503, `${context}: Database connection failed. Please retry.`, 'DB_CONNECTION_ERROR');

      default:
        throw new HttpError(500, `${context}: ${message.substring(0, 100)}`, 'DB_ERROR');
    }
  }

  // Generic database error
  throw new HttpError(500, `${context}: ${message.substring(0, 100)}`, 'DB_ERROR');
};

/**
 * Wraps a database query promise
 * Usage: const result = await promiseQuery(sql, params).catch(err => handleDbError(err, 'fetch users'))
 */
const promiseQuery = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

/**
 * Safe database query wrapper
 * Automatically catches and logs errors
 */
const safeQuery = async (db, sql, params = [], context = 'Database operation', logger = null) => {
  try {
    return await promiseQuery(db, sql, params);
  } catch (err) {
    if (logger && typeof logger.error === 'function') {
      logger.error(`[${context}] Database error:`, {
        code: err.code,
        errno: err.errno,
        message: err.message,
        sql: sql.substring(0, 200)
      });
    }
    handleDbError(err, context);
  }
};

/**
 * Check if database connection is active
 */
const checkDbConnection = (db) => {
  return new Promise((resolve) => {
    db.query('SELECT 1', (err) => {
      resolve(!err);
    });
  });
};

module.exports = {
  handleDbError,
  promiseQuery,
  safeQuery,
  checkDbConnection
};
