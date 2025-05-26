/**
 * Browser management module
 * @module browser
 */

const { connect } = require('puppeteer-real-browser');
const puppeteer = require('puppeteer');
const { log, verboseEntry, verboseExit } = require('./utils');
const config = require('./config');
const fs = require('fs');
const path = require('path');
const os = require('os');
const freeProxyManager = require('./proxy/freeProxyManager');

// Path to the installed Chrome on macOS
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Global browser instance
let browserInstance = null;

// Browser lock file
const LOCK_FILE = path.join(os.tmpdir(), 'freegpt-browser.lock');

// Browser manager state
const browserManager = {
  isInitializing: false,
  isRestarting: false,
  initializationPromise: null,
  browserStartTime: null,
  lastActivityTime: null,
  currentTabs: 0,
  maxTabs: parseInt(process.env.MAX_TABS || '3', 10),
  pendingRequests: [],
  browserErrors: [],
  pageHistory: [],
  rotationEnabled: true,
  currentProfileIndex: 0,
  failedAttempts: 0,
  maxFailedAttempts: 3,
  forceRestartTimeout: 5 * 60 * 1000, // 5 minutes
  browserInfo: null
};

// Browser profiles
const browserProfiles = [
  {
    name: 'Chrome Mac',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    headers: {
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"'
    }
  },
  {
    name: 'Chrome Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    headers: {
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    }
  },
  {
    name: 'Safari Mac',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    viewport: { width: 1920, height: 1080 },
    headers: {
      'sec-ch-ua': '"Not.A/Brand";v="99", "Apple Safari";v="17"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"'
    }
  },
  {
    name: 'Edge Windows',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0',
    viewport: { width: 1920, height: 1080 },
    headers: {
      'sec-ch-ua': '"Chromium";v="136", "Microsoft Edge";v="136", "Not.A/Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"'
    }
  }
];

/**
 * Acquires the browser initialization lock
 * @returns {Promise<boolean>} Whether the lock was acquired
 */
async function acquireBrowserLock() {
  try {
    // Check if lock file exists
    if (fs.existsSync(LOCK_FILE)) {
      const lockContent = fs.readFileSync(LOCK_FILE, 'utf8');
      const lockPid = parseInt(lockContent, 10);

      // Check if the process that owns the lock is still running
      try {
        process.kill(lockPid, 0);
        log('WARN', `Failed to acquire browser lock. Current owner: ${lockContent}`);
        return false;
      } catch (e) {
        // Process is not running, we can take the lock
        log('INFO', `Taking over stale lock from non-existent process ${lockPid}`);
      }
    }

    // Create lock file with our PID
    fs.writeFileSync(LOCK_FILE, String(process.pid));
    log('DEBUG', `Acquired browser lock. PID: ${process.pid}`);
    return true;
  } catch (error) {
    log('ERROR', `Error acquiring browser lock: ${error.message}`);
    return false;
  }
}

/**
 * Releases the browser initialization lock
 */
function releaseBrowserLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const lockContent = fs.readFileSync(LOCK_FILE, 'utf8');

      // Only remove the lock if we own it
      if (lockContent === String(process.pid)) {
        fs.unlinkSync(LOCK_FILE);
        log('DEBUG', 'Released browser lock.');
      } else {
        log('WARN', `Not releasing browser lock owned by another process: ${lockContent}`);
      }
    }
  } catch (error) {
    log('ERROR', `Error releasing browser lock: ${error.message}`);
  }
}

/**
 * Initializes the browser instance if not already running
 * @param {Object} [options] - Options for initialization
 * @param {Object} [options.profile] - Browser profile to use
 * @param {boolean} [options.forceNew=false] - Whether to force a new browser instance
 * @returns {Promise<import('puppeteer').Browser>} The browser instance
 * @throws {Error} If browser initialization fails
 */
async function initialize(options = {}) {
  const { profile = null, forceNew = false } = options;
  verboseEntry('browser.initialize', {
    profileName: profile?.name,
    forceNew
  });

  // If already initializing, wait for that to complete
  if (!forceNew && browserManager.isInitializing && browserManager.initializationPromise) {
    log('INFO', 'Browser initialization already in progress. Waiting for it to complete...');
    try {
      await browserManager.initializationPromise;
      verboseExit('browser.initialize', 'Used existing initialization');
      return browserInstance;
    } catch (error) {
      log('WARN', `Existing initialization failed: ${error.message}`);
      // Continue with a new initialization attempt
    }
  }

  // Set initialization flag and create a new promise
  browserManager.isInitializing = true;
  browserManager.initializationPromise = initializeBrowser(options);

  try {
    const result = await browserManager.initializationPromise;
    verboseExit('browser.initialize', 'Browser initialized successfully');
    return result;
  } catch (error) {
    verboseExit('browser.initialize', 'Failed to initialize browser');
    throw error;
  }
}

/**
 * Internal function to initialize the browser
 * @param {Object} options - Initialization options
 * @returns {Promise<import('puppeteer').Browser>} The browser instance
 */
async function initializeBrowser(options = {}) {
  const { profile = null } = options;

  try {
    // Try to acquire the browser lock
    const lockAcquired = await acquireBrowserLock();

    if (!lockAcquired) {
      // Wait a bit and check if browser becomes available
      await new Promise((resolve) => setTimeout(resolve, 5000));

      // If browser is already connected, return it
      if (browserInstance && browserInstance.isConnected()) {
        log('DEBUG', 'Browser instance already exists and is connected after waiting for lock.');
        return browserInstance;
      }

      log('WARN', 'Could not acquire browser lock. Proceeding with caution...');
    }

    // If browser is already connected, return it
    if (browserInstance && browserInstance.isConnected()) {
      log('DEBUG', 'Browser instance already exists and is connected.');

      // Release lock if we acquired it
      if (lockAcquired) {
        releaseBrowserLock();
      }

      return browserInstance;
    }

    log('INFO', 'Attempting to connect to existing browser instance...');

    try {
      // Get the browser profile to use
      const browserProfile =
        profile ||
        (browserManager.rotationEnabled ? getNextBrowserProfile() : browserProfiles[0]);
      log('INFO', `Using browser profile: ${browserProfile.name}`);

      // Get a proxy from the free proxy manager if available
      let proxyUrl = process.env.PROXY_SERVER_URL;

      // Determine if we're connecting to LMArena
      const isLMArenaUrl = options && options.url && options.url.includes('lmarena.ai');

      // Always use the known working proxy for LMArena
      const knownWorkingProxyUrl = "http://47.250.11.111:10000";

      if (isLMArenaUrl) {
        // For LMArena, always use the known working proxy
        proxyUrl = knownWorkingProxyUrl;
        log('INFO', `Using known working proxy for LMArena: ${knownWorkingProxyUrl}`);
      }
      // Try to use a free rotating proxy if no manual proxy is configured
      else if (!proxyUrl && freeProxyManager.initialized) {
        // For other sites, use any proxy
        const proxy = freeProxyManager.getCurrentProxy(false);

        if (proxy) {
          proxyUrl = proxy.url;
          log('INFO', `Using free rotating proxy from ${proxy.source}`);
        }
      }

      // Try to launch Chrome directly first, then fall back to connect method
      const launchOptions = {
        ...config.browser.launchOptions,
        executablePath: CHROME_PATH, // Use the installed Chrome
        env: {
          ...process.env
        },
        defaultViewport: browserProfile.viewport,
        extraHTTPHeaders: browserProfile.headers,
        args: [
          ...(config.browser.launchOptions.args || []),
          ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : [])
        ]
      };

      log('DEBUG', 'Launching with options:', JSON.stringify(launchOptions));
      log('INFO', `Using installed Chrome at: ${CHROME_PATH}`);

      try {
        // First try to connect to an existing Chrome instance
        try {
          log('INFO', 'Attempting to connect to existing Chrome instance...');

          // Execute a command to find Chrome's debugging port
          const { exec } = require('child_process');
          const findChromePort = () => {
            return new Promise((resolve, reject) => {
              exec('lsof -i TCP -sTCP:LISTEN | grep -i chrome | grep -i debug', (error, stdout, stderr) => {
                if (error) {
                  // If error, Chrome might not be running with remote debugging
                  log('DEBUG', `No Chrome debugging port found: ${error.message}`);
                  resolve(null);
                  return;
                }

                // Parse the output to find the port
                const match = stdout.match(/:(\d+)/);
                if (match && match[1]) {
                  const port = match[1];
                  log('INFO', `Found Chrome debugging port: ${port}`);
                  resolve(port);
                } else {
                  log('DEBUG', 'Chrome debugging port not found in output');
                  resolve(null);
                }
              });
            });
          };

          const debugPort = await findChromePort();

          if (debugPort) {
            // Connect to the existing Chrome instance
            browserInstance = await puppeteer.connect({
              browserURL: `http://localhost:${debugPort}`,
              defaultViewport: browserProfile.viewport
            });
            log('INFO', 'Successfully connected to existing Chrome instance');
          } else {
            // If no debugging port found, try to launch Chrome with remote debugging
            log('INFO', 'No existing Chrome debugging instance found. Launching Chrome with remote debugging...');

            // Use spawn instead of exec for better control
            const { spawn } = require('child_process');

            // Launch Chrome with remote debugging enabled
            const debuggingPort = 9222;
            log('INFO', `Launching Chrome with remote debugging port ${debuggingPort}...`);

            const chromeArgs = [
              `--remote-debugging-port=${debuggingPort}`,
              '--no-first-run',
              '--no-default-browser-check',
              '--user-data-dir=/tmp/chrome-debug-profile',
              ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : []),
              'about:blank'
            ];

            log('DEBUG', `Chrome launch command: ${CHROME_PATH} ${chromeArgs.join(' ')}`);

            const chromeProcess = spawn(CHROME_PATH, chromeArgs, {
              detached: true,
              stdio: 'ignore'
            });

            // Detach the process so it continues running after our process exits
            chromeProcess.unref();

            // Wait for Chrome to start
            log('INFO', 'Waiting for Chrome to start...');
            await new Promise(resolve => setTimeout(resolve, 3000));

            try {
              // Connect to the Chrome instance we just launched
              log('INFO', `Connecting to Chrome at http://localhost:${debuggingPort}...`);
              browserInstance = await puppeteer.connect({
                browserURL: `http://localhost:${debuggingPort}`,
                defaultViewport: browserProfile.viewport
              });
              log('INFO', 'Successfully connected to Chrome with remote debugging');
            } catch (connectError) {
              log('ERROR', `Failed to connect to Chrome with remote debugging: ${connectError.message}`);
              throw connectError;
            }
          }
        } catch (connectError) {
          log('ERROR', `Failed to connect to existing Chrome: ${connectError.message}`);
          log('INFO', 'Falling back to direct launch...');

          // Fall back to direct launch
          browserInstance = await puppeteer.launch(launchOptions);
          log('INFO', 'Successfully launched Chrome using installed executable');
        }
      } catch (directLaunchError) {
        log('ERROR', `All Chrome connection methods failed: ${directLaunchError.message}`);
        log('INFO', 'Falling back to puppeteer-real-browser connect method');

        try {
          // Fall back to connect method
          const connectOptions = {
            ...config.browser.connectionOptions,
            env: {
              ...process.env
            },
            defaultViewport: browserProfile.viewport,
            extraHTTPHeaders: browserProfile.headers,
            args: [
              ...(config.browser.launchOptions.args || []),
              ...(proxyUrl ? [`--proxy-server=${proxyUrl}`] : [])
            ]
          };

          log('DEBUG', 'Connecting with options:', JSON.stringify(connectOptions));
          log('INFO', `Attempting to connect to browser at ${connectOptions.browserURL || 'default URL'}`);

          const result = await connect(connectOptions);
          browserInstance = result.browser;
        } catch (connectError) {
          log('ERROR', `Failed to connect using puppeteer-real-browser: ${connectError.message}`);
          throw connectError;
        }
      }

      // Apply profile settings to the browser
      const pages = await browserInstance.pages();
      if (pages.length > 0) {
        try {
          // Set user agent and viewport on the default page
          await pages[0].setUserAgent(browserProfile.userAgent);
          await pages[0].setViewport(browserProfile.viewport);
          await pages[0].setExtraHTTPHeaders(browserProfile.headers);
          log('DEBUG', `Applied profile settings to default page: ${browserProfile.name}`);
        } catch (e) {
          log('WARN', `Error applying profile settings to default page: ${e.message}`);
        }
      }

      // Store browser information
      browserManager.browserInfo = {
        connected: true,
        connectionTime: Date.now(),
        wsEndpoint: browserInstance.wsEndpoint?.() || 'unknown',
        version: await browserInstance
          .version()
          .catch((e) => `Error getting version: ${e.message}`),
        userAgent: await browserInstance
          .userAgent()
          .catch((e) => `Error getting userAgent: ${e.message}`)
      };

      log('INFO', 'Successfully connected to existing browser instance.');
      log('DEBUG', `Browser info: ${JSON.stringify(browserManager.browserInfo)}`);
    } catch (connectError) {
      log('ERROR', `Connection error details: ${connectError.stack || connectError}`);
      browserManager.browserErrors.push({
        type: 'connectionError',
        timestamp: Date.now(),
        error: connectError.stack || String(connectError)
      });
      throw connectError;
    }

    // Reset browser manager state
    browserManager.browserStartTime = Date.now();
    browserManager.lastActivityTime = Date.now();
    browserManager.currentTabs = 0;

    // Count existing pages
    const pages = await browserInstance.pages();
    browserManager.currentTabs = pages.length;
    log('INFO', `Browser has ${browserManager.currentTabs} existing tabs.`);

    // Release lock if we acquired it
    if (lockAcquired) {
      releaseBrowserLock();
    }

    return browserInstance;
  } catch (error) {
    log('ERROR', `Browser initialization failed: ${error.message}`);
    throw error;
  } finally {
    browserManager.isInitializing = false;
  }
}

/**
 * Gets the current browser instance or initializes a new one
 * @returns {Promise<import('puppeteer').Browser>} The browser instance
 */
async function getBrowser() {
  verboseEntry('browser.getBrowser', {});

  try {
    // Check if we need to restart the browser
    await checkAndRestartBrowser();

    // If browser is not connected, initialize it
    if (!browserInstance || !browserInstance.isConnected()) {
      log('DEBUG', 'No connected browser instance found, initializing...');
      await initialize();
    }

    // Enforce tab limit
    await enforceTabLimit();

    verboseExit('browser.getBrowser', 'Success');
    return browserInstance;
  } catch (error) {
    log('ERROR', 'Error in getBrowser:', error.stack || error);
    verboseExit('browser.getBrowser', 'Failed');
    throw error;
  }
}

/**
 * Closes the browser instance
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  verboseEntry('browser.closeBrowser', {});

  try {
    // Release any browser lock we might have
    releaseBrowserLock();

    if (browserInstance) {
      log('INFO', 'Closing browser instance.');

      // Close all pages first to ensure clean shutdown
      try {
        const pages = await browserInstance.pages();
        log('INFO', `Closing ${pages.length} open tabs before closing browser.`);

        for (const page of pages) {
          try {
            await page.close();
            log('DEBUG', 'Closed a tab during browser shutdown.');
          } catch (e) {
            log('WARN', `Error closing tab during browser shutdown: ${e.message}`);
          }
        }
      } catch (e) {
        log('WARN', `Error getting pages during browser shutdown: ${e.message}`);
      }

      // Now close the browser
      try {
        await browserInstance.close();
        log('INFO', 'Browser instance closed successfully.');
      } catch (e) {
        log('WARN', 'Error during browser close:', e.message);
      }
    } else {
      log('DEBUG', 'No browser instance to close.');
    }

    browserInstance = null;
    browserManager.currentTabs = 0;
    browserManager.isInitializing = false;
    browserManager.initializationPromise = null;

    verboseExit('browser.closeBrowser', 'Success');
  } catch (error) {
    log('ERROR', 'Error in closeBrowser:', error.stack || error);
    verboseExit('browser.closeBrowser', 'Failed');
    throw error;
  }
}

/**
 * Gets the current browser instance if it exists
 * @returns {import('puppeteer').Browser|null} The current browser instance or null
 */
function getCurrentBrowser() {
  return browserInstance;
}

/**
 * Enforces the tab limit by closing excess tabs
 * @param {Object} options - Options for enforcing
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<number>} Number of tabs closed
 */
async function enforceTabLimit(options = {}) {
  const { requestId = 'system' } = options;

  try {
    if (!browserInstance || !browserInstance.isConnected()) {
      return 0;
    }

    // Get all pages
    const pages = await browserInstance.pages();

    // Update current tab count
    browserManager.currentTabs = pages.length;

    // If we're over the limit, close excess tabs
    if (browserManager.currentTabs > browserManager.maxTabs) {
      log(
        'WARN',
        `Request ${requestId}: Too many tabs open (${browserManager.currentTabs}/${browserManager.maxTabs}). Closing excess tabs.`
      );

      let tabsClosed = 0;

      // Sort pages by creation time (if available) to close newest ones first
      // Keep the first tab (usually about:blank)
      for (
        let i = pages.length - 1;
        i > 0 && browserManager.currentTabs > browserManager.maxTabs;
        i--
      ) {
        try {
          await pages[i].close();
          browserManager.currentTabs--;
          tabsClosed++;
          log(
            'INFO',
            `Request ${requestId}: Closed excess tab. Remaining tabs: ${browserManager.currentTabs}/${browserManager.maxTabs}`
          );
        } catch (e) {
          log('WARN', `Request ${requestId}: Error closing excess tab: ${e.message}`);
        }
      }

      return tabsClosed;
    }

    return 0;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error enforcing tab limit:`, error.stack || error);
    return 0;
  }
}

/**
 * Checks if a new tab can be created
 * @param {Object} options - Options for checking
 * @param {string} [options.requestId] - Request ID for logging
 * @param {boolean} [options.force=false] - Whether to force tab creation even if at limit
 * @returns {Promise<boolean>} Whether a new tab can be created
 */
async function canCreateTab(options = {}) {
  const { requestId = 'system', force = false } = options;

  // If forcing, always allow
  if (force) {
    return true;
  }

  // Check if we're at or over the tab limit
  if (browserManager.currentTabs >= browserManager.maxTabs) {
    log(
      'WARN',
      `Request ${requestId}: Cannot create new tab, at tab limit (${browserManager.currentTabs}/${browserManager.maxTabs}).`
    );
    return false;
  }

  return true;
}

/**
 * Checks and restarts the browser if needed
 * @param {Object} options - Options for checking
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<boolean>} Whether the browser was restarted
 */
async function checkAndRestartBrowser(options = {}) {
  const { requestId = 'system' } = options;

  // If we're already restarting, don't try again
  if (browserManager.isRestarting) {
    return false;
  }

  const now = Date.now();
  const timeSinceStart = now - (browserManager.browserStartTime || now);
  const timeSinceActivity = now - (browserManager.lastActivityTime || now);

  // If the browser has been running for more than 30 minutes, restart it
  if (timeSinceStart > 30 * 60 * 1000) {
    log(
      'INFO',
      `Request ${requestId}: Browser has been running for ${Math.round(
        timeSinceStart / 1000 / 60
      )} minutes. Restarting.`
    );
    await restartBrowser({ requestId });
    return true;
  }

  // If the browser has been inactive for more than 5 minutes, restart it
  if (timeSinceActivity > browserManager.forceRestartTimeout) {
    log(
      'INFO',
      `Request ${requestId}: Browser has been inactive for ${Math.round(
        timeSinceActivity / 1000 / 60
      )} minutes. Restarting.`
    );
    await restartBrowser({ requestId });
    return true;
  }

  return false;
}

/**
 * Restarts the browser
 * @param {Object} options - Options for restarting
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<void>}
 */
async function restartBrowser(options = {}) {
  const { requestId = 'system' } = options;

  // If already restarting, don't try again
  if (browserManager.isRestarting) {
    log('INFO', `Request ${requestId}: Browser restart already in progress. Waiting...`);

    // Wait for the current restart to complete
    let waitTime = 0;
    while (browserManager.isRestarting && waitTime < 30000) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waitTime += 1000;
    }

    if (browserManager.isRestarting) {
      log('WARN', `Request ${requestId}: Browser restart is taking too long. Proceeding anyway.`);
    } else {
      log('INFO', `Request ${requestId}: Existing browser restart completed.`);
      return;
    }
  }

  // Set restarting flag
  browserManager.isRestarting = true;

  try {
    log('INFO', `Request ${requestId}: Restarting browser...`);

    // Try to acquire the browser lock
    const lockAcquired = await acquireBrowserLock();

    if (!lockAcquired) {
      log(
        'WARN',
        `Request ${requestId}: Could not acquire browser lock for restart. Proceeding with caution...`
      );
    }

    // Close the browser
    await closeBrowser();

    // Wait a bit for the browser to fully close
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Initialize a new browser
    await initialize();

    // Release lock if we acquired it
    if (lockAcquired) {
      releaseBrowserLock();
    }

    log('INFO', `Request ${requestId}: Browser restarted successfully.`);
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error restarting browser:`, error.stack || error);
  } finally {
    // Clear restarting flag
    browserManager.isRestarting = false;
  }
}

/**
 * Sets the browser instance directly
 * @param {import('puppeteer').Browser} browser - The browser instance to set
 * @returns {void}
 */
function setBrowser(browser) {
  if (!browser) {
    log('ERROR', 'Cannot set null browser instance');
    return;
  }

  // Store the browser instance
  browserInstance = browser;
  browserManager.browserStartTime = Date.now();
  browserManager.lastActivityTime = Date.now();
  browserManager.currentTabs = 0;
  browserManager.isRestarting = false;
  browserManager.isInitializing = false;
  browserManager.initializationPromise = null;

  // Store browser information
  browserManager.browserInfo = {
    connected: true,
    connectionTime: Date.now(),
    wsEndpoint: browser.wsEndpoint?.() || 'unknown',
    version: 'Direct launch',
    userAgent: 'Direct launch'
  };

  log('INFO', 'Browser instance set directly');
}

/**
 * Gets the next browser profile for rotation
 * @returns {Object} The next browser profile
 */
function getNextBrowserProfile() {
  const profile = browserProfiles[browserManager.currentProfileIndex];
  browserManager.currentProfileIndex =
    (browserManager.currentProfileIndex + 1) % browserProfiles.length;
  log('INFO', `Rotating to browser profile: ${profile.name}`);
  return profile;
}

/**
 * Gets a specific browser profile by name
 * @param {string} name - The name of the profile to get
 * @returns {Object|null} The browser profile or null if not found
 */
function getBrowserProfileByName(name) {
  const profile = browserProfiles.find((p) => p.name === name);
  if (!profile) {
    log('WARN', `Browser profile not found: ${name}`);
    return null;
  }
  return profile;
}

/**
 * Rotates to the next browser profile and restarts the browser
 * @param {Object} options - Options for rotation
 * @param {string} [options.requestId] - Request ID for logging
 * @param {string} [options.profileName] - Specific profile name to use (optional)
 * @param {boolean} [options.force=false] - Whether to force rotation even if disabled
 * @param {number} [options.waitTime=2000] - Time to wait between closing and reopening browser
 * @returns {Promise<boolean>} Whether the rotation was successful
 */
async function rotateBrowserProfile(options = {}) {
  const { requestId = 'system', profileName = null, force = false, waitTime = 2000 } = options;

  verboseEntry('browser.rotateBrowserProfile', {
    requestId,
    profileName,
    force,
    waitTime
  });

  if (!browserManager.rotationEnabled && !force) {
    log('INFO', `Request ${requestId}: Browser profile rotation is disabled.`);
    verboseExit('browser.rotateBrowserProfile', 'Skipped: rotation disabled');
    return false;
  }

  try {
    log('INFO', `Request ${requestId}: Rotating browser profile...`);

    // Get the next profile or a specific one if requested
    const profile = profileName ? getBrowserProfileByName(profileName) : getNextBrowserProfile();

    if (!profile) {
      log('WARN', `Request ${requestId}: Failed to get browser profile for rotation.`);
      verboseExit('browser.rotateBrowserProfile', 'Failed: profile not found');
      return false;
    }

    log('INFO', `Request ${requestId}: Rotating to profile: ${profile.name}`);

    // Close the current browser
    await closeBrowser();

    // Wait a bit for the browser to fully close
    log('DEBUG', `Request ${requestId}: Waiting ${waitTime}ms for browser to fully close`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // Initialize with the new profile
    await initialize({ profile });

    log('INFO', `Request ${requestId}: Browser profile rotated successfully to ${profile.name}`);
    verboseExit('browser.rotateBrowserProfile', 'Success');
    return true;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error rotating browser profile:`, error.stack || error);
    verboseExit('browser.rotateBrowserProfile', 'Failed: error');
    return false;
  }
}

/**
 * Handles a failed request by incrementing the failed attempts counter
 * and potentially rotating the browser profile
 * @param {Object} options - Options for handling
 * @param {string} [options.requestId] - Request ID for logging
 * @param {string} [options.error] - Error message
 * @returns {Promise<boolean>} Whether the browser profile was rotated
 */
async function handleFailedRequest(options = {}) {
  const { requestId = 'system', error = 'unknown error' } = options;

  // Increment failed attempts
  browserManager.failedAttempts++;

  log(
    'WARN',
    `Request ${requestId}: Request failed (${browserManager.failedAttempts}/${browserManager.maxFailedAttempts}): ${error}`
  );

  // If we've reached the max failed attempts, rotate the browser profile
  if (browserManager.failedAttempts >= browserManager.maxFailedAttempts) {
    log(
      'INFO',
      `Request ${requestId}: Max failed attempts reached (${browserManager.failedAttempts}). Rotating browser profile.`
    );

    // Reset failed attempts
    browserManager.failedAttempts = 0;

    // Rotate browser profile
    return await rotateBrowserProfile({ requestId });
  }

  return false;
}

module.exports = {
  initialize,
  getBrowser,
  closeBrowser,
  getCurrentBrowser,
  canCreateTab,
  enforceTabLimit,
  checkAndRestartBrowser,
  restartBrowser,
  setBrowser,
  getNextBrowserProfile,
  getBrowserProfileByName,
  rotateBrowserProfile,
  handleFailedRequest,
  browserManager,
  browserProfiles
};
