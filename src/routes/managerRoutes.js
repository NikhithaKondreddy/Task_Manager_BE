const express = require('express');
const router = express.Router();
const auth = require(__root + 'middleware/auth');
const { allowRoles } = require(__root + 'middleware/role');
const Manager = require(__root + 'controllers/managerController');
const Admin = require(__root + 'controllers/adminController');

router.use(auth, allowRoles(['Manager', 'Admin', 'SuperAdmin']));

router.get('/dashboard', Manager.getManagerDashboard);
router.get('/overview', Manager.getManagerOverview);
router.get('/clients', Manager.getAssignedClients);
router.get('/projects', Manager.getAssignedProjects);
router.get('/users', Manager.listUsers);
router.get('/departments', Admin.manageDepartments);
router.get('/timeline', Manager.getTaskTimeline);
router.get('/tasks', Manager.getTaskTimeline);
router.get('/employees', Manager.getDepartmentEmployees);
router.get('/employees/all', Manager.listEmployees);

router.get('/settings', Manager.getSettings);
router.put('/settings', Manager.putSettings);

module.exports = router;
