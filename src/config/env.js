const Joi = require('joi');
require('dotenv').config();
 
let logger = console;
try { logger = require('../../logger'); } catch (e) {  }
 
const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production').default('development'),
  PORT: Joi.number().required(),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.alternatives().try(Joi.number().port(), Joi.string()).required(),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().min(8).required(),
  JWT_EXPIRES_IN: Joi.string().required(),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  MAX_FILE_SIZE: Joi.number().required(),
  UPLOAD_PATH: Joi.string().required(),
  REDIS_URL: Joi.string().uri().allow('').optional(),
  FRONTEND_URL: Joi.string().uri().required(),
  BASE_URL: Joi.string().uri().required(),
}).unknown(true);
 
const { error, value: rawEnv } = schema.validate(process.env, { abortEarly: false });
if (error) {
  logger.error('Environment validation error:', error.details.map(d => d.message).join(', '));
  throw new Error('Invalid environment configuration');
}
const env = {
  NODE_ENV: rawEnv.NODE_ENV,
  PORT: Number(rawEnv.PORT),
 
  DB_HOST: rawEnv.DB_HOST,
  DB_PORT: rawEnv.DB_PORT,
  DB_USER: rawEnv.DB_USER,
  DB_PASSWORD: rawEnv.DB_PASSWORD,
  DB_NAME: rawEnv.DB_NAME,
 
  JWT_SECRET: rawEnv.JWT_SECRET,
  JWT_EXPIRES_IN: rawEnv.JWT_EXPIRES_IN,
 
  SMTP_HOST: rawEnv.SMTP_HOST,
  SMTP_PORT: rawEnv.SMTP_PORT,
  SMTP_USER: rawEnv.SMTP_USER,
  SMTP_PASS: rawEnv.SMTP_PASS,
 
  MAX_FILE_SIZE: Number(rawEnv.MAX_FILE_SIZE),
  UPLOAD_PATH: rawEnv.UPLOAD_PATH,
 
  REDIS_URL: rawEnv.REDIS_URL || null,
  FRONTEND_URL: rawEnv.FRONTEND_URL,
  BASE_URL: rawEnv.BASE_URL,
};
if (env.NODE_ENV === 'production') {
  if (!env.DB_HOST || !env.DB_USER || !env.DB_NAME) {
    logger.error('Environment validation error: DB_HOST, DB_USER and DB_NAME are required in production');
    throw new Error('Invalid environment configuration: missing DB config');
  }
  if (!env.JWT_SECRET || String(env.JWT_SECRET).length < 32) {
    logger.error('Environment validation error: JWT_SECRET must be at least 32 characters in production');
    throw new Error('Invalid environment configuration: weak JWT_SECRET');
  }
}
 
if (env.NODE_ENV !== 'production') {
    if (!env.JWT_SECRET || String(env.JWT_SECRET).length < 8) {
    const crypto = require('crypto');
    const gen = crypto.randomBytes(32).toString('hex');
    logger.warn('No JWT_SECRET provided or too short for development — generating a temporary secret. Do NOT use in production.');
    env.JWT_SECRET = gen;
  }
}
 
module.exports = env;
 
 