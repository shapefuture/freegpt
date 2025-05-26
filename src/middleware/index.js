/**
 * Express middleware configuration
 */
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config/app.config');
const { log } = require('../utils');

/**
 * Configure all middleware for the Express application
 * @param {express.Application} app - Express application
 */
function setupMiddleware(app) {
  // Security & CORS
  app.set('trust proxy', 1); // Trust first proxy

  // Use helmet with minimal configuration
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: config.cspDirectives
      },
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      hsts: false // Disable HSTS for development
    })
  );

  // CORS
  app.use(cors({ origin: '*' }));

  // Rate limiting
  app.use(rateLimit(config.rateLimitConfig));

  // Body parsing
  app.use(express.json());

  // Static files
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));

  // Request logging
  app.use((req, res, next) => {
    log('DEBUG', `${req.method} ${req.path}`);
    next();
  });
}

module.exports = {
  setupMiddleware
};
