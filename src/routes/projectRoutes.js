const express = require('express');
const router = express.Router();
const { requireAuth } = require(__root + 'middleware/roles');
const ProjectsRouter = require(__root + 'controllers/Projects');
const TasksRouter = require(__root + 'controllers/Tasks');
const SubtasksRouter = require(__root + 'controllers/Subtasks');
const DocumentController = require(__root + 'controllers/documentController');
const ruleEngine = require(__root + 'middleware/ruleEngine');

router.use(requireAuth);
router.use('/tasks', TasksRouter);
router.use('/subtasks', SubtasksRouter);

// Document Routes
router.put('/:projectId/documents', ruleEngine('DOCUMENT_UPLOAD'), DocumentController.uploadDocument);
router.post('/:projectId/documents', ruleEngine('DOCUMENT_UPLOAD'), DocumentController.uploadDocument); // Support POST too
router.get('/:projectId/documents', ruleEngine('DOCUMENT_VIEW'), DocumentController.getProjectDocuments);

router.use('/', ProjectsRouter);

module.exports = router;