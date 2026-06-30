const express = require('express');
const router = express.Router();

router.use('/dashboard', require('./dashboard'));
router.use('/projects', require('./projects'));
router.use('/tasks', require('./tasks'));
router.use('/task-execution', require('./taskExecution'));
router.use('/recurring-tasks', require('./recurringTasks'));
router.use('/gemba-walks', require('./gembaWalks'));
router.use('/gemba-execution', require('./gembaExecution'));
router.use('/approvals', require('./approvals'));
router.use('/photos', require('./photos'));
router.use('/reports', require('./reports'));
router.use('/audit-logs', require('./auditLogs'));
router.use('/users', require('./users'));

module.exports = router;
