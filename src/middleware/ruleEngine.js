


const ruleEngine = require('../rules/jsonRuleEngine');
const db = require('../db');

const q = (sql, params = []) => new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r)));

const ruleEngineMiddleware = (ruleCode = null) => {
  return async (req, res, next) => {
    try {

      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }

      let resource = {};
      if (req.params.id) {


        resource = { id: req.params.id }; // Extend as needed
      }

      const decision = await ruleEngine.evaluate(req, user, resource, ruleCode);

      if (!decision.allowed) {

        if (decision.ruleCode === 'NO_RULE_MATCH') {
          const role = user && (user.role || '').toLowerCase();
          const code = (ruleCode || '').toLowerCase();

          // Fallback rules for bootstrapping
          if (role === 'admin') {
            return next(); // Admins can do anything
          }

          // Creation rules
          if (['task_creation', 'project_creation', 'client_creation', 'user_creation', 'subtask_creation'].includes(code)) {
            if (role === 'manager') {
              return next();
            }
          }

          // Document rules
          if (['document_view', 'document_upload', 'document_preview', 'document_download'].includes(code)) {
            if (role === 'manager' || role === 'client' || role === 'client-viewer') { // Clients might view, PMs can do all
              return next();
            }
          }

          try {
            const isProjectRule = String(ruleCode || '').toLowerCase().includes('project') || (req.baseUrl && req.baseUrl.includes('/projects'));
            if (isProjectRule) {
              const projectParam = req.params && (req.params.projectId || req.params.id || req.params.project_id) || req.body && (req.body.projectId || req.body.project_id);
              if (projectParam) {

                const projRows = await q('SELECT id FROM projects WHERE public_id = ? OR id = ? LIMIT 1', [projectParam, projectParam]).catch(() => []);
                const pid = projRows && projRows[0] && projRows[0].id;
                if (pid) {

                  if (user && (user.role === 'Admin')) {
                    return next();
                  }

                  const pcheck = await q('SELECT COUNT(*) AS cnt FROM projects WHERE id = ? AND (project_manager_id = ? OR created_by = ?)', [pid, user._id, user._id]).catch(() => []);
                  if (pcheck && pcheck[0] && pcheck[0].cnt > 0) return next();

                  const tcheck = await q(`SELECT COUNT(*) AS cnt FROM task_assignments ta JOIN tasks t ON ta.task_id = t.id WHERE t.project_id = ? AND ta.user_id = ?`, [pid, user._id]).catch(() => []);
                  if (tcheck && tcheck[0] && tcheck[0].cnt > 0) return next();
                }
              }
            }
          } catch (e) {

          }
        }

        return res.status(403).json({
          success: false,
          error: decision.reason,
          ruleCode: decision.ruleCode,
          nextAction: decision.nextAction
        });
      }

      next();
    } catch (error) {
      let logger;
      try { logger = require(global.__root + 'logger'); } catch (e) { try { logger = require('../logger'); } catch (e2) { logger = console; } }
      logger.error('Rule Engine Middleware Error:', error && (error.stack || error.message || error));

      // Fail-safe behavior: avoid returning 500 due to rule engine issues.
      // Permit privileged roles to continue, deny others with a clear 403 response.
      try {
        const role = req && req.user && (req.user.role || '').toLowerCase();
        if (role === 'admin' || role === 'manager' || role === 'superadmin') {
          logger.warn('Rule Engine failure: allowing privileged user to continue', { userId: req.user && req.user._id, role });
          return next();
        }
      } catch (e) {
        // ignore
      }

      return res.status(403).json({ success: false, error: 'Access denied (rule evaluation error)', code: 'RULE_EVAL_ERROR' });
    }
  };
};

module.exports = ruleEngineMiddleware;