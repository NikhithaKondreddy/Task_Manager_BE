const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const categoryService = require('../services/categoryService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const createSubcategory = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await categoryService.createSubcategory(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, message: 'Subcategory created', data });
});

const updateSubcategory = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await categoryService.updateSubcategory(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'Subcategory updated', data });
});

const deleteSubcategory = asyncHandler(async (req, res) => {
  const data = await categoryService.deleteSubcategory(req.user.tenant_id, req.params.id);
  res.json({ success: true, message: 'Subcategory deleted', data });
});

module.exports = {
  createSubcategory,
  updateSubcategory,
  deleteSubcategory,
};
