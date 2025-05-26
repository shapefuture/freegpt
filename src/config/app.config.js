/**
 * Application configuration
 */
require('dotenv').config();
const winston = require('winston');
const { log } = require('../utils');

// Create logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [new winston.transports.File({ filename: 'logs/app.log' })]
});

// Runtime ENV validation
const REQUIRED_ENV_VARS = ['LMARENA_URL', 'PORT'];
REQUIRED_ENV_VARS.forEach((envKey) => {
  if (!process.env[envKey]) {
    log('WARN', `Missing environment variable: ${envKey}`);
    logger.warn({ message: `Missing environment variable: ${envKey}` });
  }
});

// Log proxy configuration if present
if (process.env.PROXY_SERVER_URL) {
  const redactedProxy = process.env.PROXY_SERVER_URL.replace(/(https?:\/\/)([^:]+):([^@]+)@/, '$1****:****@');
  log('INFO', `Proxy configured: ${redactedProxy}`);
} else {
  log('INFO', 'No proxy configured. Using direct connection.');
}

// CSP directives
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  upgradeInsecureRequests: []
};

// Rate limiting configuration
const rateLimitConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again after 10 minutes'
};

// Known working proxy for LMArena
const KNOWN_WORKING_PROXY = "http://47.250.11.111:10000";

module.exports = {
  PORT: process.env.PORT || 8080,
  LMARENA_URL: process.env.LMARENA_URL || 'https://beta.lmarena.ai/',
  PROXY_SERVER_URL: process.env.PROXY_SERVER_URL,
  KNOWN_WORKING_PROXY,
  PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS === 'true',
  DEBUG_MODE: process.env.DEBUG_MODE === 'true',
  MAX_TABS: parseInt(process.env.MAX_TABS || '3', 10),
  cspDirectives,
  rateLimitConfig,
  logger
};
