const nodemailer = require('nodemailer');
require('dotenv').config();
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = require('../../logger'); }
 
let env;
try { env = require(__root + 'config/env'); } catch (e) { env = require('../config/env'); }
 
const SMTP_HOST = env.SMTP_HOST || process.env.SMTP_HOST;
const SMTP_PORT = parseInt(env.SMTP_PORT || process.env.SMTP_PORT || '587', 10);
const SMTP_SECURE = (env.SMTP_SECURE === true) || (process.env.SMTP_SECURE === 'true');
const SMTP_USER = env.SMTP_USER || process.env.SMTP_USER;
const SMTP_PASS = env.SMTP_PASS || process.env.SMTP_PASS;
const SMTP_FROM = env.SMTP_FROM || process.env.SMTP_FROM || SMTP_USER || 'no-reply@nivarahousing.com';
const COMPANY_NAME = env.COMPANY_NAME || process.env.COMPANY_NAME || 'Nivara Housing';
const APP_NAME = env.APP_NAME || process.env.APP_NAME || 'Nivara Task Manager';
 
let transporter = null;
const smtpConfigured = SMTP_HOST && SMTP_USER && SMTP_PASS;
// Allow opting-in to accept self-signed certs in non-production dev environments
const ALLOW_SELF_SIGNED = (env && (env.SMTP_ALLOW_SELF_SIGNED === true || String(env.SMTP_ALLOW_SELF_SIGNED) === 'true')) || String(process.env.SMTP_ALLOW_SELF_SIGNED) === 'true';
 
if (smtpConfigured) {
  const transportOptions = {
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  };
 
  // Allow explicit opt-in to accept self-signed certificates.
  // If enabled in production, emit a loud warning so operators are aware of the risk.
  if (ALLOW_SELF_SIGNED) {
    transportOptions.tls = { rejectUnauthorized: false };
    if (process.env.NODE_ENV === 'production') {
      logger.warn('emailService: SMTP configured to allow self-signed certificates in PRODUCTION - this is insecure. Ensure you understand the risks.');
    } else {
      logger.warn('emailService: SMTP configured to allow self-signed certificates (development/testing)');
    }
  }
 
  transporter = nodemailer.createTransport(transportOptions);
  transporter.verify()
    .then(() => logger.info('emailService: SMTP verified'))
    .catch(e => {
      const msg = e && e.message ? e.message : String(e);
      if (/self[- ]signed|certificate/i.test(msg)) {
        logger.warn('emailService: SMTP verify failed: ' + msg + (ALLOW_SELF_SIGNED ? ' (allow-self-signed enabled)' : ' — to ignore self-signed certs set SMTP_ALLOW_SELF_SIGNED=true (not recommended in production)'));
      } else {
        logger.warn('emailService: SMTP verify failed: ' + msg + (ALLOW_SELF_SIGNED ? ' (allow-self-signed enabled)' : ''));
      }
    });
} else {
  logger.info('emailService: SMTP not configured, emails will be logged to console');
}
 
function getLoginUrl() {
  const base = (env && (env.FRONTEND_URL || env.BASE_URL)) || process.env.FRONTEND_URL || process.env.BASE_URL;
  if (!base) {
    throw new Error('FRONTEND_URL or BASE_URL environment variable is required');
  }
  return base.endsWith('/') ? `${base}log-in` : `${base}/log-in`;
}
 
function generateTemplate(greeting, intro, rows) {
  let tableRows = rows.filter(r => r).map(r => `
    <tr>
      <td style="padding: 12px 10px; color: #989898; font-weight: bold; font-size: 11px; text-transform: uppercase; width: 35%; border-bottom: 1px solid #f0e6de;">${r.label}</td>
      <td style="padding: 12px 10px; color: #333; font-size: 14px; border-bottom: 1px solid #f0e6de;">${r.value}</td>
    </tr>
  `).join('');
 
  return `
<div style="font-family: Arial, Helvetica, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #eee;">
  <div style="background-color: #fcece1; padding: 20px 30px;">
    <h2 style="margin: 0; color: #7d7d7d; font-size: 18px; font-weight: bold;">${COMPANY_NAME}</h2>
    <p style="margin: 8px 0 0; color: #8b6b57; font-size: 12px;">${APP_NAME} | Secure multi-user workspace for projects, tasks, clients, and approvals</p>
  </div>
  <div style="padding: 30px;">
    <p style="margin-top: 0; font-size: 14px; color: #444; line-height: 1.6;">
      ${greeting}<br>
      ${intro}
    </p>
   
    <div style="background-color: #faf4ef; padding: 15px 20px; margin: 25px 0;">
      <table style="width: 100%; border-collapse: collapse;">
        ${tableRows}
      </table>
    </div>
 
    <div style="margin-top: 40px; border-top: 1px solid #eee; padding-top: 15px;">
      <p style="margin: 0; font-size: 12px; color: #a0a0a0; font-style: italic;">
        This message was sent by ${APP_NAME} for ${COMPANY_NAME}. Please do not reply to this email.
      </p>
    </div>
  </div>
</div>
`.trim();
}
 
function otpTemplate(code, minutes = 5, purpose = "Verification") {
  return {
    subject: `${purpose} Code - ${COMPANY_NAME}`,
    text: `Hello,\nYour ${purpose.toLowerCase()} code is: ${code}\nThis code will expire in ${minutes} minutes.\nIf you did not request this, please ignore this email.\nThank you,\n${COMPANY_NAME}`,
    html: generateTemplate('Hello,', `Your ${purpose.toLowerCase()} code has been generated:`, [
      { label: 'CODE', value: `<strong style="font-size:18px; color:#000; letter-spacing: 2px;">${code}</strong>` },
      { label: 'EXPIRES IN', value: `${minutes} minutes` }
    ])
  };
}
 
function passwordResetTemplate({ email = "User", code, minutes = 10 }) {
  return {
    subject: `Your ${COMPANY_NAME} Password Reset OTP`,
    text: `Hello ${email},\nYou requested a password reset.\nYour verification code is: ${code}\nThis code expires in ${minutes} minutes.\nIf you did not request this, please ignore this email.\nThank you,\n${COMPANY_NAME}`,
    html: generateTemplate(`Hello ${email},`, 'You requested a password reset. Your verification code is below:', [
      { label: 'CODE', value: `<strong style="font-size:18px; color:#000; letter-spacing: 2px;">${code}</strong>` },
      { label: 'EXPIRES IN', value: `${minutes} minutes` }
    ])
  };
}
 
function welcomeTemplate({
  name = "User",
  email = "",
  role = "User",
  title = "Employee",
  tempPassword = "",
  createdBy = "System Admin",
  createdAt = new Date(),
  setupLink = "#",
  userId = ""
}) {
  const loginUrl = getLoginUrl();
  const effectiveUserId = userId || email || name || 'Your User ID';
 
  return {
    subject: `Welcome to Nivara TASK – Your Account Details`,
    text: `Hi ${name},
 
Welcome to Nivara TASK – Project Management System!
We're excited to have you on board and help you streamline your projects and improve team collaboration.
 
Your account has been successfully created. Please find your login details below:
 
Login URL: ${loginUrl}
User ID: ${effectiveUserId}
Password: ${tempPassword}
 
Getting Started
 
* Click the login URL above to access the platform
* Enter your User ID and Password
* For security reasons, please update your password after your first login
 
If you face any issues while logging in or need assistance, feel free to contact our IT support team.
 
We're glad to have you with us!
 
Best regards,
TASK Management Team`,
    html: generateTemplate(`Hi ${name},`, `Welcome to <strong>Nivara TASK – Project Management System</strong>!<br>We're excited to have you on board and help you streamline your projects and improve team collaboration.<br><br>Your account has been successfully created. Please find your login details below:`, [
      { label: 'LOGIN URL', value: `<a href="${loginUrl}" target="_blank" rel="noreferrer">${loginUrl}</a>` },
      { label: 'USER ID', value: effectiveUserId },
      { label: 'PASSWORD', value: `<strong>${tempPassword}</strong>` }
    ]) + `
      <div style="max-width: 600px; margin: 0 auto; padding: 0 30px 30px; font-family: Arial, Helvetica, sans-serif; color: #444; line-height: 1.6; font-size: 14px;">
        <h3 style="margin: 30px 0 15px; color: #333; font-size: 16px;">Getting Started</h3>
        <ul style="margin: 0 0 20px; padding-left: 20px; color: #444;">
          <li>Click the login URL above to access the platform</li>
          <li>Enter your User ID and Password</li>
          <li>For security reasons, please update your password after your first login</li>
        </ul>
        <p style="margin: 0 0 20px; color: #666;">If you face any issues while logging in or need assistance, feel free to contact our IT support team.</p>
        <p style="margin: 0; color: #444;">We're glad to have you with us!</p>
        <p style="margin: 20px 0 0; font-weight: bold; color: #333;">Best regards,<br>TASK Management Team</p>
      </div>`
  };
}
 
function taskAssignedTemplate({ taskTitle, assignedBy, link, assignedTo }) {
  return {
    subject: `New Task Assigned: ${taskTitle}`,
    text: `${assignedBy} assigned you a new task.\nTask: ${taskTitle}\nAssigned To: ${assignedTo}`,
    html: generateTemplate(`Hello ${assignedTo},`, 'The following task has been assigned to you:', [
      { label: 'TITLE', value: taskTitle },
      { label: 'ASSIGNED BY', value: assignedBy }
    ])
  };
}
 
function taskStatusTemplate({ taskId, stage, userNames = [] }) {
  return {
    subject: `Task #${taskId} Status Updated: ${stage}`,
    text: `Task #${taskId} has been updated.\nNew Status: ${stage}\nNotified: ${userNames.join(', ')}`,
    html: generateTemplate('Hello,', `Task #<strong>${taskId}</strong> status has been updated.`, [
      { label: 'TASK ID', value: taskId },
      { label: 'NEW STATUS', value: `<strong>${stage}</strong>` },
      userNames.length ? { label: 'NOTIFIED', value: userNames.join(', ') } : null
    ])
  };
}
 
function taskReassignmentRequestTemplate({ taskTitle, requesterName, reason, taskLink }) {
  return {
    subject: `Task Reassignment Requested: ${taskTitle}`,
    text: `A reassignment request has been submitted.\nTask: ${taskTitle}\nRequested by: ${requesterName}\nReason: ${reason}`,
    html: generateTemplate('Hello,', 'A task reassignment request has been submitted:', [
      { label: 'TITLE', value: taskTitle },
      { label: 'REQUESTED BY', value: requesterName },
      { label: 'REASON', value: reason }
    ])
  };
}
 
function taskReassignmentApprovedTemplate({ taskTitle, oldAssignee, newAssignee, taskLink }) {
  return {
    subject: `Task Reassigned: ${taskTitle}`,
    text: `You have been assigned a new task.\nTask: ${taskTitle}\nPrevious Assignee: ${oldAssignee}`,
    html: generateTemplate(`Hello ${newAssignee},`, 'You have been assigned a new task:', [
      { label: 'TITLE', value: taskTitle },
      { label: 'PREVIOUS ASSIGNEE', value: oldAssignee }
    ])
  };
}
 
function taskReassignmentOldAssigneeTemplate({ taskTitle, newAssignee, taskLink }) {
  return {
    subject: `Task Reassigned (Read-Only): ${taskTitle}`,
    text: `Your task has been reassigned and is now read-only.\nTask: ${taskTitle}\nNew Assignee: ${newAssignee}`,
    html: generateTemplate('Hello,', 'Your task has been reassigned and is now read-only:', [
      { label: 'TITLE', value: taskTitle },
      { label: 'NEW ASSIGNEE', value: newAssignee }
    ])
  };
}
 
function taskReassignmentManagerTemplate({ taskTitle, oldAssignee, newAssignee, taskLink }) {
  return {
    subject: `Task Reassignment Completed: ${taskTitle}`,
    text: `Task reassignment completed.\nTask: ${taskTitle}\nNew Assignee: ${newAssignee}\nOld Assignee: ${oldAssignee}`,
    html: generateTemplate('Hello,', 'Task reassignment completed:', [
      { label: 'TITLE', value: taskTitle },
      { label: 'NEW ASSIGNEE', value: newAssignee },
      { label: 'OLD ASSIGNEE', value: oldAssignee }
    ])
  };
}
 
function taskReassignmentRejectedTemplate({ taskTitle, taskLink }) {
  return {
    subject: `Task Reassignment Rejected: ${taskTitle}`,
    text: `Your reassignment request was rejected.\nTask: ${taskTitle}\nYou can continue working on this task.`,
    html: generateTemplate('Hello,', 'Your task reassignment request was rejected. You can continue working on this task.', [
      { label: 'TITLE', value: taskTitle }
    ])
  };
}
 
function taskReassignmentRejectedManagerTemplate({ taskTitle, oldAssignee, taskLink }) {
  return {
    subject: `Task Reassignment Rejected: ${taskTitle}`,
    text: `Task reassignment was rejected.\nTask: ${taskTitle}\nOld Assignee: ${oldAssignee}`,
    html: generateTemplate('Hello,', 'Task reassignment was rejected:', [
      { label: 'TITLE', value: taskTitle },
      { label: 'OLD ASSIGNEE', value: oldAssignee }
    ])
  };
}
 
function projectManagerAssignmentTemplate({
  projectName,
  clientName,
  priority,
  startDate,
  endDate,
  budget,
  publicId,
  departmentNames = [],
  projectLink,
  creatorName,
  managerName
}) {
  return {
    subject: `Project Assignment: ${projectName}`,
    text: `Dear ${managerName},\nYou have been assigned as Project Manager for "${projectName}".\nClient: ${clientName}\nPriority: ${priority}\nProject ID: ${publicId}`,
    html: generateTemplate(`Hello ${managerName},`, 'You have been assigned as Project Manager for the following project:', [
      { label: 'PROJECT NAME', value: projectName },
      { label: 'CLIENT', value: clientName },
      { label: 'PRIORITY', value: priority },
      { label: 'START DATE', value: startDate || 'TBD' },
      { label: 'END DATE', value: endDate || 'TBD' },
      { label: 'BUDGET', value: budget || 'TBD' },
      { label: 'PROJECT ID', value: `<strong>${publicId}</strong>` },
      departmentNames.length ? { label: 'DEPARTMENTS', value: departmentNames.join(', ') } : null
    ])
  };
}
 
function clientProjectCreationTemplate({
  projectName,
  managerName,
  priority,
  startDate,
  endDate,
  budget,
  publicId,
  departmentNames = [],
  projectLink,
  creatorName,
  clientName
}) {
  return {
    subject: `Project Created: ${projectName}`,
    text: `Dear ${clientName},\nYour project "${projectName}" has been successfully created.\nProject Manager: ${managerName}\nPriority: ${priority}\nProject ID: ${publicId}`,
    html: generateTemplate(`Hello ${clientName},`, 'We are pleased to inform you that your project has been successfully created:', [
      { label: 'PROJECT NAME', value: projectName },
      { label: 'PROJECT MANAGER', value: managerName },
      { label: 'PRIORITY', value: priority },
      { label: 'TIMELINE', value: `${startDate || 'TBD'} to ${endDate || 'TBD'}` },
      { label: 'BUDGET', value: budget || 'TBD' },
      { label: 'PROJECT ID', value: `<strong>${publicId}</strong>` },
      departmentNames.length ? { label: 'OUR TEAMS', value: departmentNames.join(', ') } : null
    ])
  };
}
 
async function sendEmail({ to, subject, text, html }) {
  if (transporter) {
    try {
      await transporter.sendMail({
        from: SMTP_FROM,
        to,
        subject,
        text,
        html
      });
      return { sent: true };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (/self[- ]signed|certificate/i.test(msg)) {
        logger.error(`emailService: sendMail failed due to self-signed certificate: ${msg} - set SMTP_ALLOW_SELF_SIGNED=true to ignore certificate verification (not recommended in production)`);
      } else {
        logger.error('emailService: sendMail failed: ' + msg);
      }
      return { sent: false, error: msg };
    }
  }
 
  logger.info('emailService (dev) to:', to, 'subject:', subject, 'text:', text);
  return { sent: false };
}
 
async function sendProjectNotifications({
  projectManagerInfo,
  clientInfo,
  projectName,
  publicId,
  priority,
  startDate,
  endDate,
  budget,
  departmentNames = [],
  projectLink,
  creatorName
}) {
  const results = {};
 
  if (projectManagerInfo?.email) {
    const pmTemplate = projectManagerAssignmentTemplate({
      projectName,
      clientName: clientInfo.name,
      priority,
      startDate,
      endDate,
      budget,
      publicId,
      departmentNames,
      projectLink,
      creatorName,
      managerName: projectManagerInfo.name
    });
 
    results.manager = await sendEmail({
      to: projectManagerInfo.email,
      ...pmTemplate
    });
  }
 
  if (clientInfo?.email) {
    const clientTemplate = clientProjectCreationTemplate({
      projectName,
      managerName: projectManagerInfo ? projectManagerInfo.name : 'To be assigned',
      priority,
      startDate,
      endDate,
      budget,
      publicId,
      departmentNames,
      projectLink,
      creatorName,
      clientName: clientInfo.name
    });
 
    results.client = await sendEmail({
      to: clientInfo.email,
      ...clientTemplate
    });
  }
 
  return results;
}
 
function taskAssignedToEmployeeTemplate({
  taskTitle,
  taskId,
  priority,
  taskDate,
  description,
  projectName,
  projectPublicId,
  assignedBy,
  taskLink,
  employeeName,
}) {
  let formattedDate = taskDate;
  if (taskDate) {
    const d = new Date(taskDate);
    if (!isNaN(d.getTime())) {
      formattedDate = d.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });
    }
  }
 
  return {
    subject: `New Task Assigned: ${taskTitle} (Priority: ${priority})`,
    text: `Dear ${employeeName},\nYou have been assigned a new task: ${taskTitle}\nID: #${taskId}\nPriority: ${priority}\nDue Date: ${formattedDate}\nAssigned By: ${assignedBy}`,
    html: generateTemplate(`Hello ${employeeName},`, 'The following task has been assigned to you:', [
      { label: 'TITLE', value: taskTitle },
      description ? { label: 'DESCRIPTION', value: description } : null,
      { label: 'DUE DATE', value: formattedDate },
      { label: 'PRIORITY', value: priority },
      projectName ? { label: 'PROJECT', value: projectName } : null
    ])
  };
}
 
module.exports = taskAssignedToEmployeeTemplate;
 
async function sendTaskAssignmentEmails({
  finalAssigned = [],
  taskTitle,
  taskId,
  priority,
  taskDate,
  description,
  projectName,
  projectPublicId,
  assignedBy,
  taskLink,
  connection,
}) {
  const results = {};
 
  try {
    if (!connection) {
      logger.warn('⚠️ Database connection not provided');
      return results;
    }
 
    if (!Array.isArray(finalAssigned) || finalAssigned.length === 0) {
      logger.info('ℹ️ No assigned users to notify');
      return results;
    }
 
    const publicIds = [];
    const internalIds = [];
    finalAssigned.forEach((id) => {
      if (id === undefined || id === null) return;
      const s = String(id).trim();
      if (s === '') return;
      if (/^\d+$/.test(s)) internalIds.push(Number(s));
      else publicIds.push(s);
    });
 
    if (publicIds.length === 0 && internalIds.length === 0) {
      logger.info('ℹ️ No valid assigned user identifiers provided');
      return results;
    }
 
    const users = await new Promise((resolve, reject) => {
      const clauses = [];
      const params = [];
      if (publicIds.length) {
        clauses.push('public_id IN (?)');
        params.push(publicIds);
      }
      if (internalIds.length) {
        clauses.push('_id IN (?)');
        params.push(internalIds);
      }
      const sql = `SELECT _id, public_id, name, email FROM users WHERE ${clauses.join(' OR ')}`;
      connection.query(sql, params, (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
 
    if (users.length === 0) {
      logger.info('ℹ️ No matching users found in DB for the assigned IDs');
      return results;
    }
 
    const emailPromises = users.map((user) => {
      if (!user.email) return Promise.resolve({ sent: false, error: 'No email address' });
      const tpl = taskAssignedToEmployeeTemplate({
        taskTitle,
        taskId,
        priority,
        taskDate,
        description,
        projectName,
        projectPublicId,
        assignedBy,
        taskLink,
        employeeName: user.name || 'User',
      });
      return sendEmail({
        to: user.email,
        subject: tpl.subject,
        text: tpl.text,
        html: tpl.html,
      });
    });
 
    const outcomes = await Promise.allSettled(emailPromises);
    outcomes.forEach((outcome, idx) => {
      const u = users[idx];
      if (outcome.status === 'fulfilled') {
        results[u.email] = outcome.value;
      } else {
        results[u.email] = { sent: false, error: outcome.reason };
      }
    });
 
  } catch (error) {
    logger.error('❌ Error sending task assignment emails:', error);
  }
 
  return results;
}
 
module.exports = {
  sendEmail,
  sendTaskAssignmentEmails,
  sendProjectNotifications,
  otpTemplate,
  passwordResetTemplate,
  welcomeTemplate,
  taskAssignedTemplate,
  taskStatusTemplate,
  taskReassignmentRequestTemplate,
  taskReassignmentApprovedTemplate,
  taskReassignmentOldAssigneeTemplate,
  taskReassignmentManagerTemplate,
  taskReassignmentRejectedTemplate,
  taskReassignmentRejectedManagerTemplate,
  projectManagerAssignmentTemplate,
  clientProjectCreationTemplate,
  taskAssignedToEmployeeTemplate
};
 
