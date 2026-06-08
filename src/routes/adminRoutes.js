const express = require('express');
const router = express.Router();
const auth = require(__root + 'middleware/auth');
const { allowRoles } = require(__root + 'middleware/role');
const Admin = require(__root + 'controllers/adminController');
const ruleEngine = require(__root + 'rules/jsonRuleEngine');

let logger;
try { logger = require(__root + 'logger'); } catch (e) { try { logger = require('../logger'); } catch (e2) { logger = console; } }

router.use(auth, allowRoles(['Admin', 'SuperAdmin']));

const multer = require('multer');
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.get('/dashboard', Admin.getDashboard);
router.get('/users', Admin.manageUsers);
router.put('/users/:id', Admin.updateUser);
router.delete('/users/:user_id', Admin.deleteUser);
router.get('/managers', Admin.listManagers);
router.get('/clients', Admin.manageClients);
router.get('/departments', Admin.manageDepartments);
router.post('/departments', Admin.createDepartment);
router.put('/departments/:id', Admin.updateDepartment);
router.delete('/departments/:id', Admin.deleteDepartment);
router.get('/projects', Admin.manageProjects);
router.get('/tasks', Admin.manageTasks);
router.get('/settings', Admin.getSettings);
router.put('/settings', Admin.putSettings);
router.post('/settings/logo', upload.single('logo'), Admin.uploadLogo);
router.get('/modules', Admin.getModules);
router.get('/modules/:id', Admin.getModuleById);
router.post('/modules', Admin.createModule);
router.put('/modules/:id', Admin.updateModule);
router.delete('/modules/:id', Admin.deleteModule);
router.post('/rules/reload', async (req, res) => {
	try {

		if (ruleEngine && typeof ruleEngine.loadRules === 'function') {
			ruleEngine.loaded = false;
			await ruleEngine.loadRules();
			return res.json({ success: true, message: 'Rules reloaded', count: ruleEngine.rules ? ruleEngine.rules.length : 0 });
		}
		return res.status(500).json({ success: false, error: 'Rule engine not available' });
	} catch (e) {
		logger.error('Failed reloading rules:', e && e.message);
		return res.status(500).json({ success: false, error: e && e.message });
	}
});

module.exports = router;
