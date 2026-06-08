



const RULES = require('./ruleCodes');
const ruleEngine = require(__root + 'middleware/ruleEngine');

function crudMiddlewares(moduleKey) {

  return {
    create: ruleEngine(RULES[`${moduleKey}_CREATE`]),
    view: ruleEngine(RULES[`${moduleKey}_VIEW`]),
    update: ruleEngine(RULES[`${moduleKey}_UPDATE`]),
    delete: ruleEngine(RULES[`${moduleKey}_DELETE`])
  };
}

module.exports = { crudMiddlewares };
