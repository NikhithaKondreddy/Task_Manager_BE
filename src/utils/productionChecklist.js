/**
 * Production Error Handling & Validation Checklist
 * Use this utility to verify all routes have proper error handling
 */

const HttpError = require('../errors/HttpError');

// List of critical validation checks for production
const PRODUCTION_CHECKS = {
  AUTH: {
    name: 'Authentication',
    checks: [
      'JWT token validation with expiry',
      'Refresh token rotation',
      'Password hashing with bcrypt',
      'Rate limiting on auth endpoints',
      'Failed login attempt tracking'
    ]
  },
  
  DATABASE: {
    name: 'Database Operations',
    checks: [
      'All database queries wrapped in try-catch',
      'Proper error mapping to HTTP status codes',
      'Connection pooling configured',
      'Query timeout settings',
      'Prepared statements for SQL injection prevention'
    ]
  },

  ERROR_HANDLING: {
    name: 'Error Handling',
    checks: [
      'Global error handler middleware in place',
      'All async routes wrapped with asyncHandler',
      'Validation errors return 400',
      'Not found errors return 404',
      'Authorization errors return 403',
      'Server errors logged to disk',
      'Stack traces hidden from clients in production'
    ]
  },

  VALIDATION: {
    name: 'Input Validation',
    checks: [
      'All user inputs validated',
      'XSS protection enabled',
      'CSRF tokens for state-changing requests',
      'Rate limiting configured',
      'Request body size limits',
      'File upload size limits'
    ]
  },

  SECURITY: {
    name: 'Security',
    checks: [
      'HTTPS enforced in production',
      'CORS properly configured',
      'Helmet security headers enabled',
      'No sensitive data in logs',
      'No hardcoded secrets or API keys',
      'Environment variables for configs'
    ]
  },

  MONITORING: {
    name: 'Monitoring & Logging',
    checks: [
      'All errors logged with context',
      'Request/Response logging',
      'Database operations logged',
      'Error stacks logged',
      'Log rotation configured',
      'Metrics collection enabled'
    ]
  }
};

/**
 * Validate that a route handler is wrapped properly
 */
const validateRouteHandler = (handler, handlerName) => {
  const errors = [];

  if (typeof handler !== 'function') {
    errors.push(`${handlerName}: Not a function`);
  }

  // Check if it's an array (middleware stack)
  if (Array.isArray(handler)) {
    handler.forEach((mw, idx) => {
      if (typeof mw !== 'function') {
        errors.push(`${handlerName}[${idx}]: Not a function`);
      }
    });
  }

  return errors;
};

/**
 * Safe error wrapper for database queries
 */
const safeDbQuery = (db, sql, params = []) => {
  return new Promise((resolve, reject) => {
    try {
      db.query(sql, params, (err, results) => {
        if (err) {
          const wrappedErr = new HttpError(500, 'Database operation failed', 'DB_ERROR', err);
          reject(wrappedErr);
        } else {
          resolve(results);
        }
      });
    } catch (err) {
      reject(new HttpError(500, 'Database query failed', 'DB_QUERY_ERROR', err));
    }
  });
};

/**
 * Print production checklist
 */
const printChecklist = () => {
  console.log('\n========================================');
  console.log('PRODUCTION READINESS CHECKLIST');
  console.log('========================================\n');

  Object.entries(PRODUCTION_CHECKS).forEach(([key, section]) => {
    console.log(`\n✓ ${section.name.toUpperCase()}`);
    console.log('-'.repeat(40));
    section.checks.forEach(check => {
      console.log(`  [ ] ${check}`);
    });
  });

  console.log('\n========================================');
  console.log('CRITICAL ITEMS FOR PRODUCTION:');
  console.log('========================================');
  console.log('[ ] All async route handlers wrapped with asyncHandler');
  console.log('[ ] Error middleware positioned AFTER all routes');
  console.log('[ ] Database errors caught and mapped to HTTP errors');
  console.log('[ ] Input validation on all endpoints');
  console.log('[ ] HTTPS enabled');
  console.log('[ ] Environment variables configured');
  console.log('[ ] Logging collection configured');
  console.log('[ ] Rate limiting enabled');
  console.log('[ ] CORS configured securely');
  console.log('[ ] No console.log() in production code');
  console.log('[ ] Error messages do not expose system details');
  console.log('[ ] Stack traces hidden from API responses');
  console.log('\n========================================\n');
};

module.exports = {
  PRODUCTION_CHECKS,
  validateRouteHandler,
  safeDbQuery,
  printChecklist
};
