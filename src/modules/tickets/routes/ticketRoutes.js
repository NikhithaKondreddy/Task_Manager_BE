const express = require('express');
const { body, param, query } = require('express-validator');
const upload = require('../../../multer');
const ticketController = require('../controllers/ticketController');
const ticketAssignmentController = require('../controllers/ticketAssignmentController');
const escalationController = require('../controllers/escalationController');
const approvalWorkflowController = require('../controllers/approvalWorkflowController');
const ticketActivityController = require('../controllers/ticketActivityController');
const feedbackController = require('../controllers/feedbackController');
const {
  requireTicketCreateAccess,
  requireTicketViewAccess,
  requireTicketManagementAccess,
  requireTicketCommentAccess,
  requireTicketReportAccess,
  requireTicketAssignAccess,
} = require('../middleware/ticketPermissions');

const router = express.Router();

function toMySqlDateTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

router.get('/session', requireTicketViewAccess, ticketController.getSession);

router.get('/dashboard', requireTicketViewAccess, ticketController.getDashboard);

router.get(
  '/drafts',
  requireTicketCreateAccess,
  ticketController.listDrafts
);

router.post(
  '/draft',
  upload.any(),
  requireTicketCreateAccess,
  [
    body('subject').optional().isString().trim(),
    body('title').optional().isString().trim(),
    body('requesterEmail').optional().isEmail(),
  ],
  ticketController.createDraft
);

router.put(
  '/draft/:id',
  upload.any(),
  requireTicketCreateAccess,
  [param('id').isString().trim().isLength({ min: 1 })],
  ticketController.updateDraft
);

router.delete(
  '/draft/:id',
  requireTicketCreateAccess,
  [param('id').isString().trim().isLength({ min: 1 })],
  ticketController.deleteDraft
);

router.get(
  '/reports/:type',
  requireTicketReportAccess,
  [param('type').isString().trim().isLength({ min: 1 })],
  ticketController.getReport
);

router.get(
  '/escalations',
  requireTicketViewAccess,
  [query('ticketId').optional().isString().trim(), query('status').optional().isString().trim()],
  escalationController.listEscalations
);

router.get(
  '/assignees/it-support',
  requireTicketViewAccess,
  ticketController.getITSupportAssignees
);

router.post(
  '/:ticketId/assign',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.assignTicket
);

router.post(
  '/:ticketId/reassign',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.reassignTicket
);

router.post(
  '/:ticketId/assign-team',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.assignTicket
);

router.post(
  '/:ticketId/assign-engineer',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.reassignTicket
);

router.post(
  '/:ticketId/unassign',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.unassignTicket
);

router.post(
  '/:ticketId/accept',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.acceptTicket
);

router.post(
  '/:ticketId/reject',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketAssignmentController.rejectTicket
);

router.post(
  '/:ticketId/escalate',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  escalationController.escalateTicket
);

router.post(
  '/',
  upload.any(),
  requireTicketCreateAccess,
  [
    body('subject').optional().isString().trim(),
    body('title').optional().isString().trim(),
    body(['description', 'body']).optional().isString().trim(),
    body(['requesterEmail', 'requester_email']).optional().isEmail().normalizeEmail(),
    body('requestedFor').optional().isString().trim(),
    body('priority').optional().isString().trim(),
    body('status').optional().isString().trim(),
  ],
  ticketController.createTicket
);

router.get(
  '/',
  requireTicketViewAccess,
  [
    query('status').optional(),
    query('priority').optional(),
    query('search').optional().isString().trim(),
    query('limit').optional().isInt({ min: 1, max: 200 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  ticketController.listTickets
);

router.get('/doc', requireTicketViewAccess, (req, res) => {
  return res.json({
    success: true,
    message: 'Ticket API documentation mapping',
    data: {
      basePath: '/api/tickets',
      note: 'Compatibility endpoint for legacy Postman collection',
    },
  });
});

router.get(
  '/:id',
  requireTicketViewAccess,
  [param('id').isString().trim().isLength({ min: 1 })],
  ticketController.getTicket
);

router.get(
  '/:ticketId/comments',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.listComments
);

router.put(
  '/comments/:commentId',
  requireTicketCommentAccess,
  [param('commentId').isInt({ min: 1 })],
  ticketController.updateComment
);

router.delete(
  '/comments/:commentId',
  requireTicketCommentAccess,
  [param('commentId').isInt({ min: 1 })],
  ticketController.deleteComment
);

router.get(
  '/:ticketId/attachments',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.listAttachments
);

router.get(
  '/:ticketId/feedback',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  feedbackController.getTicketFeedback
);

router.post(
  '/:ticketId/feedback',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 }), body('rating').isInt({ min: 1, max: 5 })],
  feedbackController.submitTicketFeedback
);

router.post(
  '/:ticketId/attachments',
  upload.any(),
  requireTicketCommentAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.addAttachment
);

router.delete(
  '/:ticketId/attachments/:attachmentId',
  requireTicketCommentAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 }), param('attachmentId').isInt({ min: 1 })],
  ticketController.deleteAttachment
);

router.get(
  '/:ticketId/history',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketActivityController.getHistory
);

router.get(
  '/:ticketId/watchers',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.listWatchers
);

router.post(
  '/:ticketId/watchers',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.addWatcher
);

router.delete(
  '/:ticketId/watchers/:userId',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 }), param('userId').isString().trim().isLength({ min: 1 })],
  ticketController.removeWatcher
);

router.get(
  '/:ticketId/sla',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.getTicketSla
);

router.put(
  '/:ticketId/sla',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketController.updateTicketSla
);

router.put(
  '/:id',
  requireTicketManagementAccess,
  [param('id').isString().trim().isLength({ min: 1 })],
  ticketController.updateTicket
);

router.post(
  '/:ticketId/approve',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.approveTicket
);

router.post(
  '/:ticketId/reject',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.rejectTicket
);

router.get(
  '/:ticketId/approvals',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.listApprovals
);

router.post(
  '/:ticketId/request-approval',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.requestApproval
);

router.post(
  '/:ticketId/request-closure',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.requestClosure
);

router.post(
  '/:ticketId/approve-closure',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.approveClosure
);

router.post(
  '/:ticketId/reject-closure',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.rejectClosure
);

router.get(
  '/:ticketId/escalations',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => {
    req.query.ticketId = req.params.ticketId;
    return escalationController.listEscalations(req, res, next);
  }
);

router.post(
  '/:ticketId/open',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'OPEN'; return ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/in-progress',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'IN_PROGRESS'; return ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/on-hold',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'ON_HOLD'; return ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/resolved',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'RESOLVED'; return ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/resolve',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'RESOLVED'; return ticketController.resolveTicket ? ticketController.resolveTicket(req, res, next) : ticketController.setTicketStatus(req, res, next); }
);

router.put(
  '/:ticketId/resolve',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'RESOLVED'; return ticketController.resolveTicket ? ticketController.resolveTicket(req, res, next) : ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/closed',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'CLOSED'; return ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/close',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'CLOSED'; return ticketController.closeTicket ? ticketController.closeTicket(req, res, next) : ticketController.setTicketStatus(req, res, next); }
);

router.put(
  '/:ticketId/close',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'CLOSED'; return ticketController.closeTicket ? ticketController.closeTicket(req, res, next) : ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:ticketId/reopen',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'REOPENED'; return ticketController.setTicketStatus(req, res, next); }
);

router.put(
  '/:ticketId/reopen',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'REOPENED'; return ticketController.setTicketStatus(req, res, next); }
);

router.get(
  '/:ticketId/timeline',
  requireTicketViewAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  ticketActivityController.getHistory
);

router.post(
  '/:ticketId/submit-for-approval',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  approvalWorkflowController.requestApproval
);

router.post(
  '/:ticketId/sla/start',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => {
    req.body = {
      ...(req.body || {}),
      responseDueAt: toMySqlDateTime(req.body?.responseDueAt || new Date(Date.now() + 30 * 60 * 1000)),
      resolutionDueAt: toMySqlDateTime(req.body?.resolutionDueAt || new Date(Date.now() + 4 * 60 * 60 * 1000)),
      escalationDueAt: toMySqlDateTime(req.body?.escalationDueAt || new Date(Date.now() + 60 * 60 * 1000)),
      nextEscalationAt: toMySqlDateTime(req.body?.nextEscalationAt || new Date(Date.now() + 60 * 60 * 1000)),
    };
    return ticketController.updateTicketSla(req, res, next);
  }
);

router.post(
  '/:ticketId/sla/pause',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => {
    req.body = {
      ...(req.body || {}),
      responseDueAt: null,
      resolutionDueAt: null,
      escalationDueAt: null,
      nextEscalationAt: null,
    };
    return ticketController.updateTicketSla(req, res, next);
  }
);

router.post(
  '/:ticketId/escalate/level1',
  requireTicketAssignAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => {
    req.body = {
      ...(req.body || {}),
      escalationLevel: 1,
      escalatedTo: req.body?.escalatedTo || req.body?.assignedTo || req.user?._id || null,
    };
    return escalationController.escalateTicket(req, res, next);
  }
);

router.post(
  '/:ticketId/duplicate',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  async (req, res) => {
    return res.status(200).json({
      success: true,
      message: 'Duplicate request accepted (compatibility mode)',
      data: { ticketId: req.params.ticketId },
    });
  }
);

router.post(
  '/:ticketId/merge',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  async (req, res) => {
    return res.status(200).json({
      success: true,
      message: 'Merge request accepted (compatibility mode)',
      data: { sourceTicketId: req.params.ticketId, targetTicketId: req.body?.targetTicketId || null },
    });
  }
);

router.post(
  '/:ticketId/cancel',
  requireTicketManagementAccess,
  [param('ticketId').isString().trim().isLength({ min: 1 })],
  (req, res, next) => { req.body.status = 'CLOSED'; return ticketController.setTicketStatus(req, res, next); }
);

router.post(
  '/:id/comments',
  upload.any(),
  requireTicketCommentAccess,
  [
    param('id').isString().trim().isLength({ min: 1 }),
    body(['body', 'comment', 'message']).optional().isString().trim().isLength({ min: 1 }),
    body().custom((value, { req }) => {
      if (!req.body.body && !req.body.comment && !req.body.message) {
        throw new Error('Comment body is required');
      }
      return true;
    }),
  ],
  ticketController.addComment
);

module.exports = router;
