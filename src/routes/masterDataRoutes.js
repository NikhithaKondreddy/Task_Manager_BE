const express = require('express');
const router = express.Router();
const masterDataController = require('../controllers/masterDataController');
const { requireAuth, requireRole } = require('../middleware/roles');

router.use(requireAuth);
router.use(requireRole(['Admin', 'Manager', 'SuperAdmin']));

router.get('/states', masterDataController.listStates);
router.post('/states', masterDataController.createState);
router.put('/states/:id', masterDataController.updateState);
router.delete('/states/:id', masterDataController.deleteState);

router.get('/regions', masterDataController.listRegions);
router.post('/regions', masterDataController.createRegion);
router.put('/regions/:id', masterDataController.updateRegion);
router.delete('/regions/:id', masterDataController.deleteRegion);

router.get('/clusters', masterDataController.listClusters);
router.post('/clusters', masterDataController.createCluster);
router.put('/clusters/:id', masterDataController.updateCluster);
router.delete('/clusters/:id', masterDataController.deleteCluster);

router.get('/branches', masterDataController.listBranches);
router.post('/branches', masterDataController.createBranch);
router.put('/branches/:id', masterDataController.updateBranch);
router.delete('/branches/:id', masterDataController.deleteBranch);

module.exports = router;
