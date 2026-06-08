const validator = require('validator');
const HttpError = require('../../../errors/HttpError');

function normalizeEmail(email) {
  if (!email) return '';
  const trimmed = String(email).trim();
  const angleMatch = trimmed.match(/<([^>]+)>/);
  return (angleMatch ? angleMatch[1] : trimmed).toLowerCase();
}

function getAllowedDomains() {
  return String(process.env.SUPPORT_ALLOWED_SENDER_DOMAINS || '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
}

function validateSenderEmail(email) {
  const normalized = normalizeEmail(email);

  if (!validator.isEmail(normalized)) {
    throw new HttpError(400, 'Invalid requester email address', 'INVALID_SENDER');
  }

  const allowedDomains = getAllowedDomains();
  if (allowedDomains.length > 0) {
    const domain = normalized.split('@')[1];
    if (!allowedDomains.includes(domain)) {
      throw new HttpError(403, 'Sender domain is not allowed', 'SENDER_DOMAIN_NOT_ALLOWED');
    }
  }

  return normalized;
}

module.exports = {
  normalizeEmail,
  validateSenderEmail,
};
