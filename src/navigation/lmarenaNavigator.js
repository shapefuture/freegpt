/**
 * LMArena navigation strategies
 * Implements multiple navigation approaches to handle connection issues
 */
const { log } = require('../utils');
const config = require('../config/app.config');

/**
 * Navigation paths to try in order
 */
const NAVIGATION_PATHS = [
  { path: '/?mode=direct', name: 'Direct mode' },
  { path: '/', name: 'Default mode' },
  { path: '/?mode=side-by-side', name: 'Side-by-side mode' },
  { path: '/chat', name: 'Chat path' },
  { path: '/?t=' + Date.now(), name: 'Default with cache bypass' },
  { path: '/?mode=direct&t=' + Date.now(), name: 'Direct with cache bypass' }
];

/**
 * Browser profiles to try
 */
const BROWSER_PROFILES = [
  'Chrome Mac',
  'Chrome Windows',
  'Safari Mac',
  'Edge Windows'
];

/**
 * Navigate to LMArena with multiple fallback strategies
 * @param {import('puppeteer').Page} page - Puppeteer page
 * @param {Object} options - Navigation options
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} options.sseSend - Function to send SSE updates
 * @param {boolean} options.forceRefresh - Whether to force a refresh
 * @returns {Promise<boolean>} - Whether navigation was successful
 */
async function navigateToLMArena(page, options = {}) {
  const { requestId, sseSend = () => {}, forceRefresh = false } = options;
  
  // Get the browser manager
  const browserManager = require('../browser');
  
  // Try each browser profile
  for (let profileIndex = 0; profileIndex < BROWSER_PROFILES.length; profileIndex++) {
    const profile = BROWSER_PROFILES[profileIndex];
    
    if (profileIndex > 0) {
      // If this isn't the first profile, rotate to a new browser profile
      log('INFO', `Request ${requestId}: Rotating to browser profile: ${profile}`);
      sseSend({ type: 'STATUS', message: `Rotating to browser profile: ${profile}` });
      
      try {
        // Close the current browser
        await browserManager.closeBrowser();
        
        // Wait a moment for the browser to fully close
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Initialize a new browser with the new profile
        await browserManager.initialize({ profileName: profile, forceNew: true });
        
        // Get a new page
        page = await browserManager.getBrowser().newPage();
      } catch (profileError) {
        log('ERROR', `Request ${requestId}: Error rotating browser profile: ${profileError.message}`);
        sseSend({ type: 'ERROR', message: `Error rotating browser profile: ${profileError.message}` });
        continue;
      }
    }
    
    // Try each navigation path
    for (const navPath of NAVIGATION_PATHS) {
      try {
        const fullUrl = `${config.LMARENA_URL}${navPath.path}`;
        log('INFO', `Request ${requestId}: Attempting to navigate to ${navPath.name}: ${fullUrl}`);
        sseSend({ type: 'STATUS', message: `Attempting to navigate to ${navPath.name}...` });
        
        // Set a longer timeout for navigation
        const navigationResponse = await page.goto(fullUrl, {
          waitUntil: 'networkidle2',
          timeout: 60000 // 60 second timeout
        });
        
        if (navigationResponse && navigationResponse.ok()) {
          log('INFO', `Request ${requestId}: Successfully navigated to ${navPath.name}`);
          sseSend({ type: 'STATUS', message: `Successfully navigated to ${navPath.name}` });
          
          // Wait for the page to fully load
          await page.waitForTimeout(3000);
          
          // Take a screenshot for debugging
          try {
            const screenshotPath = `./logs/lmarena-navigation-${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            log('INFO', `Request ${requestId}: Saved LMArena screenshot to ${screenshotPath}`);
          } catch (screenshotError) {
            log('WARN', `Request ${requestId}: Failed to take screenshot: ${screenshotError.message}`);
          }
          
          return true;
        } else {
          const status = navigationResponse ? navigationResponse.status() : 'unknown';
          log('WARN', `Request ${requestId}: Navigation to ${navPath.name} returned status ${status}`);
          sseSend({ type: 'WARNING', message: `Navigation to ${navPath.name} returned status ${status}` });
        }
      } catch (navError) {
        log('WARN', `Request ${requestId}: Navigation to ${navPath.name} failed: ${navError.message}`);
        sseSend({ type: 'WARNING', message: `Navigation to ${navPath.name} failed: ${navError.message}` });
      }
      
      // Wait a moment before trying the next path
      await page.waitForTimeout(1000);
    }
  }
  
  // If we get here, all navigation attempts failed
  log('ERROR', `Request ${requestId}: All navigation attempts to LMArena failed`);
  sseSend({ type: 'ERROR', message: 'All navigation attempts to LMArena failed' });
  return false;
}

module.exports = {
  navigateToLMArena
};
