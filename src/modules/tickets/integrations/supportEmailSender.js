const nodemailer = require('nodemailer');
const logger = require('../../../logger');
const retry = require('../helpers/retry');
const { buildTicketSubject } = require('../helpers/ticketSubject');

let transporter;

function isEnabled() {
  return String(process.env.SUPPORT_AUTO_RESPONSE_ENABLED || 'true').toLowerCase() !== 'false';
}

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    logger.warn('Support ticket auto-response skipped: SMTP_HOST and SMTP_USER are required.');
    return null;
  }

  const port = Number(process.env.SMTP_PORT || 587);

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return transporter;
}

async function sendMailWithRetry(options) {
  if (!isEnabled()) return null;

  const mailer = getTransporter();
  if (!mailer) return null;

  const attempts = Number(process.env.SUPPORT_EMAIL_RETRY_ATTEMPTS || 3);
  const delayMs = Number(process.env.SUPPORT_EMAIL_RETRY_DELAY_MS || 1000);

  return retry(
    () => mailer.sendMail({
      from: process.env.SUPPORT_EMAIL_FROM || process.env.SMTP_USER,
      ...options,
    }),
    {
      attempts,
      delayMs,
      onRetry: (error, attempt) => {
        logger.warn(`Support email send failed on attempt ${attempt}: ${error.message}`);
      },
    }
  );
}

async function sendTicketAcknowledgement(ticket, toEmail) {
  const subject = buildTicketSubject(ticket.title, ticket.ticket_id);
  const text = [
    'Your support request has been received.',
    '',
    `Ticket ID: ${ticket.ticket_id}`,
    `Status: ${ticket.status}`,
    `Priority: ${ticket.priority}`,
    `Queue: ${ticket.assigned_queue}`,
    '',
    `Please keep [Ticket #${ticket.ticket_id}] in the subject when replying.`,
  ].join('\n');

  return sendMailWithRetry({
    to: toEmail,
    subject,
    text,
  });
}

async function sendCommentAcknowledgement(ticket, toEmail) {
  if (String(process.env.SUPPORT_COMMENT_ACK_ENABLED || 'true').toLowerCase() === 'false') {
    return null;
  }

  return sendMailWithRetry({
    to: toEmail,
    subject: buildTicketSubject(ticket.title, ticket.ticket_id),
    text: `Your reply has been added to ticket ${ticket.ticket_id}.`,
  });
}

module.exports = {
  sendTicketAcknowledgement,
  sendCommentAcknowledgement,
};
