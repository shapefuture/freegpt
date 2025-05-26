/**
 * LMArena interaction module
 * @module interaction
 */

const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');
const pageManager = require('./page');
const captchaHandler = require('./captcha');
const dialogHandler = require('./dialog');
const networkHandler = require('./network');
const config = require('./config');

/**
 * Interacts with LMArena by sending a user prompt and handling the response
 * @param {string} userPrompt - The prompt to send to LMArena
 * @param {Object} options - Options for the interaction
 * @param {string} [options.modelId] - The model ID to use
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.autoSolveCaptcha=true] - Whether to automatically solve CAPTCHAs
 * @param {boolean} [options.isVerificationTest=false] - Whether this is a verification test
 * @param {import('puppeteer').Page} [options.page] - Existing page to use
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<Object>} - The response data from LMArena
 */
async function interactWithLMArena(userPrompt, options = {}) {
  const requestId = options.requestId || generateUUID();
  const isVerificationTest = options.isVerificationTest === true;

  verboseEntry('interaction.interactWithLMArena', {
    requestId,
    promptLength: userPrompt?.length,
    modelId: options.modelId,
    isVerificationTest,
    usingExistingPage: !!options.page
  });

  log(
    'DEBUG',
    `Request ${requestId}: Starting interaction with LMArena${
      isVerificationTest ? ' (verification test)' : ''
    }.`
  );

  const sseSend =
    options.sseSend ||
    ((data) => {
      log('DEBUG', `Request ${requestId}: SSE update (mock): ${JSON.stringify(data)}`);
    });

  // Validate user prompt
  if (typeof userPrompt !== 'string') {
    log('ERROR', `Request ${requestId}: User prompt is not a string.`);
    sseSend({ type: 'ERROR', message: 'User prompt must be a string.' });
    throw new Error('User prompt must be a string.');
  }

  if (userPrompt.trim().length === 0) {
    log('ERROR', `Request ${requestId}: User prompt is empty.`);
    sseSend({ type: 'ERROR', message: 'User prompt cannot be empty.' });
    throw new Error('User prompt cannot be empty.');
  }

  let responseData = null;

  // Get or create a page instance
  let page = options.page;
  let needToReleasePage = false;

  try {
    if (!page) {
      page = await pageManager.getPage({
        requestId,
        priority: true // Mark as high priority
      });
      needToReleasePage = true;
      log('DEBUG', `Request ${requestId}: Created new page instance for interaction.`);
    } else {
      log('DEBUG', `Request ${requestId}: Using provided page instance for interaction.`);
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Failed to get page instance: ${error.message}`);
    sseSend({ type: 'ERROR', message: 'Failed to initialize browser.' });
    throw error;
  }

  // Use retry logic for the interaction
  try {
    responseData = await networkHandler.withRetry(
      async () => {
        return await performInteraction(page, userPrompt, {
          requestId,
          sseSend,
          modelId: options.modelId,
          autoSolveCaptcha: options.autoSolveCaptcha !== false,
          isVerificationTest
        });
      },
      {
        requestId,
        sseSend,
        // For verification tests, only try once to avoid long startup times
        maxAttempts: isVerificationTest ? 1 : config.lmArena.retry.maxAttempts,
        initialDelay: config.lmArena.retry.initialDelay,
        maxDelay: config.lmArena.retry.maxDelay,
        factor: config.lmArena.retry.factor
      }
    );

    log('INFO', `Request ${requestId}: Interaction completed successfully.`);
    sseSend({ type: 'SUCCESS', message: 'Interaction completed successfully.' });
  } catch (error) {
    log('ERROR', `Request ${requestId}: All interaction attempts failed: ${error.message}`);
    sseSend({ type: 'ERROR', message: `Failed to interact with LMArena: ${error.message}` });
    verboseExit('interaction.interactWithLMArena', {
      requestId,
      status: 'failed',
      error: error.message
    });
    throw error;
  } finally {
    // Release the page if we created it
    if (needToReleasePage && page) {
      try {
        await pageManager.releasePage(page, { requestId });
        log('DEBUG', `Request ${requestId}: Released page after interaction.`);
      } catch (e) {
        log('WARN', `Request ${requestId}: Error releasing page after interaction: ${e.message}`);
      }
    }
  }

  verboseExit('interaction.interactWithLMArena', {
    requestId,
    status: 'success',
    responseReceived: !!responseData,
    isVerificationTest
  });

  return responseData;
}

/**
 * Performs a single interaction attempt with LMArena
 * @param {import('puppeteer').Page} page - The page to interact with
 * @param {string} userPrompt - The prompt to send
 * @param {Object} options - Options for the interaction
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} options.sseSend - Function to send SSE updates
 * @param {string} [options.modelId] - The model ID to use
 * @param {boolean} [options.autoSolveCaptcha=true] - Whether to automatically solve CAPTCHAs
 * @param {boolean} [options.isVerificationTest=false] - Whether this is a verification test
 * @returns {Promise<Object>} - The response data
 */
async function performInteraction(page, userPrompt, options) {
  const {
    requestId,
    sseSend,
    modelId,
    autoSolveCaptcha = true,
    isVerificationTest = false
  } = options;
  verboseEntry('interaction.performInteraction', {
    requestId,
    promptLength: userPrompt?.length,
    modelId,
    isVerificationTest
  });

  try {
    // Clear cookies
    try {
      // Use the fallback method directly as it's more reliable
      const cookies = await page.cookies();
      for (const cookie of cookies) {
        await page.deleteCookie(cookie);
      }

      log('DEBUG', `Request ${requestId}: Cleared cookies.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Error clearing cookies: ${e.message}.`);
    }

    // Set up network interception
    await networkHandler.setupNetworkInterception(page, {
      requestId,
      sseSend,
      isVerificationTest
    });

    // Navigate to LMArena
    log('DEBUG', `Request ${requestId}: Navigating to LMArena...`);
    sseSend({ type: 'STATUS', message: 'Navigating to LMArena...' });

    try {
      await page.goto(config.lmArena.url, { waitUntil: 'networkidle2', timeout: 60000 });
      log('DEBUG', `Request ${requestId}: Successfully navigated to LMArena.`);
      sseSend({ type: 'STATUS', message: 'Navigated to LMArena.' });
    } catch (navigationError) {
      log(
        'WARN',
        `Request ${requestId}: Failed to navigate to primary LMArena URL: ${navigationError.message}`
      );
      sseSend({
        type: 'WARNING',
        message: 'Primary navigation failed. Trying alternative paths...'
      });

      // Try alternative navigation paths
      const navigationSuccess = await navigateWithAlternativePaths(page, {
        requestId,
        sseSend
      });

      if (!navigationSuccess) {
        log('ERROR', `Request ${requestId}: All navigation attempts to LMArena failed.`);
        sseSend({
          type: 'ERROR',
          message: 'Failed to navigate to LMArena after trying all alternatives.'
        });
        verboseExit('interaction.performInteraction', { requestId, status: 'navigation_failed' });
        throw new Error(`Failed to navigate to LMArena: ${navigationError.message}`);
      }

      log(
        'INFO',
        `Request ${requestId}: Successfully navigated to LMArena using alternative path.`
      );
      sseSend({ type: 'STATUS', message: 'Navigated to LMArena using alternative path.' });
    }

    // Check for CAPTCHA
    const captchaDetected = await captchaHandler.isCaptchaPresent(page, requestId);

    if (captchaDetected) {
      log('WARN', `Request ${requestId}: CAPTCHA detected.`);

      const captchaSolved = await captchaHandler.handleCaptcha(page, {
        requestId,
        sseSend,
        autoSolve: autoSolveCaptcha
      });

      if (!captchaSolved && autoSolveCaptcha) {
        log('ERROR', `Request ${requestId}: Failed to solve CAPTCHA.`);
        throw new Error('Failed to solve CAPTCHA.');
      }
    } else {
      log('DEBUG', `Request ${requestId}: No CAPTCHA detected.`);
    }

    // Handle any dialogs that might appear
    await dialogHandler.handleDialogs(page, { requestId, sseSend });

    // Select model if specified
    if (modelId) {
      log('INFO', `Request ${requestId}: Attempting to select model: ${modelId}`);
      sseSend({ type: 'STATUS', message: `Selecting model: ${modelId}...` });

      const modelSelected = await selectModel(page, modelId, { requestId, sseSend });

      if (!modelSelected) {
        log(
          'WARN',
          `Request ${requestId}: Failed to select model: ${modelId}. Continuing with default model.`
        );
        sseSend({
          type: 'WARNING',
          message: `Could not select model: ${modelId}. Using default model.`
        });
      }
    }

    // Interact with the prompt textarea
    log('DEBUG', `Request ${requestId}: Waiting for prompt textarea...`);
    sseSend({ type: 'STATUS', message: 'Waiting for prompt textarea...' });

    const promptTextarea = await page.waitForSelector(config.lmArena.selectors.promptTextarea, {
      timeout: 30000
    });

    // Clear the textarea first (in case there's existing text)
    await promptTextarea.click({ clickCount: 3 }); // Triple click to select all
    await page.keyboard.press('Backspace'); // Delete selected text

    // Type the prompt with a slight delay to appear more human-like
    await promptTextarea.type(userPrompt, { delay: 10 });
    log('DEBUG', `Request ${requestId}: User prompt typed into textarea.`);
    sseSend({ type: 'STATUS', message: 'Prompt entered.' });

    // Click the send button
    log('DEBUG', `Request ${requestId}: Waiting for send button...`);
    sseSend({ type: 'STATUS', message: 'Waiting for send button...' });

    const sendButton = await page.waitForSelector(config.lmArena.selectors.sendButton, {
      timeout: 30000
    });

    // Ensure the button is enabled
    await dialogHandler.enableDisabledButtons(page, { requestId, sseSend });

    await sendButton.click();
    log('DEBUG', `Request ${requestId}: Send button clicked.`);
    sseSend({ type: 'STATUS', message: 'Prompt sent.' });

    // For verification tests, we can exit early after sending the prompt
    // This is just to check if CAPTCHA appears, we don't need to wait for the full response
    if (isVerificationTest) {
      log(
        'INFO',
        `Request ${requestId}: Verification test completed successfully after sending prompt.`
      );
      sseSend({ type: 'STATUS', message: 'Verification test completed.' });

      verboseExit('interaction.performInteraction', {
        requestId,
        status: 'success',
        isVerificationTest: true
      });

      // Return a dummy response for verification tests
      return {
        status: 200,
        data: {
          message: 'Verification test completed successfully',
          isVerificationTest: true
        }
      };
    }

    // For normal interactions, wait for the API request and response
    log('DEBUG', `Request ${requestId}: Waiting for API response...`);
    sseSend({ type: 'STATUS', message: 'Waiting for response...' });

    // Get any captured request data for fallback
    const capturedRequestData = networkHandler.getCapturedRequestData(page, {
      requestId,
      urlPattern: config.lmArena.api.evaluation,
      method: 'POST'
    });

    // Wait for the API request with fallback options
    const apiResponse = await networkHandler.waitForApiRequest(page, {
      requestId,
      urlPattern: config.lmArena.api.evaluation,
      method: 'POST',
      timeout: 60000,
      sseSend,
      requestData: capturedRequestData,
      enableDirectApiFallback: true
    });

    log('INFO', `Request ${requestId}: Received API response with status ${apiResponse.status}.`);
    sseSend({ type: 'STATUS', message: 'Response received.' });

    // If the response status is not successful, try additional fallbacks
    if (apiResponse.status < 200 || apiResponse.status >= 300) {
      log(
        'WARN',
        `Request ${requestId}: API response status ${apiResponse.status} indicates failure. Trying additional fallbacks...`
      );
      sseSend({
        type: 'WARNING',
        message: `API response failed with status ${apiResponse.status}. Trying additional fallbacks...`
      });

      // Try to extract the full URL from the page
      const fullApiUrl = await page.evaluate(() => {
        // Look for network requests in devtools
        const entries = window.performance.getEntries();
        const apiEntry = entries.find((e) => e.name && e.name.includes('arena-api'));
        return apiEntry ? apiEntry.name : null;
      });

      if (fullApiUrl && capturedRequestData) {
        // Try a direct Node.js fetch as a last resort
        try {
          log('INFO', `Request ${requestId}: Attempting Node.js fetch fallback to ${fullApiUrl}`);
          sseSend({ type: 'STATUS', message: 'Attempting server-side request fallback...' });

          const nodeFetchResponse = await networkHandler.makeNodeFetchRequest({
            requestId,
            url: fullApiUrl,
            method: 'POST',
            data: capturedRequestData,
            sseSend
          });

          if (
            nodeFetchResponse &&
            nodeFetchResponse.status >= 200 &&
            nodeFetchResponse.status < 300
          ) {
            log(
              'INFO',
              `Request ${requestId}: Node.js fetch fallback succeeded with status ${nodeFetchResponse.status}.`
            );
            sseSend({ type: 'STATUS', message: 'Fallback request succeeded.' });

            // Use the successful fallback response
            apiResponse.status = nodeFetchResponse.status;
            apiResponse.data = nodeFetchResponse.data;
          }
        } catch (fallbackError) {
          log(
            'ERROR',
            `Request ${requestId}: Node.js fetch fallback failed:`,
            fallbackError.stack || fallbackError
          );
        }
      }
    }

    verboseExit('interaction.performInteraction', {
      requestId,
      status: 'success',
      responseStatus: apiResponse.status
    });

    return apiResponse.data;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error during interaction: ${error.message}`);

    // Try browser profile rotation as a fallback
    try {
      const browser = require('./browser');

      // Handle the failed request which may trigger profile rotation
      const rotated = await browser.handleFailedRequest({
        requestId,
        errorMessage: error.message,
        sseSend,
        // Force rotation for certain error types
        forceRotation:
          error.message.includes('Cloudflare') ||
          error.message.includes('captcha') ||
          error.message.includes('forbidden') ||
          error.message.includes('403')
      });

      if (rotated) {
        log(
          'INFO',
          `Request ${requestId}: Browser profile rotated after error. Retrying interaction...`
        );
        sseSend({ type: 'STATUS', message: 'Rotated browser profile. Retrying...' });

        // Get a new page with the new profile
        const pageManager = require('./page');
        const newPage = await pageManager.getPage({ requestId, forceNew: true });

        if (newPage) {
          log(
            'INFO',
            `Request ${requestId}: Got new page after profile rotation. Retrying interaction...`
          );

          // Retry the interaction with the new page
          try {
            // Set up network interception
            await networkHandler.setupNetworkInterception(newPage, {
              requestId,
              sseSend,
              isVerificationTest
            });

            // Navigate to LMArena with fallback
            try {
              await newPage.goto(config.lmArena.url, {
                waitUntil: 'networkidle2',
                timeout: config.browser.timeouts.navigation
              });
              log(
                'INFO',
                `Request ${requestId}: Successfully navigated to LMArena after profile rotation.`
              );
            } catch (retryNavigationError) {
              log(
                'WARN',
                `Request ${requestId}: Failed to navigate after profile rotation. Trying alternative paths...`
              );

              // Try alternative navigation paths
              const navigationSuccess = await navigateWithAlternativePaths(newPage, {
                requestId,
                sseSend
              });

              if (!navigationSuccess) {
                log(
                  'ERROR',
                  `Request ${requestId}: All navigation attempts failed after profile rotation.`
                );
                throw new Error(
                  `Failed to navigate after profile rotation: ${retryNavigationError.message}`
                );
              }
            }

            // Retry the interaction
            const retryResponse = await performInteraction(newPage, userPrompt, {
              requestId,
              sseSend,
              modelId,
              autoSolveCaptcha,
              isVerificationTest
            });

            // Release the page
            await pageManager.releasePage(newPage, { requestId });

            log(
              'INFO',
              `Request ${requestId}: Successfully retried interaction after profile rotation.`
            );
            return retryResponse;
          } catch (retryError) {
            log(
              'ERROR',
              `Request ${requestId}: Retry after profile rotation also failed: ${retryError.message}`
            );
            await pageManager.releasePage(newPage, { requestId });
          }
        }
      }
    } catch (fallbackError) {
      log(
        'ERROR',
        `Request ${requestId}: Error in profile rotation fallback: ${fallbackError.message}`
      );
    }

    verboseExit('interaction.performInteraction', {
      requestId,
      status: 'failed',
      error: error.message
    });
    throw error;
  }
}

/**
 * Selects a specific model in the UI
 * @param {import('puppeteer').Page} page - The page to interact with
 * @param {string} modelId - The model ID to select
 * @param {Object} options - Options for model selection
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} options.sseSend - Function to send SSE updates
 * @returns {Promise<boolean>} - Whether the model was successfully selected
 */
async function selectModel(page, modelId, options) {
  const { requestId, sseSend } = options;
  verboseEntry('interaction.selectModel', { requestId, modelId });

  if (!modelId) {
    log('WARN', `Request ${requestId}: No model ID provided for selection.`);
    verboseExit('interaction.selectModel', { requestId, status: 'no_model_id' });
    return false;
  }

  try {
    log('INFO', `Request ${requestId}: Attempting to select model: ${modelId}`);
    sseSend({ type: 'STATUS', message: `Selecting model: ${modelId}...` });

    // First check if we're in the right mode for model selection
    const currentUrl = page.url();
    let needsNavigation = false;

    // If we're not on the main page or not in side-by-side mode, navigate
    if (!currentUrl.includes('mode=side-by-side')) {
      needsNavigation = true;
      log('DEBUG', `Request ${requestId}: Not in side-by-side mode, will navigate.`);
      sseSend({ type: 'STATUS', message: 'Switching to side-by-side mode for model selection...' });
    }

    if (needsNavigation) {
      // Navigate to side-by-side mode
      await page.goto(`${config.lmArena.url}?mode=side-by-side`, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      log('DEBUG', `Request ${requestId}: Navigated to side-by-side mode for model selection.`);
      sseSend({ type: 'STATUS', message: 'Switched to side-by-side mode.' });
    }

    // Wait for model selectors to appear
    try {
      await page.waitForSelector(config.lmArena.selectors.modelBDropdownTrigger, {
        visible: true,
        timeout: 10000
      });
    } catch (e) {
      log('WARN', `Request ${requestId}: Model dropdown trigger not found: ${e.message}`);
      sseSend({ type: 'WARNING', message: 'Model selection UI not found. Using default model.' });
      verboseExit('interaction.selectModel', { requestId, status: 'ui_not_found' });
      return false;
    }

    // Click the model dropdown
    try {
      const modelDropdown = await page.$(config.lmArena.selectors.modelBDropdownTrigger);
      await modelDropdown.click();
      log('DEBUG', `Request ${requestId}: Clicked model dropdown.`);
      sseSend({ type: 'STATUS', message: 'Opened model selection dropdown.' });

      // Wait for the dropdown to appear
      await page.waitForSelector(config.lmArena.selectors.modelListbox, {
        visible: true,
        timeout: 5000
      });
    } catch (e) {
      log('WARN', `Request ${requestId}: Failed to open model dropdown: ${e.message}`);
      sseSend({
        type: 'WARNING',
        message: 'Could not open model selection dropdown. Using default model.'
      });
      verboseExit('interaction.selectModel', { requestId, status: 'dropdown_failed' });
      return false;
    }

    // Find and click the model option
    try {
      // Check if the model is in the dropdown and click it
      const modelSelected = await page.evaluate(
        (modelId, listboxSelector) => {
          const listbox = document.querySelector(listboxSelector);
          if (!listbox) return { success: false, reason: 'listbox_not_found' };

          // Look for the model in the dropdown
          const options = Array.from(listbox.querySelectorAll('[role="option"]'));

          for (const option of options) {
            const optionId = option.getAttribute('data-value') || option.textContent?.trim();
            if (optionId === modelId || optionId?.includes(modelId)) {
              // Check if the option is disabled
              const isDisabled =
                option.getAttribute('aria-disabled') === 'true' ||
                option.classList.contains('disabled') ||
                option.classList.contains('opacity-50') ||
                option.style.opacity === '0.5';

              if (isDisabled) {
                return { success: false, reason: 'model_disabled' };
              }

              // Click the option
              option.click();
              return { success: true };
            }
          }

          return { success: false, reason: 'model_not_found' };
        },
        modelId,
        config.lmArena.selectors.modelListbox
      );

      if (!modelSelected.success) {
        log('WARN', `Request ${requestId}: Could not select model: ${modelSelected.reason}`);

        // Close the dropdown by pressing Escape
        await page.keyboard.press('Escape');

        if (modelSelected.reason === 'model_disabled') {
          sseSend({
            type: 'WARNING',
            message: `Model "${modelId}" is currently disabled. Using default model.`
          });
        } else if (modelSelected.reason === 'model_not_found') {
          sseSend({
            type: 'WARNING',
            message: `Model "${modelId}" not found in dropdown. Using default model.`
          });
        } else {
          sseSend({ type: 'WARNING', message: 'Could not select model. Using default model.' });
        }

        verboseExit('interaction.selectModel', { requestId, status: modelSelected.reason });
        return false;
      }

      log('INFO', `Request ${requestId}: Successfully selected model: ${modelId}`);
      sseSend({ type: 'STATUS', message: `Selected model: ${modelId}` });

      // Wait a moment for the selection to take effect
      await page.waitForTimeout(500);

      verboseExit('interaction.selectModel', { requestId, status: 'success' });
      return true;
    } catch (e) {
      log('ERROR', `Request ${requestId}: Error selecting model option: ${e.message}`);

      // Try to close the dropdown
      try {
        await page.keyboard.press('Escape');
      } catch (escError) {
        // Ignore errors when trying to close dropdown
      }

      sseSend({ type: 'WARNING', message: 'Error selecting model. Using default model.' });
      verboseExit('interaction.selectModel', { requestId, status: 'selection_error' });
      return false;
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Fatal error selecting model:`, error);
    sseSend({
      type: 'WARNING',
      message: `Error selecting model: ${error.message}. Using default model.`
    });
    verboseExit('interaction.selectModel', { requestId, status: 'fatal_error' });
    return false;
  }
}

/**
 * Attempts to navigate to LMArena using alternative paths
 * @param {import('puppeteer').Page} page - The page to navigate with
 * @param {Object} options - Options for navigation
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {number} [options.timeout=30000] - Navigation timeout in milliseconds
 * @param {boolean} [options.checkForCloudflare=true] - Whether to check for Cloudflare challenges
 * @returns {Promise<boolean>} Whether navigation was successful
 */
async function navigateWithAlternativePaths(page, options) {
  const startTime = Date.now();
  const { requestId, sseSend = () => {}, timeout = 30000, checkForCloudflare = true } = options;

  verboseEntry('interaction.navigateWithAlternativePaths', {
    requestId,
    timeout,
    checkForCloudflare
  });

  // Validate inputs
  if (!page || !page.goto) {
    log(
      'ERROR',
      `Request ${requestId}: Invalid page object provided to navigateWithAlternativePaths`
    );
    verboseExit('interaction.navigateWithAlternativePaths', {
      requestId,
      status: 'failed',
      error: 'Invalid page object',
      duration: Date.now() - startTime
    });
    return false;
  }

  // List of alternative navigation paths to try
  const alternativePaths = [
    { url: 'https://beta.lmarena.ai/?mode=direct', description: 'Direct mode' },
    { url: 'https://beta.lmarena.ai/?mode=side-by-side', description: 'Side-by-side mode' },
    { url: 'https://beta.lmarena.ai/', description: 'Default mode' },
    { url: 'https://beta.lmarena.ai/chat', description: 'Chat path' },
    { url: 'https://lmarena.ai/', description: 'Main domain' },
    // Additional paths with query parameters to bypass caching
    {
      url: `https://beta.lmarena.ai/?mode=direct&t=${Date.now()}`,
      description: 'Direct mode (cache bypass)'
    },
    { url: `https://beta.lmarena.ai/?t=${Date.now()}`, description: 'Default mode (cache bypass)' }
  ];

  // Function to check if page has Cloudflare challenge
  const hasCloudflareChallenge = async () => {
    if (!checkForCloudflare) return false;

    try {
      return await page.evaluate(() => {
        // Check for Cloudflare elements
        const hasCloudflareChallengeForm = !!document.querySelector('form#challenge-form');
        const hasCloudflareCaptcha = !!document.querySelector(
          '#cf-hcaptcha-container, iframe[src*="hcaptcha"], iframe[src*="turnstile"]'
        );
        const hasCloudflareText = document.body.innerText.includes(
          'Checking if the site connection is secure'
        );

        return hasCloudflareChallengeForm || hasCloudflareCaptcha || hasCloudflareText;
      });
    } catch (e) {
      log('WARN', `Request ${requestId}: Error checking for Cloudflare challenge: ${e.message}`);
      return false;
    }
  };

  // Function to check if navigation was successful
  const isNavigationSuccessful = async () => {
    try {
      // Check if navigation was successful by looking for key UI elements
      const uiCheck = await page.evaluate(() => {
        // Look for common UI elements that indicate successful navigation
        const hasTextarea = !!document.querySelector('textarea');
        const hasInput = !!document.querySelector('input[type="text"]');
        const hasButton = !!document.querySelector('button');
        const hasChat = !!document.querySelector('[role="dialog"], .chat-container, .conversation');

        // Check for error indicators
        const hasError =
          document.body.innerText.includes('Error') &&
          (document.body.innerText.includes('404') ||
            document.body.innerText.includes('not found') ||
            document.body.innerText.includes('unavailable'));

        // Return detailed results
        return {
          success: (hasTextarea || (hasInput && hasButton) || hasChat) && !hasError,
          details: {
            hasTextarea,
            hasInput,
            hasButton,
            hasChat,
            hasError,
            title: document.title,
            url: window.location.href
          }
        };
      });

      log('DEBUG', `Request ${requestId}: UI check results:`, uiCheck.details);

      return uiCheck.success;
    } catch (e) {
      log('WARN', `Request ${requestId}: Error checking navigation success: ${e.message}`);
      return false;
    }
  };

  // Try each path in sequence
  // Use a recursive approach to try paths sequentially
  const tryPath = async (pathIndex) => {
    // If we've tried all paths, return false
    if (pathIndex >= alternativePaths.length) {
      return false;
    }

    const path = alternativePaths[pathIndex];
    const attemptCount = pathIndex + 1;
    const pathStartTime = Date.now();

    try {
      log(
        'INFO',
        `Request ${requestId}: Trying alternative navigation path (${attemptCount}/${alternativePaths.length}): ${path.description} (${path.url})`
      );
      sseSend({ type: 'STATUS', message: `Trying alternative path: ${path.description}...` });

      // Navigate to the alternative path
      const navigationStartTime = Date.now();
      await page.goto(path.url, {
        waitUntil: 'networkidle2',
        timeout: timeout
      });
      const navigationDuration = Date.now() - navigationStartTime;

      log(
        'DEBUG',
        `Request ${requestId}: Navigation to ${path.description} completed in ${navigationDuration}ms`
      );

      // Check for Cloudflare challenge
      if (await hasCloudflareChallenge()) {
        log('WARN', `Request ${requestId}: Detected Cloudflare challenge at ${path.description}`);
        sseSend({
          type: 'WARNING',
          message: `Detected Cloudflare challenge at ${path.description}. Waiting...`
        });

        // Wait a bit longer for Cloudflare to resolve
        await page.waitForTimeout(5000);

        // Check again after waiting
        if (await hasCloudflareChallenge()) {
          log(
            'WARN',
            `Request ${requestId}: Cloudflare challenge still present after waiting. Skipping path.`
          );
          // Try the next path
          return tryPath(pathIndex + 1);
        } else {
          log('INFO', `Request ${requestId}: Cloudflare challenge resolved automatically.`);
        }
      }

      // Check if navigation was successful
      if (await isNavigationSuccessful()) {
        const pathDuration = Date.now() - pathStartTime;
        log(
          'INFO',
          `Request ${requestId}: Successfully navigated using alternative path: ${path.description} in ${pathDuration}ms`
        );
        sseSend({ type: 'STATUS', message: `Successfully navigated to ${path.description}.` });

        successfulPath = path;
        verboseExit('interaction.navigateWithAlternativePaths', {
          requestId,
          status: 'success',
          path: path.description,
          attempts: attemptCount,
          duration: Date.now() - startTime
        });
        return true;
      }

      log(
        'DEBUG',
        `Request ${requestId}: Alternative path did not have expected UI: ${path.description}`
      );

      // Take a screenshot for debugging if in verbose mode
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const pathDesc = path.description.replace(/\s+/g, '_');
        const screenshotPath = `./logs/screenshots/${requestId}_${timestamp}_${pathDesc}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        log(
          'DEBUG',
          `Request ${requestId}: Saved navigation failure screenshot to ${screenshotPath}`
        );
      } catch (screenshotError) {
        log('DEBUG', `Request ${requestId}: Failed to save screenshot: ${screenshotError.message}`);
      }

      // Try the next path
      return tryPath(pathIndex + 1);
    } catch (navigationError) {
      const isTimeout = navigationError.message.includes('timeout');
      log(
        'WARN',
        `Request ${requestId}: Error navigating to alternative path ${path.description}: ${navigationError.message}`
      );

      if (isTimeout) {
        log(
          'WARN',
          `Request ${requestId}: Navigation timeout (${timeout}ms) for path: ${path.description}`
        );
      }

      // Try to get the current URL even after error
      try {
        const currentUrl = await page.url();
        log('DEBUG', `Request ${requestId}: Current URL after navigation error: ${currentUrl}`);

        // Check if we're actually on a valid page despite the error
        if (await isNavigationSuccessful()) {
          log(
            'INFO',
            `Request ${requestId}: Navigation succeeded despite error for ${path.description}`
          );
          successfulPath = path;
          verboseExit('interaction.navigateWithAlternativePaths', {
            requestId,
            status: 'success_with_error',
            path: path.description,
            error: navigationError.message,
            attempts: attemptCount,
            duration: Date.now() - startTime
          });
          return true;
        }
      } catch (urlError) {
        log(
          'DEBUG',
          `Request ${requestId}: Could not get current URL after navigation error: ${urlError.message}`
        );
      }

      // Try the next path
      return tryPath(pathIndex + 1);
    }
  };

  // Start trying paths from index 0
  return tryPath(0);
}

module.exports = {
  interactWithLMArena,
  performInteraction,
  selectModel,
  navigateWithAlternativePaths
};
