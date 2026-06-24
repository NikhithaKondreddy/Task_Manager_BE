


const db = require('../config/db');
const { buildRuleContext } = require('./ruleContext');
const { evaluateRules } = require('./ruleEvaluator');
const logger = require('../logger');

class RuleEngine {
  constructor() {
    this.rules = [];
    this.loaded = false;
  }

  async loadRules() {
    if (this.loaded) return;

    try {
      const query = 'SELECT * FROM business_rules WHERE active = 1 ORDER BY priority ASC';
      const rows = await new Promise((resolve, reject) => {
        db.query(query, (err, results) => {
          if (err) reject(err);
          else resolve(results);
        });
      });

      this.rules = rows.map(row => ({
        ruleCode: row.rule_code,
        description: row.description,
        conditions: JSON.parse(row.conditions),
        action: row.action,
        priority: row.priority,
        active: row.active,
        version: row.version
      }));

      this.loaded = true;
      logger.info('Rule Engine: Loaded ' + this.rules.length + ' rules from database');
    } catch (error) {
      logger.error('Rule Engine: Failed to load rules from database', error);
      throw error;
    }
  }

  async evaluate(req, user, resource = {}, ruleCode = null) {
    if (!this.loaded) {
      await this.loadRules();
    }

    const context = buildRuleContext(req, user, resource);

    let rulesToEvaluate = this.rules;
    if (ruleCode) {
      rulesToEvaluate = this.rules.filter(rule => rule.ruleCode === ruleCode);
      if (rulesToEvaluate.length === 0) {
        rulesToEvaluate = this.rules;
      }
    }

    console.log('[RuleEngine] Evaluating with context:', JSON.stringify(context, null, 2));

    const decision = evaluateRules(rulesToEvaluate, context);

    logger.info('Rule Evaluation', {
      userId: context.userId,
      ruleCode: decision.ruleCode,
      decision: decision.allowed ? 'ALLOWED' : 'DENIED',
      reason: decision.reason,
      timestamp: context.timestamp
    });

    return decision;
  }

  async addRule(rule) {

    const requiredFields = ['ruleCode', 'description', 'conditions', 'action', 'priority', 'active', 'version'];
    for (const field of requiredFields) {
      if (!(field in rule)) {
        throw new Error(`Rule missing required field: ${field}`);
      }
    }

    const query = `
      INSERT INTO business_rules (rule_code, description, conditions, action, priority, active, version)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      description = VALUES(description),
      conditions = VALUES(conditions),
      action = VALUES(action),
      priority = VALUES(priority),
      active = VALUES(active),
      version = VALUES(version),
      updated_at = CURRENT_TIMESTAMP
    `;

    await new Promise((resolve, reject) => {
      db.query(query, [
        rule.ruleCode,
        rule.description,
        JSON.stringify(rule.conditions),
        rule.action,
        rule.priority,
        rule.active,
        rule.version
      ], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    this.loaded = false;
    await this.loadRules();
  }

  async getActiveRules() {
    if (!this.loaded) {
      await this.loadRules();
    }
    return this.rules;
  }
}

const ruleEngineInstance = new RuleEngine();

module.exports = ruleEngineInstance;