/**
 * API routes for the application
 */
const express = require('express');
const router = express.Router();
const { log, generateUUID, verboseEntry, verboseExit } = require('../utils');
const puppeteerManager = require('../puppeteerManager');
const freeProxyManager = require('../proxy/freeProxyManager');
const config = require('../config/app.config');
const { navigateToLMArena } = require('../navigation/lmarenaNavigator');

// Map to store waiting retry resolvers
const waitingForRetryResolvers = new Map();

/**
 * Chat API endpoint
 */
router.post('/chat', async (req, res) => {
  verboseEntry('POST /api/chat', req.body);
  const {
    userPrompt,
    systemPrompt,
    targetModelA,
    targetModelB,
    clientConversationId: existingClientConversationId,
    clientMessagesHistory = []
  } = req.body;

  const requestId = generateUUID();
  log('INFO', `Request ${requestId}: Received /api/chat`, {
    userPrompt: userPrompt ? userPrompt.substring(0, 30) + '...' : 'N/A'
  });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const sseSend = (data) => {
    log('DEBUG', 'SSE Send:', data);
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    const pageInstance = await puppeteerManager.launchOrGetPage();
    if (!pageInstance) {
      throw new Error('Failed to launch or get Puppeteer page.');
    }

    const waitForUserRetrySignal = () => {
      log('DEBUG', `[${requestId}] Waiting for user retry signal`);
      return new Promise((resolve) => {
        waitingForRetryResolvers.set(requestId, resolve);
        log('DEBUG', `Request ${requestId}: Paused, waiting for user retry signal.`);
      });
    };

    // Check if the requested model is available
    if (targetModelA) {
      sseSend({ type: 'STATUS', message: `Checking availability of model: ${targetModelA}...` });

      try {
        const modelsModule = require('../models');

        // First check if the model is in our cached list
        let modelInfo = null;
        if (global.cachedModels && global.cachedModels.length > 0) {
          modelInfo = global.cachedModels.find((m) => m.id === targetModelA);
        }

        // If we don't have the model in cache or need to verify availability
        if (!modelInfo || modelInfo.available === undefined) {
          log('INFO', `Request ${requestId}: Checking availability for model ${targetModelA}`);
          const isAvailable = await modelsModule.checkModelAvailability(
            pageInstance,
            targetModelA,
            { requestId }
          );

          if (!isAvailable) {
            log('WARN', `Request ${requestId}: Requested model ${targetModelA} is not available`);
            sseSend({
              type: 'WARNING',
              message: `The requested model "${targetModelA}" is currently unavailable. Using default model instead.`
            });

            // Try to get an available model from cache
            if (global.cachedModels && global.cachedModels.length > 0) {
              const availableModel = global.cachedModels.find((m) => m.available);
              if (availableModel) {
                log(
                  'INFO',
                  `Request ${requestId}: Using available model ${availableModel.id} instead`
                );
                sseSend({
                  type: 'STATUS',
                  message: `Using available model: ${availableModel.id}`
                });
                // Update the target model
                targetModelA = availableModel.id;
              }
            }
          } else {
            log('INFO', `Request ${requestId}: Confirmed model ${targetModelA} is available`);
            sseSend({ type: 'STATUS', message: `Model ${targetModelA} is available.` });
          }
        } else if (modelInfo && !modelInfo.available) {
          log(
            'WARN',
            `Request ${requestId}: Cached info shows model ${targetModelA} is not available`
          );
          sseSend({
            type: 'WARNING',
            message: `The requested model "${targetModelA}" is currently unavailable. Using default model instead.`
          });

          // Try to get an available model from cache
          const availableModel = global.cachedModels.find((m) => m.available);
          if (availableModel) {
            log('INFO', `Request ${requestId}: Using available model ${availableModel.id} instead`);
            sseSend({
              type: 'STATUS',
              message: `Using available model: ${availableModel.id}`
            });
            // Update the target model
            targetModelA = availableModel.id;
          }
        } else {
          log(
            'INFO',
            `Request ${requestId}: Using cached availability info for model ${targetModelA}`
          );
          sseSend({ type: 'STATUS', message: `Model ${targetModelA} is available (cached).` });
        }
      } catch (modelCheckError) {
        log(
          'WARN',
          `Request ${requestId}: Error checking model availability: ${modelCheckError.message}`
        );
        sseSend({
          type: 'WARNING',
          message: `Could not verify model availability. Proceeding with requested model.`
        });
      }
    }

    // Try to navigate to LMArena with our enhanced navigation strategy
    const navigationSuccess = await navigateToLMArena(pageInstance, {
      requestId,
      sseSend,
      forceRefresh: false
    });

    if (!navigationSuccess) {
      throw new Error('Failed to navigate to LMArena after multiple attempts');
    }

    await puppeteerManager.interactWithLMArena(userPrompt, {
      modelId: targetModelA,
      sseSend,
      autoSolveCaptcha: true,
      requestId
    });
    
    verboseExit('POST /api/chat', 'Chat interaction finished.');
  } catch (error) {
    log(
      'ERROR',
      `Request ${requestId}: Error in /api/chat handler:`,
      error.stack || error.message || error
    );
    sseSend({ type: 'ERROR', message: `Server error: ${error.message}` });
  } finally {
    if (!res.writableEnded) {
      log('INFO', `Request ${requestId}: Ending SSE stream for /api/chat.`);
      res.end();
    }
    if (waitingForRetryResolvers.has(requestId)) {
      waitingForRetryResolvers.delete(requestId);
    }
  }
});

/**
 * Trigger retry endpoint
 */
router.post('/trigger-retry', (req, res) => {
  verboseEntry('POST /api/trigger-retry', req.body);
  const { requestId } = req.body;
  log('INFO', `Request ${requestId}: Received /api/trigger-retry`);

  if (waitingForRetryResolvers.has(requestId)) {
    const resolve = waitingForRetryResolvers.get(requestId);
    resolve({ userRetrying: true });
    waitingForRetryResolvers.delete(requestId);
    res.json({ status: 'OK', message: 'Retry signal sent to backend task.' });
    verboseExit('POST /api/trigger-retry', 'Retry resolver executed');
  } else {
    log('WARN', `Request ${requestId}: No active action waiting for retry.`);
    res
      .status(404)
      .json({ error: 'No active action waiting for retry, or request ID mismatched.' });
    verboseExit('POST /api/trigger-retry', 'No resolver found for this requestId');
  }
});

/**
 * IP check endpoint
 */
router.get('/ip-check', async (req, res) => {
  verboseEntry('GET /api/ip-check', {});
  try {
    const requestId = generateUUID();
    log('DEBUG', `Entering GET /api/ip-check with args: {}`);

    // Get proxy information
    let proxyUrl = process.env.PROXY_SERVER_URL;
    let usingFreeProxy = false;
    let proxySource = null;
    let worksWithLMArena = false;

    // Always use the known working proxy for LMArena
    const knownWorkingProxyUrl = config.KNOWN_WORKING_PROXY;

    if (freeProxyManager.initialized) {
      // Force the use of our known working proxy
      let currentProxy;

      // Check if we have the known working proxy in our active proxies
      const knownProxy = freeProxyManager.activeProxies.find(p => p.url === knownWorkingProxyUrl);

      if (knownProxy) {
        currentProxy = knownProxy;
        log('INFO', `Request ${requestId}: Using known working proxy: ${knownWorkingProxyUrl}`);
      } else {
        // Try to get an LMArena-compatible proxy
        currentProxy = freeProxyManager.getCurrentProxy(true);
      }

      if (currentProxy) {
        proxyUrl = currentProxy.url;
        usingFreeProxy = true;
        proxySource = currentProxy.source;
        worksWithLMArena = !!currentProxy.worksWithLMArena;

        // Set the proxy URL as an environment variable so it's used by default
        process.env.PROXY_SERVER_URL = currentProxy.url;

        log('INFO', `Request ${requestId}: Using free rotating proxy from ${proxySource} for IP check (LMArena compatible: ${worksWithLMArena})`);

        if (worksWithLMArena) {
          log('INFO', `Request ${requestId}: Using LMArena-compatible proxy: ${currentProxy.url} (${currentProxy.lmarenaTestMethod})`);
        }
      } else {
        // If no proxy is available, use the known working proxy directly
        proxyUrl = knownWorkingProxyUrl;
        usingFreeProxy = true;
        proxySource = "manual";
        worksWithLMArena = true;

        // Set the proxy URL as an environment variable so it's used by default
        process.env.PROXY_SERVER_URL = knownWorkingProxyUrl;

        log('INFO', `Request ${requestId}: Using manually configured working proxy: ${knownWorkingProxyUrl}`);
      }
    }

    // Get a page from the browser
    const page = await puppeteerManager.launchOrGetPage({ requestId });

    // Track which service we used successfully
    let serviceUsed = '';
    let ipData = { ip: 'unknown' };

    try {
      // Try multiple IP check services in case one fails
      const ipCheckServices = [
        { url: 'https://api.ipify.org?format=json', parser: 'json' },
        { url: 'https://ifconfig.me/ip', parser: 'text' },
        { url: 'https://icanhazip.com', parser: 'text' },
        { url: 'https://ipinfo.io/json', parser: 'json', field: 'ip' }
      ];

      for (const service of ipCheckServices) {
        try {
          log('INFO', `Request ${requestId}: Trying IP check service: ${service.url}`);

          // Navigate to IP check service
          await page.goto(service.url, {
            waitUntil: 'networkidle2',
            timeout: 15000 // Shorter timeout for each service
          });

          // Get the IP address from the response
          if (service.parser === 'json') {
            ipData = await page.evaluate((field) => {
              try {
                const text = document.body.textContent;
                const data = JSON.parse(text);
                return { ip: field ? data[field] : data.ip };
              } catch (e) {
                return { ip: 'Error parsing response', error: e.message };
              }
            }, service.field);
          } else {
            // Text parser
            ipData = await page.evaluate(() => {
              try {
                return { ip: document.body.textContent.trim() };
              } catch (e) {
                return { ip: 'Error parsing response', error: e.message };
              }
            });
          }

          if (ipData.ip && ipData.ip !== 'unknown' && !ipData.error) {
            serviceUsed = service.url;
            break;
          }
        } catch (serviceError) {
          log('WARN', `Request ${requestId}: IP check service ${service.url} failed: ${serviceError.message}`);
          // Continue to the next service
        }
      }

      // Check LMArena connectivity
      let lmarenaStatus = 'unknown';

      try {
        // Try to navigate to LMArena to check connectivity
        log('INFO', `Request ${requestId}: Testing LMArena connectivity...`);

        // Use our enhanced navigation strategy
        const navigationSuccess = await navigateToLMArena(page, {
          requestId,
          forceRefresh: false
        });

        if (navigationSuccess) {
          lmarenaStatus = 'connected';
          log('INFO', `Request ${requestId}: Successfully connected to LMArena`);
        } else {
          lmarenaStatus = 'error: navigation failed';
          log('WARN', `Request ${requestId}: Failed to connect to LMArena: ${lmarenaStatus}`);
        }
      } catch (lmarenaError) {
        lmarenaStatus = `error: ${lmarenaError.message}`;
        log('WARN', `Request ${requestId}: Error testing LMArena connectivity: ${lmarenaError.message}`);
      }

      // Get free proxy stats
      const freeProxyStats = freeProxyManager.initialized ? {
        total: freeProxyManager.proxies.length,
        active: freeProxyManager.activeProxies.length,
        lmarenaCompatible: freeProxyManager.activeProxies.filter(p => p.worksWithLMArena === true).length
      } : null;

      // Return the IP address and proxy information
      res.json({
        success: true,
        ip: ipData.ip,
        serviceUsed,
        usingProxy: !!proxyUrl,
        usingFreeProxy,
        proxySource,
        worksWithLMArena,
        lmarenaStatus,
        freeProxyStats,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      log('ERROR', `Error checking IP: ${error.message}`);
      res.status(500).json({
        success: false,
        error: `Error checking IP: ${error.message}`,
        usingProxy: !!proxyUrl
      });
    } finally {
      // Release the page
      await puppeteerManager.releasePage(page, { requestId });
    }
  } catch (error) {
    log('ERROR', `Error in /api/ip-check: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
  verboseExit('GET /api/ip-check', {});
});

/**
 * Models API endpoint
 */
router.get('/models', async (req, res) => {
  verboseEntry('GET /api/models', req.query);

  try {
    // Get the force refresh parameter
    const forceRefresh = req.query.forceRefresh === 'true';

    // Use the getModels function from the models module
    const modelsModule = require('../models');
    const models = await modelsModule.getModels({
      forceRefresh,
      sseSend: (data) => {
        // No SSE for this endpoint, just log
        log('DEBUG', `Model fetch status: ${JSON.stringify(data)}`);
      }
    });

    // Return the models with additional metadata
    res.json({
      models,
      metadata: {
        count: models.length,
        availableCount: models.filter((m) => m.available).length,
        timestamp: global.cachedModelsTimestamp || Date.now(),
        sources: [...new Set(models.map((m) => m.source).filter(Boolean))],
        cached: !forceRefresh && global.cachedModelsTimestamp ? true : false
      }
    });

    verboseExit('GET /api/models', { modelCount: models.length });
  } catch (err) {
    log('ERROR', 'Failed to fetch models', err);
    res.status(500).json({ error: 'Failed to fetch models' });
  }
});

/**
 * Set known proxy endpoint
 */
router.get('/set-known-proxy', async (req, res) => {
  verboseEntry('GET /api/set-known-proxy', {});
  try {
    const requestId = generateUUID();
    log('DEBUG', `Entering GET /api/set-known-proxy with args: {}`);
    
    // Set the known working proxy
    const knownWorkingProxyUrl = config.KNOWN_WORKING_PROXY;
    process.env.PROXY_SERVER_URL = knownWorkingProxyUrl;
    
    // Add it to the free proxy manager if initialized
    if (freeProxyManager.initialized) {
      // Check if we already have this proxy
      const existingProxy = freeProxyManager.proxies.find(p => p.url === knownWorkingProxyUrl);
      
      if (existingProxy) {
        // Update the existing proxy
        existingProxy.working = true;
        existingProxy.worksWithLMArena = true;
        existingProxy.lmarenaTestMethod = 'HEAD';
        existingProxy.lastTested = new Date().toISOString();
        
        // Make sure it's in the active proxies list
        if (!freeProxyManager.activeProxies.some(p => p.url === knownWorkingProxyUrl)) {
          freeProxyManager.activeProxies.push(existingProxy);
        }
      } else {
        // Add the new proxy
        const newProxy = {
          id: generateUUID(),
          url: knownWorkingProxyUrl,
          host: "47.250.11.111",
          port: 10000,
          protocol: "http",
          source: "manual",
          added: new Date().toISOString(),
          lastTested: new Date().toISOString(),
          working: true,
          worksWithLMArena: true,
          lmarenaTestMethod: 'HEAD'
        };
        
        freeProxyManager.proxies.push(newProxy);
        freeProxyManager.activeProxies.push(newProxy);
      }
      
      // Save the updated proxies to cache
      freeProxyManager.saveToCache();
      
      log('INFO', `Manually set known working proxy: ${knownWorkingProxyUrl}`);
    }
    
    // Return success
    res.json({
      success: true,
      message: `Set known working proxy: ${knownWorkingProxyUrl}`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    log('ERROR', `Error in /api/set-known-proxy: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
  verboseExit('GET /api/set-known-proxy', {});
});

module.exports = router;
