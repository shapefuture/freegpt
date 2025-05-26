/**
 * Page management module
 * @module page
 */

const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');
const browser = require('./browser');
const config = require('./config');

// Get the browser manager from the browser module
const browserManager = browser;

// Page pool for reusing pages
const pagePool = {
  pages: [],
  maxSize: parseInt(process.env.MAX_TABS || '1', 10), // Maximum number of pages to keep in the pool
  maxConcurrent: parseInt(process.env.MAX_TABS || '1', 10), // Maximum number of concurrent pages - STRICT LIMIT
  inUse: new Map(), // Track which pages are currently in use
  pendingRequests: [], // Queue for pending page requests
  tabCount: 0, // Track total number of tabs created
  maxTabsAllowed: parseInt(process.env.MAX_TABS || '2', 10), // Absolute maximum number of tabs allowed
  forceCloseTimeout: 30000 // Force close tabs after 30 seconds of inactivity
};

/**
 * Gets a page from the pool or creates a new one
 * @param {Object} options - Options for the page
 * @param {string} [options.requestId] - Request ID for logging
 * @param {boolean} [options.reuseExisting=true] - Whether to try to reuse an existing page
 * @param {boolean} [options.priority=false] - Whether this request should be prioritized
 * @returns {Promise<import('puppeteer').Page>} The page instance
 * @throws {Error} If page creation fails
 */
async function getPage(options = {}) {
  const requestId = options.requestId || generateUUID();
  const reuseExisting = options.reuseExisting !== false;
  const priority = options.priority === true;
  verboseEntry('page.getPage', { requestId, reuseExisting, priority });

  // Check if we're already at max concurrent pages and need to queue
  const currentlyInUse = pagePool.inUse.size;
  if (!priority && currentlyInUse >= pagePool.maxConcurrent) {
    log(
      'INFO',
      `Request ${requestId}: Max concurrent pages reached (${currentlyInUse}/${pagePool.maxConcurrent}). Queueing request.`
    );

    // Create a promise that will resolve when a page becomes available
    return new Promise((resolve, reject) => {
      const queuedRequest = {
        requestId,
        options,
        resolve,
        reject,
        timestamp: Date.now()
      };

      // Add to queue (priority requests go to the front)
      if (priority) {
        pagePool.pendingRequests.unshift(queuedRequest);
      } else {
        pagePool.pendingRequests.push(queuedRequest);
      }

      // Set a timeout to reject the request if it takes too long
      setTimeout(() => {
        // Only reject if the request is still in the queue
        const index = pagePool.pendingRequests.findIndex((req) => req.requestId === requestId);
        if (index !== -1) {
          const request = pagePool.pendingRequests.splice(index, 1)[0];
          log('WARN', `Request ${requestId}: Page request timed out after 60 seconds in queue.`);
          request.reject(new Error('Page request timed out in queue'));
        }
      }, 60000); // 60 second timeout
    });
  }

  try {
    // Get the browser instance
    const browser = await browserManager.getBrowser();

    // Check if the browser needs to be restarted
    await browserManager.checkAndRestartBrowser({ requestId });

    // Force close any pages that have been in use for too long
    await forceCloseInactivePages(requestId);

    // Enforce the browser tab limit
    await browserManager.enforceTabLimit({ requestId });

    // Check if we can create a new tab
    const canCreate = await browserManager.canCreateTab({
      requestId,
      force: priority
    });

    // If we can't create a new tab and this isn't a priority request, queue it
    if (!canCreate && !priority) {
      log(
        'WARN',
        `Request ${requestId}: Browser tab limit reached (${browserManager.currentTabs}/${browserManager.maxTabs}). Waiting for tabs to close.`
      );

      // Wait for a tab to be closed before proceeding
      return new Promise((resolve, reject) => {
        const queuedRequest = {
          requestId,
          options,
          resolve,
          reject,
          timestamp: Date.now(),
          isTabLimitWait: true
        };

        // Add to queue with high priority
        pagePool.pendingRequests.unshift(queuedRequest);

        // Set a timeout to reject the request if it takes too long
        setTimeout(() => {
          // Only reject if the request is still in the queue
          const index = pagePool.pendingRequests.findIndex((req) => req.requestId === requestId);
          if (index !== -1) {
            const request = pagePool.pendingRequests.splice(index, 1)[0];
            log('WARN', `Request ${requestId}: Tab limit wait timed out after 60 seconds.`);
            request.reject(new Error('Tab limit wait timed out'));
          }
        }, 60000); // 60 second timeout
      });
    }

    // Try to get an available page from the pool if reuse is enabled
    if (reuseExisting) {
      // Find a page that's not in use
      const availablePage = pagePool.pages.find(
        (page) => !pagePool.inUse.has(page) && !page.isClosed()
      );

      if (availablePage) {
        log('DEBUG', `Request ${requestId}: Reusing page from pool.`);

        try {
          // Mark the page as in use
          pagePool.inUse.set(availablePage, {
            requestId,
            timestamp: Date.now()
          });

          // Navigate to blank page to reset state
          await availablePage.goto('about:blank', { waitUntil: 'networkidle2' });
          log('INFO', `Request ${requestId}: Reusing existing page, navigated to about:blank.`);

          verboseExit('page.getPage', 'Reused existing page from pool');
          return availablePage;
        } catch (e) {
          log('WARN', `Request ${requestId}: Failed to reuse page from pool:`, e.message);
          pagePool.inUse.delete(availablePage);

          // Remove the page from the pool
          pagePool.pages = pagePool.pages.filter((p) => p !== availablePage);
          pagePool.tabCount = Math.max(0, pagePool.tabCount - 1);

          try {
            await availablePage.close();
          } catch (closeErr) {
            log('WARN', `Request ${requestId}: Error closing stale page:`, closeErr.message);
          }
        }
      } else {
        log('DEBUG', `Request ${requestId}: No available pages in pool or reuse disabled.`);
      }
    }

    // Check if we can create a new page without exceeding the limit
    if (pagePool.tabCount >= pagePool.maxTabsAllowed) {
      log(
        'WARN',
        `Request ${requestId}: Cannot create new page, maximum tab limit reached (${pagePool.tabCount}/${pagePool.maxTabsAllowed}).`
      );
      throw new Error(
        `Maximum tab limit reached (${pagePool.tabCount}/${pagePool.maxTabsAllowed})`
      );
    }

    // Create a new page
    log('DEBUG', `Request ${requestId}: Creating new page in browser instance.`);
    const newPage = await browser.newPage();
    pagePool.tabCount++; // Increment tab count
    log(
      'INFO',
      `Request ${requestId}: New page created. Total tabs: ${pagePool.tabCount}/${pagePool.maxTabsAllowed}`
    );

    // Configure the page
    await configurePage(newPage, requestId);

    // Set up a listener for page close events to decrement the tab count
    newPage.once('close', () => {
      pagePool.tabCount = Math.max(0, pagePool.tabCount - 1);
      log('DEBUG', `Page closed. Total tabs: ${pagePool.tabCount}/${pagePool.maxTabsAllowed}`);

      // Process any pending requests that were waiting for tab limit
      processTabLimitQueue();
    });

    // Add to pool and mark as in use
    if (pagePool.pages.length >= pagePool.maxSize) {
      // Remove the oldest page if we've reached the max pool size
      const oldestPage = pagePool.pages.shift();
      if (!oldestPage.isClosed() && !pagePool.inUse.has(oldestPage)) {
        try {
          await oldestPage.close();
          pagePool.tabCount = Math.max(0, pagePool.tabCount - 1);
          log(
            'DEBUG',
            `Request ${requestId}: Closed oldest page in pool to make room. Total tabs: ${pagePool.tabCount}/${pagePool.maxTabsAllowed}`
          );
        } catch (e) {
          log('WARN', `Request ${requestId}: Error closing oldest page in pool:`, e.message);
        }
      }
    }

    // Add the new page to the pool and mark it as in use
    pagePool.pages.push(newPage);
    pagePool.inUse.set(newPage, {
      requestId,
      timestamp: Date.now()
    });

    verboseExit('page.getPage', 'Created and configured new page');
    return newPage;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in getPage:`, error.stack || error);
    verboseExit('page.getPage', 'Failed');
    throw error;
  }
}

/**
 * Configures a page with default settings
 * @param {import('puppeteer').Page} page - The page to configure
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<void>}
 */
async function configurePage(page, requestId) {
  verboseEntry('page.configurePage', { requestId });

  try {
    // Add waitForTimeout function if it doesn't exist
    if (!page.waitForTimeout) {
      page.waitForTimeout = async function (timeout) {
        log('DEBUG', `Request ${requestId}: Using polyfill waitForTimeout(${timeout})`);
        return new Promise((resolve) => setTimeout(resolve, timeout));
      };
    }

    // Set extra HTTP headers
    try {
      log('DEBUG', `Request ${requestId}: Setting extra HTTP headers.`);
      await page.setExtraHTTPHeaders(config.browser.headers);
      log('DEBUG', `Request ${requestId}: Extra HTTP headers set.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to set extra HTTP headers:`, e.message);
    }

    // Bypass CSP
    try {
      log('DEBUG', `Request ${requestId}: Bypassing CSP.`);
      await page.setBypassCSP(true);
      log('DEBUG', `Request ${requestId}: CSP bypass set.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to bypass CSP:`, e.message);
    }

    // Set geolocation and permissions
    try {
      log('DEBUG', `Request ${requestId}: Setting geolocation and permissions.`);
      const context = page.browserContext();
      await context.overridePermissions(config.lmArena.url, ['geolocation']);
      await page.setGeolocation(config.browser.geolocation);
      log('DEBUG', `Request ${requestId}: Geolocation and permissions set.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to set geolocation or permissions:`, e.message);
    }

    // Set timezone
    try {
      log('DEBUG', `Request ${requestId}: Setting timezone.`);
      await setRandomTimezone(page, requestId);
      log('DEBUG', `Request ${requestId}: Timezone set.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to set timezone:`, e.message);
    }

    // Set viewport
    try {
      log('DEBUG', `Request ${requestId}: Setting viewport.`);
      const viewportWidth = config.browser.viewport.width + Math.floor(Math.random() * 100) - 50;
      const viewportHeight = config.browser.viewport.height + Math.floor(Math.random() * 100) - 50;
      await page.setViewport({
        ...config.browser.viewport,
        width: viewportWidth,
        height: viewportHeight
      });
      log('DEBUG', `Request ${requestId}: Viewport set to ${viewportWidth}x${viewportHeight}.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to set viewport:`, e.message);
    }

    // Set user agent
    try {
      log('DEBUG', `Request ${requestId}: Setting user agent.`);
      // Use the first user agent in the list (Chrome 136)
      const userAgent = config.browser.userAgents[0];
      await page.setUserAgent(userAgent);
      log('DEBUG', `Request ${requestId}: User agent set to: ${userAgent}`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to set user agent:`, e.message);
    }

    // Set timeouts
    try {
      log('DEBUG', `Request ${requestId}: Setting timeouts.`);
      await page.setDefaultNavigationTimeout(config.browser.timeouts.navigation);
      await page.setDefaultTimeout(config.browser.timeouts.action);
      log('DEBUG', `Request ${requestId}: Timeouts set.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to set timeouts:`, e.message);
    }

    // Inject Turnstile sniffing script
    try {
      log('DEBUG', `Request ${requestId}: Injecting Turnstile sniffing script.`);
      await injectTurnstileSniffingScript(page, requestId);
      log('DEBUG', `Request ${requestId}: Turnstile sniffing script injected.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to inject Turnstile sniffing script:`, e.message);
    }

    verboseExit('page.configurePage', 'Success');
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in configurePage:`, error.stack || error);
    verboseExit('page.configurePage', 'Failed');
    throw error;
  }
}

/**
 * Sets a random timezone on the page
 * @param {import('puppeteer').Page} page - The page to set the timezone on
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<void>}
 */
async function setRandomTimezone(page, requestId) {
  verboseEntry('page.setRandomTimezone', { requestId });

  try {
    await page.evaluateOnNewDocument(() => {
      try {
        const timezones = [
          'America/New_York',
          'America/Chicago',
          'America/Denver',
          'America/Los_Angeles',
          'Europe/London',
          'Europe/Paris',
          'Asia/Tokyo',
          'Australia/Sydney'
        ];
        const randomTz = timezones[Math.floor(Math.random() * timezones.length)];

        // Override timezone if Intl is available
        if (window.Intl && window.Intl.DateTimeFormat) {
          console.log('DEBUG', `Overriding timezone to ${randomTz}`);
          Object.defineProperty(Intl, 'DateTimeFormat', {
            value: class extends Intl.DateTimeFormat {
              constructor(locales, options) {
                const opts = options || {};
                super(locales, { ...opts, timeZone: opts.timeZone || randomTz });
              }
            },
            configurable: true
          });
        } else {
          console.log('DEBUG', 'Intl.DateTimeFormat not available for timezone override.');
        }
      } catch (e) {
        console.error('Error setting timezone via evaluateOnNewDocument:', e);
      }
    });

    verboseExit('page.setRandomTimezone', 'Success');
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in setRandomTimezone:`, error.stack || error);
    verboseExit('page.setRandomTimezone', 'Failed');
    throw error;
  }
}

/**
 * Injects a script to sniff Turnstile parameters
 * @param {import('puppeteer').Page} page - The page to inject the script into
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<void>}
 */
async function injectTurnstileSniffingScript(page, requestId) {
  verboseEntry('page.injectTurnstileSniffingScript', { requestId });

  try {
    await page.evaluateOnNewDocument(() => {
      try {
        window.capturedTurnstileParams = {};
        const originalTurnstileRender = window.turnstile?.render;
        if (originalTurnstileRender) {
          console.log('DEBUG', 'Intercepting window.turnstile.render');
          window.turnstile = new Proxy(window.turnstile, {
            get(target, prop) {
              if (prop === 'render') {
                return function (element, options) {
                  console.log('DEBUG', 'Captured turnstile render options', options);
                  window.capturedTurnstileParams = {
                    sitekey: options.sitekey,
                    action: options.action,
                    cData: options.cData,
                    chlPageData: options.chlPageData,
                    callbackName: options.callback?.name
                  };
                  return originalTurnstileRender.apply(target, [element, options]);
                };
              }
              return target[prop];
            }
          });
        } else {
          console.log('DEBUG', 'window.turnstile.render not found to intercept.');
        }
      } catch (e) {
        console.error('Error injecting turnstile sniffing script:', e);
      }
    });

    verboseExit('page.injectTurnstileSniffingScript', 'Success');
  } catch (error) {
    log(
      'ERROR',
      `Request ${requestId}: Error in injectTurnstileSniffingScript:`,
      error.stack || error
    );
    verboseExit('page.injectTurnstileSniffingScript', 'Failed');
    throw error;
  }
}

/**
 * Releases a page back to the pool
 * @param {import('puppeteer').Page} page - The page to release
 * @param {Object} options - Options for releasing the page
 * @param {string} [options.requestId] - Request ID for logging
 * @param {boolean} [options.forceClose=false] - Whether to force close the page instead of returning it to the pool
 * @returns {Promise<void>}
 */
async function releasePage(page, options = {}) {
  const requestId = options.requestId || generateUUID();
  const forceClose = options.forceClose === true;
  verboseEntry('page.releasePage', { requestId, forceClose });

  try {
    if (!page || page.isClosed()) {
      log('DEBUG', `Request ${requestId}: Page is already closed or null, nothing to release.`);
      verboseExit('page.releasePage', 'Page already closed');
      return;
    }

    // Check if this page is in our pool
    if (pagePool.pages.includes(page) && !forceClose) {
      // Mark the page as no longer in use
      pagePool.inUse.delete(page);
      log('INFO', `Request ${requestId}: Page released back to pool.`);

      // Navigate to blank page to reset state
      try {
        await page.goto('about:blank', { waitUntil: 'networkidle2', timeout: 5000 });
        log('DEBUG', `Request ${requestId}: Released page navigated to about:blank.`);
      } catch (e) {
        log(
          'WARN',
          `Request ${requestId}: Failed to navigate released page to about:blank:`,
          e.message
        );
        // Don't remove from pool yet, it might still be usable
      }

      // Process any pending requests in the queue
      processPageQueue(requestId);

      verboseExit('page.releasePage', 'Page released to pool');
    } else {
      // Remove from pool if it's there
      if (pagePool.pages.includes(page)) {
        pagePool.pages = pagePool.pages.filter((p) => p !== page);
      }

      // Remove from in-use map if it's there
      if (pagePool.inUse.has(page)) {
        pagePool.inUse.delete(page);
      }

      log(
        'DEBUG',
        `Request ${requestId}: ${
          forceClose ? 'Force closing page' : 'Page not found in pool, closing it'
        }.`
      );

      try {
        await page.close();
        pagePool.tabCount = Math.max(0, pagePool.tabCount - 1);
        log(
          'INFO',
          `Request ${requestId}: Page closed successfully. Total tabs: ${pagePool.tabCount}/${pagePool.maxTabsAllowed}`
        );

        // Process any tab limit wait requests
        processTabLimitQueue();
      } catch (e) {
        log('WARN', `Request ${requestId}: Error during page close:`, e.message);
      }

      verboseExit('page.releasePage', 'Page closed');
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in releasePage:`, error.stack || error);
    verboseExit('page.releasePage', 'Failed');
  }
}

/**
 * Force close pages that have been inactive for too long
 * @param {string} requestId - Request ID for logging
 */
async function forceCloseInactivePages(requestId) {
  const now = Date.now();
  const pagesToClose = [];

  // Find pages that have been in use for too long
  for (const [page, info] of pagePool.inUse.entries()) {
    if (info && info.timestamp && now - info.timestamp > pagePool.forceCloseTimeout) {
      pagesToClose.push({
        page,
        requestId: info.requestId,
        inactiveTime: now - info.timestamp
      });
    }
  }

  // Close the inactive pages
  for (const { page, requestId: pageRequestId, inactiveTime } of pagesToClose) {
    try {
      log(
        'WARN',
        `Request ${requestId}: Force closing page for request ${pageRequestId} after ${Math.round(
          inactiveTime / 1000
        )}s of inactivity.`
      );

      // Remove from pool and in-use map
      pagePool.inUse.delete(page);
      pagePool.pages = pagePool.pages.filter((p) => p !== page);

      // Close the page
      if (!page.isClosed()) {
        await page.close();
        pagePool.tabCount = Math.max(0, pagePool.tabCount - 1);
        log(
          'INFO',
          `Request ${requestId}: Force closed inactive page. Total tabs: ${pagePool.tabCount}/${pagePool.maxTabsAllowed}`
        );
      }
    } catch (e) {
      log('ERROR', `Request ${requestId}: Error force closing inactive page:`, e.message);
    }
  }

  return pagesToClose.length;
}

/**
 * Process the queue of requests waiting for tab limit
 */
function processTabLimitQueue() {
  // Check if there are any tab limit wait requests in the queue
  const tabLimitWaitIndex = pagePool.pendingRequests.findIndex((req) => req.isTabLimitWait);

  if (tabLimitWaitIndex !== -1 && pagePool.tabCount < pagePool.maxTabsAllowed) {
    // Get the request from the queue
    const nextRequest = pagePool.pendingRequests.splice(tabLimitWaitIndex, 1)[0];
    log('INFO', `Processing queued tab limit wait request ${nextRequest.requestId}.`);

    // Set priority to true to bypass the queue check
    const options = {
      ...nextRequest.options,
      priority: true
    };

    // Get a page for the queued request
    getPage(options)
      .then((page) => {
        log(
          'INFO',
          `Successfully got page for queued tab limit wait request ${nextRequest.requestId}.`
        );
        nextRequest.resolve(page);
      })
      .catch((error) => {
        log(
          'ERROR',
          `Failed to get page for queued tab limit wait request ${nextRequest.requestId}:`,
          error.message
        );
        nextRequest.reject(error);
      });
  }
}

/**
 * Process the queue of pending page requests
 * @param {string} requestId - Request ID for logging
 */
function processPageQueue(requestId) {
  // First process any tab limit wait requests
  processTabLimitQueue();

  // Then process regular queue requests
  if (pagePool.pendingRequests.length > 0) {
    // Find the first request that is not a tab limit wait
    const regularRequestIndex = pagePool.pendingRequests.findIndex((req) => !req.isTabLimitWait);

    if (regularRequestIndex !== -1) {
      // Get the next request from the queue
      const nextRequest = pagePool.pendingRequests.splice(regularRequestIndex, 1)[0];
      log('INFO', `Request ${requestId}: Processing queued page request ${nextRequest.requestId}.`);

      // Set priority to true to bypass the queue check
      const options = {
        ...nextRequest.options,
        priority: true
      };

      // Get a page for the queued request
      getPage(options)
        .then((page) => {
          log(
            'INFO',
            `Request ${requestId}: Successfully got page for queued request ${nextRequest.requestId}.`
          );
          nextRequest.resolve(page);
        })
        .catch((error) => {
          log(
            'ERROR',
            `Request ${requestId}: Failed to get page for queued request ${nextRequest.requestId}:`,
            error.message
          );
          nextRequest.reject(error);
        });
    }
  }
}

/**
 * Closes a specific page
 * @param {import('puppeteer').Page} page - The page to close
 * @param {Object} options - Options for closing the page
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<void>}
 */
async function closeSpecificPage(page, options = {}) {
  const requestId = options.requestId || generateUUID();
  verboseEntry('page.closeSpecificPage', { requestId });

  try {
    if (!page || page.isClosed()) {
      log('DEBUG', `Request ${requestId}: Page is already closed or null.`);
      verboseExit('page.closeSpecificPage', 'Page already closed');
      return;
    }

    // Remove from pool if it's there
    pagePool.pages = pagePool.pages.filter((p) => p !== page);
    pagePool.inUse.delete(page);

    // Close the page
    log('INFO', `Request ${requestId}: Closing page.`);
    try {
      await page.close();
      pagePool.tabCount = Math.max(0, pagePool.tabCount - 1);
      log(
        'INFO',
        `Request ${requestId}: Page closed successfully. Total tabs: ${pagePool.tabCount}/${pagePool.maxTabsAllowed}`
      );

      // Process any tab limit wait requests
      processTabLimitQueue();
    } catch (e) {
      log('WARN', `Request ${requestId}: Error during page close:`, e.message);
    }

    verboseExit('page.closeSpecificPage', 'Success');
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in closeSpecificPage:`, error.stack || error);
    verboseExit('page.closeSpecificPage', 'Failed');
  }
}

/**
 * Closes all pages in the pool
 * @returns {Promise<void>}
 */
async function closeAllPages() {
  verboseEntry('page.closeAllPages', {});

  try {
    const pagesToClose = [...pagePool.pages];

    for (const page of pagesToClose) {
      if (!page.isClosed()) {
        log('INFO', 'Closing pooled page.');
        try {
          await page.close();
          log('INFO', 'Pooled page closed successfully.');
        } catch (e) {
          log('WARN', 'Error during page close:', e.message);
        }
      }
    }

    // Clear the pool
    pagePool.pages = [];
    pagePool.inUse.clear();
    pagePool.tabCount = 0;
    log('INFO', 'Reset tab count to 0.');

    verboseExit('page.closeAllPages', 'Success');
  } catch (error) {
    log('ERROR', 'Error in closeAllPages:', error.stack || error);
    verboseExit('page.closeAllPages', 'Failed');
    throw error;
  }
}

/**
 * Gets diagnostic information about the page pool
 * @returns {Object} Page pool information
 */
function getPagePoolInfo() {
  try {
    // Create a safe copy of the page pool for diagnostics
    const poolInfo = {
      maxSize: pagePool.maxSize,
      maxConcurrent: pagePool.maxConcurrent,
      maxTabsAllowed: pagePool.maxTabsAllowed,
      tabCount: pagePool.tabCount,
      forceCloseTimeout: pagePool.forceCloseTimeout,
      pagesInPool: pagePool.pages.length,
      pagesInUse: pagePool.inUse.size,
      pendingRequests: pagePool.pendingRequests.length,
      pendingRequestsInfo: pagePool.pendingRequests.map((req) => ({
        requestId: req.requestId,
        timestamp: req.timestamp,
        isTabLimitWait: req.isTabLimitWait || false,
        waitTime: Date.now() - (req.timestamp || Date.now())
      }))
    };

    // Add information about pages in the pool
    poolInfo.pageDetails = [];

    for (const page of pagePool.pages) {
      try {
        const inUse = pagePool.inUse.has(page);
        const inUseInfo = inUse ? pagePool.inUse.get(page) : null;

        poolInfo.pageDetails.push({
          isClosed: page.isClosed?.() || false,
          inUse: inUse,
          requestId: inUseInfo?.requestId || null,
          inUseTime: inUseInfo?.timestamp ? Date.now() - inUseInfo.timestamp : null
        });
      } catch (e) {
        poolInfo.pageDetails.push({
          error: `Error getting page details: ${e.message}`
        });
      }
    }

    return poolInfo;
  } catch (error) {
    return {
      error: `Error getting page pool info: ${error.message}`
    };
  }
}

module.exports = {
  getPage,
  configurePage,
  releasePage,
  closeSpecificPage,
  closeAllPages,
  setRandomTimezone,
  injectTurnstileSniffingScript,
  getPagePoolInfo
};
