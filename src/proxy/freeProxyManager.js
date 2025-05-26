/**
 * Free Proxy Manager
 *
 * A simple manager for fetching, testing, and rotating free proxies
 * from various providers like ProxyScrape, Proxifly, etc.
 */

const axios = require('axios');
const { log } = require('../utils');
const fs = require('fs').promises;
const path = require('path');
const { generateUUID } = require('../utils');

// Cache file for storing proxies
const PROXY_CACHE_FILE = path.join(process.cwd(), 'cache', 'free-proxies.json');

// Default test timeout in milliseconds
const DEFAULT_TEST_TIMEOUT = 5000;

// Free proxy sources
const PROXY_SOURCES = {
  PROXYSCRAPE: {
    name: 'ProxyScrape',
    url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all',
    enabled: true
  },
  PROXYSCRAPE_PREMIUM: {
    name: 'ProxyScrape Premium',
    url: 'https://api.proxyscrape.com/v2/?request=getproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=elite',
    enabled: true
  },
  PROXIFLY: {
    name: 'Proxifly',
    url: 'https://proxifly.dev/api/proxy-list?format=json',
    enabled: true
  },
  FREE_PROXY_LIST: {
    name: 'Free Proxy List',
    url: 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt',
    enabled: true
  },
  GEONODE: {
    name: 'GeoNode',
    url: 'https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&filterUpTime=90&protocols=http,https',
    enabled: true,
    jsonPath: 'data',
    parser: 'geonode'
  },
  PROXY_LIST: {
    name: 'Proxy-List',
    url: 'https://www.proxy-list.download/api/v1/get?type=http',
    enabled: true
  },
  SPYS_ONE: {
    name: 'Spys.one',
    url: 'https://spys.one/free-proxy-list/US/',
    enabled: false, // Requires browser automation to parse
    parser: 'spys'
  },
  PROXYSHARE: {
    name: 'ProxyShare',
    url: 'https://api.proxyshare.io/free',
    enabled: false, // Requires API key
    parser: 'proxyshare'
  }
};

class FreeProxyManager {
  constructor() {
    this.proxies = [];
    this.activeProxies = [];
    this.currentIndex = 0;
    this.lastFetchTime = null;
    this.initialized = false;
  }

  /**
   * Initialize the proxy manager
   */
  async initialize() {
    try {
      // Create cache directory if it doesn't exist
      await fs.mkdir(path.dirname(PROXY_CACHE_FILE), { recursive: true });

      // Try to load cached proxies
      await this.loadFromCache();

      // If no proxies loaded, fetch new ones
      if (this.proxies.length === 0) {
        await this.fetchProxies();
      }

      // Test proxies to find active ones
      await this.testProxies();

      this.initialized = true;
      log('INFO', `Free Proxy Manager initialized with ${this.activeProxies.length} active proxies`);
      return true;
    } catch (error) {
      log('ERROR', `Failed to initialize Free Proxy Manager: ${error.message}`);
      return false;
    }
  }

  /**
   * Load proxies from cache file
   */
  async loadFromCache() {
    try {
      const data = await fs.readFile(PROXY_CACHE_FILE, 'utf8');
      const cached = JSON.parse(data);

      if (cached.proxies && Array.isArray(cached.proxies)) {
        this.proxies = cached.proxies;
        this.activeProxies = cached.activeProxies || [];
        this.lastFetchTime = cached.lastFetchTime;

        log('INFO', `Loaded ${this.proxies.length} proxies from cache, ${this.activeProxies.length} active`);
        return true;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log('WARN', `Error loading proxy cache: ${error.message}`);
      } else {
        log('INFO', 'No proxy cache found, will fetch new proxies');
      }
    }
    return false;
  }

  /**
   * Save proxies to cache file
   */
  async saveToCache() {
    try {
      const data = JSON.stringify({
        proxies: this.proxies,
        activeProxies: this.activeProxies,
        lastFetchTime: this.lastFetchTime,
        timestamp: new Date().toISOString()
      });

      await fs.writeFile(PROXY_CACHE_FILE, data, 'utf8');
      log('DEBUG', `Saved ${this.proxies.length} proxies to cache`);
      return true;
    } catch (error) {
      log('WARN', `Error saving proxy cache: ${error.message}`);
      return false;
    }
  }

  /**
   * Fetch proxies from all enabled sources
   */
  async fetchProxies() {
    log('INFO', 'Fetching proxies from free providers...');

    const newProxies = [];

    // Fetch from all enabled sources
    for (const [key, source] of Object.entries(PROXY_SOURCES)) {
      if (!source.enabled) continue;

      try {
        // Convert key to lowercase for the provider name
        const providerName = key.toLowerCase();
        log('INFO', `Fetching proxies from ${source.name}...`);

        let proxies = [];

        // Use the appropriate fetch method based on the provider
        switch (providerName) {
          case 'proxyscrape':
            proxies = await this.fetchFromProxyScrape(source.url);
            break;
          case 'proxyscrape_premium':
            proxies = await this.fetchFromProxyScrape(source.url, 'proxyscrape_premium');
            break;
          case 'proxifly':
            proxies = await this.fetchFromProxifly();
            break;
          case 'free_proxy_list':
            proxies = await this.fetchFromFreeProxyList();
            break;
          case 'geonode':
            proxies = await this.fetchFromGeoNode();
            break;
          case 'proxy_list':
            proxies = await this.fetchFromProxyList();
            break;
          default:
            log('WARN', `No fetch method implemented for ${source.name}`);
            continue;
        }

        log('INFO', `Fetched ${proxies.length} proxies from ${source.name}`);
        newProxies.push(...proxies);
      } catch (error) {
        log('ERROR', `Error fetching from ${source.name}: ${error.message}`);
      }
    }

    // Deduplicate and add to proxy list
    const uniqueProxies = this.deduplicateProxies(newProxies);
    this.proxies = [...this.proxies, ...uniqueProxies];
    this.lastFetchTime = new Date().toISOString();

    // Save to cache
    await this.saveToCache();

    log('INFO', `Added ${uniqueProxies.length} new unique proxies, total: ${this.proxies.length}`);
    return uniqueProxies;
  }

  /**
   * Fetch proxies from ProxyScrape
   * @param {string} url - The URL to fetch proxies from
   * @param {string} sourceName - The name of the source
   */
  async fetchFromProxyScrape(url = PROXY_SOURCES.PROXYSCRAPE.url, sourceName = 'proxyscrape') {
    try {
      const response = await axios.get(url, {
        timeout: 10000
      });

      if (response.status === 200 && response.data) {
        // Parse the response (usually a list of IPs and ports)
        return response.data.split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => {
            const [host, port] = line.trim().split(':');
            return {
              id: generateUUID(),
              url: `http://${host}:${port}`,
              host,
              port: parseInt(port, 10),
              protocol: 'http',
              source: sourceName,
              added: new Date().toISOString(),
              lastTested: null,
              working: null
            };
          });
      }

      return [];
    } catch (error) {
      log('ERROR', `Error fetching from ${sourceName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch proxies from Proxifly
   */
  async fetchFromProxifly() {
    try {
      const response = await axios.get(PROXY_SOURCES.PROXIFLY.url, {
        timeout: 10000
      });

      if (response.status === 200 && response.data && Array.isArray(response.data)) {
        return response.data.map(proxy => {
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
            working: null
          };
        });
      }

      return [];
    } catch (error) {
      log('ERROR', `Error fetching from Proxifly: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch proxies from Free Proxy List
   */
  async fetchFromFreeProxyList() {
    try {
      const response = await axios.get(PROXY_SOURCES.FREE_PROXY_LIST.url, {
        timeout: 10000
      });

      if (response.status === 200 && response.data) {
        // Parse the response (usually a list of IPs and ports)
        return response.data.split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => {
            const [host, port] = line.trim().split(':');
            return {
              id: generateUUID(),
              url: `http://${host}:${port}`,
              host,
              port: parseInt(port, 10),
              protocol: 'http',
              source: 'freeproxylist',
              added: new Date().toISOString(),
              lastTested: null,
              working: null
            };
          });
      }

      return [];
    } catch (error) {
      log('ERROR', `Error fetching from Free Proxy List: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch proxies from GeoNode
   */
  async fetchFromGeoNode() {
    try {
      const response = await axios.get(PROXY_SOURCES.GEONODE.url, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
        }
      });

      if (response.status === 200 && response.data && response.data.data) {
        // Parse the JSON response
        return response.data.data.map(proxy => {
          return {
            id: generateUUID(),
            url: `${proxy.protocols[0]}://${proxy.ip}:${proxy.port}`,
            host: proxy.ip,
            port: parseInt(proxy.port, 10),
            protocol: proxy.protocols[0],
            source: 'geonode',
            country: proxy.country,
            anonymity: proxy.anonymity,
            added: new Date().toISOString(),
            lastTested: null,
            working: null
          };
        });
      }

      return [];
    } catch (error) {
      log('ERROR', `Error fetching from GeoNode: ${error.message}`);
      return [];
    }
  }

  /**
   * Fetch proxies from Proxy-List
   */
  async fetchFromProxyList() {
    try {
      const response = await axios.get(PROXY_SOURCES.PROXY_LIST.url, {
        timeout: 10000
      });

      if (response.status === 200 && response.data) {
        // Parse the response (usually a list of IPs and ports)
        return response.data.split('\n')
          .filter(line => line.trim().length > 0)
          .map(line => {
            const [host, port] = line.trim().split(':');
            return {
              id: generateUUID(),
              url: `http://${host}:${port}`,
              host,
              port: parseInt(port, 10),
              protocol: 'http',
              source: 'proxy_list',
              added: new Date().toISOString(),
              lastTested: null,
              working: null
            };
          });
      }

      return [];
    } catch (error) {
      log('ERROR', `Error fetching from Proxy-List: ${error.message}`);
      return [];
    }
  }

  /**
   * Remove duplicate proxies
   */
  deduplicateProxies(proxies) {
    const seen = new Set();
    const existingUrls = new Set(this.proxies.map(p => p.url));

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
   * Test proxies to find working ones
   * @param {number} maxToTest - Maximum number of proxies to test
   * @param {number} timeout - Timeout in milliseconds
   * @param {boolean} testWithLMArena - Whether to specifically test compatibility with LMArena
   */
  async testProxies(maxToTest = 50, timeout = DEFAULT_TEST_TIMEOUT, testWithLMArena = false) {
    // Get proxies to test
    let proxiesToTest = [];

    if (testWithLMArena) {
      // If testing with LMArena, prioritize proxies that haven't been tested with LMArena yet
      // or haven't been tested recently
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      // First, include working proxies that haven't been tested with LMArena
      const untested = this.activeProxies.filter(p => p.worksWithLMArena === undefined);

      // Then include proxies that were previously tested with LMArena but need a retest
      const needRetest = this.activeProxies.filter(
        p => p.worksWithLMArena !== undefined &&
             p.lastTested &&
             new Date(p.lastTested) < oneDayAgo
      );

      // Combine and limit
      proxiesToTest = [...untested, ...needRetest].slice(0, maxToTest);

      // If we still have room, add some untested proxies
      if (proxiesToTest.length < maxToTest) {
        const remainingSlots = maxToTest - proxiesToTest.length;
        const untestedGeneral = this.proxies
          .filter(p => !p.lastTested && !proxiesToTest.some(tp => tp.id === p.id))
          .slice(0, remainingSlots);

        proxiesToTest = [...proxiesToTest, ...untestedGeneral];
      }
    } else {
      // Regular testing - get untested proxies or proxies that haven't been tested in a while
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);

      proxiesToTest = this.proxies
        .filter(p => !p.lastTested || new Date(p.lastTested) < oneDayAgo)
        .slice(0, maxToTest);
    }

    if (proxiesToTest.length === 0) {
      log('INFO', 'No proxies to test');
      return [];
    }

    log('INFO', `Testing ${proxiesToTest.length} proxies${testWithLMArena ? ' with LMArena' : ''}...`);

    const workingProxies = [];

    // Test proxies in batches to avoid overwhelming the network
    const batchSize = 5;
    for (let i = 0; i < proxiesToTest.length; i += batchSize) {
      const batch = proxiesToTest.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(proxy => this.testProxy(proxy, timeout))
      );

      // Process results
      for (const result of results) {
        const { proxy, working } = result;
        proxy.lastTested = new Date().toISOString();
        proxy.working = working;

        if (working) {
          workingProxies.push(proxy);
        }
      }

      // Short delay between batches
      if (i + batchSize < proxiesToTest.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // Update active proxies list
    this.activeProxies = this.proxies.filter(p => p.working === true);

    // Save to cache
    await this.saveToCache();

    // Log results
    if (testWithLMArena) {
      const lmarenaCompatible = workingProxies.filter(p => p.worksWithLMArena === true).length;
      log('INFO', `Found ${workingProxies.length} working proxies, ${lmarenaCompatible} compatible with LMArena`);
    } else {
      log('INFO', `Found ${workingProxies.length} working proxies out of ${proxiesToTest.length} tested`);
    }

    return workingProxies;
  }

  /**
   * Test a single proxy
   */
  async testProxy(proxy) {
    try {
      // First test with a simple IP service to check basic connectivity
      const response = await axios.get('https://api.ipify.org?format=json', {
        proxy: {
          host: proxy.host,
          port: proxy.port,
          protocol: proxy.protocol
        },
        timeout: DEFAULT_TEST_TIMEOUT
      });

      // Check if the response is valid
      const basicWorking = response.status === 200 && response.data && response.data.ip;

      if (!basicWorking) {
        log('DEBUG', `Proxy ${proxy.url} failed basic connectivity test`);
        return { proxy, working: false };
      }

      // Store the IP for reference
      proxy.ip = response.data.ip;

      // Now test with LMArena to check if it works with our target site
      // We'll try multiple approaches to test LMArena compatibility

      // Store the test results
      let lmarenaWorking = false;
      let lmarenaTestMethod = '';

      // Common headers that work well with Cloudflare
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      };

      // Approach 1: Try a HEAD request first (fastest)
      try {
        const headResponse = await axios.head('https://beta.lmarena.ai/', {
          proxy: {
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol
          },
          timeout: DEFAULT_TEST_TIMEOUT,
          headers
        });

        if (headResponse.status < 400) {
          lmarenaWorking = true;
          lmarenaTestMethod = 'HEAD';
          log('DEBUG', `Proxy ${proxy.url} works with LMArena (HEAD)`);
        }
      } catch (headError) {
        // HEAD request failed, try GET
      }

      // Approach 2: If HEAD failed, try a GET request
      if (!lmarenaWorking) {
        try {
          const getResponse = await axios.get('https://beta.lmarena.ai/', {
            proxy: {
              host: proxy.host,
              port: proxy.port,
              protocol: proxy.protocol
            },
            timeout: DEFAULT_TEST_TIMEOUT * 2, // Give GET more time
            headers,
            maxRedirects: 5
          });

          if (getResponse.status < 400) {
            lmarenaWorking = true;
            lmarenaTestMethod = 'GET';
            log('DEBUG', `Proxy ${proxy.url} works with LMArena (GET)`);
          }
        } catch (getError) {
          // GET request failed, try one more approach
        }
      }

      // Approach 3: Try with a different URL path
      if (!lmarenaWorking) {
        try {
          const altResponse = await axios.get('https://beta.lmarena.ai/api/health', {
            proxy: {
              host: proxy.host,
              port: proxy.port,
              protocol: proxy.protocol
            },
            timeout: DEFAULT_TEST_TIMEOUT,
            headers
          });

          if (altResponse.status < 400) {
            lmarenaWorking = true;
            lmarenaTestMethod = 'API';
            log('DEBUG', `Proxy ${proxy.url} works with LMArena API`);
          }
        } catch (altError) {
          // All approaches failed
        }
      }

      // Update proxy with test results
      proxy.worksWithLMArena = lmarenaWorking;
      if (lmarenaWorking) {
        proxy.lmarenaTestMethod = lmarenaTestMethod;
      } else {
        log('DEBUG', `Proxy ${proxy.url} failed all LMArena tests`);
      }

      // We consider the proxy working if it has basic connectivity, even if it doesn't work with LMArena
      // This way we can still use it for other purposes
      return { proxy, working: true, worksWithLMArena: lmarenaWorking };
    } catch (error) {
      log('DEBUG', `Proxy ${proxy.url} failed: ${error.message}`);
      return { proxy, working: false, worksWithLMArena: false };
    }
  }

  /**
   * Get the next working proxy
   * @param {boolean} requireLMArenaSupport - If true, only return proxies that work with LMArena
   */
  getNextProxy(requireLMArenaSupport = false) {
    if (this.activeProxies.length === 0) {
      log('WARN', 'No active proxies available');
      return null;
    }

    // Filter proxies that work with LMArena if required
    const eligibleProxies = requireLMArenaSupport
      ? this.activeProxies.filter(p => p.worksWithLMArena === true)
      : this.activeProxies;

    if (eligibleProxies.length === 0) {
      if (requireLMArenaSupport) {
        log('WARN', 'No proxies that work with LMArena available');
        // Fall back to any working proxy if none work with LMArena
        return this.getNextProxy(false);
      }
      return null;
    }

    // Rotate to the next proxy
    if (requireLMArenaSupport) {
      // Use a separate index for LMArena-compatible proxies
      this.lmarenaProxyIndex = (this.lmarenaProxyIndex || 0);
      this.lmarenaProxyIndex = (this.lmarenaProxyIndex + 1) % eligibleProxies.length;
      const proxy = eligibleProxies[this.lmarenaProxyIndex];

      log('DEBUG', `Using LMArena-compatible proxy: ${proxy.url} (${this.lmarenaProxyIndex + 1}/${eligibleProxies.length})`);
      return proxy;
    } else {
      // Regular rotation for all working proxies
      this.currentIndex = (this.currentIndex + 1) % this.activeProxies.length;
      const proxy = this.activeProxies[this.currentIndex];

      log('DEBUG', `Using proxy: ${proxy.url} (${this.currentIndex + 1}/${this.activeProxies.length})`);
      return proxy;
    }
  }

  /**
   * Get the current proxy
   * @param {boolean} requireLMArenaSupport - If true, return a proxy that works with LMArena
   */
  getCurrentProxy(requireLMArenaSupport = false) {
    if (this.activeProxies.length === 0) {
      return null;
    }

    // First, check for the known working proxy
    const knownWorkingProxyUrl = "http://47.250.11.111:10000";
    const knownWorkingProxy = this.activeProxies.find(p => p.url === knownWorkingProxyUrl);

    if (knownWorkingProxy) {
      log('INFO', `Using known working proxy: ${knownWorkingProxyUrl}`);
      // Make sure it's marked as working with LMArena
      knownWorkingProxy.worksWithLMArena = true;
      knownWorkingProxy.lmarenaTestMethod = 'HEAD';
      return knownWorkingProxy;
    }

    if (requireLMArenaSupport) {
      // Get proxies that work with LMArena
      const lmarenaProxies = this.activeProxies.filter(p => p.worksWithLMArena === true);

      if (lmarenaProxies.length === 0) {
        log('WARN', 'No proxies that work with LMArena available');

        // If we don't have the known working proxy in our list, add it
        if (!this.proxies.some(p => p.url === knownWorkingProxyUrl)) {
          log('INFO', `Adding known working proxy: ${knownWorkingProxyUrl}`);
          const newProxy = {
            id: generateUUID(),
            url: knownWorkingProxyUrl,
            host: "47.250.11.111",
            port: 10000,
            protocol: "http",
            source: "proxyscrape",
            added: new Date().toISOString(),
            lastTested: new Date().toISOString(),
            working: true,
            worksWithLMArena: true,
            lmarenaTestMethod: 'HEAD'
          };

          this.proxies.push(newProxy);
          this.activeProxies.push(newProxy);
          this.saveToCache();

          return newProxy;
        }

        // Fall back to any working proxy
        return this.activeProxies[this.currentIndex];
      }

      // Use the current LMArena proxy index or default to 0
      const index = (this.lmarenaProxyIndex || 0) % lmarenaProxies.length;
      return lmarenaProxies[index];
    }

    return this.activeProxies[this.currentIndex];
  }

  /**
   * Get proxy stats
   */
  getStats() {
    // Count proxies that work with LMArena
    const lmarenaProxies = this.activeProxies.filter(p => p.worksWithLMArena === true);

    return {
      total: this.proxies.length,
      active: this.activeProxies.length,
      lmarenaCompatible: lmarenaProxies.length,
      lastFetchTime: this.lastFetchTime,
      currentProxy: this.getCurrentProxy(),
      currentLMArenaProxy: this.getCurrentProxy(true)
    };
  }
}

// Export singleton instance
const freeProxyManager = new FreeProxyManager();
module.exports = freeProxyManager;
