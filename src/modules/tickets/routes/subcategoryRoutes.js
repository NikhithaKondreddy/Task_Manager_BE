const express = require('express');
const { body, param } = require('express-validator');
const subcategoryController = require('../controllers/subcategoryController');
const { requireTicketCatalogManagementAccess } = require('../middleware/ticketPermissions');

const router = express.Router();

router.post(
  '/',
  requireTicketCatalogManagementAccess,
  [
    body('categoryId').optional().isInt({ min: 1 }),
    body('name').optional().isString().trim(),
  ],
  subcategoryController.createSubcategory
);

router.put(
  '/:id',
  requireTicketCatalogManagementAccess,
  [param('id').isInt({ min: 1 })],
  subcategoryController.updateSubcategory
);

router.delete(
  '/:id',
  requireTicketCatalogManagementAccess,
  [param('id').isInt({ min: 1 })],
  subcategoryController.deleteSubcategory
);

module.exports = router;
