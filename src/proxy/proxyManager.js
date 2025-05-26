/**
 * Proxy Manager - Handles fetching, testing, and rotating proxies
 * 
 * This module provides functionality to:
 * 1. Fetch proxies from various free providers
 * 2. Test proxies for validity and performance
 * 3. Rotate proxies automatically
 * 4. Provide proxy statistics and health metrics
 */

const axios = require('axios');
const { log } = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');
const { generateUUID } = require('../utils/helpers');

// Cache directory for storing proxies
const PROXY_CACHE_DIR = path.join(process.cwd(), 'cache');
const PROXY_CACHE_FILE = path.join(PROXY_CACHE_DIR, 'proxies.json');

// Default proxy test timeout in milliseconds
const DEFAULT_TEST_TIMEOUT = 5000;

// Default proxy rotation interval in milliseconds (10 minutes)
const DEFAULT_ROTATION_INTERVAL = 10 * 60 * 1000;

// Maximum number of proxies to keep in the active pool
const MAX_ACTIVE_PROXIES = 10;

class ProxyManager {
  constructor() {
    this.proxies = {
      all: [],       // All fetched proxies
      active: [],    // Currently active and validated proxies
      failed: [],    // Failed proxies
      blacklisted: [] // Blacklisted proxies (repeatedly failed)
    };
    
    this.stats = {
      totalFetched: 0,
      totalTested: 0,
      totalValid: 0,
      totalFailed: 0,
      lastFetchTime: null,
      lastRotationTime: null
    };
    
    this.currentProxyIndex = 0;
    this.rotationTimer = null;
    this.isInitialized = false;
    this.providers = [
      { name: 'proxyscrape', enabled: true },
      { name: 'proxifly', enabled: true },
      { name: 'webshare', enabled: false }, // Requires API key
      { name: 'proxyshare', enabled: false } // Requires Discord join
    ];
  }

  /**
   * Initialize the proxy manager
   * @param {Object} options Configuration options
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
    try {
      // Create cache directory if it doesn't exist
      try {
        await fs.mkdir(PROXY_CACHE_DIR, { recursive: true });
      } catch (err) {
        if (err.code !== 'EEXIST') {
          throw err;
        }
      }

      // Load cached proxies if available
      await this.loadCachedProxies();
      
      // If no proxies are loaded or force refresh is requested, fetch new ones
      if (this.proxies.all.length === 0 || options.forceRefresh) {
        await this.fetchProxies();
      }
      
      // Test proxies if needed
      if (this.proxies.active.length === 0 || options.testProxies) {
        await this.testProxies();
      }
      
      // Start rotation timer if enabled
      if (options.enableRotation !== false) {
        this.startRotation(options.rotationInterval || DEFAULT_ROTATION_INTERVAL);
      }
      
      this.isInitialized = true;
      log('INFO', `Proxy Manager initialized with ${this.proxies.active.length} active proxies`);
      
      return true;
    } catch (error) {
      log('ERROR', `Failed to initialize Proxy Manager: ${error.message}`);
      return false;
    }
  }

  /**
   * Load proxies from cache file
   * @returns {Promise<void>}
   */
  async loadCachedProxies() {
    try {
      const data = await fs.readFile(PROXY_CACHE_FILE, 'utf8');
      const cached = JSON.parse(data);
      
      this.proxies = cached.proxies || this.proxies;
      this.stats = cached.stats || this.stats;
      
      log('INFO', `Loaded ${this.proxies.all.length} proxies from cache, ${this.proxies.active.length} active`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log('WARN', `Error loading proxy cache: ${error.message}`);
      } else {
        log('INFO', 'No proxy cache found, will fetch new proxies');
      }
    }
  }

  /**
   * Save proxies to cache file
   * @returns {Promise<void>}
   */
  async saveProxiesToCache() {
    try {
      const data = JSON.stringify({
        proxies: this.proxies,
        stats: this.stats,
        timestamp: new Date().toISOString()
      }, null, 2);
      
      await fs.writeFile(PROXY_CACHE_FILE, data, 'utf8');
      log('DEBUG', `Saved ${this.proxies.all.length} proxies to cache`);
    } catch (error) {
      log('WARN', `Error saving proxy cache: ${error.message}`);
    }
  }

  /**
   * Fetch proxies from all enabled providers
   * @returns {Promise<Array>} Array of fetched proxies
   */
  async fetchProxies() {
    log('INFO', 'Fetching proxies from enabled providers...');
    
    const newProxies = [];
    
    for (const provider of this.providers.filter(p => p.enabled)) {
      try {
        log('DEBUG', `Fetching proxies from ${provider.name}...`);
        const proxies = await this.fetchFromProvider(provider.name);
        
        if (proxies && proxies.length > 0) {
          log('INFO', `Fetched ${proxies.length} proxies from ${provider.name}`);
          newProxies.push(...proxies);
        } else {
          log('WARN', `No proxies fetched from ${provider.name}`);
        }
      } catch (error) {
        log('ERROR', `Error fetching proxies from ${provider.name}: ${error.message}`);
      }
    }
    
    // Deduplicate proxies
    const uniqueProxies = this.deduplicateProxies(newProxies);
    
    // Update stats
    this.stats.totalFetched += uniqueProxies.length;
    this.stats.lastFetchTime = new Date().toISOString();
    
    // Add to all proxies list
    this.proxies.all = [...this.proxies.all, ...uniqueProxies];
    
    // Save to cache
    await this.saveProxiesToCache();
    
    return uniqueProxies;
  }

  /**
   * Fetch proxies from a specific provider
   * @param {string} providerName Name of the provider
   * @returns {Promise<Array>} Array of fetched proxies
   */
  async fetchFromProvider(providerName) {
    switch (providerName) {
      case 'proxyscrape':
        return this.fetchFromProxyScrape();
      case 'proxifly':
        return this.fetchFromProxifly();
      case 'webshare':
        return this.fetchFromWebshare();
      case 'proxyshare':
        return this.fetchFromProxyShare();
      default:
        log('WARN', `Unknown provider: ${providerName}`);
        return [];
    }
  }

  /**
   * Fetch proxies from ProxyScrape
   * @returns {Promise<Array>} Array of fetched proxies
   */
  async fetchFromProxyScrape() {
    try {
      const response = await axios.get('https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all', {
        timeout: 10000
      });
      
      if (response.status === 200 && response.data) {
        // Parse the response (usually a list of IPs and ports)
        const proxyList = response.data.split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => {
            const [host, port] = line.trim().split(':');
            return {
              id: generateUUID(),
              url: `http://${host}:${port}`,
              host,
              port: parseInt(port, 10),
              protocol: 'http',
              source: 'proxyscrape',
              added: new Date().toISOString(),
              lastTested: null,
              lastUsed: null,
              status: 'untested',
              responseTime: null,
              failCount: 0
            };
          });
        
        return proxyList;
      }
      
      return [];
    } catch (error) {
      log('ERROR', `Error fetching from ProxyScrape: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch proxies from Proxifly
   * @returns {Promise<Array>} Array of fetched proxies
   */
  async fetchFromProxifly() {
    try {
      const response = await axios.get('https://proxifly.dev/api/proxy-list?format=json', {
        timeout: 10000
      });
      
      if (response.status === 200 && response.data && Array.isArray(response.data)) {
        const proxyList = response.data.map(proxy => {
          return {
            id: generateUUID(),
            url: `${proxy.protocol}://${proxy.ip}:${proxy.port}`,
            host: proxy.ip,
            port: parseInt(proxy.port, 10),
            protocol: proxy.protocol.toLowerCase(),
            source: 'proxifly',
            country: proxy.country || 'unknown',
            added: new Date().toISOString(),
            lastTested: null,
            lastUsed: null,
            status: 'untested',
            responseTime: null,
            failCount: 0
          };
        });
        
        return proxyList;
      }
      
      return [];
    } catch (error) {
      log('ERROR', `Error fetching from Proxifly: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch proxies from Webshare (requires API key)
   * @returns {Promise<Array>} Array of fetched proxies
   */
  async fetchFromWebshare() {
    // Webshare requires an API key, so this is just a placeholder
    // In a real implementation, you would fetch from their API
    log('WARN', 'Webshare provider requires API key, not implemented');
    return [];
  }

  /**
   * Fetch proxies from ProxyShare (requires Discord join)
   * @returns {Promise<Array>} Array of fetched proxies
   */
  async fetchFromProxyShare() {
    // ProxyShare requires Discord join, so this is just a placeholder
    log('WARN', 'ProxyShare provider requires Discord join, not implemented');
    return [];
  }

  /**
   * Remove duplicate proxies
   * @param {Array} proxies Array of proxies
   * @returns {Array} Deduplicated array of proxies
   */
  deduplicateProxies(proxies) {
    const seen = new Set();
    const existingUrls = new Set(this.proxies.all.map(p => p.url));
    
    return proxies.filter(proxy => {
      const key = proxy.url;
      if (seen.has(key) || existingUrls.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Test proxies for validity and performance
   * @param {Array} proxiesToTest Array of proxies to test (defaults to all untested)
   * @param {number} timeout Timeout in milliseconds
   * @returns {Promise<Array>} Array of valid proxies
   */
  async testProxies(proxiesToTest = null, timeout = DEFAULT_TEST_TIMEOUT) {
    // If no proxies specified, test all untested ones
    const toTest = proxiesToTest || this.proxies.all.filter(p => p.status === 'untested');
    
    if (toTest.length === 0) {
      log('INFO', 'No proxies to test');
      return [];
    }
    
    log('INFO', `Testing ${toTest.length} proxies...`);
    
    const validProxies = [];
    
    // Test proxies in batches to avoid overwhelming the network
    const batchSize = 5;
    for (let i = 0; i < toTest.length; i += batchSize) {
      const batch = toTest.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(proxy => this.testProxy(proxy, timeout))
      );
      
      // Update stats
      this.stats.totalTested += batch.length;
      
      // Process results
      for (let j = 0; j < results.length; j++) {
        const { proxy, isValid, responseTime } = results[j];
        
        // Update proxy status
        proxy.lastTested = new Date().toISOString();
        proxy.responseTime = responseTime;
        
        if (isValid) {
          proxy.status = 'valid';
          proxy.failCount = 0;
          validProxies.push(proxy);
          
          // Add to active proxies if not already there
          if (!this.proxies.active.some(p => p.id === proxy.id)) {
            this.proxies.active.push(proxy);
          }
          
          // Remove from failed proxies if present
          const failedIndex = this.proxies.failed.findIndex(p => p.id === proxy.id);
          if (failedIndex !== -1) {
            this.proxies.failed.splice(failedIndex, 1);
          }
        } else {
          proxy.status = 'failed';
          proxy.failCount++;
          
          // Add to failed proxies if not already there
          if (!this.proxies.failed.some(p => p.id === proxy.id)) {
            this.proxies.failed.push(proxy);
          }
          
          // Remove from active proxies if present
          const activeIndex = this.proxies.active.findIndex(p => p.id === proxy.id);
          if (activeIndex !== -1) {
            this.proxies.active.splice(activeIndex, 1);
          }
          
          // Blacklist if failed too many times
          if (proxy.failCount >= 3) {
            proxy.status = 'blacklisted';
            if (!this.proxies.blacklisted.some(p => p.id === proxy.id)) {
              this.proxies.blacklisted.push(proxy);
            }
          }
        }
      }
      
      // Short delay between batches
      if (i + batchSize < toTest.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Update stats
    this.stats.totalValid = this.proxies.active.length;
    this.stats.totalFailed = this.proxies.failed.length;
    
    // Limit active proxies to prevent memory issues
    if (this.proxies.active.length > MAX_ACTIVE_PROXIES) {
      this.proxies.active = this.proxies.active
        .sort((a, b) => a.responseTime - b.responseTime)
        .slice(0, MAX_ACTIVE_PROXIES);
    }
    
    // Save to cache
    await this.saveProxiesToCache();
    
    log('INFO', `Proxy testing completed. ${validProxies.length} valid proxies found.`);
    
    return validProxies;
  }

  /**
   * Test a single proxy
   * @param {Object} proxy Proxy object to test
   * @param {number} timeout Timeout in milliseconds
   * @returns {Promise<Object>} Test result
   */
  async testProxy(proxy, timeout) {
    const startTime = Date.now();
    let isValid = false;
    let responseTime = null;
    
    try {
      // Test the proxy by making a request to a test endpoint
      const response = await axios.get('https://api.ipify.org?format=json', {
        proxy: {
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol
        },
        timeout: timeout
      });
      
      responseTime = Date.now() - startTime;
      
      // Check if the response is valid
      isValid = response.status === 200 && response.data && response.data.ip;
      
      if (isValid) {
        log('DEBUG', `Proxy ${proxy.url} is valid (${responseTime}ms)`);
      }
    } catch (error) {
      responseTime = Date.now() - startTime;
      log('DEBUG', `Proxy ${proxy.url} failed: ${error.message}`);
    }
    
    return { proxy, isValid, responseTime };
  }

  /**
   * Start proxy rotation timer
   * @param {number} interval Rotation interval in milliseconds
   */
  startRotation(interval = DEFAULT_ROTATION_INTERVAL) {
    // Clear existing timer if any
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
    }
    
    // Start new rotation timer
    this.rotationTimer = setInterval(() => {
      this.rotateProxy();
    }, interval);
    
    log('INFO', `Proxy rotation started with interval of ${interval}ms`);
  }

  /**
   * Stop proxy rotation timer
   */
  stopRotation() {
    if (this.rotationTimer) {
      clearInterval(this.rotationTimer);
      this.rotationTimer = null;
      log('INFO', 'Proxy rotation stopped');
    }
  }

  /**
   * Rotate to the next proxy
   * @returns {Object|null} The next proxy or null if none available
   */
  rotateProxy() {
    if (this.proxies.active.length === 0) {
      log('WARN', 'No active proxies available for rotation');
      return null;
    }
    
    // Move to the next proxy in the active list
    this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.active.length;
    const proxy = this.proxies.active[this.currentProxyIndex];
    
    // Update proxy usage stats
    proxy.lastUsed = new Date().toISOString();
    
    // Update rotation stats
    this.stats.lastRotationTime = new Date().toISOString();
    
    log('DEBUG', `Rotated to proxy: ${proxy.url}`);
    
    return proxy;
  }

  /**
   * Get the current proxy
   * @returns {Object|null} Current proxy or null if none available
   */
  getCurrentProxy() {
    if (this.proxies.active.length === 0) {
      return null;
    }
    
    return this.proxies.active[this.currentProxyIndex];
  }

  /**
   * Get proxy stats
   * @returns {Object} Proxy statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeCount: this.proxies.active.length,
      failedCount: this.proxies.failed.length,
      blacklistedCount: this.proxies.blacklisted.length,
      totalCount: this.proxies.all.length,
      currentProxy: this.getCurrentProxy()
    };
  }
}

// Export singleton instance
const proxyManager = new ProxyManager();
module.exports = proxyManager;
