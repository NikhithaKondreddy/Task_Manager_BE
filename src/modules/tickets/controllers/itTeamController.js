const { validationResult } = require('express-validator');
const HttpError = require('../../../errors/HttpError');
const { asyncHandler } = require('../../../utils/asyncHandler');
const itTeamService = require('../services/itTeamService');

function assertValidRequest(req) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new HttpError(400, 'Validation failed', 'VALIDATION_ERROR', errors.array());
  }
}

const listTeams = asyncHandler(async (req, res) => {
  const data = await itTeamService.listTeams(req.user.tenant_id, req.query);
  res.json({ success: true, message: 'IT teams fetched', data });
});

const getTeam = asyncHandler(async (req, res) => {
  const data = await itTeamService.getTeamById(req.user.tenant_id, req.params.id);
  if (!data) throw new HttpError(404, 'Team not found', 'TEAM_NOT_FOUND');
  res.json({ success: true, message: 'IT team fetched', data });
});

const createTeam = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await itTeamService.createTeam(req.user.tenant_id, req.body, req.user);
  res.status(201).json({ success: true, message: 'IT team created', data });
});

const updateTeam = asyncHandler(async (req, res) => {
  assertValidRequest(req);
  const data = await itTeamService.updateTeam(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'IT team updated', data });
});

const deleteTeam = asyncHandler(async (req, res) => {
  const data = await itTeamService.deleteTeam(req.user.tenant_id, req.params.id, req.user);
  res.json({ success: true, message: 'IT team deleted', data });
});

const listMembers = asyncHandler(async (req, res) => {
  const data = await itTeamService.listMembers(req.user.tenant_id, req.params.id);
  res.json({ success: true, message: 'Team members fetched', data });
});

const addMembers = asyncHandler(async (req, res) => {
  const data = await itTeamService.addMembers(req.user.tenant_id, req.params.id, req.body, req.user);
  res.status(201).json({ success: true, message: 'Team members added', data });
});

const removeMember = asyncHandler(async (req, res) => {
  const data = await itTeamService.removeMember(req.user.tenant_id, req.params.id, req.params.userId, req.user);
  res.json({ success: true, message: 'Team member removed', data });
});

const updateTeamLead = asyncHandler(async (req, res) => {
  const data = await itTeamService.updateTeamLead(req.user.tenant_id, req.params.id, req.body, req.user);
  res.json({ success: true, message: 'Team lead updated', data });
});

module.exports = {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  listMembers,
  addMembers,
  removeMember,
  updateTeamLead,
};
