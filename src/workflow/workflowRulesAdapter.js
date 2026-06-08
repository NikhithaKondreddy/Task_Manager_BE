


const db = require('../db');

const q = (sql, params = []) => (db.q ? db.q(sql, params) : new Promise((resolve, reject) => db.query(sql, params, (e, r) => e ? reject(e) : resolve(r))));

async function loadWorkflowDefinition(tenantId, entityType) {
  const rows = await q(
    'SELECT * FROM workflow_definitions WHERE tenant_id = ? AND entity_type = ? LIMIT 1',
    [tenantId, entityType]
  );
  if (!rows || rows.length === 0) return null;
  const def = rows[0];
  return {
    id: def.id,
    tenant_id: def.tenant_id,
    entity_type: def.entity_type,
    name: def.name,
    states: JSON.parse(def.states),
    rules: JSON.parse(def.rules)
  };
}

async function getCustomRules(tenantId, entityType, fromState, toState) {
  const def = await loadWorkflowDefinition(tenantId, entityType);
  if (!def) return null;
  return def.rules;
}

module.exports = {
  loadWorkflowDefinition,
  getCustomRules
};