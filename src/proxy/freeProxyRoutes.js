/**
 * Free Proxy API Routes
 *
 * Provides endpoints for managing free rotating proxies:
 * - GET /api/free-proxy/stats - Get proxy statistics
 * - GET /api/free-proxy/list - Get list of proxies
 * - POST /api/free-proxy/fetch - Fetch new proxies
 * - POST /api/free-proxy/test - Test proxies
 * - POST /api/free-proxy/rotate - Rotate to next proxy
 */

const express = require('express');
const router = express.Router();
const freeProxyManager = require('./freeProxyManager');
const { log } = require('../utils');

// Middleware to ensure proxy manager is initialized
const ensureInitialized = async (req, res, next) => {
  if (!freeProxyManager.initialized) {
    try {
      await freeProxyManager.initialize();
    } catch (error) {
      log('ERROR', `Failed to initialize free proxy manager: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize free proxy manager'
      });
    }
  }
  next();
};

// Get proxy statistics
router.get('/stats', ensureInitialized, (req, res) => {
  try {
    const stats = freeProxyManager.getStats();

    // Redact sensitive information from current proxy
    if (stats.currentProxy) {
      stats.currentProxy = {
        ...stats.currentProxy,
        url: stats.currentProxy.url.replace(/(https?:\/\/)([^:]+):([^@]+)@/, '$1****:****@')
      };
    }

    res.json({
      success: true,
      stats
    });
  } catch (error) {
    log('ERROR', `Error getting free proxy stats: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get list of proxies
router.get('/list', ensureInitialized, (req, res) => {
  try {
    const { type = 'active', limit = 100 } = req.query;
    let proxies = [];

    if (type === 'active') {
      proxies = freeProxyManager.activeProxies.slice(0, parseInt(limit, 10));
    } else {
      proxies = freeProxyManager.proxies.slice(0, parseInt(limit, 10));
    }

    // Sanitize sensitive information
    const sanitizedProxies = proxies.map(proxy => {
      // Create a copy without credentials
      const { url, ...rest } = proxy;

      // Redact credentials from URL if present
      let sanitizedUrl = url;
      if (url.includes('@')) {
        sanitizedUrl = url.replace(/(https?:\/\/)([^:]+):([^@]+)@/, '$1****:****@');
      }

      return {
        ...rest,
        url: sanitizedUrl
      };
    });

    res.json({
      success: true,
      type,
      count: sanitizedProxies.length,
      proxies: sanitizedProxies
    });
  } catch (error) {
    log('ERROR', `Error getting free proxy list: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fetch new proxies
router.post('/fetch', ensureInitialized, async (req, res) => {
  try {
    log('INFO', 'Fetching new free proxies...');

    const proxies = await freeProxyManager.fetchProxies();

    res.json({
      success: true,
      message: `Fetched ${proxies.length} new free proxies`,
      count: proxies.length
    });
  } catch (error) {
    log('ERROR', `Error fetching free proxies: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test proxies
router.post('/test', ensureInitialized, async (req, res) => {
  try {
    const { maxToTest = 50, testWithLMArena = false } = req.body;

    if (testWithLMArena) {
      log('INFO', `Testing up to ${maxToTest} free proxies with LMArena compatibility...`);
    } else {
      log('INFO', `Testing up to ${maxToTest} free proxies...`);
    }

    // Pass the testWithLMArena parameter to the testProxies method
    const workingProxies = await freeProxyManager.testProxies(
      parseInt(maxToTest, 10),
      undefined, // Use default timeout
      testWithLMArena
    );

    // Count LMArena-compatible proxies
    const lmarenaCompatible = workingProxies.filter(p => p.worksWithLMArena === true).length;

    if (testWithLMArena) {
      res.json({
        success: true,
        message: `Found ${workingProxies.length} working free proxies, ${lmarenaCompatible} compatible with LMArena`,
        count: workingProxies.length,
        lmarenaCompatible
      });
    } else {
      res.json({
        success: true,
        message: `Found ${workingProxies.length} working free proxies`,
        count: workingProxies.length
      });
    }
  } catch (error) {
    log('ERROR', `Error testing free proxies: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rotate to next proxy
router.post('/rotate', ensureInitialized, (req, res) => {
  try {
    const { requireLMArenaSupport = false } = req.body;

    const proxy = freeProxyManager.getNextProxy(requireLMArenaSupport);

    if (!proxy) {
      return res.status(404).json({
        success: false,
        error: requireLMArenaSupport ?
          'No active LMArena-compatible proxies available' :
          'No active free proxies available'
      });
    }

    // Redact credentials from URL if present
    let sanitizedUrl = proxy.url;
    if (proxy.url.includes('@')) {
      sanitizedUrl = proxy.url.replace(/(https?:\/\/)([^:]+):([^@]+)@/, '$1****:****@');
    }

    res.json({
      success: true,
      message: requireLMArenaSupport ?
        'Rotated to next LMArena-compatible proxy' :
        'Rotated to next free proxy',
      proxy: {
        ...proxy,
        url: sanitizedUrl
      }
    });
  } catch (error) {
    log('ERROR', `Error rotating free proxy: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
