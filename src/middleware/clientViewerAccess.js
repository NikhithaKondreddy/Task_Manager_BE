

const db = require('../db');
let logger;
try { logger = require(global.__root + 'logger'); } catch (e) { logger = require('../logger'); }

module.exports = async function clientViewerAccessControl(req, res, next) {
  try {
    if (!req.user || req.user.role !== 'Client-Viewer') {
      return next();
    }

    if (req.method !== 'GET') {
      return res.status(403).json({
        success: false,
        error: 'Client-Viewer users have read-only access. POST, PUT, DELETE not allowed.'
      });
    }

    const clientId = await new Promise(resolve => {
      db.query(
        'SELECT client_id FROM client_viewers WHERE user_id = ? LIMIT 1',
        [req.user._id],
        (err, results) => {
          resolve(results && results[0] ? results[0].client_id : null);
        }
      );
    });

    if (!clientId) {
      return res.status(403).json({
        success: false,
        error: 'No client assigned to this viewer'
      });
    }

    req.viewerMappedClientId = clientId;

    const allowedPatterns = [
      /^\/api\/clients\/\d+$/,           // GET /api/clients/:id
      /^\/api\/tasks$/,                  // GET /api/tasks
      /^\/api\/tasks\/\d+$/,             // GET /api/tasks/:id
      /^\/api\/documents$/,              // GET /api/documents
      /^\/api\/documents\/\d+$/,         // GET /api/documents/:id
      /^\/api\/users\/profile$/,         // GET /api/users/profile
      /^\/api\/clients\/\d+\/tasks$/,    // GET /api/clients/:id/tasks
      /^\/api\/clients\/\d+\/documents$/ // GET /api/clients/:id/documents
    ];

    const requestPath = req.path;
    const isAllowed = allowedPatterns.some(pattern => pattern.test(requestPath));

    if (!isAllowed) {
      return res.status(403).json({
        success: false,
        error: `Access denied to ${req.method} ${requestPath}. Client-Viewer has limited read-only access.`,
        allowedEndpoints: [
          'GET /api/clients/:id',
          'GET /api/tasks',
          'GET /api/tasks/:id',
          'GET /api/documents',
          'GET /api/documents/:id',
          'GET /api/users/profile',
          'GET /api/clients/:id/tasks',
          'GET /api/clients/:id/documents'
        ]
      });
    }

    const clientIdMatch = requestPath.match(/\/api\/clients\/(\d+)/);
    if (clientIdMatch) {
      const requestedClientId = parseInt(clientIdMatch[1], 10);
      if (requestedClientId !== clientId) {
        return res.status(403).json({
          success: false,
          error: `Access denied: You are only allowed to view client ID ${clientId}`
        });
      }
    }

    req.accessLevel = 'Limited Read-Only';
    req.allowedModules = ['Dashboard', 'Assigned Tasks', 'Documents'];

    return next();
  } catch (e) {
    logger.error('Error in clientViewerAccessControl:', e.message);
    return res.status(500).json({
      success: false,
      error: 'Access control check failed',
      details: process.env.NODE_ENV === 'development' ? e.message : undefined
    });
  }
};
