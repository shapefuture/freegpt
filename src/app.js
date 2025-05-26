/**
 * Main application file
 */
require('dotenv').config();
const express = require('express');
const { log } = require('./utils');
const config = require('./config/app.config');
const { setupMiddleware } = require('./middleware');
const { notFoundHandler, globalErrorHandler } = require('./middleware/errorHandlers');
const { performInitialVerificationChecks } = require('./services/verificationService');
const freeProxyManager = require('./proxy/freeProxyManager');
const puppeteerManager = require('./puppeteerManager');

// Create Express application
const app = express();

// Set up middleware
setupMiddleware(app);

// Register all routes
require('./routes').registerRoutes(app);

// Register error handlers
app.use(notFoundHandler);
app.use(globalErrorHandler);

/**
 * Start the server
 */
function startServer() {
  const server = app.listen(config.PORT, () => {
    log('INFO', `Server listening on port ${config.PORT}`);
    console.log(`\nApplication is running at: http://localhost:${config.PORT}\n`);

    // Perform initial verification checks after a short delay
    setTimeout(() => {
      performInitialVerificationChecks().catch((e) => {
        log('ERROR', 'Failed to perform initial verification checks:', e);
      });
    }, 2000);

    // Auto-open the browser when the server starts
    if (process.env.NODE_ENV !== 'production') {
      const { exec } = require('child_process');
      const url = `http://localhost:${config.PORT}`;
      const start =
        process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      exec(`${start} ${url}`);
    }
  });

  return server;
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  log('INFO', 'SIGINT received, shutting down...');
  await puppeteerManager.closeBrowser();

  // Save proxy cache before exit
  if (freeProxyManager.initialized) {
    try {
      await freeProxyManager.saveToCache();
      log('INFO', 'Saved free proxy cache before shutdown');
    } catch (error) {
      log('WARN', `Error saving proxy cache: ${error.message}`);
    }
  }

  process.exit(0);
});

process.on('SIGTERM', async () => {
  log('INFO', 'SIGTERM received, shutting down...');
  await puppeteerManager.closeBrowser();

  // Save proxy cache before exit
  if (freeProxyManager.initialized) {
    try {
      await freeProxyManager.saveToCache();
      log('INFO', 'Saved free proxy cache before shutdown');
    } catch (error) {
      log('WARN', `Error saving proxy cache: ${error.message}`);
    }
  }

  process.exit(0);
});

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

// Export the app for testing
module.exports = app;
