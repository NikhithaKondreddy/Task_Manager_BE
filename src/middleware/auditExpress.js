const auditQueue = require('../services/auditQueueService');

module.exports = (req, res, next) => {
    res.on('finish', () => {
        // Fire-and-forget logging hook
        auditQueue.logEvent({
            actor_id: req.user ? (req.user._id || req.user.id) : null,
            tenant_id: req.user ? req.user.tenant_id : null,
            action: `${req.method} ${req.route ? req.route.path : req.originalUrl}`,
            ip_address: req.ip,
            user_agent: req.headers['user-agent'] || null,
            correlation_id: req.requestId || null, // from our requestLogger
            module: 'API_REQUEST',
            details: { params: req.params, method: req.method, statusCode: res.statusCode },
        }).catch(err => console.error('Audit Error:', err));
    });
    next();
};
