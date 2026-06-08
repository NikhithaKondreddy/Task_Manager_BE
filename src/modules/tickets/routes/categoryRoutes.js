const express = require('express');
const { body, param } = require('express-validator');
const categoryController = require('../controllers/categoryController');
const { requireTicketViewAccess, requireTicketCatalogManagementAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.get('/', requireTicketViewAccess, categoryController.listCategories);

router.get(
  '/:id',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 })],
  categoryController.getCategory
);

router.get(
  '/:id/subcategories',
  requireTicketViewAccess,
  [param('id').isInt({ min: 1 })],
  categoryController.listSubcategories
);

router.post(
  '/',
  requireTicketCatalogManagementAccess,
  [
    body('categoryName').optional().isString().trim(),
    body('category_name').optional().isString().trim(),
  ],
  categoryController.createCategory
);

router.put(
  '/:id',
  requireTicketCatalogManagementAccess,
  [param('id').isInt({ min: 1 })],
  categoryController.updateCategory
);

router.delete(
  '/:id',
  requireTicketCatalogManagementAccess,
  [param('id').isInt({ min: 1 })],
  categoryController.deleteCategory
);

module.exports = router;
