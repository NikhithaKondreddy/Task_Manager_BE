const nodemailer = require('nodemailer');
const logger = require('../../../logger');

const IT_TEAM_EMAIL = 'Ashwini.m@nmit-solutions.com';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  }
});

function getCompanyName() {
  return process.env.COMPANY_NAME || 'NIVARA HOME FINANCE LTD';
}

function getFromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER;
}

function getRequesterName(ticket) {
  return ticket.requester_name || ticket.requester_email || 'User';
}

function getSenderEmail() {
  return process.env.SMTP_USER || '';
}

function getEmailStyles() {
  return `
    body { font-family: Arial, sans-serif; color: #333; margin: 0; padding: 0; }
    .wrapper { width: 100%; background: #f4f6f8; padding: 20px; }
    .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 0 30px rgba(0,0,0,0.08); }
    .header { background: #002b55; color: #ffffff; padding: 22px 30px; text-align: left; }
    .header h1 { margin: 0; font-size: 20px; }
    .content { padding: 30px; }
    .content h2 { margin-top: 0; color: #071e3d; }
    .details { border-collapse: collapse; width: 100%; margin: 20px 0; }
    .details th, .details td { padding: 12px 15px; border: 1px solid #e8eaed; text-align: left; }
    .details th { background: #f8fafd; color: #1f3a63; }
    .footer { padding: 20px 30px; font-size: 14px; color: #6b778c; background: #f6f8fb; }
    .button { display: inline-block; margin-top: 18px; padding: 12px 20px; background: #0052cc; color: #ffffff; text-decoration: none; border-radius: 6px; }
  `;
}

async function sendITTeamEmail(ticket) {
  console.log('Using SMTP:', process.env.SMTP_USER);
  console.log('Sending ticket email...');
  console.log('To IT team');

  const mailOptions = {
    from: getFromAddress(),
    to: IT_TEAM_EMAIL,
    subject: `Important: New IT Ticket - ${ticket.ticket_id}`,
    text: `A new IT ticket has been created. Ticket ID: ${ticket.ticket_id} Title: ${ticket.title}`,
    html: `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>${getEmailStyles()}</style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <h1>New IT Support Ticket Assigned</h1>
            </div>
            <div class="content">
              <h2>${ticket.title}</h2>
              <p>A new IT Support ticket has been created and assigned to the IT queue.</p>
              <table class="details">
                <tr><th>Ticket ID</th><td>${ticket.ticket_id}</td></tr>
                <tr><th>Status</th><td>${ticket.status}</td></tr>
                <tr><th>Priority</th><td>${ticket.priority || 'Medium'}</td></tr>
                <tr><th>Requester</th><td>${getRequesterName(ticket)}</td></tr>
                <tr><th>Requester Email</th><td>${ticket.requester_email}</td></tr>
                <tr><th>Assigned Queue</th><td>${ticket.assigned_queue}</td></tr>
              </table>
              <p><strong>Description</strong></p>
              <p>${ticket.description || '(No description provided)'}</p>
              <p>Please review the ticket in the support dashboard and update it as work progresses.</p>
              <a class="button" href="${process.env.BASE_URL || 'http://localhost:4000'}/it-support/tickets">Open Support Tickets</a>
            </div>
            <div class="footer">
              <p>If you have any questions, contact the IT Support team.</p>
            </div>
          </div>
        </div>
      </body>
      </html>`
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    logger.info(`IT team ticket email sent for ${ticket.ticket_id} to ${IT_TEAM_EMAIL}`);
    return result;
  } catch (error) {
    logger.error(`Failed to send IT team ticket email for ${ticket.ticket_id}: ${error.message}`);
    throw error;
  }
}

async function sendRequesterEmail(ticket) {
  console.log('Using SMTP:', process.env.SMTP_USER);
  console.log('Sending ticket email...');

  const mailOptions = {
    from: getFromAddress(),
    to: ticket.requester_email,
    subject: `Important: Ticket Created - ${ticket.ticket_id}`,
    text: `Hello ${getRequesterName(ticket)},\n\nYour IT support ticket has been successfully created.\n\nTicket ID: ${ticket.ticket_id}\nTitle: ${ticket.title}\nDescription: ${ticket.description}\nStatus: ${ticket.status}\n\nThis notification has been sent from ${getSenderEmail()}.\n\nNext Steps:\nPlease keep this Ticket ID for future reference.\nOur IT team will review your request and contact you shortly.\nIf you have additional information, reply with the ticket reference in the subject.\n\nIf you do not receive further updates in time, please reach out to the IT department.\n\nBest regards,\nLavanya / Poojitha\n\nRegards\nVijaya baskar.A`,
    html: `<!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8" />
        <style>${getEmailStyles()}</style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <div class="header">
              <h1>Your IT Support Ticket Has Been Created</h1>
            </div>
            <div class="content">
              <h2>${ticket.title}</h2>
              <p>Thank you for submitting your request. Your ticket is now logged and will be processed by IT Support.</p>
              <table class="details">
                <tr><th>Ticket ID</th><td>${ticket.ticket_id}</td></tr>
                <tr><th>Status</th><td>${ticket.status}</td></tr>
                <tr><th>Priority</th><td>${ticket.priority || 'Medium'}</td></tr>
                <tr><th>Requested By</th><td>${getRequesterName(ticket)}</td></tr>
                <tr><th>Request Email</th><td>${ticket.requester_email}</td></tr>
              </table>
              <p><strong>Description</strong></p>
              <p>${ticket.description || '(No description provided)'}</p>
              <p>Our IT team will follow up shortly with the next steps.</p>
              <a class="button" href="${process.env.BASE_URL || 'http://localhost:4000'}/it-support/tickets">View Your Ticket</a>
            </div>
            <div class="footer">
              <p>Best regards,</p>
              <p>IT Support Team</p>
            </div>
          </div>
        </div>
      </body>
      </html>`
  };

  try {
    const result = await transporter.sendMail(mailOptions);
    logger.info(`Requester ticket email sent for ${ticket.ticket_id} to ${ticket.requester_email}`);
    return result;
  } catch (error) {
    logger.error(`Failed to send requester ticket email for ${ticket.ticket_id}: ${error.message}`);
    throw error;
  }
}

module.exports = {
  sendITTeamEmail,
  sendRequesterEmail,
};
