/**
 * Network interception module
 * @module network
 */

const { log, verboseEntry, verboseExit } = require('./utils');
const config = require('./config');

/**
 * Sets up request and response interception for debugging
 * @param {import('puppeteer').Page} page - The page to set up interception on
 * @param {Object} options - Options for network interception
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.blockResources=false] - Whether to block non-essential resources
 * @param {boolean} [options.isVerificationTest=false] - Whether this is a verification test
 * @param {boolean} [options.captureRequestData=true] - Whether to capture request data for fallbacks
 * @returns {Promise<void>}
 */
async function setupNetworkInterception(page, options) {
  const {
    requestId,
    sseSend = () => {},
    blockResources = false,
    isVerificationTest = false,
    captureRequestData = true
  } = options;

  verboseEntry('network.setupNetworkInterception', {
    requestId,
    blockResources,
    isVerificationTest,
    captureRequestData
  });

  // Create a property on the page object to store captured request data
  if (captureRequestData && !page.capturedRequests) {
    page.capturedRequests = new Map();
  }

  try {
    // Remove any existing listeners to avoid conflicts
    try {
      // First try to remove all listeners for specific events
      page.removeAllListeners('request');
      page.removeAllListeners('response');
      page.removeAllListeners('console');
      page.removeAllListeners('error');
      log('DEBUG', `Request ${requestId}: Removed existing event listeners.`);
    } catch (e) {
      log('WARN', `Request ${requestId}: Error removing existing listeners: ${e.message}`);
    }

    await page.setRequestInterception(true);

    // Request handler for intercepting requests
    page.on('request', (interceptedRequest) => {
      try {
        const url = interceptedRequest.url();
        const resourceType = interceptedRequest.resourceType();
        const method = interceptedRequest.method();

        // Block non-essential resources if requested
        if (
          blockResources &&
          ['image', 'stylesheet', 'font', 'media'].includes(resourceType) &&
          !url.includes('turnstile')
        ) {
          log('DEBUG', `Request ${requestId}: Blocking resource: ${resourceType} ${url}`);
          interceptedRequest.abort();
          return;
        }

        // Capture API requests for potential fallbacks
        if (captureRequestData && url.includes(config.lmArena.api.evaluation)) {
          log('DEBUG', `Request ${requestId}: Intercepting API request: ${url}`);
          sseSend({ type: 'STATUS', message: 'Sending request to LMArena API...' });

          // Store request data for potential fallbacks
          const postData = interceptedRequest.postData();
          if (postData) {
            try {
              const parsedData = JSON.parse(postData);
              log('DEBUG', `Request ${requestId}: API request body:`, parsedData);

              // Store the request data in the page object for later use
              if (page.capturedRequests) {
                const requestKey = `${method}:${url}`;
                page.capturedRequests.set(requestKey, {
                  url,
                  method,
                  data: parsedData,
                  headers: interceptedRequest.headers(),
                  timestamp: Date.now()
                });
                log('DEBUG', `Request ${requestId}: Stored request data for ${requestKey}`);
              }
            } catch (e) {
              log(
                'DEBUG',
                `Request ${requestId}: API request body (raw): ${postData.substring(0, 500)}...`
              );
            }
          }
        }

        try {
          interceptedRequest.continue();
        } catch (continueError) {
          // If the request is already handled, just log it and continue
          if (continueError.message.includes('Request is already handled')) {
            log(
              'DEBUG',
              `Request ${requestId}: Request already handled: ${url.substring(0, 100)}...`
            );
          } else {
            throw continueError;
          }
        }
      } catch (error) {
        log('ERROR', `Request ${requestId}: Error in request interception:`, error.message);
        // Ensure the request continues even if there's an error in our handler
        try {
          interceptedRequest.continue();
        } catch (e) {
          // Ignore errors when trying to continue an already handled request
          log(
            'DEBUG',
            `Request ${requestId}: Could not continue request after error: ${e.message}`
          );
        }
      }
    });

    // Response handler for intercepting responses
    page.on('response', async (response) => {
      try {
        const url = response.url();
        const status = response.status();

        // Log API responses
        if (url.includes(config.lmArena.api.evaluation)) {
          log('INFO', `Request ${requestId}: Intercepted API response: ${url}. Status: ${status}`);
          sseSend({ type: 'STATUS', message: `Received API response (status: ${status}).` });

          // Only try to parse JSON for successful responses
          if (status >= 200 && status < 300) {
            try {
              const responseBody = await response.json();
              log('DEBUG', `Request ${requestId}: API response body:`, responseBody);
            } catch (e) {
              log('WARN', `Request ${requestId}: Could not parse API response as JSON:`, e.message);
            }
          } else {
            log('WARN', `Request ${requestId}: API request failed with status ${status}`);
            sseSend({ type: 'WARNING', message: `API request failed with status ${status}.` });
          }
        }
      } catch (error) {
        log('ERROR', `Request ${requestId}: Error in response interception:`, error.message);
      }
    });

    // Error handler for network errors
    page.on('error', (error) => {
      log('ERROR', `Request ${requestId}: Page error:`, error.message);
      sseSend({ type: 'ERROR', message: `Page error: ${error.message}` });
    });

    // Console message handler
    page.on('console', (message) => {
      const type = message.type();
      const text = message.text();

      // Only log errors, warnings, and debug messages with DEBUG prefix
      if (type === 'error') {
        log('ERROR', `Request ${requestId}: Console error: ${text}`);
      } else if (type === 'warning') {
        log('WARN', `Request ${requestId}: Console warning: ${text}`);
      } else if (text.includes('DEBUG')) {
        log('DEBUG', `Request ${requestId}: Console: ${text}`);
      }
    });

    log('DEBUG', `Request ${requestId}: Network interception set up.`);
    verboseExit('network.setupNetworkInterception', { requestId, status: 'success' });
  } catch (error) {
    log('WARN', `Request ${requestId}: Failed to set up network interception:`, error.message);
    verboseExit('network.setupNetworkInterception', {
      requestId,
      status: 'failed',
      error: error.message
    });

    // Try to disable request interception if it failed to set up properly
    try {
      await page.setRequestInterception(false);
    } catch (e) {
      log(
        'ERROR',
        `Request ${requestId}: Error disabling request interception after setup failure:`,
        e.message
      );
    }
  }
}

/**
 * Waits for a specific API request and response
 * @param {import('puppeteer').Page} page - The page to wait for the API request on
 * @param {Object} options - Options for waiting for the API request
 * @param {string} options.requestId - Request ID for logging
 * @param {string} options.urlPattern - URL pattern to match for the API request
 * @param {string} options.method - HTTP method to match (e.g., 'POST')
 * @param {number} [options.timeout=60000] - Timeout in milliseconds
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {Object} [options.requestData] - Request data for direct API fallback
 * @param {boolean} [options.enableDirectApiFallback=true] - Whether to enable direct API fallback
 * @returns {Promise<Object>} The response data
 */
async function waitForApiRequest(page, options) {
  const {
    requestId,
    urlPattern,
    method,
    timeout = config.browser.timeouts.action,
    sseSend = () => {},
    requestData = null,
    enableDirectApiFallback = true
  } = options;

  verboseEntry('network.waitForApiRequest', {
    requestId,
    urlPattern,
    method,
    timeout,
    enableDirectApiFallback
  });

  try {
    log(
      'DEBUG',
      `Request ${requestId}: Waiting for API request matching ${method} ${urlPattern}...`
    );
    sseSend({ type: 'STATUS', message: 'Waiting for API response...' });

    // Wait for the API request
    const apiRequest = await page.waitForRequest(
      (request) => request.url().includes(urlPattern) && request.method() === method,
      { timeout }
    );

    log('INFO', `Request ${requestId}: Detected API request: ${apiRequest.url()}`);

    // Wait for the API response
    const response = await page.waitForResponse(
      (response) => response.url().includes(urlPattern) && response.request().method() === method,
      { timeout }
    );

    const status = response.status();
    log('INFO', `Request ${requestId}: Received API response. Status: ${status}`);
    sseSend({ type: 'STATUS', message: `Received API response (status: ${status}).` });

    // Parse the response
    let responseData;
    try {
      responseData = await response.json();
      log('DEBUG', `Request ${requestId}: API response data:`, responseData);
    } catch (error) {
      log('WARN', `Request ${requestId}: Failed to parse API response as JSON:`, error.message);
      sseSend({ type: 'WARNING', message: 'Failed to parse API response.' });
      responseData = null;
    }

    verboseExit('network.waitForApiRequest', {
      requestId,
      status: 'success',
      responseStatus: status
    });
    return { status, data: responseData };
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error waiting for API request:`, error.stack || error);
    sseSend({
      type: 'WARNING',
      message: `Error waiting for API response: ${error.message}. Trying fallback methods...`
    });

    // Try direct API fallback if enabled and we have request data
    if (enableDirectApiFallback && requestData) {
      try {
        log('INFO', `Request ${requestId}: Attempting direct API fallback...`);
        sseSend({ type: 'STATUS', message: 'Attempting direct API request...' });

        const directApiResult = await attemptDirectApiRequest(page, {
          requestId,
          urlPattern,
          method,
          requestData,
          sseSend
        });

        if (directApiResult) {
          log('INFO', `Request ${requestId}: Direct API fallback succeeded.`);
          sseSend({ type: 'STATUS', message: 'Direct API request succeeded.' });
          return directApiResult;
        }
      } catch (fallbackError) {
        log(
          'ERROR',
          `Request ${requestId}: Direct API fallback failed:`,
          fallbackError.stack || fallbackError
        );
        sseSend({
          type: 'WARNING',
          message: `Direct API fallback failed: ${fallbackError.message}`
        });
      }
    }

    verboseExit('network.waitForApiRequest', { requestId, status: 'failed', error: error.message });
    throw error;
  }
}

/**
 * Implements exponential backoff retry logic for network operations
 * @param {Function} operation - The async operation to retry
 * @param {Object} options - Options for the retry logic
 * @param {string} options.requestId - Request ID for logging
 * @param {number} [options.maxAttempts=3] - Maximum number of attempts
 * @param {number} [options.initialDelay=1000] - Initial delay in milliseconds
 * @param {number} [options.maxDelay=30000] - Maximum delay in milliseconds
 * @param {number} [options.factor=2] - Exponential factor
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<any>} The result of the operation
 */
async function withRetry(operation, options) {
  const {
    requestId,
    maxAttempts = config.lmArena.retry.maxAttempts,
    initialDelay = config.lmArena.retry.initialDelay,
    maxDelay = config.lmArena.retry.maxDelay,
    factor = config.lmArena.retry.factor,
    sseSend = () => {}
  } = options;

  verboseEntry('network.withRetry', { requestId, maxAttempts, initialDelay, maxDelay, factor });

  let lastError;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log('INFO', `Request ${requestId}: Attempt ${attempt}/${maxAttempts}...`);

      if (attempt > 1) {
        sseSend({ type: 'STATUS', message: `Retry attempt ${attempt}/${maxAttempts}...` });
      }

      const result = await operation();

      log('DEBUG', `Request ${requestId}: Operation succeeded on attempt ${attempt}.`);
      verboseExit('network.withRetry', { requestId, status: 'success', attempt });
      return result;
    } catch (error) {
      lastError = error;
      log('WARN', `Request ${requestId}: Attempt ${attempt}/${maxAttempts} failed:`, error.message);

      if (attempt < maxAttempts) {
        // Calculate next delay with exponential backoff
        delay = Math.min(delay * factor, maxDelay);
        const jitter = Math.random() * 0.3 * delay; // Add up to 30% jitter
        const actualDelay = Math.floor(delay + jitter);

        log('DEBUG', `Request ${requestId}: Retrying in ${actualDelay}ms...`);
        sseSend({
          type: 'STATUS',
          message: `Retry in ${Math.round(actualDelay / 1000)} seconds...`
        });

        await new Promise((resolve) => setTimeout(resolve, actualDelay));
      }
    }
  }

  log('ERROR', `Request ${requestId}: All ${maxAttempts} attempts failed.`);
  sseSend({ type: 'ERROR', message: `Operation failed after ${maxAttempts} attempts.` });
  verboseExit('network.withRetry', { requestId, status: 'failed', attempts: maxAttempts });
  throw lastError;
}

/**
 * Attempts to make a direct API request as a fallback
 * @param {import('puppeteer').Page} page - The page to use for the request
 * @param {Object} options - Options for the direct API request
 * @param {string} options.requestId - Request ID for logging
 * @param {string} options.urlPattern - URL pattern for the API endpoint
 * @param {string} options.method - HTTP method to use
 * @param {Object} options.requestData - Request data to send
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<Object|null>} The response data or null if failed
 */
async function attemptDirectApiRequest(page, options) {
  const startTime = Date.now();
  const { requestId, urlPattern, method, requestData, sseSend = () => {} } = options;

  verboseEntry('network.attemptDirectApiRequest', {
    requestId,
    urlPattern,
    method,
    dataSize: requestData ? JSON.stringify(requestData).length : 0
  });

  try {
    // Validate inputs
    if (!page || !page.evaluate) {
      throw new Error('Invalid page object provided');
    }

    if (!urlPattern) {
      throw new Error('URL pattern is required');
    }

    if (!method) {
      throw new Error('HTTP method is required');
    }

    log('DEBUG', `Request ${requestId}: Starting direct API request preparation (${method})`);
    sseSend({ type: 'STATUS', message: 'Preparing direct API request...' });

    // Get cookies and headers from the page
    let cookies = [];
    try {
      cookies = await page.cookies();
      log('DEBUG', `Request ${requestId}: Retrieved ${cookies.length} cookies`);
    } catch (cookieError) {
      log('WARN', `Request ${requestId}: Error getting cookies: ${cookieError.message}`);
      // Continue without cookies
      cookies = [];
    }

    const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    // Extract CSRF token if available
    let csrfToken = '';
    try {
      csrfToken = await page.evaluate(() => {
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) {
          return metaTag.getAttribute('content');
        }

        // Try other common CSRF token locations
        const csrfInput = document.querySelector(
          'input[name="csrf-token"], input[name="_csrf"], input[name="csrf"]'
        );
        if (csrfInput) {
          return csrfInput.value;
        }

        return '';
      });

      if (csrfToken) {
        log('DEBUG', `Request ${requestId}: Found CSRF token: ${csrfToken.substring(0, 10)}...`);
      } else {
        log('DEBUG', `Request ${requestId}: No CSRF token found`);
      }
    } catch (csrfError) {
      log('WARN', `Request ${requestId}: Error extracting CSRF token: ${csrfError.message}`);
    }

    // Determine the full URL
    let baseUrl = '';
    let fullUrl = '';

    try {
      baseUrl = await page.evaluate(() => window.location.origin);
      fullUrl = urlPattern.startsWith('http')
        ? urlPattern
        : `${baseUrl}/${urlPattern.replace(/^\//, '')}`;
      log('DEBUG', `Request ${requestId}: Constructed full URL: ${fullUrl}`);
    } catch (urlError) {
      log('WARN', `Request ${requestId}: Error constructing URL: ${urlError.message}`);
      // Fallback to direct pattern if we can't get origin
      fullUrl = urlPattern;
    }

    log('INFO', `Request ${requestId}: Attempting direct API request to ${fullUrl}`);
    sseSend({
      type: 'STATUS',
      message: `Attempting direct API request to ${fullUrl.substring(0, 30)}...`
    });

    // Measure request time
    const requestStartTime = Date.now();

    // Make the request directly from within the page context
    const result = await page.evaluate(
      async (url, method, data, cookieStr, csrf, reqId) => {
        try {
          console.log(`[${reqId}] Starting in-page fetch to ${url}`);

          const headers = {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-Requested-With': 'XMLHttpRequest'
          };

          if (cookieStr) {
            headers.Cookie = cookieStr;
          }

          if (csrf) {
            headers['X-CSRF-Token'] = csrf;
            headers['CSRF-Token'] = csrf;
            headers['X-XSRF-TOKEN'] = csrf;
          }

          const fetchOptions = {
            method,
            headers,
            credentials: 'include',
            mode: 'cors',
            cache: 'no-cache'
          };

          if (method !== 'GET' && data) {
            fetchOptions.body = JSON.stringify(data);
            console.log(`[${reqId}] Request payload size: ${fetchOptions.body.length} bytes`);
          }

          console.log(`[${reqId}] Fetch options:`, JSON.stringify(fetchOptions, null, 2));

          const fetchStartTime = Date.now();
          const response = await fetch(url, fetchOptions);
          const fetchEndTime = Date.now();

          console.log(
            `[${reqId}] Fetch completed in ${fetchEndTime - fetchStartTime}ms with status ${
              response.status
            }`
          );

          // Create headers object manually instead of using Object.fromEntries
          const responseHeaders = {};
          response.headers.forEach((value, name) => {
            responseHeaders[name] = value;
          });

          const responseData = {
            status: response.status,
            statusText: response.statusText,
            headers: responseHeaders,
            data: null,
            timing: {
              fetchTime: fetchEndTime - fetchStartTime
            }
          };

          try {
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('application/json')) {
              responseData.data = await response.json();
              console.log(`[${reqId}] Parsed JSON response`);
            } else {
              const text = await response.text();
              console.log(`[${reqId}] Received text response (${text.length} bytes)`);

              // Try to parse as JSON anyway in case content-type is wrong
              try {
                responseData.data = JSON.parse(text);
                console.log(`[${reqId}] Successfully parsed text as JSON`);
              } catch (jsonError) {
                responseData.data = text;
              }
            }
          } catch (parseError) {
            console.error(`[${reqId}] Error parsing response:`, parseError);
            try {
              responseData.data = await response.text();
            } catch (textError) {
              console.error(`[${reqId}] Error getting response text:`, textError);
              responseData.data = null;
            }
          }

          return responseData;
        } catch (error) {
          console.error(`[${reqId}] Direct API request failed:`, error);
          // Calculate time even if there was an error
          const errorTime = Date.now();
          return {
            error: error.toString(),
            status: 0,
            timing: {
              fetchTime: errorTime - fetchStartTime
            }
          };
        }
      },
      fullUrl,
      method,
      requestData,
      cookieString,
      csrfToken,
      requestId
    );

    const requestEndTime = Date.now();
    const requestDuration = requestEndTime - requestStartTime;

    log('DEBUG', `Request ${requestId}: Direct API request took ${requestDuration}ms`);

    if (result.error) {
      log('ERROR', `Request ${requestId}: Direct API request failed: ${result.error}`);
      sseSend({
        type: 'WARNING',
        message: `Direct API request failed: ${result.error.substring(0, 100)}`
      });
      verboseExit('network.attemptDirectApiRequest', {
        requestId,
        status: 'failed',
        error: result.error,
        duration: Date.now() - startTime
      });
      return null;
    }

    log(
      'INFO',
      `Request ${requestId}: Direct API request succeeded with status ${result.status} in ${requestDuration}ms`
    );
    sseSend({
      type: 'STATUS',
      message: `Direct API request succeeded with status ${result.status}`
    });

    verboseExit('network.attemptDirectApiRequest', {
      requestId,
      status: 'success',
      responseStatus: result.status,
      duration: Date.now() - startTime
    });

    // Use destructuring to avoid property shorthand issues
    const { status, data } = result;
    return {
      status,
      data,
      timing: {
        ...result.timing,
        totalTime: requestDuration
      }
    };
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in direct API request:`, error.stack || error);
    sseSend({ type: 'ERROR', message: `Error in direct API request: ${error.message}` });
    verboseExit('network.attemptDirectApiRequest', {
      requestId,
      status: 'failed',
      error: error.message,
      duration: Date.now() - startTime
    });
    return null;
  }
}

/**
 * Attempts to extract API request data from a network request
 * @param {import('puppeteer').Request} request - The intercepted request
 * @returns {Object|null} The parsed request data or null if parsing failed
 */
function extractRequestData(request) {
  try {
    const postData = request.postData();
    if (!postData) return null;

    return JSON.parse(postData);
  } catch (e) {
    return null;
  }
}

/**
 * Gets the most recent captured request data for a specific URL pattern
 * @param {import('puppeteer').Page} page - The page to get captured request data from
 * @param {Object} options - Options for getting captured request data
 * @param {string} options.requestId - Request ID for logging
 * @param {string} options.urlPattern - URL pattern to match
 * @param {string} [options.method='POST'] - HTTP method to match
 * @returns {Object|null} The captured request data or null if not found
 */
function getCapturedRequestData(page, options) {
  const { requestId, urlPattern, method = 'POST' } = options;

  if (!page.capturedRequests || page.capturedRequests.size === 0) {
    log('DEBUG', `Request ${requestId}: No captured requests available.`);
    return null;
  }

  // Find the most recent matching request
  let mostRecentRequest = null;
  let mostRecentTimestamp = 0;

  // Use forEach instead of for...of to avoid linting issues
  page.capturedRequests.forEach((requestData) => {
    if (requestData.url.includes(urlPattern) && requestData.method === method) {
      if (requestData.timestamp > mostRecentTimestamp) {
        mostRecentRequest = requestData;
        mostRecentTimestamp = requestData.timestamp;
      }
    }
  });

  if (mostRecentRequest) {
    log('DEBUG', `Request ${requestId}: Found captured request data for ${urlPattern}`);
    return mostRecentRequest.data;
  }

  log('DEBUG', `Request ${requestId}: No matching captured request found for ${urlPattern}`);
  return null;
}

/**
 * Attempts to make a direct API request using Node.js fetch as a last resort
 * @param {Object} options - Options for the direct API request
 * @param {string} options.requestId - Request ID for logging
 * @param {string} options.url - Full URL for the API endpoint
 * @param {string} options.method - HTTP method to use
 * @param {Object} options.data - Request data to send
 * @param {Object} [options.headers={}] - Headers to include in the request
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {number} [options.timeout=30000] - Request timeout in milliseconds
 * @param {number} [options.retries=2] - Number of retries for failed requests
 * @returns {Promise<Object|null>} The response data or null if failed
 */
async function makeNodeFetchRequest(options) {
  const startTime = Date.now();
  const {
    requestId,
    url,
    method,
    data,
    headers = {},
    sseSend = () => {},
    timeout = 30000,
    retries = 2
  } = options;

  verboseEntry('network.makeNodeFetchRequest', {
    requestId,
    url,
    method,
    timeout,
    retries,
    dataSize: data ? JSON.stringify(data).length : 0
  });

  // Validate inputs
  if (!url) {
    log('ERROR', `Request ${requestId}: URL is required for Node.js fetch`);
    verboseExit('network.makeNodeFetchRequest', {
      requestId,
      status: 'failed',
      error: 'URL is required',
      duration: Date.now() - startTime
    });
    return null;
  }

  if (!method) {
    log('ERROR', `Request ${requestId}: HTTP method is required for Node.js fetch`);
    verboseExit('network.makeNodeFetchRequest', {
      requestId,
      status: 'failed',
      error: 'HTTP method is required',
      duration: Date.now() - startTime
    });
    return null;
  }

  // Function to perform a single fetch attempt
  const performFetch = async (attemptNum) => {
    const attemptStartTime = Date.now();
    log(
      'INFO',
      `Request ${requestId}: Node.js fetch attempt ${attemptNum}/${retries + 1} to ${url}`
    );
    sseSend({
      type: 'STATUS',
      message: `Attempting server-side request${
        attemptNum > 1 ? ` (attempt ${attemptNum})` : ''
      }...`
    });

    try {
      // Use dynamic import to avoid requiring fetch at the top level
      const { default: fetch } = await import('node-fetch');

      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Prepare fetch options
      const fetchOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': config.browser.userAgents[0],
          'X-Request-ID': requestId,
          ...headers
        },
        signal: controller.signal,
        body: method !== 'GET' && data ? JSON.stringify(data) : undefined,
        // Add additional options for better reliability
        follow: 5, // Follow up to 5 redirects
        compress: true, // Accept compressed responses
        size: 50 * 1024 * 1024, // 50MB max response size
        timeout: timeout // Set timeout
      };

      log('DEBUG', `Request ${requestId}: Node.js fetch options:`, {
        method,
        url,
        headers: fetchOptions.headers,
        bodySize: fetchOptions.body ? fetchOptions.body.length : 0
      });

      // Perform the fetch
      const fetchStartTime = Date.now();
      const response = await fetch(url, fetchOptions);
      const fetchEndTime = Date.now();

      // Clear timeout
      clearTimeout(timeoutId);

      const fetchDuration = fetchEndTime - fetchStartTime;
      log(
        'DEBUG',
        `Request ${requestId}: Node.js fetch completed in ${fetchDuration}ms with status ${response.status}`
      );

      // Get response headers
      const responseHeaders = {};
      response.headers.forEach((value, name) => {
        responseHeaders[name] = value;
      });

      // Parse response based on content type
      const contentType = response.headers.get('content-type') || '';
      let responseData;

      if (contentType.includes('application/json')) {
        try {
          responseData = await response.json();
          log('DEBUG', `Request ${requestId}: Successfully parsed JSON response`);
        } catch (jsonError) {
          log('WARN', `Request ${requestId}: Failed to parse JSON response: ${jsonError.message}`);
          responseData = await response.text();
        }
      } else {
        // Try to parse as JSON first even if content-type is not JSON
        const text = await response.text();
        log('DEBUG', `Request ${requestId}: Received text response (${text.length} bytes)`);

        try {
          responseData = JSON.parse(text);
          log(
            'DEBUG',
            `Request ${requestId}: Successfully parsed text as JSON despite content-type: ${contentType}`
          );
        } catch (e) {
          log('DEBUG', `Request ${requestId}: Response is not JSON, using as text`);
          responseData = text;
        }
      }

      const attemptDuration = Date.now() - attemptStartTime;
      log(
        'INFO',
        `Request ${requestId}: Node.js fetch succeeded with status ${response.status} in ${attemptDuration}ms`
      );

      return {
        status: response.status,
        data: responseData,
        headers: responseHeaders,
        timing: {
          fetchTime: fetchDuration,
          totalTime: attemptDuration
        }
      };
    } catch (error) {
      const attemptDuration = Date.now() - attemptStartTime;
      const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');

      log(
        'WARN',
        `Request ${requestId}: Node.js fetch attempt ${attemptNum} failed after ${attemptDuration}ms: ${error.message}`
      );

      if (isTimeout) {
        log('WARN', `Request ${requestId}: Request timed out after ${timeout}ms`);
      }

      // Rethrow to be caught by retry logic
      throw error;
    }
  };

  // Use a recursive approach instead of a loop to avoid no-await-in-loop issues
  const attemptFetch = async (attempt) => {
    try {
      const result = await performFetch(attempt);

      verboseExit('network.makeNodeFetchRequest', {
        requestId,
        status: 'success',
        responseStatus: result.status,
        duration: Date.now() - startTime
      });

      return result;
    } catch (error) {
      if (attempt <= retries) {
        // Calculate backoff delay with jitter
        const baseDelay = Math.min(1000 * 2 ** (attempt - 1), 5000);
        const jitter = Math.random() * 0.3 * baseDelay;
        const delay = Math.floor(baseDelay + jitter);

        log(
          'INFO',
          `Request ${requestId}: Retrying Node.js fetch in ${delay}ms (attempt ${attempt}/${retries})`
        );
        sseSend({
          type: 'STATUS',
          message: `Retrying server-side request in ${Math.round(delay / 1000)}s...`
        });

        // Wait before retrying
        await new Promise((resolve) => setTimeout(resolve, delay));

        // Recursive call for next attempt
        return attemptFetch(attempt + 1);
      }

      // All retries failed
      log(
        'ERROR',
        `Request ${requestId}: All Node.js fetch attempts failed:`,
        error.stack || error
      );
      sseSend({
        type: 'ERROR',
        message: `Server-side request failed after ${retries + 1} attempts: ${error.message}`
      });

      verboseExit('network.makeNodeFetchRequest', {
        requestId,
        status: 'failed',
        error: error.message,
        attempts: retries + 1,
        duration: Date.now() - startTime
      });

      return null;
    }
  };

  // Start with attempt 1
  return attemptFetch(1);
}

module.exports = {
  setupNetworkInterception,
  waitForApiRequest,
  withRetry,
  attemptDirectApiRequest,
  extractRequestData,
  getCapturedRequestData,
  makeNodeFetchRequest
};
