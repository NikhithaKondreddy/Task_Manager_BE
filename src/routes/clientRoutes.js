const express = require('express');
const router = express.Router();
const clientViewerAccessControl = require(__root + 'middleware/clientViewerAccess');
const ClientsApi = require(__root + 'controllers/ClientsApi');

const DocumentController = require(__root + 'controllers/documentController');
const ruleEngine = require(__root + 'middleware/ruleEngine');

const { requireAuth } = require(__root + 'middleware/roles');

router.use(requireAuth);
router.use(clientViewerAccessControl);
router.post('/:clientId/documents', ruleEngine('DOCUMENT_UPLOAD'), DocumentController.uploadDocument);
router.get('/:clientId/documents', ruleEngine('DOCUMENT_VIEW'), DocumentController.getClientDocuments);
router.use('/', ClientsApi);

module.exports = router;
