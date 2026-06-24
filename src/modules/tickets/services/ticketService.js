const HttpError = require('../../../errors/HttpError');
const logger = require('../../../logger');
const userRepository = require('../repositories/userRepository');
const ticketRepository = require('../repositories/ticketRepository');
const commentRepository = require('../repositories/commentRepository');
const attachmentRepository = require('../repositories/attachmentRepository');
const { detectPriority, normalizePriority } = require('../helpers/priority');
const { validateSenderEmail } = require('../helpers/senderValidator');
const { saveAttachment } = require('../helpers/attachmentStorage');
const emailService = require('./emailService');
const { normalizeRole } = require('../../../config/rbac');

const VALID_STATUSES = ['Open', 'In Progress', 'Closed'];
const ALLOWED_STATUS_TRANSITIONS = {
  Open: ['In Progress'],
  'In Progress': ['Closed'],
  Closed: ['Open'],
};

function normalizeStatus(status) {
  if (!status) return 'Open';
  const value = String(status).trim().toLowerCase();
  if (value === 'new' || value === 'open') return 'Open';
  if (value === 'in progress' || value === 'in_progress') return 'In Progress';
  if (value === 'closed') return 'Closed';
  return null;
}

async function persistAttachments(attachments = [], context) {
  const saved = [];

  for (const attachment of attachments || []) {
    const stored = await saveAttachment(attachment, {
      ticketPublicId: context.ticket.ticket_id,
    });

    if (!stored.storage_path) {
      logger.warn(`Skipping attachment without content or storage path: ${stored.file_name}`);
      continue;
    }

    saved.push(await attachmentRepository.create({
      ...stored,
      ticket_id: context.ticket.id,
      comment_id: context.comment ? context.comment.id : null,
      source_message_id: context.source_message_id || null,
    }));
  }

  return saved;
}

async function getTicketOrThrow(id) {
  const ticket = await ticketRepository.findByPublicIdOrId(id);
  if (!ticket) {
    throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  }
  return ticket;
}

async function hydrateTicket(ticket) {
  const [comments, attachments] = await Promise.all([
    commentRepository.listByTicketId(ticket.id),
    attachmentRepository.listByTicketId(ticket.id),
  ]);

  const baseUrl = (process.env.BASE_URL || process.env.API_BASE_URL || `http://localhost:4000`).replace(/\/$/, '');
  const transformedAttachments = attachments.map(att => ({
    ...att,
    storage_path: `${baseUrl}/${att.storage_path}`
  }));

  return {
    ...ticket,
    comments,
    attachments: transformedAttachments,
  };
}

async function hydrateTickets(tickets = []) {
  return Promise.all(tickets.map((ticket) => hydrateTicket(ticket)));
}

async function buildVisibilityFilters(filters, user) {
  if (!user) return null;

  const roleKey = normalizeRole(user.role);
  if (roleKey === 'SUPER_ADMIN' || roleKey === 'ADMIN' || roleKey === 'IT_SUPPORT') {
    return { ...filters };
  }

  if (roleKey === 'MANAGER') {
    const manager = await userRepository.findById(user._id);
    if (!manager || !manager.department_public_id) {
      return { ...filters, department_public_id: '__NO_DEPARTMENT__' };
    }
    return {
      ...filters,
      department_public_id: manager.department_public_id,
    };
  }

  if (roleKey === 'EMPLOYEE') {
    return {
      ...filters,
      requester_user_id: user._id,
    };
  }

  return null;
}

async function canUserAccessTicket(ticket, user) {
  if (!user) return false;
  const roleKey = normalizeRole(user.role);

  if (roleKey === 'SUPER_ADMIN' || roleKey === 'ADMIN' || roleKey === 'IT_SUPPORT') {
    return true;
  }

  if (roleKey === 'EMPLOYEE') {
    return Number(ticket.requester_user_id) === Number(user._id);
  }

  if (roleKey === 'MANAGER') {
    const manager = await userRepository.findById(user._id);
    if (!manager || !manager.department_public_id) return false;
    const requester = ticket.requester_user_id ? await userRepository.findById(ticket.requester_user_id) : null;
    return Boolean(requester && requester.department_public_id === manager.department_public_id);
  }

  return false;
}

function assertStatusTransition(currentStatus, nextStatus) {
  if (!nextStatus || currentStatus === nextStatus) return;
  const allowedNextStatuses = ALLOWED_STATUS_TRANSITIONS[currentStatus] || [];
  if (!allowedNextStatuses.includes(nextStatus)) {
    throw new HttpError(
      400,
      `Invalid status transition from ${currentStatus} to ${nextStatus}`,
      'INVALID_TICKET_STATUS_TRANSITION'
    );
  }
}

async function createTicket(input) {
  const requesterEmail = validateSenderEmail(input.requester_email || input.requesterEmail);
  const requester = await userRepository.findOrCreateByEmail({
    email: requesterEmail,
    name: input.requester_name || input.requesterName || null,
    source: input.source === 'email' ? 'email' : 'api',
  });

  const sourceMessageId = input.source_message_id || input.message_id || null;
  if (sourceMessageId) {
    const existing = await ticketRepository.findByMessageId(sourceMessageId);
    if (existing) {
      return {
        duplicate: true,
        ticket: await hydrateTicket(existing),
      };
    }
  }

  const priority = normalizePriority(input.priority) ||
    detectPriority(input.title, input.description);
  const status = normalizeStatus(input.status) || 'Open';

  const ticket = await ticketRepository.create({
    title: input.title || 'Support request',
    description: input.description || '(No description)',
    requester_user_id: requester.id,
    requester_email: requester.email,
    status,
    priority,
    assigned_to: input.assigned_to || null,
    assigned_queue: input.assigned_queue || 'IT Support',
    module: input.module || 'general',
    source: input.source || 'api',
    source_message_id: sourceMessageId,
  });

  await persistAttachments(input.attachments, {
    ticket,
    source_message_id: sourceMessageId,
  });

  const hydratedTicket = await hydrateTicket(ticket);

  void emailService.sendITTeamEmail(hydratedTicket)
    .catch((error) => logger.error(`IT team email dispatch failed for ${hydratedTicket.ticket_id}: ${error?.message || error}`));

  void emailService.sendRequesterEmail(hydratedTicket)
    .catch((error) => logger.error(`Requester email dispatch failed for ${hydratedTicket.ticket_id}: ${error?.message || error}`));

  return {
    duplicate: false,
    ticket: hydratedTicket,
  };
}

async function listTickets(filters, user) {
  const scopedFilters = await buildVisibilityFilters(filters, user);
  if (!scopedFilters || scopedFilters.department_public_id === '__NO_DEPARTMENT__') return [];
  const tickets = await hydrateTickets(await ticketRepository.list(scopedFilters));

  if (!user) return tickets;

  const roleKey = normalizeRole(user.role);

  if (roleKey === 'EMPLOYEE') {
    // For employees: categorize by status
    const myTickets = tickets;
    const closed = tickets.filter(t => t.status === 'Closed');
    const inProgress = tickets.filter(t => t.status === 'In Progress');
    const open = tickets.filter(t => t.status === 'Open');
    const newStatus = tickets.filter(t => t.status === 'New');
    return {
      myTickets,
      new: newStatus,
      open,
      inProgress,
      closed,
    };
  } else if (roleKey === 'IT_SUPPORT') {
    // For IT Support: return flat array of all tickets
    return tickets;
  } else {
    // For manager, admin, super admin: group by module with status categories, and separate my tickets
    const grouped = {};
    tickets.forEach(ticket => {
      const module = ticket.module || 'general';
      if (!grouped[module]) {
        grouped[module] = { New: [], Open: [], 'In Progress': [], Closed: [] };
      }
      grouped[module][ticket.status].push(ticket);
    });

    // My tickets categorized by status
    const userEmail = (user.email || '').toLowerCase();
    const myTickets = tickets.filter(t => (t.requester_email || '').toLowerCase() === userEmail);
    const myGrouped = { New: [], Open: [], 'In Progress': [], Closed: [] };
    myTickets.forEach(ticket => {
      myGrouped[ticket.status].push(ticket);
    });

    return { allTickets: grouped, myTickets: myGrouped };
  }
}

async function getDashboard(user) {
  const scopedFilters = await buildVisibilityFilters({}, user);
  if (!scopedFilters || scopedFilters.department_public_id === '__NO_DEPARTMENT__') {
    return { total: 0, open: 0, in_progress: 0, closed: 0 };
  }
  return ticketRepository.getDashboardSummary(scopedFilters);
}

async function getTicket(id, user) {
  const ticket = await getTicketOrThrow(id);
  if (!(await canUserAccessTicket(ticket, user))) {
    throw new HttpError(403, 'Not allowed to view this ticket', 'TICKET_ACCESS_FORBIDDEN');
  }
  return hydrateTicket(ticket);
}

async function updateTicket(id, input) {
  const existingTicket = await getTicketOrThrow(id);

  const fields = {};
  if (input.status !== undefined) {
    const status = normalizeStatus(input.status);
    if (!status || !VALID_STATUSES.includes(status)) {
      throw new HttpError(400, 'Invalid ticket status', 'INVALID_TICKET_STATUS');
    }
    assertStatusTransition(existingTicket.status, status);
    fields.status = status;
  }

  if (input.priority !== undefined) {
    const priority = normalizePriority(input.priority);
    if (!priority) {
      throw new HttpError(400, 'Invalid ticket priority', 'INVALID_TICKET_PRIORITY');
    }
    fields.priority = priority;
  }

  if (input.assigned_queue !== undefined) {
    fields.assigned_queue = input.assigned_queue || 'IT Support';
  }

  if (input.assigned_user_id !== undefined || input.assigned_to !== undefined) {
    const userId = input.assigned_to !== undefined ? input.assigned_to : input.assigned_user_id;
    if (userId === null || userId === '') {
      fields.assigned_to = null;
    } else {
      const user = await userRepository.findById(userId);
      if (!user) throw new HttpError(404, 'Assigned user not found', 'ASSIGNED_USER_NOT_FOUND');
      fields.assigned_to = user.id;
    }
  }

  if (input.assigned_user_email) {
    const assignedEmail = validateSenderEmail(input.assigned_user_email);
    const assignee = await userRepository.findOrCreateByEmail({
      email: assignedEmail,
      name: input.assigned_user_name || null,
      source: 'api',
    });
    fields.assigned_to = assignee.id;
  }

  const updated = await ticketRepository.update(id, fields);
  if (!updated) throw new HttpError(404, 'Ticket not found', 'TICKET_NOT_FOUND');
  return hydrateTicket(updated);
}

async function addComment(ticketId, input, user) {
  const ticket = await getTicketOrThrow(ticketId);
  if (user && !(await canUserAccessTicket(ticket, user))) {
    throw new HttpError(403, 'Not allowed to comment on this ticket', 'TICKET_ACCESS_FORBIDDEN');
  }
  const sourceMessageId = input.source_message_id || input.message_id || null;

  if (sourceMessageId) {
    const duplicate = await commentRepository.findByMessageId(sourceMessageId);
    if (duplicate) {
      return {
        duplicate: true,
        ticket: await hydrateTicket(ticket),
      };
    }
  }

  let commentUser = null;
  let authorEmail = input.author_email || input.requester_email || null;

  if (authorEmail) {
    authorEmail = validateSenderEmail(authorEmail);
    commentUser = await userRepository.findOrCreateByEmail({
      email: authorEmail,
      name: input.author_name || input.requester_name || null,
      source: input.source === 'email' ? 'email' : 'api',
    });
  }

  const commentBody = input.body || input.comment || input.message;

  const comment = await commentRepository.create({
    ticket_id: ticket.id,
    user_id: commentUser ? commentUser.id : null,
    author_email: authorEmail,
    body: commentBody,
    source: input.source || 'api',
    source_message_id: sourceMessageId,
  });

  await persistAttachments(input.attachments, {
    ticket,
    comment,
    source_message_id: sourceMessageId,
  });

  return {
    duplicate: false,
    ticket: await hydrateTicket(ticket),
  };
}

async function getITSupportAssignees() {
  const users = await userRepository.findByRole('IT Support');
  return users.map(user => ({
    id: user.id,
    public_id: user.public_id,
    name: user.name,
    email: user.email,
    title: user.title || 'IT Support',
  }));
}

module.exports = {
  createTicket,
  listTickets,
  getDashboard,
  getTicket,
  updateTicket,
  addComment,
  getITSupportAssignees,
};
