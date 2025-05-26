/**
 * Static routes for the application
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const { log, verboseEntry, verboseExit } = require('../utils');

/**
 * Home page route
 */
router.get('/', (req, res) => {
  verboseEntry('GET /', { url: req.url, headers: req.headers });
  try {
    res.sendFile(path.join(__dirname, '..', '..', 'public', 'index.html'), (err) => {
      if (err) {
        console.error('Error sending index.html:', err);
        res.status(500).send('Error loading the application');
      } else {
        verboseExit('GET /', 'Sent index.html');
      }
    });
  } catch (err) {
    log('ERROR', 'Failed to send index.html', err);
    res.status(500).send('Server error');
  }
});

/**
 * Health check endpoint
 */
router.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

/**
 * Diagnostic endpoint for browser debugging
 */
router.get('/diagnostics', async (req, res) => {
  verboseEntry('GET /diagnostics', {});

  try {
    // Get browser manager from browser.js
    const browserManager = require('../browser').browserManager;

    // Get current browser instance
    const currentBrowser = require('../browser').getCurrentBrowser();

    // Get page pool info
    const pagePool = require('../page').getPagePoolInfo();

    // Collect diagnostic information
    const diagnosticInfo = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      browser: {
        instance: currentBrowser
          ? {
              connected: currentBrowser.isConnected(),
              targetInfo: await currentBrowser
                .pages()
                .then((pages) => pages.length)
                .catch((e) => `Error: ${e.message}`),
              wsEndpoint: currentBrowser.wsEndpoint?.() || 'unknown'
            }
          : null,
        manager: {
          currentTabs: browserManager.currentTabs,
          maxTabs: browserManager.maxTabs,
          startTime: browserManager.browserStartTime,
          lastActivity: browserManager.lastActivityTime,
          isRestarting: browserManager.isRestarting,
          isInitializing: browserManager.isInitializing,
          pendingRequests: browserManager.pendingRequests.length,
          browserInfo: browserManager.browserInfo,
          pageHistory: browserManager.pageHistory.slice(-20) // Last 20 page events
        },
        errors: browserManager.browserErrors.slice(-20) // Last 20 errors
      },
      pagePool: pagePool,
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        env: {
          DEBUG: process.env.DEBUG,
          NODE_ENV: process.env.NODE_ENV,
          PUPPETEER_HEADLESS: process.env.PUPPETEER_HEADLESS
        }
      }
    };

    // Take a screenshot of all current pages if browser is connected
    if (currentBrowser && currentBrowser.isConnected()) {
      try {
        const pages = await currentBrowser.pages();
        diagnosticInfo.browser.pages = [];

        for (let i = 0; i < pages.length; i++) {
          try {
            const page = pages[i];
            const pageUrl = await page.url().catch(() => 'unknown');
            const pageTitle = await page.title().catch(() => 'unknown');

            // Take a screenshot
            const screenshotPath = `./logs/diagnostic-page-${i}-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });

            diagnosticInfo.browser.pages.push({
              index: i,
              url: pageUrl,
              title: pageTitle,
              screenshot: screenshotPath
            });
          } catch (pageError) {
            diagnosticInfo.browser.pages.push({
              index: i,
              error: pageError.message
            });
          }
        }
      } catch (pagesError) {
        diagnosticInfo.browser.pagesError = pagesError.message;
      }
    }

    log('INFO', 'Generated diagnostic information');
    res.json(diagnosticInfo);
    verboseExit('GET /diagnostics', 'Success');
  } catch (error) {
    log('ERROR', 'Error generating diagnostics:', error.stack || error);
    res.status(500).json({
      error: 'Failed to generate diagnostics',
      message: error.message,
      stack: error.stack
    });
    verboseExit('GET /diagnostics', 'Failed');
  }
});

module.exports = router;
