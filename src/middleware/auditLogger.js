// =====================================================
// 2B) EXPRESS MIDDLEWARE FOR AUDIT LOGGING
// =====================================================

const { v4: uuidv4 } = require('uuid');
const auditLogger = require('../services/auditLogger');

/**
 * Middleware to capture request metadata and attach to req
 * Automatically logs request completion
 */
function auditMiddleware(options = {}) {
    return async (req, res, next) => {
        // Generate correlation ID
        req.correlationId = req.headers['x-correlation-id'] || uuidv4();

        // Attach audit helper to request
        req.audit = {
            log: async (auditData) => {
                const data = {
                    tenant_id: req.user?.tenant_id || req.user?.tenantId || null,
                    actor_id: req.user?._id || req.user?.id || req.user?.public_id || 'anonymous',
                    ip_address: req.ip || req.connection?.remoteAddress || null,
                    user_agent: req.headers['user-agent'] || null,
                    correlation_id: req.correlationId,
                    ...auditData
                };

                await auditLogger.logAudit(data);
            }
        };

        // Auto-audit on response finish (optional)
        if (options.autoLog) {
            const originalSend = res.send;
            res.send = function (data) {
                res.send = originalSend;

                // Log after response
                setImmediate(() => {
                    req.audit.log({
                        action: `HTTP_${req.method}`,
                        module: options.module || 'API',
                        entity: options.entity || req.baseUrl,
                        entity_id: req.params?.id || null,
                        details: {
                            method: req.method,
                            path: req.path,
                            statusCode: res.statusCode,
                            userRole: req.user?.role || 'guest'
                        }
                    }).catch(() => { });
                });

                return originalSend.call(this, data);
            };
        }

        next();
    };
}

/**
 * Manual audit logger helper
 * @param {Object} req - Express request object
 * @param {Object} auditData - Audit data
 */
async function manualAudit(req, auditData) {
    const data = {
        tenant_id: req.user?.tenant_id || req.user?.tenantId || null,
        actor_id: req.user?._id || req.user?.id || req.user?.public_id || 'anonymous',
        ip_address: req.ip || req.connection?.remoteAddress || null,
        user_agent: req.headers['user-agent'] || null,
        correlation_id: req.correlationId || null,
        ...auditData
    };

    await auditLogger.logAudit(data);
}

module.exports = {
    auditMiddleware,
    manualAudit
};
