const roleManagementService = require('../services/roleManagementService');
const errorResponse = require('../utils/errorResponse');

module.exports = {
  listRoles: async (req, res) => {
    try {
      const data = await roleManagementService.listRoles(req.user.tenant_id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  },

  getRole: async (req, res) => {
    try {
      const data = await roleManagementService.getRoleById(req.user.tenant_id, req.params.id);
      if (!data) return res.status(404).json(errorResponse.notFound('Role not found', 'NOT_FOUND'));
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  },

  createRole: async (req, res) => {
    try {
      const data = await roleManagementService.createRole(req.user.tenant_id, req.body, req.user._id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      res.status(400).json(errorResponse.badRequest(error.message, 'ROLE_CREATE_FAILED'));
    }
  },

  updateRole: async (req, res) => {
    try {
      const data = await roleManagementService.updateRole(req.user.tenant_id, req.params.id, req.body, req.user._id);
      res.json({ success: true, data });
    } catch (error) {
      const status = error.message.includes('not found') ? 404 : 400;
      res.status(status).json(errorResponse.badRequest(error.message, 'ROLE_UPDATE_FAILED'));
    }
  },

  deleteRole: async (req, res) => {
    try {
      const data = await roleManagementService.deleteRole(req.user.tenant_id, req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      const status = error.message.includes('not found') ? 404 : 400;
      res.status(status).json(errorResponse.badRequest(error.message, 'ROLE_DELETE_FAILED'));
    }
  },

  listPermissions: async (req, res) => {
    try {
      const data = await roleManagementService.listPermissions(req.user.tenant_id);
      res.json({ success: true, data });
    } catch (error) {
      res.status(500).json(errorResponse.serverError('Operation failed', 'SERVER_ERROR', { details: error.message }));
    }
  }
};
