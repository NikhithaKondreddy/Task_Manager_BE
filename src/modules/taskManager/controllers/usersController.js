const { success } = require('../../../utils/response');
const userRepo = require('../repos/userRepo');

async function assignable(req, res) {
  const users = await userRepo.getAssignable(req.user.tenant_id);
  return success(res, users);
}

async function team(req, res) {
  const users = await userRepo.getTeam(req.user._id, req.user.tenant_id);
  return success(res, users);
}

module.exports = { assignable, team };
