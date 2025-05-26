/**
 * Error handling middleware
 */
const path = require('path');
const { log } = require('../utils');

/**
 * 404 handler for non-API routes
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next function
 */
function notFoundHandler(req, res, next) {
  if (req.path.startsWith('/api/'))
    return res.status(404).json({ error: 'API endpoint not found' });
  res.status(404).sendFile(path.join(__dirname, '..', '..', 'public', '404.html'));
}

/**
 * Global error handler
 * @param {Error} err - Error object
 * @param {import('express').Request} req - Express request
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Express next function
 */
function globalErrorHandler(err, req, res, next) {
  log('ERROR', 'Express error handler', err.stack || err);
  
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.status(500).sendFile(path.join(__dirname, '..', '..', 'public', '500.html'));
  }
}

module.exports = {
  notFoundHandler,
  globalErrorHandler
};
