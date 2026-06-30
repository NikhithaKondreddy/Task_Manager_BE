const HttpError = require('../../../errors/HttpError');
const { success } = require('../../../utils/response');
const { normalizeRole } = require('../../../config/rbac');
const { getManagerTeamUserIds } = require('../utils/teamScope');
const approvalRepo = require('../repos/approvalRepo');
const completionService = require('../services/completionService');

async function approverScope(req) {
  const role = normalizeRole(req.user.role);
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return null;
  if (role === 'MANAGER') {
    const teamIds = await getManagerTeamUserIds(req.user._id, req.user.tenant_id);
    return [...new Set([...teamIds, req.user._id])];
  }
  throw new HttpError(403, 'Insufficient role', 'AUTH_FORBIDDEN');
}

async function list(req, res) {
  const scope = await approverScope(req);
  const result = await approvalRepo.list(req.user.tenant_id, req.query, scope);
  return success(res, result);
}

async function getOne(req, res) {
  const approval = await approvalRepo.findById(req.params.id, req.user.tenant_id);
  if (!approval) throw new HttpError(404, 'Approval not found', 'NOT_FOUND');
  return success(res, approval);
}

async function approve(req, res) {
  const result = await completionService.decideApproval({ req, approvalId: req.params.id, decision: 'approve' });
  return success(res, result, 'Approved');
}

async function reject(req, res) {
  if (!req.body.reason) throw new HttpError(400, 'reason is required', 'VALIDATION_ERROR');
  const result = await completionService.decideApproval({ req, approvalId: req.params.id, decision: 'reject', reason: req.body.reason });
  return success(res, result, 'Rejected');
}

module.exports = { list, getOne, approve, reject };
