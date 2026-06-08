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

const listCategories = asyncHandler(async (req, res) => {
  const data = await categoryService.listCategories(req.user.tenant_id, req.query);
  res.json({ success: true, message: 'Categories fetched', data });
});

const createCategory = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await categoryService.createCategory(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, message: 'Category created', data });
});

const getCategory = asyncHandler(async (req, res) => {
  const data = await categoryService.getCategoryById(req.user.tenant_id, req.params.id);
  if (!data) throw new HttpError(404, 'Category not found', 'CATEGORY_NOT_FOUND');
  res.json({ success: true, message: 'Category fetched', data });
});

const listSubcategories = asyncHandler(async (req, res) => {
  const data = await categoryService.listSubcategories(req.user.tenant_id, req.params.id);
  res.json({ success: true, message: 'Subcategories fetched', data });
});

const updateCategory = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await categoryService.updateCategory(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'Category updated', data });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const data = await categoryService.deleteCategory(req.user.tenant_id, req.params.id, req.user);
  res.json({ success: true, message: 'Category deleted', data });
});

module.exports = {
  listCategories,
  getCategory,
  listSubcategories,
  createCategory,
  updateCategory,
  deleteCategory,
};
