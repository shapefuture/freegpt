/**
 * CAPTCHA handling module
 * @module captcha
 */

const { log, verboseEntry, verboseExit } = require('./utils');
const config = require('./config');
const TurnstileSolver = require('./utils/turnstileSolver');

/**
 * Checks if a CAPTCHA is present on the page
 * @param {import('puppeteer').Page} page - The page to check
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<boolean>} True if CAPTCHA is present, false otherwise
 */
async function isCaptchaPresent(page, requestId) {
  verboseEntry('captcha.isCaptchaPresent', { requestId });

  try {
    log('DEBUG', `Request ${requestId}: Checking for Turnstile iframe.`);

    const hasTurnstile = await page.evaluate(() => {
      return !!document.querySelector('iframe[src*="turnstile"]');
    });

    if (hasTurnstile) {
      log('WARN', `Request ${requestId}: Turnstile CAPTCHA detected.`);
      verboseExit('captcha.isCaptchaPresent', 'CAPTCHA detected');
      return true;
    }

    log('DEBUG', `Request ${requestId}: No CAPTCHA detected.`);
    verboseExit('captcha.isCaptchaPresent', 'No CAPTCHA detected');
    return false;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error checking for CAPTCHA:`, error.stack || error);
    verboseExit('captcha.isCaptchaPresent', 'Error');
    return false; // Assume no CAPTCHA on error
  }
}

/**
 * Attempts to solve a CAPTCHA on the page
 * @param {import('puppeteer').Page} page - The page with the CAPTCHA
 * @param {Object} options - Options for solving the CAPTCHA
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<boolean>} True if CAPTCHA was solved, false otherwise
 */
async function solveCaptcha(page, options) {
  const { requestId, sseSend = () => {} } = options;
  verboseEntry('captcha.solveCaptcha', { requestId });

  try {
    log('INFO', `Request ${requestId}: Attempting to solve CAPTCHA.`);
    sseSend({ type: 'STATUS', message: 'CAPTCHA detected, attempting to solve...' });

    // Extract Turnstile parameters from the page
    const turnstileParams = await page.evaluate(() => {
      return window.capturedTurnstileParams || {};
    });

    log('DEBUG', `Request ${requestId}: Extracted Turnstile parameters:`, turnstileParams);

    if (!turnstileParams.sitekey) {
      log('WARN', `Request ${requestId}: No sitekey found in captured Turnstile parameters.`);
      sseSend({ type: 'WARNING', message: 'Could not extract CAPTCHA parameters.' });
      verboseExit('captcha.solveCaptcha', 'No sitekey found');
      return false;
    }

    // Initialize the Turnstile solver
    const solver = new TurnstileSolver({
      debug: process.env.DEBUG_MODE === 'true',
      headless: process.env.CAPTCHA_HEADLESS !== 'false',
      timeout: config.browser.timeouts.captcha
    });

    log('INFO', `Request ${requestId}: Initialized Turnstile solver.`);
    sseSend({ type: 'STATUS', message: 'Solving CAPTCHA...' });

    // Solve the CAPTCHA
    const result = await solver.solve(
      page.url(),
      turnstileParams.sitekey,
      turnstileParams.action,
      turnstileParams.cData
    );

    // Clean up the solver
    await solver.close();

    if (!result.success || !result.token) {
      log('ERROR', `Request ${requestId}: Failed to solve CAPTCHA:`, result.error);
      sseSend({ type: 'ERROR', message: 'Failed to solve CAPTCHA automatically.' });
      verboseExit('captcha.solveCaptcha', 'Failed to solve');
      return false;
    }

    log('INFO', `Request ${requestId}: Successfully solved CAPTCHA in ${result.timeElapsed}ms.`);

    // Apply the token to the page
    const applied = await applyCaptchaToken(page, result.token, turnstileParams, requestId);

    if (applied) {
      log('INFO', `Request ${requestId}: Successfully applied CAPTCHA token.`);
      sseSend({ type: 'SUCCESS', message: 'CAPTCHA solved successfully.' });
      verboseExit('captcha.solveCaptcha', 'Success');
      return true;
    } else {
      log('WARN', `Request ${requestId}: Failed to apply CAPTCHA token.`);
      sseSend({ type: 'WARNING', message: 'Solved CAPTCHA but failed to apply token.' });
      verboseExit('captcha.solveCaptcha', 'Failed to apply token');
      return false;
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error solving CAPTCHA:`, error.stack || error);
    sseSend({ type: 'ERROR', message: `Error solving CAPTCHA: ${error.message}` });
    verboseExit('captcha.solveCaptcha', 'Error');
    return false;
  }
}

/**
 * Applies a CAPTCHA token to the page
 * @param {import('puppeteer').Page} page - The page with the CAPTCHA
 * @param {string} token - The CAPTCHA token
 * @param {Object} params - The Turnstile parameters
 * @param {string} requestId - Request ID for logging
 * @returns {Promise<boolean>} True if token was applied, false otherwise
 */
async function applyCaptchaToken(page, token, params, requestId) {
  verboseEntry('captcha.applyCaptchaToken', { requestId });

  try {
    log('DEBUG', `Request ${requestId}: Applying CAPTCHA token.`);

    const applied = await page.evaluate(
      (token, params) => {
        try {
          // Set the token in the textarea
          const textarea = document.querySelector('textarea[name="cf-turnstile-response"]');
          if (textarea) {
            textarea.value = token;
            console.log('DEBUG', 'Set token in textarea.');
          }

          // Call the callback function if available
          if (params.callbackName && window[params.callbackName]) {
            console.log('DEBUG', `Calling callback function: ${params.callbackName}`);
            window[params.callbackName](token);
            return true;
          }

          // Dispatch change event on the textarea
          if (textarea) {
            console.log('DEBUG', 'Dispatching change event on textarea.');
            textarea.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }

          return false;
        } catch (e) {
          console.error('Error applying CAPTCHA token:', e);
          return false;
        }
      },
      token,
      params
    );

    verboseExit('captcha.applyCaptchaToken', applied ? 'Success' : 'Failed');
    return applied;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error applying CAPTCHA token:`, error.stack || error);
    verboseExit('captcha.applyCaptchaToken', 'Error');
    return false;
  }
}

/**
 * Handles CAPTCHA detection and solving
 * @param {import('puppeteer').Page} page - The page to check for CAPTCHA
 * @param {Object} options - Options for handling the CAPTCHA
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.autoSolve=true] - Whether to automatically solve the CAPTCHA
 * @returns {Promise<boolean>} True if CAPTCHA was detected, false otherwise
 */
async function handleCaptcha(page, options) {
  const { requestId, sseSend = () => {}, autoSolve = true } = options;
  verboseEntry('captcha.handleCaptcha', { requestId, autoSolve });

  try {
    const captchaPresent = await isCaptchaPresent(page, requestId);

    if (!captchaPresent) {
      verboseExit('captcha.handleCaptcha', 'No CAPTCHA detected');
      return false;
    }

    if (autoSolve) {
      const solved = await solveCaptcha(page, { requestId, sseSend });

      if (solved) {
        log('INFO', `Request ${requestId}: CAPTCHA solved successfully.`);
        verboseExit('captcha.handleCaptcha', 'CAPTCHA solved');
        return true;
      } else {
        log('WARN', `Request ${requestId}: Failed to solve CAPTCHA automatically.`);
        sseSend({
          type: 'USER_ACTION_REQUIRED',
          message: 'Please solve the CAPTCHA manually in the browser window.'
        });

        // Wait for manual solving
        log('INFO', `Request ${requestId}: Waiting for manual CAPTCHA solving.`);
        sseSend({ type: 'STATUS', message: 'Waiting for manual CAPTCHA solving...' });

        // Wait for the CAPTCHA to be solved (token to appear)
        await page.waitForFunction(
          () => {
            const textarea = document.querySelector('textarea[name="cf-turnstile-response"]');
            return textarea && textarea.value && textarea.value.length > 0;
          },
          { timeout: config.browser.timeouts.captcha }
        );

        log('INFO', `Request ${requestId}: CAPTCHA appears to be solved manually.`);
        sseSend({ type: 'SUCCESS', message: 'CAPTCHA solved.' });
        verboseExit('captcha.handleCaptcha', 'CAPTCHA solved manually');
        return true;
      }
    } else {
      log('INFO', `Request ${requestId}: CAPTCHA detected but autoSolve is disabled.`);
      sseSend({
        type: 'USER_ACTION_REQUIRED',
        message: 'CAPTCHA detected. Please solve it manually.'
      });
      verboseExit('captcha.handleCaptcha', 'CAPTCHA detected, autoSolve disabled');
      return true;
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error handling CAPTCHA:`, error.stack || error);
    sseSend({ type: 'ERROR', message: `Error handling CAPTCHA: ${error.message}` });
    verboseExit('captcha.handleCaptcha', 'Error');
    return false;
  }
}

module.exports = {
  isCaptchaPresent,
  solveCaptcha,
  applyCaptchaToken,
  handleCaptcha
};
