const Redis = require('ioredis');
const emailService = require('./emailService');
require('dotenv').config();
let logger;
try { logger = require(__root + 'logger'); } catch (e) { logger = require('../../logger'); }

const REQUIRE_REDIS = process.env.REQUIRE_REDIS !== 'false';
let redis = null;
if (REQUIRE_REDIS && process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL);
    redis.on('error', (err) =>
      logger.warn('Redis error (otpService):', err && err.message)
    );
  } catch (e) {
    logger.warn('Failed to initialize Redis client (otpService):', e && e.message);
    redis = null;
  }
} else {
  if (process.env.REDIS_URL)
    logger.info('REQUIRE_REDIS is false — otpService skipping Redis client creation');
}


function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function _storeOtp(keyId, code, ttlSeconds = 5 * 60) {
  if (redis) {
    await redis.set(`otp:${String(keyId)}`, code, 'EX', ttlSeconds);
    return;
  }
  if (!global.__otps) global.__otps = new Map();
  global.__otps.set(String(keyId), { code, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function _getAndDeleteOtp(keyId) {
  if (redis) {
    const key = `otp:${String(keyId)}`;
    const stored = await redis.get(key);
    if (stored) await redis.del(key);
    return stored;
  }
  const rec = global.__otps && global.__otps.get(String(keyId));
  if (!rec) return null;
  if (Date.now() > rec.expiresAt) {
    global.__otps.delete(String(keyId));
    return null;
  }
  global.__otps.delete(String(keyId));
  return rec.code;
}

async function sendOtp(email, userId) {
  const code = generateCode();
  const ttlSeconds = parseInt(process.env.OTP_TTL_SECONDS || String(5 * 60), 10);

  try {
    try { logger.info('otpService: sendOtp start', { to: email, userId }); } catch (e) {}

    await _storeOtp(userId, code, ttlSeconds);

    const subject = process.env.OTP_SUBJECT || 'Your one-time verification code';
    const text = `Your one-time verification code is: ${code}. It expires in ${Math.floor(ttlSeconds / 60)} minute(s).`;
    const html = `<p>Your one-time verification code is: <strong>${code}</strong>.</p><p>It expires in ${Math.floor(ttlSeconds / 60)} minute(s).</p>`;
    const tpl = emailService.otpTemplate(code, Math.floor(ttlSeconds / 60));
    const sentRes = await emailService.sendEmail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
    try {
      logger.info('otpService: sendOtp attempt', { to: email, sent: !!sentRes.sent, error: sentRes.error || null });
    } catch (e) {}
    if (!sentRes.sent) logger.warn('OTP (fallback):', code);

    const resp = { code, expiresAt: Date.now() + ttlSeconds * 1000, sent: !!sentRes.sent };
    if (process.env.DEV_INCLUDE_OTP === 'true') resp.code = code;
    return resp;
  } catch (e) {
    logger.error('otpService: sendOtp failed', e && e.message ? e.message : String(e));
    const resp = { code, expiresAt: Date.now() + ttlSeconds * 1000, sent: false };
    if (process.env.DEV_INCLUDE_OTP === 'true') resp.code = code;
    return resp;
  }
}

async function verifyOtp(userId, code) {
  const stored = await _getAndDeleteOtp(userId);
  if (process.env.OTP_DEBUG === 'true') {
    try {
      logger.debug(`[OTP DEBUG] verifyOtp userId=${userId} provided=${code} stored=${stored}`);
    } catch (e) {}
  }
  if (!stored) return false;
  return String(stored) === String(code);
}

async function sendNotification({ to, subject, text, html }) {
  const r = await emailService.sendEmail({ to, subject, text, html });
  return !!r.sent;
}

async function resendOtp(email, userId) {
  logger.info(`Resending OTP for userId: ${userId}`);
  const code = generateCode();
  const ttlSeconds = parseInt(process.env.OTP_TTL_SECONDS || String(5 * 60), 10);
  await _storeOtp(userId, code, ttlSeconds);

  const subject = process.env.OTP_SUBJECT || 'Your verification code (Resent)';
  const text = `Your new verification code is: ${code}. It expires in ${Math.floor(ttlSeconds / 60)} minute(s).`;
  const html = `<p>Your new verification code is: <strong>${code}</strong>.</p><p>It expires in ${Math.floor(ttlSeconds / 60)} minute(s).</p>`;

  try {
    const tpl = emailService.otpTemplate(code, Math.floor(ttlSeconds / 60));
    const sentRes = await emailService.sendEmail({ to: email, subject: tpl.subject, text: tpl.text, html: tpl.html });
    try {
      logger.info('otpService: resendOtp attempt', { to: email, sent: !!sentRes.sent, error: sentRes.error || null });
    } catch (e) {}
    if (!sentRes.sent) logger.warn('Resent OTP (fallback):', code);

    const resp = { code, expiresAt: Date.now() + ttlSeconds * 1000, sent: !!sentRes.sent };
    if (process.env.DEV_INCLUDE_OTP === 'true') resp.code = code;
    return resp;
  } catch (e) {
    logger.error('otpService: resendOtp failed', e && e.message ? e.message : String(e));
    const resp = { code, expiresAt: Date.now() + ttlSeconds * 1000, sent: false };
    if (process.env.DEV_INCLUDE_OTP === 'true') resp.code = code;
    return resp;
  }
}

module.exports = {
  sendOtp,
  resendOtp, 
  verifyOtp,
  sendNotification
};
