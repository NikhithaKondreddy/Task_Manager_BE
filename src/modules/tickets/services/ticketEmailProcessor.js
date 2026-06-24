const logger = require('../../../logger');
const ticketService = require('./ticketService');
const ticketRepository = require('../repositories/ticketRepository');
const commentRepository = require('../repositories/commentRepository');
const supportEmailSender = require('../integrations/supportEmailSender');
const { extractTicketIdFromSubject } = require('../helpers/ticketSubject');

async function processInboundEmail(email) {
  const messageId = email.message_id || email.messageId;
  const senderEmail = email.sender_email || email.from;
  const subject = email.subject || 'Support request';
  const body = email.body || '(No email body)';
  const referencedTicketId = extractTicketIdFromSubject(subject);

  if (messageId) {
    const duplicateTicket = await ticketRepository.findByMessageId(messageId);
    if (duplicateTicket) {
      logger.info(`Skipping duplicate ticket email with Message-ID ${messageId}`);
      return { action: 'duplicate-ticket', ticket: duplicateTicket };
    }

    const duplicateComment = await commentRepository.findByMessageId(messageId);
    if (duplicateComment) {
      logger.info(`Skipping duplicate ticket comment email with Message-ID ${messageId}`);
      return { action: 'duplicate-comment', comment: duplicateComment };
    }
  }

  if (referencedTicketId) {
    const ticket = await ticketRepository.findByPublicIdOrId(referencedTicketId);
    if (ticket) {
      const result = await ticketService.addComment(ticket.ticket_id, {
        body,
        author_email: senderEmail,
        author_name: email.sender_name || null,
        source: 'email',
        source_message_id: messageId,
        attachments: email.attachments || [],
      });

      await supportEmailSender.sendCommentAcknowledgement(result.ticket, senderEmail);
      return { action: 'comment', ticket: result.ticket };
    }
  }

  const result = await ticketService.createTicket({
    title: subject,
    description: body,
    requester_email: senderEmail,
    requester_name: email.sender_name || null,
    source: 'email',
    source_message_id: messageId,
    attachments: email.attachments || [],
  });

  if (!result.duplicate) {
    await supportEmailSender.sendTicketAcknowledgement(result.ticket, senderEmail);
  }

  return { action: result.duplicate ? 'duplicate-ticket' : 'ticket', ticket: result.ticket };
}

module.exports = {
  processInboundEmail,
};
