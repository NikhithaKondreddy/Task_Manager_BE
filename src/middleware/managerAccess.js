
const db = require('../db');

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

module.exports = async function managerAccessMiddleware(req, res, next) {
  try {

    if (!req.user || req.user.role !== 'Manager') {
      return next();
    }

    const managerId = req.user._id;
    const clientIdFromRoute = req.params.id;

    if (!clientIdFromRoute) {
      return next();
    }

    const assignedClients = await q(
      'SELECT id FROM clients WHERE id = ? AND manager_id = ? LIMIT 1',
      [clientIdFromRoute, managerId]
    );

    if (!assignedClients || assignedClients.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied: You are not assigned to this client'
      });
    }

    req.isManagerOfClient = true;
    return next();
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: 'Internal error checking manager access'
    });
  }
};
