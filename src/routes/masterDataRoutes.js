const express = require('express');
const router = express.Router();
const masterDataController = require('../controllers/masterDataController');
const { requireAuth, requireRole } = require('../middleware/roles');

// Read-only: any authenticated user can fetch location data (needed for ticket creation form)
const readOnly = [requireAuth];
// Write: restricted strictly to IT Admin & SuperAdmin
const writeOnly = [
  requireAuth,
  (req, res, next) => {
    const role = req.user.normalized_role;
    if (role === 'IT_ADMIN' || role === 'SUPER_ADMIN') {
      return next();
    }
    const HttpError = require('../errors/HttpError');
    return next(new HttpError(403, 'Insufficient role', 'AUTH_FORBIDDEN'));
  }
];

router.get('/states', readOnly, masterDataController.listStates);
router.post('/states', writeOnly, masterDataController.createState);
router.put('/states/:id', writeOnly, masterDataController.updateState);
router.delete('/states/:id', writeOnly, masterDataController.deleteState);

router.get('/regions', readOnly, masterDataController.listRegions);
router.post('/regions', writeOnly, masterDataController.createRegion);
router.put('/regions/:id', writeOnly, masterDataController.updateRegion);
router.delete('/regions/:id', writeOnly, masterDataController.deleteRegion);

router.get('/clusters', readOnly, masterDataController.listClusters);
router.post('/clusters', writeOnly, masterDataController.createCluster);
router.put('/clusters/:id', writeOnly, masterDataController.updateCluster);
router.delete('/clusters/:id', writeOnly, masterDataController.deleteCluster);

router.get('/branches', readOnly, masterDataController.listBranches);
router.post('/branches', writeOnly, masterDataController.createBranch);
router.put('/branches/:id', writeOnly, masterDataController.updateBranch);
router.delete('/branches/:id', writeOnly, masterDataController.deleteBranch);

module.exports = router;
