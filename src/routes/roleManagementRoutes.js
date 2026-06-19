const express = require('express');
const router = express.Router();
const roleManagementController = require('../controllers/roleManagementController');
const { requireAuth, requireRole } = require('../middleware/roles');

// Apply role checks per-route. Allow `IT Admin` to create IT-related roles.
router.get('/roles', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.listRoles);
router.post('/roles', requireAuth, requireRole(['Admin', 'SuperAdmin', 'IT Admin', 'Central IT Admin']), roleManagementController.createRole);
router.get('/roles/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.getRole);
router.put('/roles/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.updateRole);
router.delete('/roles/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.deleteRole);

// Permission CRUD
router.post('/permissions', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.createPermission);
router.get('/permissions', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.listPermissions);
router.get('/permissions/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.getPermission);
router.put('/permissions/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.updatePermission);
router.delete('/permissions/:id', requireAuth, requireRole(['Admin', 'SuperAdmin']), roleManagementController.deletePermission);

module.exports = router;
