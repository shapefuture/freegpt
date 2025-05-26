/**
 * Routes index file
 */
const express = require('express');
const apiRoutes = require('./api.routes');
const staticRoutes = require('./static.routes');
const freeProxyRoutes = require('../proxy/freeProxyRoutes');

/**
 * Register all routes
 * @param {express.Application} app - Express application
 */
function registerRoutes(app) {
  // API routes
  app.use('/api', apiRoutes);
  
  // Free proxy routes
  app.use('/api/free-proxy', freeProxyRoutes);
  
  // Static routes
  app.use('/', staticRoutes);
}

module.exports = {
  registerRoutes
};
