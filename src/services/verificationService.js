/**
 * Service for performing initial verification checks
 */
const { log, generateUUID } = require('../utils');
const config = require('../config/app.config');
const { navigateToLMArena } = require('../navigation/lmarenaNavigator');
const freeProxyManager = require('../proxy/freeProxyManager');
const puppeteer = require('puppeteer');

/**
 * Performs initial verification checks for both model availability and Cloudflare/CAPTCHA
 * @returns {Promise<void>}
 */
async function performInitialVerificationChecks() {
  const requestId = generateUUID();
  log(
    'INFO',
    `Request ${requestId}: Starting initial verification checks for models and Cloudflare/CAPTCHA...`
  );

  // Initialize free proxy manager
  try {
    log('INFO', `Request ${requestId}: Initializing free proxy manager...`);
    await freeProxyManager.initialize();
    log('INFO', `Request ${requestId}: Free proxy manager initialized with ${freeProxyManager.activeProxies.length} active proxies`);

    // If no active proxies, fetch and test some
    if (freeProxyManager.activeProxies.length === 0) {
      log('INFO', `Request ${requestId}: No active proxies, fetching and testing...`);
      await freeProxyManager.fetchProxies();
      await freeProxyManager.testProxies();
      log('INFO', `Request ${requestId}: Now have ${freeProxyManager.activeProxies.length} active proxies`);
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error initializing free proxy manager: ${error.message}`);
  }

  // First, make sure we have a clean browser state
  try {
    // Get the browser manager
    const browserManager = require('../browser');

    // Close any existing browser
    log('INFO', `Request ${requestId}: Closing any existing browser to start fresh...`);
    await browserManager.closeBrowser();

    // Wait a moment for the browser to fully close
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Initialize a new browser with explicit launch options
    log('INFO', `Request ${requestId}: Initializing a fresh browser...`);

    // Force a new browser instance with specific launch options
    const puppeteer = require('puppeteer');

    // Get a proxy from the free proxy manager if available
    let proxyUrl = process.env.PROXY_SERVER_URL;

    // Try to use a free rotating proxy if no manual proxy is configured
    if (!proxyUrl && freeProxyManager.initialized) {
      // For LMArena verification, use a proxy that's known to work with it
      const proxy = freeProxyManager.getCurrentProxy(true); // true = require LMArena compatibility

      if (proxy) {
        proxyUrl = proxy.url;
        if (proxy.worksWithLMArena) {
          log('INFO', `Request ${requestId}: Using LMArena-compatible proxy from ${proxy.source}`);
        } else {
          log('INFO', `Request ${requestId}: Using free rotating proxy from ${proxy.source}`);
        }
      }
    }

    // Try to connect to an existing Chrome instance first
    let browser;

    try {
      log('INFO', `Request ${requestId}: Attempting to connect to existing Chrome instance...`);

      // Execute a command to find Chrome's debugging port
      const { exec } = require('child_process');
      const findChromePort = () => {
        return new Promise((resolve) => {
          exec('lsof -i TCP -sTCP:LISTEN | grep -i chrome | grep -i debug', (error, stdout) => {
            if (error) {
              // If error, Chrome might not be running with remote debugging
              log('DEBUG', `Request ${requestId}: No Chrome debugging port found: ${error.message}`);
              resolve(null);
              return;
            }

            // Parse the output to find the port
            const match = stdout.match(/:(\d+)/);
            if (match && match[1]) {
              const port = match[1];
              log('INFO', `Request ${requestId}: Found Chrome debugging port: ${port}`);
              resolve(port);
            } else {
              log('DEBUG', `Request ${requestId}: Chrome debugging port not found in output`);
              resolve(null);
            }
          });
        });
      };

      const debugPort = await findChromePort();

      if (debugPort) {
        // Connect to the existing Chrome instance
        browser = await puppeteer.connect({
          browserURL: `http://localhost:${debugPort}`,
          defaultViewport: null
        });
        log('INFO', `Request ${requestId}: Successfully connected to existing Chrome instance`);
      } else {
        // If no debugging port found, try to launch Chrome with remote debugging
        log('INFO', `Request ${requestId}: No existing Chrome debugging instance found. Launching Chrome with remote debugging...`);

        // Launch Chrome with remote debugging enabled
        const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        const debuggingPort = 9222;

        // Use spawn instead of exec for better control
        const { spawn } = require('child_process');
        const chromeProcess = spawn(CHROME_PATH, [
          `--remote-debugging-port=${debuggingPort}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--user-data-dir=/tmp/chrome-debug-profile',
          ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : []),
          'about:blank'
        ], {
          detached: true,
          stdio: 'ignore'
        });

        // Detach the process so it continues running after our process exits
        chromeProcess.unref();

        // Wait for Chrome to start
        log('INFO', `Request ${requestId}: Waiting for Chrome to start with debugging port ${debuggingPort}...`);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Connect to the Chrome instance we just launched
        browser = await puppeteer.connect({
          browserURL: `http://localhost:${debuggingPort}`,
          defaultViewport: null
        });
        log('INFO', `Request ${requestId}: Successfully connected to Chrome with remote debugging`);
      }
    } catch (connectError) {
      log('ERROR', `Request ${requestId}: Failed to connect to existing Chrome: ${connectError.message}`);
      log('INFO', `Request ${requestId}: Falling back to direct launch...`);

      // Fall back to direct launch
      browser = await puppeteer.launch({
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // Use installed Chrome
        headless: process.env.PUPPETEER_HEADLESS === 'true',
        defaultViewport: null,
        ignoreHTTPSErrors: true,
        args: [
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--window-size=1920,1080',
          '--start-maximized',
          '--no-first-run',
          '--no-zygote',
          ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : [])
        ],
        timeout: 90000,
        dumpio: process.env.DEBUG_MODE === 'true'
      });

      log('INFO', `Request ${requestId}: Successfully launched Chrome using installed executable`);
    }

    // Store the browser instance
    browserManager.setBrowser(browser);

    log('INFO', `Request ${requestId}: Browser initialized successfully with direct launch.`);
  } catch (browserError) {
    log('ERROR', `Request ${requestId}: Error initializing browser: ${browserError.message}`);
  }

  // Now perform the verification checks one at a time instead of in parallel
  try {
    // First, let's navigate to LMArena directly
    log('INFO', `Request ${requestId}: Navigating to LMArena...`);

    try {
      // Create a page directly from the browser
      const browser = require('../browser').getCurrentBrowser();
      if (!browser) {
        throw new Error('Browser not initialized');
      }

      log('INFO', `Request ${requestId}: Creating new page directly from browser...`);
      const page = await browser.newPage();

      // Add waitForTimeout function if it doesn't exist
      if (!page.waitForTimeout) {
        page.waitForTimeout = async function (timeout) {
          log('DEBUG', `Request ${requestId}: Using polyfill waitForTimeout(${timeout})`);
          return new Promise((resolve) => setTimeout(resolve, timeout));
        };
      }

      try {
        // Configure the page
        await page.setViewport({ width: 1920, height: 1080 });

        // Set extra headers
        await page.setExtraHTTPHeaders({
          'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"'
        });

        // Use our enhanced navigation strategy
        const navigationSuccess = await navigateToLMArena(page, {
          requestId,
          forceRefresh: true
        });

        if (navigationSuccess) {
          log('INFO', `Request ${requestId}: Successfully navigated to LMArena`);

          // 1. First check: Model availability
          log('INFO', `Request ${requestId}: Checking model availability...`);

          try {
            const modelsModule = require('../models');

            // Create a dummy SSE send function that just logs
            const dummySseSend = (data) => {
              log('DEBUG', `Request ${requestId}: Model check SSE update: ${JSON.stringify(data)}`);
            };

            // Take a screenshot before model extraction for debugging
            try {
              const screenshotPath = `./logs/model-extraction-before-${Date.now()}.png`;
              await page.screenshot({ path: screenshotPath, fullPage: true });
              log(
                'INFO',
                `Request ${requestId}: Saved model extraction screenshot to ${screenshotPath}`
              );
            } catch (screenshotError) {
              log(
                'WARN',
                `Request ${requestId}: Failed to take screenshot: ${screenshotError.message}`
              );
            }

            // Refresh the model cache using the existing page
            await modelsModule.refreshModelCache({
              sseSend: dummySseSend,
              requestId,
              page: page
            });

            log('INFO', `Request ${requestId}: Successfully refreshed model cache`);
          } catch (modelError) {
            log(
              'ERROR',
              `Request ${requestId}: Failed to refresh model cache: ${modelError.message}`
            );
          }

          // Wait a moment between checks
          await page.waitForTimeout(2000);

          // 2. Second check: Cloudflare/CAPTCHA verification
          log('INFO', `Request ${requestId}: Checking Cloudflare/CAPTCHA...`);

          try {
            // Create a dummy SSE send function that just logs
            const dummySseSend = (data) => {
              log('DEBUG', `Request ${requestId}: CAPTCHA check SSE update: ${JSON.stringify(data)}`);
            };

            // Get the puppeteer manager
            const puppeteerManager = require('../puppeteerManager');

            // Perform the CAPTCHA check using the existing page
            await puppeteerManager.interactWithLMArena(
              'Hello, this is a verification test. Please ignore.',
              {
                modelId: 'gpt-4', // Use a common model for testing
                sseSend: dummySseSend,
                autoSolveCaptcha: true,
                isVerificationTest: true, // Flag to indicate this is just a verification test
                requestId,
                page: page
              }
            );

            log(
              'INFO',
              `Request ${requestId}: Cloudflare/CAPTCHA verification completed successfully`
            );
          } catch (captchaError) {
            log(
              'WARN',
              `Request ${requestId}: Cloudflare/CAPTCHA verification encountered an issue: ${captchaError.message}`
            );
          }
        } else {
          log('ERROR', `Request ${requestId}: Failed to navigate to LMArena after multiple attempts`);
        }
      } finally {
        // Close the page directly
        try {
          await page.close();
          log('INFO', `Request ${requestId}: Closed page after verification`);
        } catch (closeError) {
          log('WARN', `Request ${requestId}: Error closing page: ${closeError.message}`);
        }
      }
    } catch (navigationError) {
      log(
        'ERROR',
        `Request ${requestId}: Failed to navigate to LMArena: ${navigationError.message}`
      );
    }

    log('INFO', `Request ${requestId}: Initial verification checks completed`);
  } catch (error) {
    log(
      'ERROR',
      `Request ${requestId}: Error during initial verification checks: ${error.message}`
    );
  }
}

module.exports = {
  performInitialVerificationChecks
};
