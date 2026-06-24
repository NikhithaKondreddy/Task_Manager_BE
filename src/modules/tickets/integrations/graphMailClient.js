const axios = require('axios');
const logger = require('../../../logger');
const retry = require('../helpers/retry');

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

let cachedToken = null;
let tokenExpiresAt = 0;

function isConfigured() {
  return Boolean(
    process.env.SUPPORT_GRAPH_TENANT_ID &&
    process.env.SUPPORT_GRAPH_CLIENT_ID &&
    process.env.SUPPORT_GRAPH_CLIENT_SECRET &&
    process.env.SUPPORT_MAILBOX
  );
}

async function getAccessToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt - 60000 > now) return cachedToken;

  const tenantId = process.env.SUPPORT_GRAPH_TENANT_ID;
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.SUPPORT_GRAPH_CLIENT_ID,
    client_secret: process.env.SUPPORT_GRAPH_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await axios.post(tokenUrl, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  cachedToken = response.data.access_token;
  tokenExpiresAt = now + Number(response.data.expires_in || 3600) * 1000;
  return cachedToken;
}

async function graphRequest(config) {
  const token = await getAccessToken();
  const attempts = Number(process.env.SUPPORT_GRAPH_RETRY_ATTEMPTS || 3);
  const delayMs = Number(process.env.SUPPORT_GRAPH_RETRY_DELAY_MS || 1000);

  return retry(
    () => axios({
      ...config,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(config.headers || {}),
      },
    }),
    {
      attempts,
      delayMs,
      onRetry: (error, attempt) => {
        logger.warn(`Graph request failed on attempt ${attempt}: ${error.message}`);
      },
    }
  );
}

function stripHtml(html = '') {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapMessage(message, attachments) {
  const body = message.body || {};
  const bodyText = String(body.contentType || '').toLowerCase() === 'html'
    ? stripHtml(body.content || '')
    : String(body.content || '').trim();

  return {
    provider: 'microsoft-graph',
    provider_id: message.id,
    message_id: message.internetMessageId || `graph:${message.id}`,
    sender_email: message.from && message.from.emailAddress ? message.from.emailAddress.address : null,
    sender_name: message.from && message.from.emailAddress ? message.from.emailAddress.name : null,
    subject: message.subject || 'No subject',
    body: bodyText || '(No email body)',
    received_at: message.receivedDateTime,
    attachments,
  };
}

async function fetchAttachments(messageId) {
  const mailbox = encodeURIComponent(process.env.SUPPORT_MAILBOX);
  const response = await graphRequest({
    method: 'GET',
    url: `${GRAPH_BASE_URL}/users/${mailbox}/messages/${messageId}/attachments`,
    params: {
      '$top': 100,
    },
  });

  return (response.data.value || [])
    .filter((attachment) => attachment['@odata.type'] === '#microsoft.graph.fileAttachment')
    .map((attachment) => ({
      file_name: attachment.name || 'attachment',
      content_type: attachment.contentType || 'application/octet-stream',
      size_bytes: attachment.size || 0,
      content_base64: attachment.contentBytes || '',
      content_id: attachment.contentId || null,
      is_inline: Boolean(attachment.isInline),
    }));
}

async function fetchUnreadMessages(limit = 10) {
  if (!isConfigured()) {
    logger.warn('Support mailbox polling skipped: Microsoft Graph settings are not configured.');
    return [];
  }

  const mailbox = encodeURIComponent(process.env.SUPPORT_MAILBOX);
  const response = await graphRequest({
    method: 'GET',
    url: `${GRAPH_BASE_URL}/users/${mailbox}/mailFolders/inbox/messages`,
    params: {
      '$top': Math.min(Number(limit || 10), 50),
      '$filter': 'isRead eq false',
      '$select': 'id,internetMessageId,from,subject,body,receivedDateTime,hasAttachments,isRead',
    },
  });

  const messages = response.data.value || [];
  const normalized = [];

  for (const message of messages) {
    const attachments = message.hasAttachments ? await fetchAttachments(message.id) : [];
    normalized.push(mapMessage(message, attachments));
  }

  return normalized;
}

async function markMessageRead(providerId) {
  if (!providerId || !isConfigured()) return;

  const mailbox = encodeURIComponent(process.env.SUPPORT_MAILBOX);
  await graphRequest({
    method: 'PATCH',
    url: `${GRAPH_BASE_URL}/users/${mailbox}/messages/${providerId}`,
    data: { isRead: true },
  });
}

module.exports = {
  isConfigured,
  fetchUnreadMessages,
  markMessageRead,
};
