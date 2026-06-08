const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const slaService = require('../services/slaService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const listPolicies = asyncHandler(async (req, res) => {
  const data = await slaService.listPolicies(req.user.tenant_id);
  res.json({ success: true, message: 'SLA policies fetched', data });
});

const getPolicy = asyncHandler(async (req, res) => {
  const data = await slaService.getPolicyById(req.user.tenant_id, req.params.id);
  if (!data) throw new HttpError(404, 'SLA policy not found', 'SLA_POLICY_NOT_FOUND');
  res.json({ success: true, message: 'SLA policy fetched', data });
});

const createPolicy = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await slaService.createPolicy(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, message: 'SLA policy created', data });
});

const updatePolicy = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await slaService.updatePolicy(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'SLA policy updated', data });
});

const deletePolicy = asyncHandler(async (req, res) => {
  const data = await slaService.deletePolicy(req.user.tenant_id, req.params.id, req.user);
  res.json({ success: true, message: 'SLA policy deleted', data });
});

module.exports = {
  listPolicies,
  getPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
};
