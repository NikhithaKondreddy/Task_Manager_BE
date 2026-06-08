const masterDataService = require('../services/masterDataService');
const errorResponse = require('../utils/errorResponse');

function handleError(res, error, code) {
  const status = error.message && error.message.includes('not found') ? 404 : 400;
  res.status(status).json(errorResponse.badRequest(error.message, code));
}

module.exports = {
  listStates: async (req, res) => {
    try {
      const data = await masterDataService.listStates(req.user.tenant_id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  },
  createState: async (req, res) => {
    try {
      const data = await masterDataService.createState(req.user.tenant_id, req.body, req.user._id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'STATE_CREATE_FAILED');
    }
  },
  updateState: async (req, res) => {
    try {
      const data = await masterDataService.updateState(req.user.tenant_id, req.params.id, req.body, req.user._id);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'STATE_UPDATE_FAILED');
    }
  },
  deleteState: async (req, res) => {
    try {
      const data = await masterDataService.deleteState(req.user.tenant_id, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'STATE_DELETE_FAILED');
    }
  },

  listRegions: async (req, res) => {
    try {
      const data = await masterDataService.listRegions(req.user.tenant_id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  },
  createRegion: async (req, res) => {
    try {
      const data = await masterDataService.createRegion(req.user.tenant_id, req.body, req.user._id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'REGION_CREATE_FAILED');
    }
  },
  updateRegion: async (req, res) => {
    try {
      const data = await masterDataService.updateRegion(req.user.tenant_id, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'REGION_UPDATE_FAILED');
    }
  },
  deleteRegion: async (req, res) => {
    try {
      const data = await masterDataService.deleteRegion(req.user.tenant_id, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'REGION_DELETE_FAILED');
    }
  },

  listClusters: async (req, res) => {
    try {
      const data = await masterDataService.listClusters(req.user.tenant_id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  },
  createCluster: async (req, res) => {
    try {
      const data = await masterDataService.createCluster(req.user.tenant_id, req.body, req.user._id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'CLUSTER_CREATE_FAILED');
    }
  },
  updateCluster: async (req, res) => {
    try {
      const data = await masterDataService.updateCluster(req.user.tenant_id, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'CLUSTER_UPDATE_FAILED');
    }
  },
  deleteCluster: async (req, res) => {
    try {
      const data = await masterDataService.deleteCluster(req.user.tenant_id, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'CLUSTER_DELETE_FAILED');
    }
  },

  listBranches: async (req, res) => {
    try {
      const data = await masterDataService.listBranches(req.user.tenant_id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  },
  createBranch: async (req, res) => {
    try {
      const data = await masterDataService.createBranch(req.user.tenant_id, req.body, req.user._id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'BRANCH_CREATE_FAILED');
    }
  },
  updateBranch: async (req, res) => {
    try {
      const data = await masterDataService.updateBranch(req.user.tenant_id, req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'BRANCH_UPDATE_FAILED');
    }
  },
  deleteBranch: async (req, res) => {
    try {
      const data = await masterDataService.deleteBranch(req.user.tenant_id, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      handleError(res, error, 'BRANCH_DELETE_FAILED');
    }
  }
};
