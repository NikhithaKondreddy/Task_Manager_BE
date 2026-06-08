const express = require('express');
const router = express.Router();

const auth = require(__root + 'middleware/auth');
const ruleEngine = require(__root + 'middleware/ruleEngine');
const DocumentController = require(__root + 'controllers/documentController');

router.use(auth);

router.use(ruleEngine('DOCUMENT_VIEW'));

router.post('/upload', ruleEngine('DOCUMENT_UPLOAD'), DocumentController.uploadDocument);

// New endpoint: upload document for a project (employee/manager only)
router.post('/upload-for-project', DocumentController.uploadForProject);

router.get('/', DocumentController.listDocuments);

// Consolidated Delete
router.delete('/:documentId', ruleEngine('DOCUMENT_DELETE'), DocumentController.deleteDocument);

// Previews
router.get('/:id/preview', ruleEngine('DOCUMENT_PREVIEW'), DocumentController.getDocumentPreview);
router.get('/:id/download', ruleEngine('DOCUMENT_DOWNLOAD'), DocumentController.downloadDocument);

// Legacy/Compat
router.get('/my', DocumentController.getMyDocuments);
router.post('/access', ruleEngine('DOCUMENT_ASSIGN_ACCESS'), DocumentController.assignDocumentAccess);

module.exports = router;