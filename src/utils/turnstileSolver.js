const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { executablePath } = require('puppeteer');
const logger = require('./logger');

// Add stealth plugin for better evasion
puppeteer.use(StealthPlugin());

class TurnstileSolver {
    constructor(options = {}) {
        this.debug = options.debug || false;
        this.headless = options.headless !== false; // Default to true
        this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
        this.timeout = options.timeout || 60000; // 60 seconds
        this.browser = null;
        this.page = null;
    }

    async init() {
        if (this.browser) return;

        const launchOptions = {
            headless: this.headless ? 'new' : false,
            executablePath: executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                `--user-agent=${this.userAgent}`,
                '--window-size=1920,1080',
                '--start-maximized',
                '--disable-popup-blocking',
                '--disable-notifications',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials',
                '--disable-blink-features',
                '--disable-webgl',
                '--disable-threaded-animation',
                '--disable-in-process-stack-traces',
                '--disable-breakpad',
                '--disable-client-side-phishing-detection',
                '--disable-component-update',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-sync',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-pings',
                '--password-store=basic',
                '--use-mock-keychain',
                '--single-process',
                '--disable-3d-apis',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-ipc-flooding-protection',
                '--enable-features=NetworkService,NetworkServiceInProcess',
                '--disable-background-networking',
                '--disable-hang-monitor',
                '--safebrowsing-disable-auto-update',
                '--hide-scrollbars'
            ],
            ignoreHTTPSErrors: true
        };

        if (process.env.PROXY_SERVER_URL) {
            launchOptions.args.push(`--proxy-server=${process.env.PROXY_SERVER_URL}`);
        }

        this.browser = await puppeteer.launch(launchOptions);
        this.page = await this.browser.newPage();

        // Set viewport to a common desktop resolution
        await this.page.setViewport({
            width: 1366,
            height: 768,
            deviceScaleFactor: 1,
            hasTouch: false,
            isLandscape: false,
            isMobile: false
        });

        // Set extra HTTP headers
        await this.page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Referer': 'https://www.google.com/',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        });

        // Set user agent
        await this.page.setUserAgent(this.userAgent);

        // Set geolocation
        await this.page.setGeolocation({
            latitude: 37.7749,
            longitude: -122.4194
        });

        // Enable request interception
        await this.page.setRequestInterception(true);
        this.page.on('request', (request) => {
            const resourceType = request.resourceType();
            if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
                request.abort();
            } else {
                request.continue();
            }
        });
    }

    async solve(url, siteKey, action = null, cdata = null) {
        const startTime = Date.now();
        let result = {
            success: false,
            token: null,
            error: null,
            timeElapsed: 0
        };

        try {
            await this.init();

            // Navigate to the target URL
            await this.page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: this.timeout
            });

            // Inject Turnstile iframe
            await this.page.evaluate((siteKey, action, cdata) => {
                // Remove any existing Turnstile iframes
                document.querySelectorAll('iframe[src*="challenges.cloudflare.com"]').forEach(iframe => iframe.remove());
                
                // Create the Turnstile iframe
                const turnstileDiv = document.createElement('div');
                turnstileDiv.className = 'cf-turnstile';
                turnstileDiv.dataset.sitekey = siteKey;
                if (action) turnstileDiv.dataset.action = action;
                if (cdata) turnstileDiv.dataset.cdata = cdata;
                
                // Style it to be visible (for debugging)
                turnstileDiv.style.width = '300px';
                turnstileDiv.style.height = '65px';
                turnstileDiv.style.margin = '20px auto';
                turnstileDiv.style.border = '1px solid #ccc';
                turnstileDiv.style.borderRadius = '3px';
                
                document.body.appendChild(turnstileDiv);
                
                // Load the Turnstile script if not already loaded
                if (!document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]')) {
                    const script = document.createElement('script');
                    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
                    script.async = true;
                    script.defer = true;
                    document.head.appendChild(script);
                }
            }, siteKey, action, cdata);

            // Wait for the Turnstile iframe to load
            await this.page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', {
                visible: true,
                timeout: 10000
            }).catch(() => {
                throw new Error('Turnstile iframe did not load in time');
            });

            // Check if we need to solve a challenge
            const isChallenge = await this.page.evaluate(() => {
                const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
                if (!iframe) return false;
                const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                return !!iframeDoc.querySelector('#challenge-form');
            });

            if (isChallenge) {
                // Try to automatically solve the challenge
                await this._solveChallenge();
            }

            // Wait for the token to be generated
            const token = await this.page.evaluate(() => {
                return new Promise((resolve) => {
                    // Check if token is already available
                    const checkToken = () => {
                        const token = document.querySelector('textarea[name="cf-turnstile-response"]')?.value;
                        if (token) {
                            resolve(token);
                            return;
                        }
                        setTimeout(checkToken, 500);
                    };
                    checkToken();
                });
            });

            if (!token) {
                throw new Error('Failed to get Turnstile token');
            }

            result.success = true;
            result.token = token;
            result.timeElapsed = Date.now() - startTime;

            if (this.debug) {
                logger.info(`Successfully solved Turnstile in ${result.timeElapsed}ms`);
                logger.debug(`Token: ${token.substring(0, 20)}...`);
            }

        } catch (error) {
            result.error = error.message;
            if (this.debug) {
                logger.error('Error solving Turnstile:', error);
            }
        }

        return result;
    }

    async _solveChallenge() {
        // This is a simplified version - in a real implementation, you might need to:
        // 1. Detect the type of challenge (checkbox, image selection, etc.)
        // 2. Use a CAPTCHA solving service or human verification
        // 3. For now, we'll just wait for manual interaction if not in headless mode
        
        if (this.headless) {
            // In headless mode, we'll try to solve automatically
            // This is a simplified version - you might want to implement more robust solving logic
            logger.warn('Running in headless mode with automatic challenge solving');
            
            // Wait for the challenge to be visible
            await this.page.waitForSelector('iframe[src*="challenges.cloudflare.com"]', { visible: true });
            
            // Click the checkbox if it exists
            await this.page.evaluate(() => {
                const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
                if (iframe) {
                    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
                    const checkbox = iframeDoc.querySelector('input[type="checkbox"]');
                    if (checkbox) {
                        checkbox.click();
                        return true;
                    }
                }
                return false;
            });
            
            // Wait a bit for the challenge to be processed
            await this.page.waitForTimeout(3000);
        } else {
            // In non-headless mode, wait for user to manually solve the CAPTCHA
            logger.info('Please solve the CAPTCHA in the browser window...');
            await this.page.waitForFunction(() => {
                return !!document.querySelector('textarea[name="cf-turnstile-response"]')?.value;
            }, {
                timeout: 300000, // 5 minutes
                polling: 1000
            });
        }
    }

    async close() {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
            this.page = null;
        }
    }
}

module.exports = TurnstileSolver;
