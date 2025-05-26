/**
 * Puppeteer Manager for LMArena interactions
 * @module puppeteerManager
 */

const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');
const browserManager = require('./browser');
const pageManager = require('./page');
const captchaHandler = require('./captcha');
const dialogHandler = require('./dialog');
const networkHandler = require('./network');
const modelManager = require('./models');
const interaction = require('./interaction');
const config = require('./config');

/**
 * Initializes the Puppeteer browser instance if not already running.
 * @returns {Promise<void>}
 */
async function initialize() {
  verboseEntry('puppeteerManager.initialize', {});

  try {
    await browserManager.initialize();
    verboseExit('puppeteerManager.initialize', 'Browser ready');
  } catch (e) {
    log('ERROR', 'Error in initialize:', e.stack || e);
    verboseExit('puppeteerManager.initialize', 'Failed');
    throw e;
  }
}

/**
 * Launches or returns an existing Puppeteer page instance.
 * @param {Object} options - Options for getting the page
 * @param {string} [options.requestId] - Request ID for logging
 * @param {boolean} [options.reuseExisting=true] - Whether to try to reuse an existing page
 * @param {boolean} [options.priority=false] - Whether this request should be prioritized
 * @returns {Promise<import('puppeteer').Page>}
 */
async function launchOrGetPage(options = {}) {
  const requestId = options.requestId || generateUUID();
  const priority = options.priority === true;
  verboseEntry('puppeteerManager.launchOrGetPage', { requestId, priority });

  try {
    const page = await pageManager.getPage({
      requestId,
      reuseExisting: options.reuseExisting !== false,
      priority
    });
    verboseExit('puppeteerManager.launchOrGetPage', 'Success');
    return page;
  } catch (err) {
    log('ERROR', `Request ${requestId}: FATAL Error in launchOrGetPage:`, err.stack || err);
    verboseExit('puppeteerManager.launchOrGetPage', 'Failed');
    throw err;
  }
}

/**
 * Releases a page back to the pool.
 * @param {import('puppeteer').Page} page - The page to release
 * @param {Object} options - Options for releasing the page
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<void>}
 */
async function releasePage(page, options = {}) {
  const requestId = options.requestId || generateUUID();
  verboseEntry('puppeteerManager.releasePage', { requestId });

  try {
    await pageManager.releasePage(page, { requestId });
    verboseExit('puppeteerManager.releasePage', 'Success');
  } catch (e) {
    log('ERROR', `Request ${requestId}: Error in releasePage:`, e.stack || e);
    verboseExit('puppeteerManager.releasePage', 'Failed');
  }
}

/**
 * Closes a specific page.
 * @param {import('puppeteer').Page} page - The page to close
 * @param {Object} options - Options for closing the page
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<void>}
 */
async function closeSpecificPage(page, options = {}) {
  const requestId = options.requestId || generateUUID();
  verboseEntry('puppeteerManager.closeSpecificPage', { requestId });

  try {
    await pageManager.closeSpecificPage(page, { requestId });
    verboseExit('puppeteerManager.closeSpecificPage', 'Success');
  } catch (e) {
    log('ERROR', `Request ${requestId}: Error in closeSpecificPage:`, e.stack || e);
    verboseExit('puppeteerManager.closeSpecificPage', 'Failed');
  }
}

/**
 * Closes all pages in the pool.
 * @returns {Promise<void>}
 */
async function closeAllPages() {
  verboseEntry('puppeteerManager.closeAllPages', {});

  try {
    await pageManager.closeAllPages();
    verboseExit('puppeteerManager.closeAllPages', 'Success');
  } catch (e) {
    log('ERROR', 'Error in closeAllPages:', e.stack || e);
    verboseExit('puppeteerManager.closeAllPages', 'Failed');
    throw e;
  }
}

/**
 * Closes the browser instance.
 * @returns {Promise<void>}
 */
async function closeBrowser() {
  verboseEntry('puppeteerManager.closeBrowser', {});

  try {
    await browserManager.closeBrowser();
    verboseExit('puppeteerManager.closeBrowser', 'Success');
  } catch (e) {
    log('ERROR', 'Error in closeBrowser:', e.stack || e);
    verboseExit('puppeteerManager.closeBrowser', 'Failed');
    throw e;
  }
}

/**
 * Checks if a CAPTCHA is present on the page
 * @param {import('puppeteer').Page} page - The page to check
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<boolean>} True if CAPTCHA is present, false otherwise
 */
async function handleCaptchaIfPresent(page, requestId) {
  verboseEntry('puppeteerManager.handleCaptchaIfPresent', { requestId });

  try {
    const result = await captchaHandler.isCaptchaPresent(page, requestId);
    verboseExit(
      'puppeteerManager.handleCaptchaIfPresent',
      result ? 'CAPTCHA detected' : 'No CAPTCHA'
    );
    return result;
  } catch (e) {
    log('ERROR', `Request ${requestId}: Error in handleCaptchaIfPresent:`, e.stack || e);
    verboseExit('puppeteerManager.handleCaptchaIfPresent', 'Failed');
    return false;
  }
}

/**
 * Handles any dialogs that appear during interaction
 * @param {import('puppeteer').Page} page - The page to handle dialogs on
 * @param {Function} sseSend - Function to send SSE updates
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<boolean>} True if a dialog was handled, false otherwise
 */
async function handleDialogs(page, sseSend, requestId) {
  verboseEntry('puppeteerManager.handleDialogs', { requestId });

  try {
    const result = await dialogHandler.handleDialogs(page, { requestId, sseSend });
    verboseExit('puppeteerManager.handleDialogs', result ? 'Dialog handled' : 'No dialog');
    return result;
  } catch (e) {
    log('ERROR', `Request ${requestId}: Error in handleDialogs:`, e.stack || e);
    verboseExit('puppeteerManager.handleDialogs', 'Failed');
    return false;
  }
}

/**
 * Sets up request and response interception for debugging
 * @param {import('puppeteer').Page} page - The page to set up interception on
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<void>}
 */
async function setupNetworkInterception(page, requestId) {
  verboseEntry('puppeteerManager.setupNetworkInterception', { requestId });

  try {
    await networkHandler.setupNetworkInterception(page, { requestId });
    verboseExit('puppeteerManager.setupNetworkInterception', 'Success');
  } catch (e) {
    log('ERROR', `Request ${requestId}: Error in setupNetworkInterception:`, e.stack || e);
    verboseExit('puppeteerManager.setupNetworkInterception', 'Failed');
  }
}
/**
 * Interacts with LMArena by sending a user prompt and handling the response
 * @param {string} userPrompt - The prompt to send to LMArena
 * @param {Object} options - Options for the interaction
 * @param {string} [options.modelId] - The model ID to use
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.autoSolveCaptcha=true] - Whether to automatically solve CAPTCHAs
 * @returns {Promise<Object>} - The response data from LMArena
 */
async function interactWithLMArena(userPrompt, options = {}) {
  verboseEntry('puppeteerManager.interactWithLMArena', {
    promptLength: userPrompt?.length,
    modelId: options.modelId
  });

  try {
    // Initialize browser if needed
    await initialize();

    // Delegate to the interaction module
    const result = await interaction.interactWithLMArena(userPrompt, options);

    verboseExit('puppeteerManager.interactWithLMArena', 'Success');
    return result;
  } catch (e) {
    log('ERROR', 'Error in interactWithLMArena:', e.stack || e);
    verboseExit('puppeteerManager.interactWithLMArena', 'Failed');
    throw e;
  }
}

/**
 * Sets up request and response interception for debugging
 * @param {import('puppeteer').Page} page - The page to set up interception on
 * @param {string} requestId - The request ID for logging
 */
async function setupNetworkInterception(page, requestId) {
  verboseEntry('puppeteerManager.setupNetworkInterception', { requestId });

  try {
    await page.setRequestInterception(true);

    // Request handler for logging intercepted requests
    page.on('request', (interceptedRequest) => {
      const url = interceptedRequest.url();
      if (url.includes('arena-api') && url.includes('evaluation')) {
        log('DEBUG', `Request ${requestId}: Intercepting API request: ${url}`);
      }
      interceptedRequest.continue();
    });

    // Response handler for logging intercepted responses
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('arena-api') && url.includes('evaluation')) {
        log(
          'INFO',
          `Request ${requestId}: Intercepted API response: ${url}. Status: ${response.status()}`
        );
        try {
          const responseBody = await response.json();
          log('DEBUG', `Request ${requestId}: API response body:`, responseBody);
        } catch (e) {
          log('WARN', `Request ${requestId}: Could not parse API response as JSON:`, e.message);
        }
      }
    });

    log('DEBUG', `Request ${requestId}: Network interception set up.`);
    verboseExit('puppeteerManager.setupNetworkInterception', { requestId, status: 'success' });
  } catch (e) {
    log('WARN', `Request ${requestId}: Failed to set up network interception:`, e.message);
    verboseExit('puppeteerManager.setupNetworkInterception', {
      requestId,
      status: 'failed',
      error: e.message
    });
  }
}

/**
 * Fetches available models from LMArena
 * @param {Object} options - Options for fetching models
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.priority=false] - Whether this is a priority request
 * @returns {Promise<Array<{id:string,name:string}>>} Array of model objects
 */
async function fetchAvailableModels(options = {}) {
  const priority = options.priority === true;
  verboseEntry('puppeteerManager.fetchAvailableModels', { priority });

  try {
    // Initialize browser if needed
    await initialize();

    // Get a page instance with priority flag
    const page = await launchOrGetPage({ priority });

    // Delegate to the model manager
    const models = await modelManager.fetchAvailableModels(page, options);

    // Make sure to release the page back to the pool
    await releasePage(page);

    verboseExit('puppeteerManager.fetchAvailableModels', 'Success');
    return models;
  } catch (e) {
    log('ERROR', 'Error in fetchAvailableModels:', e.stack || e);
    verboseExit('puppeteerManager.fetchAvailableModels', 'Failed');

    // Return default models on error
    return config.lmArena.defaultModels;
  }
}

module.exports = {
  initialize,
  launchOrGetPage,
  releasePage,
  closeSpecificPage,
  closeAllPages,
  closeBrowser,
  interactWithLMArena,
  fetchAvailableModels,
  handleCaptchaIfPresent,
  handleDialogs,
  setupNetworkInterception
};
