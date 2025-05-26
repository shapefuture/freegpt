/**
 * Dialog handling module
 * @module dialog
 */

const { log, verboseEntry, verboseExit } = require('./utils');
const config = require('./config');

/**
 * Handles any dialogs that appear during interaction
 * @param {import('puppeteer').Page} page - The page to handle dialogs on
 * @param {Object} options - Options for handling dialogs
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<boolean>} True if a dialog was handled, false otherwise
 */
async function handleDialogs(page, options) {
  const { requestId, sseSend = () => {} } = options;
  verboseEntry('dialog.handleDialogs', { requestId });

  return new Promise(async (resolve) => {
    try {
      log('DEBUG', `Request ${requestId}: Starting dialog handling check.`);

      // First try to handle ToS modal programmatically
      const tosHandled = await handleTosModal(page, { requestId, sseSend });

      if (tosHandled) {
        log('INFO', `Request ${requestId}: Successfully handled ToS modal programmatically.`);
        sseSend({ type: 'STATUS', message: 'Handled Terms of Service.' });
        resolve(true); // Resolved because a dialog was handled
        verboseExit('dialog.handleDialogs', 'ToS modal handled');
        return;
      }

      log('DEBUG', `Request ${requestId}: No ToS modal handled programmatically.`);

      // Then try to handle warning dialogs by clicking common buttons
      log('DEBUG', `Request ${requestId}: Checking for warning dialogs in DOM.`);
      const warningHandled = await handleWarningDialogs(page, { requestId, sseSend });

      if (warningHandled) {
        log('INFO', `Request ${requestId}: Handled a warning dialog programmatically.`);
        sseSend({ type: 'STATUS', message: 'Handled a website dialog.' });
        await new Promise((resolve) => setTimeout(resolve, 500)); // Wait for potential UI changes after dialog close
        resolve(true); // Resolved because a dialog was handled
        verboseExit('dialog.handleDialogs', 'Warning dialog handled');
        return;
      }

      log('DEBUG', `Request ${requestId}: No warning dialogs handled programmatically.`);

      // Then try to enable any other potentially disabled action buttons (like Send)
      log('DEBUG', `Request ${requestId}: Checking for and enabling disabled buttons.`);
      const buttonEnabled = await enableDisabledButtons(page, { requestId, sseSend });

      if (buttonEnabled) {
        log('INFO', `Request ${requestId}: Enabled potentially disabled action buttons.`);
        sseSend({ type: 'STATUS', message: 'Enabled potentially disabled buttons.' });
        // Don't resolve here, just continue as enabling button doesn't mean a dialog was handled
      } else {
        log('DEBUG', `Request ${requestId}: No disabled action buttons found to enable.`);
      }

      // Set up a listener for native browser dialogs (alert, confirm, prompt)
      log('DEBUG', `Request ${requestId}: Setting up native dialog listener.`);
      const nativeDialogHandler = async (dialog) => {
        const message = dialog.message();
        const type = dialog.type(); // 'alert', 'confirm', 'prompt'
        log(
          'DEBUG',
          `Request ${requestId}: Native dialog appeared (${type}): ${message.substring(0, 100)}...`
        );
        sseSend({ type: 'STATUS', message: `Website wants to show a dialog (${type})...` });

        try {
          // For simplicity, auto-accept or dismiss common dialog types
          if (type === 'alert' || type === 'confirm') {
            log('INFO', `Request ${requestId}: Auto-dismissing native dialog.`);
            await dialog.dismiss();
            sseSend({ type: 'STATUS', message: 'Native dialog dismissed.' });
          } else if (type === 'prompt') {
            log('INFO', `Request ${requestId}: Auto-accepting native prompt with empty string.`);
            await dialog.accept(''); // Accept prompt with empty string
            sseSend({ type: 'STATUS', message: 'Native prompt accepted.' });
          } else {
            // Default to dismissing anything unexpected
            log(
              'WARN',
              `Request ${requestId}: Unhandled native dialog type "${type}", dismissing.`
            );
            await dialog.dismiss();
            sseSend({
              type: 'WARNING',
              message: `Unhandled native dialog type "${type}" dismissed.`
            });
          }

          // After dismissing, try to enable buttons again as dialogs can disable them
          log(
            'DEBUG',
            `Request ${requestId}: Re-checking/enabling buttons after native dialog handling.`
          );
          await enableDisabledButtons(page, { requestId, sseSend });
        } catch (e) {
          log('ERROR', `Request ${requestId}: Error handling native dialog:`, e.stack || e);
          sseSend({ type: 'ERROR', message: `Error handling native dialog: ${e.message}` });
          try {
            await dialog.dismiss();
          } catch (e2) {
            log('ERROR', `Request ${requestId}: Error dismissing native dialog after failure:`, e2);
          }
        }
        // We don't resolve the main promise here, the dialog listener is passive.
        // The main logic will proceed after the timeout below.
      };

      // Listen for native dialogs - add listener conditionally
      const dialogListener = nativeDialogHandler.bind(null); // Bind to null to avoid 'this' issues
      page.on('dialog', dialogListener);
      log('DEBUG', `Request ${requestId}: Native dialog listener attached.`);

      // Set a timeout to resolve the main promise if no dialog appears within a short period
      const dialogCheckTimeout = config.browser.timeouts.dialog || 3000; // Default 3 seconds
      log(
        'DEBUG',
        `Request ${requestId}: Setting timeout for dialog check (${dialogCheckTimeout}ms).`
      );

      setTimeout(() => {
        log('DEBUG', `Request ${requestId}: Dialog check timeout reached. Removing listener.`);
        page.off('dialog', dialogListener); // Clean up the listener
        resolve(false); // Resolve with false as no dialog required pausing
        verboseExit('dialog.handleDialogs', 'Timeout, no dialogs requiring pause');
      }, dialogCheckTimeout);
    } catch (e) {
      log('ERROR', `Request ${requestId}: Error in main handleDialogs execution:`, e.stack || e);
      sseSend({
        type: 'ERROR',
        message: `An error occurred during dialog handling setup: ${e.message}`
      });
      resolve(false); // Resolve with false due to setup error
      verboseExit('dialog.handleDialogs', 'Error during setup');
    }
  });
}

/**
 * Handles Terms of Service modal programmatically
 * @param {import('puppeteer').Page} page - The page with the ToS modal
 * @param {Object} options - Options for handling the ToS modal
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<boolean>} True if ToS modal was handled, false otherwise
 */
async function handleTosModal(page, options) {
  const { requestId, sseSend = () => {} } = options;
  verboseEntry('dialog.handleTosModal', { requestId });

  try {
    log('DEBUG', `Request ${requestId}: Checking for ToS modal.`);

    // Wait for the ToS modal to appear with a timeout
    const tosModal = await page
      .waitForSelector(config.lmArena.selectors.tosForm, {
        timeout: 10000
      })
      .catch(() => null);

    if (!tosModal) {
      log('DEBUG', `Request ${requestId}: ToS modal selector not found.`);
      verboseExit('dialog.handleTosModal', 'No ToS modal detected');
      return false; // No modal detected
    }

    log(
      'INFO',
      `Request ${requestId}: ToS modal detected, attempting to handle programmatically...`
    );
    sseSend({ type: 'STATUS', message: 'Terms of Service modal detected...' });

    // Handle the ToS modal in the page context
    const tosHandled = await page.evaluate(async (selectors) => {
      console.log('INFO', 'Executing in-page ToS modal handler.');

      try {
        const form = document.querySelector(selectors.tosForm);

        if (!form) {
          console.log('DEBUG', 'ToS form not found in evaluate.');
          return false;
        }

        const agreeButton = form.querySelector('button[type="submit"]');
        const content = form.querySelector('.overflow-y-auto');

        if (!agreeButton || !content) {
          console.log('DEBUG', 'ToS form elements (button/content) not found.');
          return false;
        }

        console.log('DEBUG', 'Found ToS button and content.');

        // Function to check if scrolled to bottom
        const isScrolledToBottom = () => {
          const { scrollTop, scrollHeight, clientHeight } = content;
          return Math.abs(scrollHeight - scrollTop - clientHeight) < 10; // Allow small delta
        };

        // Ensure the button is enabled
        if (agreeButton.disabled || agreeButton.getAttribute('aria-disabled') === 'true') {
          console.log('INFO', 'ToS button disabled, attempting to enable.');
          agreeButton.disabled = false;
          agreeButton.removeAttribute('aria-disabled');
          agreeButton.style.pointerEvents = 'auto';
          agreeButton.style.opacity = '1';
          agreeButton.classList.remove('disabled', 'opacity-50', 'pointer-events-none');
          console.log('INFO', 'ToS button enabled.');
        }

        // Scroll to bottom if needed to enable button
        if (!isScrolledToBottom()) {
          console.log('DEBUG', 'Scrolling ToS content to bottom.');
          content.scrollTop = content.scrollHeight;
          // Wait a moment for any scroll-triggered UI updates
          await new Promise((resolve) => setTimeout(resolve, 500));
          console.log('DEBUG', 'Finished scrolling ToS content.');
        } else {
          console.log('DEBUG', 'ToS content already scrolled to bottom.');
        }

        // Re-check button enabled state after potential scroll
        if (agreeButton.disabled || agreeButton.getAttribute('aria-disabled') === 'true') {
          console.log('WARN', 'ToS button still disabled after attempting to enable and scroll.');
          return false; // Button is still disabled, cannot proceed
        }

        // Click the button if it's enabled
        console.log('INFO', 'Attempting to click ToS agree button.');
        agreeButton.click();
        console.log('INFO', 'ToS agree button clicked.');
        return true; // Indicate successful handling
      } catch (error) {
        console.error('Error in in-page ToS modal handler:', error);
        return false; // Indicate failure
      }
    }, config.lmArena.selectors);

    if (tosHandled) {
      log('INFO', `Request ${requestId}: Programmatic ToS modal handling reported success.`);
      sseSend({ type: 'STATUS', message: 'Accepted Terms of Service.' });

      // Wait for potential navigation or UI changes after clicking accept
      log('DEBUG', `Request ${requestId}: Waiting for navigation or network idle after ToS click.`);

      await page
        .waitForNavigation({
          waitUntil: ['networkidle0', 'domcontentloaded']
        })
        .catch((e) =>
          log(
            'DEBUG',
            `Request ${requestId}: No navigation observed after ToS click or timeout: ${e.message}`
          )
        );

      log('DEBUG', `Request ${requestId}: Finished waiting after ToS click.`);
      verboseExit('dialog.handleTosModal', 'ToS modal handled successfully');
      return true;
    } else {
      log(
        'WARN',
        `Request ${requestId}: Programmatic ToS modal handling failed or reported failure.`
      );
      sseSend({ type: 'WARNING', message: 'Could not automatically accept Terms of Service.' });
      // If programmatic handling failed, the dialog might still be there, handle via generic dialog listener if set up.
      verboseExit('dialog.handleTosModal', 'ToS modal handling failed programmatically');
      return false; // Indicate failure
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in handleTosModal:`, error.stack || error);
    sseSend({ type: 'ERROR', message: `Error handling Terms of Service modal: ${error.message}` });
    verboseExit('dialog.handleTosModal', 'Error occurred');
    return false; // Indicate failure
  }
}

/**
 * Handles warning dialogs by clicking common buttons
 * @param {import('puppeteer').Page} page - The page with the warning dialogs
 * @param {Object} options - Options for handling warning dialogs
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<boolean>} True if a warning dialog was handled, false otherwise
 */
async function handleWarningDialogs(page, options) {
  const { requestId, sseSend = () => {} } = options;
  verboseEntry('dialog.handleWarningDialogs', { requestId });

  try {
    const warningHandled = await page.evaluate(() => {
      try {
        // Look for warning dialogs
        const warningDialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(
          (dialog) => {
            const text = dialog.textContent || '';
            return (
              text.includes('Warning') ||
              text.includes('warning') ||
              text.includes('terms') ||
              text.includes('Terms') ||
              text.includes('service') ||
              text.includes('Service')
            );
          }
        );

        if (warningDialogs.length > 0) {
          console.log('DEBUG', `Found ${warningDialogs.length} potential dialogs.`);

          // Try to find and click the first available button
          const buttons = warningDialogs.flatMap((dialog) =>
            Array.from(dialog.querySelectorAll('button'))
          );

          const buttonTexts = [
            'OK',
            'Ok',
            'Okay',
            'I understand',
            'Got it',
            'Dismiss',
            'Close',
            'Accept',
            'Agree',
            'I agree',
            'Continue'
          ];

          // Try to find a button with common text
          for (const text of buttonTexts) {
            const button = buttons.find((btn) => {
              const btnText = (btn.textContent || '').trim().toLowerCase();
              const ariaLabel = (btn.getAttribute('aria-label') || '').trim().toLowerCase();
              return btnText === text.toLowerCase() || ariaLabel === text.toLowerCase();
            });

            if (button) {
              console.log('INFO', `Clicking button with text/label: "${text}"`);

              if (button.disabled || button.getAttribute('aria-disabled') === 'true') {
                console.log('WARN', 'Button is disabled, attempting to force enable.');
                button.removeAttribute('disabled');
                button.removeAttribute('aria-disabled');
                button.style.pointerEvents = 'auto';
                button.style.opacity = '1';
              }

              button.click();
              return true; // Indicate a dialog was handled
            }
          }

          // If no button found by text, try to click any non-disabled button in the dialog
          const clickableButton = buttons.find(
            (btn) => !btn.disabled && btn.getAttribute('aria-disabled') !== 'true'
          );

          if (clickableButton) {
            console.log('INFO', 'Clicking first non-disabled button in dialog.');
            clickableButton.click();
            return true; // Indicate a dialog was handled
          }

          console.log(
            'WARN',
            'Found dialog but no clickable button with known text or non-disabled status.'
          );
        }

        console.log('DEBUG', 'No warning dialogs found in DOM.');
        return false; // Indicate no dialogs handled
      } catch (e) {
        console.error('Error handling warning dialog via evaluate:', e);
        return false; // Indicate failure/no dialog handled
      }
    });

    verboseExit(
      'dialog.handleWarningDialogs',
      warningHandled ? 'Dialog handled' : 'No dialog handled'
    );
    return warningHandled;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in handleWarningDialogs:`, error.stack || error);
    verboseExit('dialog.handleWarningDialogs', 'Error');
    return false;
  }
}

/**
 * Enables disabled buttons on the page
 * @param {import('puppeteer').Page} page - The page with the disabled buttons
 * @param {Object} options - Options for enabling buttons
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<boolean>} True if any button was enabled, false otherwise
 */
async function enableDisabledButtons(page, options) {
  const { requestId, sseSend = () => {} } = options;
  verboseEntry('dialog.enableDisabledButtons', { requestId });

  try {
    const buttonEnabled = await page.evaluate(() => {
      try {
        const buttons = Array.from(document.querySelectorAll('button'));
        let found = false;

        buttons.forEach((btn) => {
          // Check if button is a send button or similar and is disabled
          const isActionMaybeDisabled =
            (btn.textContent?.includes('Send') ||
              btn.getAttribute('aria-label')?.includes('Send') ||
              btn.querySelector('svg[aria-label="Send"]') || // Check for send icon
              btn.textContent?.includes('Submit') ||
              btn.getAttribute('aria-label')?.includes('Submit')) &&
            (btn.disabled ||
              btn.getAttribute('aria-disabled') === 'true' ||
              btn.classList.contains('opacity-50') ||
              btn.classList.contains('pointer-events-none'));

          if (isActionMaybeDisabled) {
            console.log(
              'DEBUG',
              'Found potentially disabled action button, enabling it.',
              btn.textContent
            );
            btn.removeAttribute('disabled');
            btn.removeAttribute('aria-disabled');
            btn.style.pointerEvents = 'auto';
            btn.style.opacity = '1';
            // Remove common classes used for visual disabled state
            btn.classList.remove('disabled', 'opacity-50', 'pointer-events-none');
            found = true;
          }
        });

        return found; // Return true if any button was enabled
      } catch (e) {
        console.error('Error in button enable script via evaluate:', e);
        return false; // Indicate failure/no button enabled
      }
    });

    verboseExit(
      'dialog.enableDisabledButtons',
      buttonEnabled ? 'Buttons enabled' : 'No buttons enabled'
    );
    return buttonEnabled;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in enableDisabledButtons:`, error.stack || error);
    verboseExit('dialog.enableDisabledButtons', 'Error');
    return false;
  }
}

module.exports = {
  handleDialogs,
  handleTosModal,
  handleWarningDialogs,
  enableDisabledButtons
};
