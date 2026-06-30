const { success } = require('../../../utils/response');
const auditRepo = require('../repos/auditRepo');

async function list(req, res) {
  const result = await auditRepo.list(req.user.tenant_id, req.query);
  return success(res, result);
}

module.exports = { list };
