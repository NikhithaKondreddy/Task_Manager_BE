const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const engineerMappingService = require('../services/engineerMappingService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const listMappings = asyncHandler(async (req, res) => {
  const data = await engineerMappingService.listMappings(req.user.tenant_id, req.query);
  res.json({ success: true, message: 'Engineer mappings fetched', data });
});

const createMapping = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await engineerMappingService.createMapping(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, message: 'Engineer mapping created', data });
});

const updateMapping = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await engineerMappingService.updateMapping(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'Engineer mapping updated', data });
});

const deleteMapping = asyncHandler(async (req, res) => {
  const data = await engineerMappingService.deleteMapping(req.user.tenant_id, req.params.id, req.user);
  res.json({ success: true, message: 'Engineer mapping deleted', data });
});

module.exports = {
  listMappings,
  createMapping,
  updateMapping,
  deleteMapping,
};
