

const { Engine } = require('json-rules-engine');
const db = require('../config/db');
const { buildRuleContext } = require('./ruleContext');
const logger = require('../logger');

class JsonRuleEngine {
  constructor() {
    this.rules = [];
    this.loaded = false;
  }

  async loadRules() {
    if (this.loaded) return;
    const query = 'SELECT * FROM business_rules WHERE active = 1 ORDER BY priority ASC';
    const rows = await new Promise((resolve, reject) => {
      db.query(query, (err, results) => {
        if (err) return reject(err);
        resolve(results);
      });
    });

    this.rules = rows.map(r => ({
      id: r.id,
      ruleCode: r.rule_code,
      description: r.description,
      conditions: typeof r.conditions === 'string' ? JSON.parse(r.conditions) : r.conditions,
      action: r.action, // ALLOW / DENY / REQUIRE_APPROVAL / MODIFY
      priority: r.priority || 100,
      active: !!r.active,
      version: r.version || '1.0'
    }));

    this.loaded = true;
    logger.info(`JsonRuleEngine: loaded ${this.rules.length} rules`);
  }

  flattenContext(obj, prefix = '', res = {}) {
    for (const [k, v] of Object.entries(obj || {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        this.flattenContext(v, p, res);
      } else {
        res[p] = v;
      }
    }
    return res;
  }

  convertConditionToClauses(condition) {

    const clauses = [];

    for (const [key, value] of Object.entries(condition)) {
      if (key === '$or' && Array.isArray(value)) {

        const anyClauses = value.map(sub => this.convertConditionToClauses(sub));
        return { any: anyClauses.map(c => c.all || c.any).flat() };
      }

      if (value && typeof value === 'object' && !Array.isArray(value)) {

        if (value.$or) {
          const any = value.$or.map(sub => this.convertConditionToClauses(sub));
          return { any: any.map(c => c.all || c.any).flat() };
        }

        if (value.$in) {
          clauses.push({ fact: key, operator: 'in', value: value.$in });
          continue;
        }
        if (value.$eq !== undefined) {
          clauses.push({ fact: key, operator: 'equal', value: value.$eq });
          continue;
        }
        if (value.$ne !== undefined) {
          clauses.push({ fact: key, operator: 'notEqual', value: value.$ne });
          continue;
        }
        if (value.$gt !== undefined) {
          clauses.push({ fact: key, operator: 'gt', value: value.$gt });
          continue;
        }
        if (value.$gte !== undefined) {
          clauses.push({ fact: key, operator: 'gte', value: value.$gte });
          continue;
        }
        if (value.$lt !== undefined) {
          clauses.push({ fact: key, operator: 'lt', value: value.$lt });
          continue;
        }
        if (value.$lte !== undefined) {
          clauses.push({ fact: key, operator: 'lte', value: value.$lte });
          continue;
        }
        if (value.$exists !== undefined) {
          clauses.push({ fact: key, operator: 'exists', value: value.$exists });
          continue;
        }

        const nested = this.convertConditionToClauses(value);

        if (nested && nested.all) {

          nested.all.forEach(c => {
            clauses.push({ fact: `${key}.${c.fact}`, operator: c.operator, value: c.value });
          });
          continue;
        }
      } else {

        clauses.push({ fact: key, operator: 'equal', value });
      }
    }

    return { all: clauses };
  }

  async runEngineForRule(rule, facts) {
    const engine = new Engine();

    engine.addOperator('gt', (factVal, jsonVal) => parseFloat(factVal) > parseFloat(jsonVal));
    engine.addOperator('lt', (factVal, jsonVal) => parseFloat(factVal) < parseFloat(jsonVal));
    engine.addOperator('gte', (factVal, jsonVal) => parseFloat(factVal) >= parseFloat(jsonVal));
    engine.addOperator('lte', (factVal, jsonVal) => parseFloat(factVal) <= parseFloat(jsonVal));
    engine.addOperator('in', (factVal, jsonVal) => {
      if (factVal === undefined || factVal === null) return false;
      if (typeof factVal === 'string') {
        return jsonVal.map(v => (typeof v === 'string' ? v.toLowerCase() : v)).includes(factVal.toLowerCase());
      }
      return Array.isArray(jsonVal) ? jsonVal.includes(factVal) : false;
    });
    engine.addOperator('equal', (factVal, jsonVal) => {
      if (factVal === undefined) return false;
      if (Array.isArray(factVal)) {
        return factVal.some(v => {
          if (v === undefined || v === null) return false;
          if (typeof v === 'string' && typeof jsonVal === 'string') {
            const vl = v.toLowerCase();
            const jl = jsonVal.toLowerCase();

            if (vl === jl || vl.includes(jl) || jl.includes(vl) || vl.endsWith(jl) || jl.endsWith(vl)) return true;

            const stripPrefix = s => s.replace(/^post_+|^get_+|^put_+|^patch_+|^delete_+/i, '').replace(/^_+/, '');
            const coreV = stripPrefix(vl);
            const coreJ = stripPrefix(jl);
            return coreV === coreJ || coreV.includes(coreJ) || coreJ.includes(coreV) || coreV.endsWith(coreJ) || coreJ.endsWith(coreV);
          }
          return v === jsonVal;
        });
      }
      if (typeof factVal === 'string' && typeof jsonVal === 'string') {
        const fl = factVal.toLowerCase();
        const jl = jsonVal.toLowerCase();
        if (fl === jl || fl.includes(jl) || jl.includes(fl) || fl.endsWith(jl) || jl.endsWith(fl)) return true;
        const stripPrefix = s => s.replace(/^post_+|^get_+|^put_+|^patch_+|^delete_+/i, '').replace(/^_+/, '');
        const coreF = stripPrefix(fl);
        const coreJ = stripPrefix(jl);
        return coreF === coreJ || coreF.includes(coreJ) || coreJ.includes(coreF) || coreF.endsWith(coreJ) || coreJ.endsWith(coreF);
      }
      return factVal === jsonVal;
    });
    engine.addOperator('notEqual', (factVal, jsonVal) => !engine.operators.equal(factVal, jsonVal));
    engine.addOperator('exists', (factVal, jsonVal) => {
      const exists = factVal !== undefined && factVal !== null;
      return jsonVal === exists;
    });

    const converted = this.convertConditionToClauses(rule.conditions || {});
    const ruleDef = {
      conditions: converted,
      event: { type: rule.action || 'ALLOW', params: { ruleCode: rule.ruleCode, description: rule.description, version: rule.version } },
      priority: rule.priority || 1
    };

    engine.addRule(ruleDef);

    const results = await engine.run(facts);
    return results.events && results.events.length > 0;
  }

  async evaluateFromRules(rulesArray, context) {

    const facts = this.flattenContext(context);

    const sorted = (rulesArray || []).filter(r => r.active).sort((a, b) => (a.priority || 100) - (b.priority || 100));

    for (const rule of sorted) {
      try {
        const matched = await this.runEngineForRule(rule, facts);
        if (matched) {
          const decision = {
            allowed: rule.action === 'ALLOW',
            ruleCode: rule.ruleCode,
            reason: rule.description || 'Matched rule',
            version: rule.version,
            nextAction: rule.action === 'REQUIRE_APPROVAL' ? 'MANAGER_APPROVAL' : null
          };

          setImmediate(() => logger.info('RuleAudit', { ruleCode: rule.ruleCode, version: rule.version, decision: decision.allowed ? 'ALLOWED' : 'DENIED', userId: context.userId, timestamp: new Date().toISOString() }));

          if (rule.action === 'DENY' || rule.action === 'REQUIRE_APPROVAL' || rule.action === 'ALLOW') {
            return decision;
          }
        }
      } catch (e) {
        logger.warn('JsonRuleEngine: rule evaluation failed for ' + rule.ruleCode, e && e.message);
      }
    }

    return { allowed: false, ruleCode: 'NO_RULE_MATCH', reason: 'No matching rule found', nextAction: null };
  }

  async evaluate(req, user, resource = {}, ruleCode = null) {
    if (!this.loaded) await this.loadRules();

    const context = buildRuleContext(req, user, resource);

    let rulesToEvaluate = this.rules;
    if (ruleCode) {
      const byCode = this.rules.filter(r => r.ruleCode === ruleCode);
      if (byCode.length > 0) rulesToEvaluate = byCode;
    }

    const decision = await this.evaluateFromRules(rulesToEvaluate, context);
    return decision;
  }
}

module.exports = new JsonRuleEngine();
