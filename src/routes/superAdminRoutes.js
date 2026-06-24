const express = require('express');
const router = express.Router();
const auth = require(__root + 'middleware/auth');
const { allowRoles } = require(__root + 'middleware/role');
const superAdmin = require(__root + 'controllers/superAdminController');

// All routes require authentication + SuperAdmin role
router.use(auth, allowRoles('SuperAdmin'));

// Platform Dashboard
router.get('/dashboard', superAdmin.getDashboard);

// Tenant CRUD (Expose only list for now)
router.get('/tenants', superAdmin.listTenants);

// Admin CRUD
router.post('/admins', superAdmin.createAdmin);
router.get('/admins', superAdmin.listAdmins);
router.get('/admins/:id', superAdmin.getAdmin);
router.put('/admins/:id', superAdmin.updateAdmin);
router.delete('/admins/:id', superAdmin.deleteAdmin);

// Admin module management
router.get('/admins/:id/modules', superAdmin.getAdminModules);
router.put('/admins/:id/modules', superAdmin.updateAdminModules);

// IT Support User Management
router.post('/it-support-users', superAdmin.createITSupportUser);
router.get('/it-support-users', superAdmin.listITSupportUsers);
router.get('/it-support-users/:id', superAdmin.getITSupportUser);
router.put('/it-support-users/:id', superAdmin.updateITSupportUser);
router.delete('/it-support-users/:id', superAdmin.deleteITSupportUser);

// Settings
router.get('/settings', superAdmin.getSettings);
router.put('/settings', superAdmin.updateSettings);

// Audit logs
router.get('/audit-logs', require('../controllers/auditController').admin);

module.exports = router;
