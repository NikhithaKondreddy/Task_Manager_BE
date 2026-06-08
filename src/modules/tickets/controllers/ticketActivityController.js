const { asyncHandler } = require('../../../utils/asyncHandler');
const ticketActivityService = require('../services/ticketActivityService');

const getHistory = asyncHandler(async (req, res) => {
  const data = await ticketActivityService.listHistory(req.user.tenant_id, req.params.ticketId);
  res.json({ success: true, message: 'Ticket history fetched', data });
});

module.exports = {
  getHistory,
};
