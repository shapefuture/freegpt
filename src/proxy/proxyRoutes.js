/**
 * Proxy API Routes
 * 
 * Provides endpoints for managing and monitoring proxies:
 * - GET /api/proxy/stats - Get proxy statistics
 * - GET /api/proxy/list - Get list of proxies
 * - POST /api/proxy/fetch - Fetch new proxies
 * - POST /api/proxy/test - Test proxies
 * - POST /api/proxy/rotate - Rotate to next proxy
 */

const express = require('express');
const router = express.Router();
const proxyManager = require('./proxyManager');
const { log } = require('../utils/logger');
const { generateUUID } = require('../utils/helpers');

// Middleware to ensure proxy manager is initialized
const ensureInitialized = async (req, res, next) => {
  if (!proxyManager.isInitialized) {
    try {
      await proxyManager.initialize();
    } catch (error) {
      log('ERROR', `Failed to initialize proxy manager: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: 'Failed to initialize proxy manager'
      });
    }
  }
  next();
};

// Get proxy statistics
router.get('/stats', ensureInitialized, (req, res) => {
  try {
    const stats = proxyManager.getStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    log('ERROR', `Error getting proxy stats: ${error.message}`);
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
    
    switch (type) {
      case 'active':
        proxies = proxyManager.proxies.active;
        break;
      case 'failed':
        proxies = proxyManager.proxies.failed;
        break;
      case 'blacklisted':
        proxies = proxyManager.proxies.blacklisted;
        break;
      case 'all':
        proxies = proxyManager.proxies.all;
        break;
      default:
        proxies = proxyManager.proxies.active;
    }
    
    // Limit the number of proxies returned
    proxies = proxies.slice(0, parseInt(limit, 10));
    
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
    log('ERROR', `Error getting proxy list: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fetch new proxies
router.post('/fetch', ensureInitialized, async (req, res) => {
  try {
    const requestId = generateUUID();
    log('INFO', `Request ${requestId}: Fetching new proxies...`);
    
    const proxies = await proxyManager.fetchProxies();
    
    res.json({
      success: true,
      message: `Fetched ${proxies.length} new proxies`,
      count: proxies.length
    });
  } catch (error) {
    log('ERROR', `Error fetching proxies: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test proxies
router.post('/test', ensureInitialized, async (req, res) => {
  try {
    const requestId = generateUUID();
    const { proxyIds, testAll = false, timeout } = req.body;
    
    let proxiesToTest = [];
    
    if (testAll) {
      log('INFO', `Request ${requestId}: Testing all proxies...`);
      proxiesToTest = proxyManager.proxies.all;
    } else if (proxyIds && Array.isArray(proxyIds) && proxyIds.length > 0) {
      log('INFO', `Request ${requestId}: Testing ${proxyIds.length} specific proxies...`);
      proxiesToTest = proxyManager.proxies.all.filter(p => proxyIds.includes(p.id));
    } else {
      log('INFO', `Request ${requestId}: Testing untested proxies...`);
      proxiesToTest = proxyManager.proxies.all.filter(p => p.status === 'untested');
    }
    
    const validProxies = await proxyManager.testProxies(
      proxiesToTest,
      timeout ? parseInt(timeout, 10) : undefined
    );
    
    res.json({
      success: true,
      message: `Tested ${proxiesToTest.length} proxies, ${validProxies.length} valid`,
      testedCount: proxiesToTest.length,
      validCount: validProxies.length
    });
  } catch (error) {
    log('ERROR', `Error testing proxies: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Rotate to next proxy
router.post('/rotate', ensureInitialized, (req, res) => {
  try {
    const proxy = proxyManager.rotateProxy();
    
    if (!proxy) {
      return res.status(404).json({
        success: false,
        error: 'No active proxies available'
      });
    }
    
    // Redact credentials from URL if present
    let sanitizedUrl = proxy.url;
    if (proxy.url.includes('@')) {
      sanitizedUrl = proxy.url.replace(/(https?:\/\/)([^:]+):([^@]+)@/, '$1****:****@');
    }
    
    res.json({
      success: true,
      message: 'Rotated to next proxy',
      proxy: {
        ...proxy,
        url: sanitizedUrl
      }
    });
  } catch (error) {
    log('ERROR', `Error rotating proxy: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Add a custom proxy
router.post('/add', ensureInitialized, async (req, res) => {
  try {
    const { url, protocol = 'http' } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required'
      });
    }
    
    // Parse the URL
    let host, port;
    
    if (url.includes('://')) {
      // URL with protocol
      const urlObj = new URL(url);
      host = urlObj.hostname;
      port = urlObj.port ? parseInt(urlObj.port, 10) : (protocol === 'https' ? 443 : 80);
    } else if (url.includes(':')) {
      // Host:port format
      [host, port] = url.split(':');
      port = parseInt(port, 10);
    } else {
      return res.status(400).json({
        success: false,
        error: 'Invalid proxy URL format'
      });
    }
    
    // Create proxy object
    const proxy = {
      id: generateUUID(),
      url: `${protocol}://${host}:${port}`,
      host,
      port,
      protocol,
      source: 'manual',
      added: new Date().toISOString(),
      lastTested: null,
      lastUsed: null,
      status: 'untested',
      responseTime: null,
      failCount: 0
    };
    
    // Add to proxy list
    proxyManager.proxies.all.push(proxy);
    
    // Test the proxy
    const [testResult] = await proxyManager.testProxies([proxy]);
    
    // Save to cache
    await proxyManager.saveProxiesToCache();
    
    res.json({
      success: true,
      message: 'Proxy added and tested',
      proxy: {
        ...proxy,
        status: proxy.status,
        isValid: proxy.status === 'valid'
      }
    });
  } catch (error) {
    log('ERROR', `Error adding proxy: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Delete a proxy
router.delete('/:proxyId', ensureInitialized, async (req, res) => {
  try {
    const { proxyId } = req.params;
    
    if (!proxyId) {
      return res.status(400).json({
        success: false,
        error: 'Proxy ID is required'
      });
    }
    
    // Find and remove the proxy from all lists
    const removeFromList = (list) => {
      const index = list.findIndex(p => p.id === proxyId);
      if (index !== -1) {
        list.splice(index, 1);
        return true;
      }
      return false;
    };
    
    const removedFromAll = removeFromList(proxyManager.proxies.all);
    removeFromList(proxyManager.proxies.active);
    removeFromList(proxyManager.proxies.failed);
    removeFromList(proxyManager.proxies.blacklisted);
    
    if (!removedFromAll) {
      return res.status(404).json({
        success: false,
        error: 'Proxy not found'
      });
    }
    
    // Save to cache
    await proxyManager.saveProxiesToCache();
    
    res.json({
      success: true,
      message: 'Proxy deleted',
      proxyId
    });
  } catch (error) {
    log('ERROR', `Error deleting proxy: ${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
