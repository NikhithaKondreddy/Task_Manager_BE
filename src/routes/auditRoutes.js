const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require(__root + 'middleware/roles');
const auditController = require(__root + 'controllers/auditController');
const adminRouter = express.Router();
adminRouter.get('/audit-logs', requireAuth, requireRole(['Admin', 'Audit', 'SuperAdmin']), auditController.admin);
adminRouter.delete('/audit-logs', requireAuth, requireRole(['Admin', 'SuperAdmin']), auditController.delete);
adminRouter.get('/audit-logs/cleanup-stats', requireAuth, requireRole(['Admin', 'SuperAdmin']), auditController.getCleanupStats);
adminRouter.post('/audit-logs/cleanup', requireAuth, requireRole(['Admin', 'SuperAdmin']), auditController.cleanup);
const managerRouter = express.Router();
managerRouter.get('/audit-logs', requireAuth, requireRole(['Manager', 'Admin', 'Audit', 'SuperAdmin']), auditController.manager);
const employeeRouter = express.Router();
employeeRouter.get('/audit-logs', requireAuth, requireRole(['Employee', 'Manager', 'Admin', 'Audit', 'SuperAdmin']), auditController.employee);

module.exports = { admin: adminRouter, manager: managerRouter, employee: employeeRouter };
