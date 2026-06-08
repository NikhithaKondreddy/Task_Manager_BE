const TICKET_REFERENCE_REGEX = /\[Ticket\s*#([A-Za-z0-9_-]+)\]/i;

function extractTicketIdFromSubject(subject = '') {
  const match = String(subject || '').match(TICKET_REFERENCE_REGEX);
  return match ? match[1].trim() : null;
}

function buildTicketSubject(originalSubject = '', ticketId) {
  const subject = String(originalSubject || 'Support request').trim();
  if (extractTicketIdFromSubject(subject)) return subject;
  const withoutRe = subject.replace(/^re:\s*/i, '').trim() || 'Support request';
  return `Re: ${withoutRe} [Ticket #${ticketId}]`;
}

module.exports = {
  extractTicketIdFromSubject,
  buildTicketSubject,
};
