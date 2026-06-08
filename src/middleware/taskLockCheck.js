const db = require(__root + 'db');

const queryAsync = (sql, params = []) =>
  new Promise((resolve, reject) =>
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

async function hasColumn(tableName, columnName) {
  try {
    const rows = await queryAsync(
      `SELECT 1
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
         AND COLUMN_NAME = ?
       LIMIT 1`,
      [tableName, columnName]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    return false;
  }
}

/**
 * Middleware to enforce requester-only lock while reassignment is pending.
 * Blocks write operations only for the user who created the pending request.
 */
const taskLockCheckMiddleware = (req, res, next) => {
  // Allow GET operations, only block write operations
  if (req.method === 'GET') {
    return next();
  }

  // Skip check if no task ID in params or body
  const taskId = req.params.id || req.params.taskId || req.body?.taskId;
  if (!taskId) {
    return next();
  }

  // Handle both public_id and numeric ID
  const checkTaskLock = async () => {
    try {
      // Convert public_id to internal ID if needed
      let internalTaskId = taskId;
      if (typeof taskId === 'string' && !/^\d+$/.test(taskId)) {
        const taskRows = await queryAsync('SELECT id FROM tasks WHERE public_id = ?', [taskId]);
        if (taskRows.length === 0) {
          return next(); // Let the route handler deal with not found
        }
        internalTaskId = taskRows[0].id;
      }

      const userId = req.user && req.user._id;
      const tenantId = req.user?.tenant_id || req.tenantId || null;
      if (!userId) return next();

      const hasReassignmentTenantId = await hasColumn('task_resign_requests', 'tenant_id');

      // Check pending reassignment request only for current requester.
      const pendingRows = await queryAsync(
        `SELECT id FROM task_resign_requests 
         WHERE task_id = ?
           AND requested_by = ?
           AND status = 'PENDING'
           ${hasReassignmentTenantId ? 'AND tenant_id = ?' : ''}
         LIMIT 1`,
        hasReassignmentTenantId ? [internalTaskId, userId, tenantId] : [internalTaskId, userId]
      );

      const isLockedForUser = pendingRows.length > 0;

      if (isLockedForUser) {
        return res.status(423).json({
          success: false,
          error: 'You already requested reassignment. Action restricted.',
          is_locked_for_user: true,
          has_pending_request: true,
          code: 'TASK_LOCKED_FOR_REQUESTER',
          lock: {
            is_locked: true,
            locked_for: 'REQUESTER_ONLY'
          }
        });
      }

      next();
    } catch (error) {
      console.error('taskLockCheckMiddleware error:', error);
      // On error, allow operation to proceed (database issue shouldn't block requests)
      next();
    }
  };

  checkTaskLock();
};

module.exports = taskLockCheckMiddleware;
