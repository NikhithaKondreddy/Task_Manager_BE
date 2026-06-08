const express = require('express');
const router = express.Router();
const roleManagementController = require('../controllers/roleManagementController');
const { requireAuth, requireRole } = require('../middleware/roles');

router.use(requireAuth);
router.use(requireRole(['Admin', 'SuperAdmin']));

router.get('/roles', roleManagementController.listRoles);
router.post('/roles', roleManagementController.createRole);
router.get('/roles/:id', roleManagementController.getRole);
router.put('/roles/:id', roleManagementController.updateRole);
router.delete('/roles/:id', roleManagementController.deleteRole);

router.get('/permissions', roleManagementController.listPermissions);

module.exports = router;
