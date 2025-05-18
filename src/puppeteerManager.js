const { connect } = require('puppeteer-real-browser');
const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');

let browserInstance = null;
let currentPageInstance = null; 

const LMARENA_URL = process.env.LMARENA_URL || 'https://beta.lmarena.ai/';
const PROMPT_TEXTAREA_SELECTOR = 'textarea[placeholder*="Ask anything"], textarea[placeholder*="Send a message"]';
const SEND_BUTTON_SELECTOR = 'form button[type="submit"]';

/**
 * Initializes the Puppeteer browser instance if not already running.
 * @returns {Promise<void>}
 */
async function initialize() {
    verboseEntry('puppeteerManager.initialize', {});
    try {
        if (!browserInstance) {
            await launchOrGetPage();
        }
        verboseExit('puppeteerManager.initialize', 'Browser ready');
    } catch (e) {
        log('ERROR', 'Error in initialize:', e.stack || e);
        throw e;
    }
}

/**
 * Launches or returns an existing Puppeteer page instance.
 * @returns {Promise<import('puppeteer').Page>}
 */
async function launchOrGetPage() {
    verboseEntry('puppeteerManager.launchOrGetPage', {});
    try {
        if (browserInstance && browserInstance.isConnected()) {
            if (currentPageInstance && !currentPageInstance.isClosed()) {
                try {
                    await currentPageInstance.goto('about:blank', {waitUntil: 'networkidle2'});
                    log('DEBUG', 'Reusing existing page, navigated to about:blank.');
                    return currentPageInstance;
                } catch (e) {
                    log('WARN', 'Failed to navigate existing page to about:blank, creating new.', e.message);
                    try { await currentPageInstance.close(); } catch (closeErr) { log('WARN', 'Error closing page', closeErr); }
                }
            }
        }

        log('INFO', 'Launching new browser instance with puppeteer-real-browser...');
        
        // Check if we're running in a Docker container
        const isDocker = process.env.IS_DOCKER === 'true' || process.env.CONTAINER === 'docker';

        // Connect using puppeteer-real-browser
        const result = await connect({
            headless: process.env.PUPPETEER_HEADLESS === 'true' ? 'new' : false,
            turnstile: true, // Enable Turnstile CAPTCHA bypass
            ignoreAllFlags: true, // Override all initialization arguments
            connectOption: {
                defaultViewport: null,
            },
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
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
                '--disable-client-side-phishing-detection',
                '--disable-default-apps',
                '--disable-hang-monitor',
                '--disable-sync',
                '--metrics-recording-only',
                '--safebrowsing-disable-auto-update',
                '--password-store=basic',
                '--use-mock-keychain',
                '--hide-scrollbars',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-pings',
                '--no-sandbox',
                '--no-zygote',
                '--single-process',
                '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
            ],
            ignoreDefaultArgs: [
                '--enable-automation',
                '--enable-blink-features',
                '--enable-logging',
                '--log-level=0',
                '--remote-debugging-port=0',
                '--remote-debugging-address=0.0.0.0',
                '--enable-features=NetworkService',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-ipc-flooding-protection',
                '--disable-background-networking',
                '--disable-client-side-phishing-detection',
                '--disable-default-apps',
                '--disable-hang-monitor',
                '--disable-sync',
                '--metrics-recording-only',
                '--safebrowsing-disable-auto-update',
                '--password-store=basic',
                '--use-mock-keychain',
                '--hide-scrollbars',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-pings',
                '--no-sandbox',
                '--no-zygote',
                '--single-process'
            ],
            ignoreHTTPSErrors: true,
            timeout: 60000,
            dumpio: false,
            pipe: true,
            env: {
                ...process.env,
                DISPLAY: process.env.DISPLAY || (isDocker ? ':99' : ':0'),
                LANG: 'en_US.UTF-8',
                LANGUAGE: 'en_US:en',
                LC_ALL: 'en_US.UTF-8',
                NO_AT_BRIDGE: '1',
                XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/tmp/xdg-runtime-dir',
                TMPDIR: process.env.TMPDIR || '/tmp',
                TMP: process.env.TMP || '/tmp',
                TEMP: process.env.TEMP || '/tmp',
                HOME: process.env.HOME || '/tmp'
            },
            ignoreAllFlags: true, // Override all initialization arguments
            connectOptions: {
                defaultViewport: null
            },
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
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
                '--disable-background-networking'
                ],
                ignoreDefaultArgs: [
                    '--enable-automation',
                    '--enable-blink-features',
                    '--enable-logging',
                    '--log-level=0',
                    '--remote-debugging-port=0',
                    '--remote-debugging-address=0.0.0.0'
                ],
                ignoreHTTPSErrors: true,
                timeout: 60000,
                dumpio: false,
                pipe: true,
                env: {
                    ...process.env,
                    DISPLAY: process.env.DISPLAY || (isDocker ? ':99' : ':0'),
                    LANG: 'en_US.UTF-8',
                    LANGUAGE: 'en_US:en',
                    LC_ALL: 'en_US.UTF-8',
                    NO_AT_BRIDGE: '1',
                    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || '/tmp/xdg-runtime-dir',
                    TMPDIR: process.env.TMPDIR || '/tmp',
                    TMP: process.env.TMP || '/tmp',
                    TEMP: process.env.TEMP || '/tmp',
                    HOME: process.env.HOME || '/tmp'
                }
            });
            
            browserInstance = result.browser;
            log('INFO', 'Browser instance launched.');
            browserInstance.on('disconnected', () => {
                log('WARN', 'Browser disconnected!');
                browserInstance = null;
                currentPageInstance = null;
            });
            currentPageInstance = await browserInstance.newPage();
            log('DEBUG', 'Created new page in new browser.');

            // Set a realistic viewport
            await currentPageInstance.setViewport({
                width: 1920,
                height: 1080,
                deviceScaleFactor: 1,
                hasTouch: false,
                isLandscape: false,
                isMobile: false,
            });

            // Update browser and page instances
            browserInstance = result.browser;
            currentPageInstance = result.page;

            log('INFO', 'Successfully launched browser with puppeteer-real-browser');

            // Set extra HTTP headers
            await currentPageInstance.setExtraHTTPHeaders({
                'accept-language': 'en-US,en;q=0.9',
                'sec-ch-ua': '"Google Chrome";v="123", "Not:A-Brand";v="8"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': 'macOS',
            });
            
            // Bypass Cloudflare and other bot protections
            await currentPageInstance.setJavaScriptEnabled(true);
            await currentPageInstance.setBypassCSP(true);
            
            // Set geolocation and timezone
            const context = currentPageInstance.browserContext();
            await context.overridePermissions(LMARENA_URL, ['geolocation']);
            await currentPageInstance.setGeolocation({latitude: 37.7749, longitude: -122.4194});
            
            // Set viewport with some randomness to appear more human-like
            const viewportWidth = 1920 + Math.floor(Math.random() * 100) - 50;
            const viewportHeight = 1080 + Math.floor(Math.random() * 100) - 50;
            await currentPageInstance.setViewport({
                width: viewportWidth,
                height: viewportHeight,
                deviceScaleFactor: 1,
                hasTouch: false,
                isLandscape: false,
                isMobile: false,
            });

            // Set a realistic user agent
            const userAgents = [
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
                'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0'
            ];
            const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
            await currentPageInstance.setUserAgent(randomUserAgent);
            
            // Set timezone for the page
            await currentPageInstance.evaluateOnNewDocument(() => {
                try {
                    const timezones = [
                        'America/New_York',
                        'America/Chicago',
                        'America/Denver',
                        'America/Los_Angeles',
                        'Europe/London',
                        'Europe/Paris',
                        'Asia/Tokyo',
                        'Australia/Sydney'
                    ];
                    const randomTz = timezones[Math.floor(Math.random() * timezones.length)];
                    
                    // Override timezone if Intl is available
                    if (window.Intl && window.Intl.DateTimeFormat) {
                        Object.defineProperty(Intl, 'DateTimeFormat', {
                            value: class extends Intl.DateTimeFormat {
                                constructor(locales, options) {
                                    const opts = options || {};
                                    super(locales, { ...opts, timeZone: opts.timeZone || randomTz });
                            }
                        },
                        configurable: true
                    });
                }
            } catch (e) {
                console.error('Error setting timezone:', e);
            }
        });
        
        // Set timeouts
        await currentPageInstance.setDefaultNavigationTimeout(60000);
        await currentPageInstance.setDefaultTimeout(60000);
        
        // Setup Turnstile proxy if it exists
        await currentPageInstance.evaluateOnNewDocument(() => {
            window.capturedTurnstileParams = {};
            const originalTurnstileRender = window.turnstile?.render;
            if (originalTurnstileRender) {
                window.turnstile = new Proxy(window.turnstile, {
                    get(target, prop) {
                        if (prop === 'render') {
                            return function(element, options) {
                                window.capturedTurnstileParams = { 
                                    sitekey: options.sitekey, 
                                    action: options.action, 
                                    cData: options.cData, 
                                    chlPageData: options.chlPageData, 
                                    callbackName: options.callback?.name 
                                };
                                return originalTurnstileRender.apply(target, [element, options]);
                            };
                        }
                        return target[prop];
                    }
                });
            }
        });
        
        verboseExit('puppeteerManager.launchOrGetPage', 'Page ready');
            // Set up Turnstile proxy and timezone in a single evaluateOnNewDocument call
            await currentPageInstance.evaluateOnNewDocument(() => {
                // Set up timezone
                const timezones = [
                    'America/New_York',
                    'America/Chicago',
                    'America/Denver',
                    'America/Los_Angeles',
                    'Europe/London',
                    'Europe/Paris',
                    'Asia/Tokyo',
                    'Australia/Sydney'
                ];
                const randomTz = timezones[Math.floor(Math.random() * timezones.length)];
                
                // Override timezone if Intl is available
                if (window.Intl && window.Intl.DateTimeFormat) {
                    Object.defineProperty(Intl, 'DateTimeFormat', {
                        value: class extends Intl.DateTimeFormat {
                            constructor(locales, options) {
                                const opts = options || {};
                                super(locales, { ...opts, timeZone: opts.timeZone || randomTz });
                        }
                    },
                    configurable: true
                });
            }
            
            // Set up Turnstile proxy
            window.capturedTurnstileParams = {};
            const originalTurnstileRender = window.turnstile?.render;
            if (originalTurnstileRender) {
                window.turnstile = new Proxy(window.turnstile, {
                    get(target, prop) {
                        if (prop === 'render') {
                            return function(element, options) {
                                window.capturedTurnstileParams = { sitekey: options.sitekey, action: options.action, cData: options.cData, chlPageData: options.chlPageData, callbackName: options.callback?.name };
                                return originalTurnstileRender.apply(target, [element, options]);
                            };
                        }
                        return target[prop];
                    }
                });
            }
        });
        verboseExit('puppeteerManager.launchOrGetPage', 'Page ready');
        return currentPageInstance;
    } catch (err) {
        log('ERROR', 'Error in launchOrGetPage:', err.stack || err);
        throw err;
    }
}

async function closePage() {
    verboseEntry('puppeteerManager.closePage', {});
    try {
        if (currentPageInstance && !currentPageInstance.isClosed()) {
            try {
                await currentPageInstance.close();
                log('INFO', 'Current page closed.');
            } catch(e){ log('WARN', 'Error closing page', e.message); }
        }
        currentPageInstance = null;
        verboseExit('puppeteerManager.closePage', 'Success');
    } catch (e) {
        log('ERROR', 'Error in closePage:', e.stack || e);
        throw e;
    }
}

async function closeBrowser() {
    verboseEntry('puppeteerManager.closeBrowser', {});
    try {
        if (browserInstance) {
            try {
                await browserInstance.close();
                log('INFO', 'Browser instance closed.');
            } catch(e){ log('WARN', 'Error closing browser', e.message); }
        }
        browserInstance = null;
        currentPageInstance = null;
        verboseExit('puppeteerManager.closeBrowser', 'Success');
    } catch (e) {
        log('ERROR', 'Error in closeBrowser:', e.stack || e);
        throw e;
    }
}

// Function to handle Terms of Service modal
async function handleTosModal(page) {
    try {
        // Wait for the ToS modal to appear with a timeout
        const tosModal = await page.waitForSelector('form[action*="tos"]', { timeout: 10000 }).catch(() => null);
        if (!tosModal) return false;
        
        log('INFO', 'ToS modal detected, attempting to handle...');
        
        // Handle the ToS modal in the page context
        const tosHandled = await page.evaluate(async () => {
            try {
                const form = document.querySelector('form[action*="tos"]');
                if (!form) return false;

                const agreeButton = form.querySelector('button[type="submit"]');
                const content = form.querySelector('.overflow-y-auto');
                
                if (!agreeButton || !content) return false;

                // Function to check if scrolled to bottom
                const isScrolledToBottom = () => {
                    const { scrollTop, scrollHeight, clientHeight } = content;
                    return Math.abs(scrollHeight - scrollTop - clientHeight) < 10;
                };

                // Enable the button if needed
                if (agreeButton.disabled) {
                    agreeButton.disabled = false;
                    agreeButton.style.pointerEvents = 'auto';
                    agreeButton.style.opacity = '1';
                }

                // Scroll to bottom if needed
                if (!isScrolledToBottom()) {
                    content.scrollTop = content.scrollHeight;
                    // Wait for scroll to complete
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                // Click the button if it's enabled
                if (!agreeButton.disabled) {
                    agreeButton.click();
                    return true;
                }
                
                return false;
            } catch (error) {
                console.error('Error in ToS modal handler:', error);
                return false;
            }
        });
        
        if (tosHandled) {
            log('INFO', 'Successfully handled ToS modal');
            // Wait for navigation to complete
            await page.waitForNavigation({ waitUntil: 'networkidle0' }).catch(() => {});
        }
        
        return tosHandled;
    } catch (error) {
        log('ERROR', 'Error in handleTosModal:', error);
        return false;
    }
}

const TurnstileSolver = require('./utils/turnstileSolver');

// Helper function to handle CAPTCHA if it appears
async function handleCaptchaIfPresent(page, sseSend) {
    try {
        // First, check for Turnstile CAPTCHA
        const turnstileDetected = await page.evaluate(() => {
            return !!document.querySelector('iframe[src*="challenges.cloudflare.com/turnstile"]');
        });

        if (turnstileDetected) {
            sseSend({ type: 'STATUS', message: 'Cloudflare Turnstile detected. Attempting to solve...' });
            
            // Get the current URL and sitekey
            const { url, sitekey, action, cdata } = await page.evaluate(() => {
                const turnstileIframe = document.querySelector('iframe[src*="challenges.cloudflare.com/turnstile"]');
                const sitekey = turnstileIframe?.getAttribute('data-sitekey') || 
                               turnstileIframe?.parentElement?.getAttribute('data-sitekey') ||
                               window.capturedTurnstileParams?.sitekey;
                
                const action = window.capturedTurnstileParams?.action || 'verify';
                const cdata = window.capturedTurnstileParams?.cData || null;
                
                return {
                    url: window.location.href,
                    sitekey,
                    action,
                    cdata
                };
            });

            if (!sitekey) {
                sseSend({ type: 'WARNING', message: 'Could not extract Turnstile sitekey. Falling back to manual CAPTCHA solving.' });
                return true; // Still return true to indicate CAPTCHA was detected
            }

            // Initialize the Turnstile solver
            const solver = new TurnstileSolver({
                debug: process.env.DEBUG === 'true',
                headless: process.env.HEADLESS !== 'false',
                userAgent: await page.evaluate(() => window.navigator.userAgent)
            });

            try {
                // Try to solve the Turnstile
                const result = await solver.solve(url, sitekey, action, cdata);
                
                if (result.success) {
                    sseSend({ 
                        type: 'SUCCESS', 
                        message: `Successfully solved Turnstile in ${result.timeElapsed}ms` 
                    });
                    
                    // Inject the token into the page
                    await page.evaluate((token) => {
                        // Find all Turnstile response textareas and set the token
                        document.querySelectorAll('textarea[name="cf-turnstile-response"]').forEach(el => {
                            el.value = token;
                            // Trigger any necessary events
                            const event = new Event('input', { bubbles: true });
                            el.dispatchEvent(event);
                            
                            // If there's a form, try to submit it
                            const form = el.closest('form');
                            if (form) {
                                form.dispatchEvent(new Event('submit', { cancelable: true }));
                            }
                        });
                    }, result.token);
                    
                    // Wait for any potential form submission
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    return true;
                } else {
                    sseSend({ 
                        type: 'WARNING', 
                        message: `Failed to solve Turnstile automatically: ${result.error}. Falling back to manual solving.` 
                    });
                    return true; // Still return true to indicate CAPTCHA was detected
                }
            } catch (error) {
                log('ERROR', 'Error in Turnstile solver:', error);
                sseSend({ 
                    type: 'WARNING', 
                    message: `Error solving Turnstile: ${error.message}. Falling back to manual solving.` 
                });
                return true; // Still return true to indicate CAPTCHA was detected
            } finally {
                await solver.close();
            }
        }

        // Fallback to checking for other CAPTCHA types (reCAPTCHA, hCaptcha, etc.)
        const captchaFrame = await page.frames().find(frame => {
            return frame && frame.url() && 
                   (frame.url().includes('recaptcha') || 
                   frame.url().includes('hcaptcha'));
        });

        if (captchaFrame) {
            sseSend({ type: 'STATUS', message: 'CAPTCHA detected. Please complete the CAPTCHA in the browser window.' });
            await page.bringToFront();
            
            // Wait for CAPTCHA to be solved (you'll need to do this manually)
            await page.waitForFunction(
                () => document.visibilityState === 'visible',
                { timeout: 0 }
            );
            
            // Wait a bit after CAPTCHA is presumably solved
            await new Promise(resolve => setTimeout(resolve, 3000));
            return true;
        }
        
        return false;
    } catch (error) {
        log('ERROR', 'Error in handleCaptchaIfPresent:', error);
        return false;
    }
}

// Function to handle any dialogs that appear during interaction and ensure buttons are enabled
async function handleDialogs(page, sseSend) {
    return new Promise(async (resolve) => {
        try {
            // First try to handle ToS modal
            const tosHandled = await handleTosModal(page);
            if (tosHandled) {
                log('DEBUG', 'Successfully handled ToS modal');
                resolve(true);
                return;
            }

            // Then try to handle warning dialogs
            const warningHandled = await page.evaluate(() => {
                try {
                    // Look for warning dialogs
                    const warningDialogs = Array.from(document.querySelectorAll('div[role="dialog"]')).filter(dialog => {
                        const text = dialog.textContent || '';
                        return text.includes('Warning') || text.includes('warning');
                    });

                    if (warningDialogs.length > 0) {
                        // Try to find and click the first available button
                        const buttons = warningDialogs.flatMap(dialog => 
                            Array.from(dialog.querySelectorAll('button'))
                        );

                        const buttonTexts = ['OK', 'Ok', 'Okay', 'I understand', 'Got it', 'Dismiss', 'Close'];
                        
                        // Try to find a button with common text
                        for (const text of buttonTexts) {
                            const button = buttons.find(btn => 
                                btn.textContent && btn.textContent.trim().toLowerCase() === text.toLowerCase()
                            );
                            if (button) {
                                button.click();
                                return true;
                            }
                        }

                        // If no button found by text, try to click any non-disabled button
                        const clickableButton = buttons.find(btn => !btn.disabled);
                        if (clickableButton) {
                            clickableButton.click();
                            return true;
                        }
                    }
                    return false;
                } catch (e) {
                    console.error('Error handling warning dialog:', e);
                    return false;
                }
            });

            if (warningHandled) {
                log('DEBUG', 'Handled warning dialog');
                resolve(true);
                return;
            }
            
            // Then try to enable any other disabled buttons
            const buttonEnabled = await page.evaluate(() => {
                try {
                    const buttons = Array.from(document.querySelectorAll('button'));
                    let found = false;
                    
                    buttons.forEach(btn => {
                        // Check if button is a send button or similar
                        const isSendButton = 
                            (btn.textContent?.includes('Send') || 
                             btn.getAttribute('aria-label')?.includes('Send') ||
                             btn.querySelector('svg[aria-label="Send"]')) &&
                            (btn.disabled || btn.getAttribute('aria-disabled') === 'true' || 
                             btn.classList.contains('opacity-50') || 
                             btn.classList.contains('pointer-events-none'));
                        
                        if (isSendButton) {
                            btn.removeAttribute('disabled');
                            btn.removeAttribute('aria-disabled');
                            btn.style.pointerEvents = 'auto';
                            btn.style.opacity = '1';
                            btn.classList.remove('disabled', 'opacity-50', 'pointer-events-none');
                            found = true;
                        }
                    });
                    
                    return found;
                } catch (e) {
                    console.error('Error in button enable script:', e);
                    return false;
                }
            });
            
            if (buttonEnabled) {
                log('DEBUG', 'Enabled potentially disabled buttons');
            }

            // Set up a dialog handler
            const dialogHandler = async (dialog) => {
                const message = dialog.message();
                log('DEBUG', `Dialog appeared: ${message.substring(0, 100)}...`);
                
                try {
                    // For warning dialogs, we'll dismiss them
                    if (message.toLowerCase().includes('warning') || message.toLowerCase().includes('terms of service')) {
                        log('DEBUG', 'Dismissing dialog');
                        await dialog.dismiss();
                        // After dismissing, try to enable buttons again
                        await page.evaluate(() => {
                            document.querySelectorAll('button').forEach(btn => {
                                if (btn.disabled || 
                                    btn.getAttribute('aria-disabled') === 'true' || 
                                    btn.classList.contains('opacity-50') || 
                                    btn.classList.contains('pointer-events-none')) {
                                    btn.removeAttribute('disabled');
                                    btn.removeAttribute('aria-disabled');
                                    btn.style.pointerEvents = 'auto';
                                    btn.style.opacity = '1';
                                    btn.classList.remove('opacity-50', 'pointer-events-none');
                                }
                            });
                        });
                    } else {
                        await dialog.accept();
                    }
                    sseSend({ type: 'STATUS', message: 'Dialog handled' });
                } catch (e) {
                    log('WARN', 'Error handling dialog:', e);
                    try {
                        await dialog.dismiss();
                    } catch (e2) {
                        log('ERROR', 'Error dismissing dialog:', e2);
                    }
                }
                resolve(true);
            };
            
            // Listen for dialogs
            page.on('dialog', dialogHandler);
            
            // Set a timeout to resolve if no dialog appears
            setTimeout(() => {
                page.off('dialog', dialogHandler);
                resolve(false);
            }, 3000); // Reduced timeout to 3 seconds for faster response
            
        } catch (e) {
            log('ERROR', 'Error in dialog handler:', e);
            resolve(false);
        }
    });
}

async function interactWithLMArena(page, options, sseSend, waitForUserRetrySignal) {
    // First, try to handle ToS modal if it appears
    await handleTosModal(page);
    log('DEBUG', `interactWithLMArena called with requestId: ${options.requestId}`);
    verboseEntry('puppeteerManager.interactWithLMArena', { options });
    const { userPrompt, systemPrompt, targetModelA, targetModelB, clientConversationId, clientMessagesHistory, requestId } = options;
    let attempt = 0;
    const MAX_ATTEMPTS_AFTER_USER_RETRY = 2;

    while(attempt < MAX_ATTEMPTS_AFTER_USER_RETRY) {
        attempt++;
        log('INFO', `Request ${requestId}: LMArena interaction attempt #${attempt}`);
        sseSend({ type: 'STATUS', message: `Attempting interaction with LMArena (Attempt ${attempt})...` });

        log('DEBUG', `Attempting to navigate to ${LMARENA_URL}`);
        try {
            // Navigate to the page with a longer timeout
            await page.goto(LMARENA_URL, { 
                waitUntil: 'networkidle2', 
                timeout: 120000, // 2 minute timeout
                referer: 'https://www.google.com/',
            });
            
            // Check for CAPTCHA
            const captchaDetected = await handleCaptchaIfPresent(page, sseSend);
            if (captchaDetected) {
                sseSend({ type: 'STATUS', message: 'Please complete the CAPTCHA and press Enter to continue...' });
                await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 300000 }); // 5 minute timeout
            }
            
            log('DEBUG', `Successfully navigated to ${LMARENA_URL}`);
            sseSend({ type: 'STATUS', message: 'Navigated to LMArena.' });
            
            // Wait for the page to be fully loaded
            await page.waitForSelector('body', { timeout: 30000 });
            
            // Dismiss any modals or popups with more robust handling
            try {
                // Wait for the page to be fully interactive
                await page.waitForFunction(
                    () => document.readyState === 'complete',
                    { timeout: 10000 }
                );

                // Try multiple approaches to find and click the accept button
                const clickAcceptButton = async () => {
                    // Try different selectors and text patterns
                    const selectors = [
                        'button:has-text("Accept")',
                        'button:has-text("Agree")',
                        'button:has-text("I agree")',
                        'button:has-text("Got it")',
                        'button:has-text("Continue")',
                        'button[aria-label*="Accept"]',
                        'button[aria-label*="Agree"]',
                        'button[data-testid*="accept"]',
                        'button[data-testid*="agree"]',
                        'button:not([disabled]):has(div:has-text("Accept"))',
                        'button:not([disabled]):has(div:has-text("Agree"))'
                    ];

                    for (const selector of selectors) {
                        try {
                            const button = await page.$(selector);
                            if (button) {
                                log('DEBUG', `Found button with selector: ${selector}`);
                                
                                // Scroll into view and click with proper waiting
                                await button.evaluate(btn => btn.scrollIntoView({behavior: 'smooth', block: 'center'}));
                                await page.waitForTimeout(500);
                                
                                // Try multiple click methods
                                try {
                                    await button.click({delay: 100});
                                } catch (e) {
                                    log('DEBUG', 'First click attempt failed, trying alternative click method');
                                    await button.evaluate(btn => {
                                        btn.dispatchEvent(new MouseEvent('click', {
                                            view: window,
                                            bubbles: true,
                                            cancelable: true
                                        }));
                                    });
                                }
                                
                                log('DEBUG', 'Successfully clicked accept button');
                                await page.waitForTimeout(1000); // Wait for any animations
                                return true;
                            }
                        } catch (e) {
                            log('DEBUG', `Error with selector ${selector}:`, e.message);
                        }
                    }
                    return false;
                };

                // Try clicking the accept button
                let clicked = await clickAcceptButton();
                
                // If no button found, try waiting a bit and try again
                if (!clicked) {
                    await page.waitForTimeout(2000);
                    clicked = await clickAcceptButton();
                }
                
                if (!clicked) {
                    log('INFO', 'No accept button found after multiple attempts');
                    sseSend({ type: 'STATUS', message: 'Please check the browser window and manually accept any dialogs if needed.' });
                }
                
            } catch (e) {
                log('ERROR', 'Error handling popups:', e);
                sseSend({ type: 'ERROR', message: 'Error handling website dialogs. Please check the browser window.' });
            }

            const cookies = await page.cookies(LMARENA_URL);
            const authCookie = cookies.find(cookie => cookie.name === 'arena-auth-prod-v1');
            const supabaseJWT = authCookie ? authCookie.value : null;
            if (!supabaseJWT) log('WARN', `Request ${requestId}: Supabase JWT (arena-auth-prod-v1) not found.`);
            // Set up dialog handling before any interaction
            const dialogPromise = handleDialogs(page, sseSend);
            
            // Set up request interception for API calls
            page.setRequestInterception(true);
            let apiRequestProcessed = false;
            let turnstileTokenFromPage = null;

            const requestHandler = async (interceptedRequest) => {
                const url = interceptedRequest.url();
                if (url.startsWith('https://arena-api-stable.vercel.app/evaluation')) {
                    apiRequestProcessed = true;
                    log('DEBUG', `Request ${requestId}: Intercepting LMArena API call: ${url}`);
                    let originalPayload;
                    try { originalPayload = JSON.parse(interceptedRequest.postData() || '{}'); } 
                    catch (e) { originalPayload = {}; }

                    const modifiedPayload = { ...originalPayload };
                    
                    modifiedPayload.id = clientConversationId;
                    modifiedPayload.modality = "chat";
                    modifiedPayload.mode = "side-by-side";

                    const messages = [...clientMessagesHistory]; 
                    if (systemPrompt && (messages.length === 0 || messages[0].role !== 'system')) {
                        messages.unshift({ role: 'system', content: systemPrompt, id: generateUUID() });
                    }
                    const currentUserMessageId = generateUUID();
                    messages.push({ 
                        role: 'user', content: userPrompt, id: currentUserMessageId, 
                        evaluationSessionId: clientConversationId,
                        status: 'pending'
                    });
                    
                    const modelAInternalId = targetModelA;
                    const modelBInternalId = targetModelB;
                    const assistantAMessageId = generateUUID();
                    const assistantBMessageId = generateUUID();

                    messages.push({ role: 'assistant', content: "", id: assistantAMessageId, modelId: modelAInternalId, evaluationSessionId: clientConversationId, status: 'pending' });
                    messages.push({ role: 'assistant', content: "", id: assistantBMessageId, modelId: modelBInternalId, evaluationSessionId: clientConversationId, status: 'pending' });
                    
                    modifiedPayload.messages = messages;
                    modifiedPayload.modelAId = modelAInternalId;
                    modifiedPayload.modelAMessageId = assistantAMessageId;
                    modifiedPayload.modelBId = modelBInternalId;
                    modifiedPayload.modelBMessageId = assistantBMessageId;
                    modifiedPayload.userMessageId = currentUserMessageId;

                    turnstileTokenFromPage = originalPayload.turnstileToken || interceptedRequest.headers()['cf-turnstile-response'];
                    if (turnstileTokenFromPage) {
                        modifiedPayload.turnstileToken = turnstileTokenFromPage;
                        log('DEBUG', `Request ${requestId}: Using page-provided Turnstile token.`);
                    } else {
                        log('WARN', `Request ${requestId}: No Turnstile token found in page's request to LMArena API.`);
                    }
                    
                    const modifiedHeaders = { ...interceptedRequest.headers(), 'content-type': 'application/json' };
                    if (supabaseJWT) modifiedHeaders['supabase-jwt'] = supabaseJWT;
                    
                    log('DEBUG', `Request ${requestId}: Continuing LMArena API request with modified payload and headers.`);
                    interceptedRequest.continue({
                        method: 'POST',
                        postData: JSON.stringify(modifiedPayload),
                        headers: modifiedHeaders
                    });
                } else {
                    interceptedRequest.continue();
                }
            };
            page.on('request', requestHandler);

            const responseHandler = async (response) => {
                const url = response.request().url();
                if (url.startsWith('https://arena-api-stable.vercel.app/evaluation') && response.headers()['content-type']?.includes('text/event-stream')) {
                    log('DEBUG', `Request ${requestId}: SSE stream opened from LMArena API.`);
                    sseSend({ type: 'STATUS', message: 'Connected to LMArena stream. Models are responding...' });
                    try {
                        const streamText = await response.text();
                        const chunks = streamText.split('\n\n').filter(Boolean);
                        for (const chunk of chunks) {
                            if (chunk.startsWith('data: ')) {
                                const jsonData = JSON.parse(chunk.substring(5).trim());
                                if (jsonData.a0 !== undefined) sseSend({ type: 'MODEL_CHUNK', modelKey: 'A', content: jsonData.a0 });
                                if (jsonData.b0 !== undefined) sseSend({ type: 'MODEL_CHUNK', modelKey: 'B', content: jsonData.b0 });
                                if (jsonData.ae?.finishReason) sseSend({ type: 'MODEL_CHUNK', modelKey: 'A', finishReason: jsonData.ae.finishReason });
                                if (jsonData.be?.finishReason) sseSend({ type: 'MODEL_CHUNK', modelKey: 'B', finishReason: jsonData.be.finishReason });
                            }
                        }
                        log('INFO', `Request ${requestId}: SSE stream from LMArena API finished.`);
                        sseSend({ type: 'STREAM_END' });
                    } catch (streamError) {
                        log('ERROR', `Request ${requestId}: Error reading LMArena SSE stream:`, streamError);
                        sseSend({ type: 'ERROR', message: 'Error processing LMArena response stream.' });
                    }
                } else if (url.startsWith('https://arena-api-stable.vercel.app/evaluation') && (response.status() === 401 || response.status() === 403)) {
                    log('WARN', `Request ${requestId}: LMArena API returned ${response.status()}. Potential CAPTCHA block.`);
                }
            };
            page.on('response', responseHandler);

            log('DEBUG', `Request ${requestId}: Typing prompt: "${userPrompt.substring(0,30)}..."`);
            await page.waitForSelector(PROMPT_TEXTAREA_SELECTOR, { timeout: 10000 });
            await page.type(PROMPT_TEXTAREA_SELECTOR, userPrompt, {delay: 50 + Math.random() * 50});
            
            // Wait for the send button and ensure it's clickable
            const sendButton = await page.waitForSelector(SEND_BUTTON_SELECTOR, { 
                visible: true,
                timeout: 10000 
            }).catch(() => null);
            
            if (!sendButton) {
                throw new Error('Send button not found');
            }
            
            // Ensure the button is enabled and clickable
            await page.evaluate(btn => {
                btn.removeAttribute('disabled');
                btn.removeAttribute('aria-disabled');
                btn.style.pointerEvents = 'auto';
                btn.style.opacity = '1';
                btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, sendButton);
            
            // Add a small delay to ensure the button is ready
            await page.waitForTimeout(500);
            
            // Try multiple ways to click the button
            try {
                await sendButton.click();
            } catch (e) {
                log('WARN', 'Standard click failed, trying alternative click method');
                await page.evaluate(btn => {
                    const event = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    });
                    btn.dispatchEvent(event);
                }, sendButton);
            }
            log('INFO', `Request ${requestId}: Prompt submitted to LMArena page.`);
            sseSend({ type: 'STATUS', message: 'Prompt submitted. Waiting for models...' });

            await new Promise(resolve => {
                let checkInterval = setInterval(() => {
                    if (apiRequestProcessed) {
                        clearInterval(checkInterval);
                        resolve();
                    }
                }, 100);
                setTimeout(() => {
                    clearInterval(checkInterval);
                    if (!apiRequestProcessed) log('WARN', `Request ${requestId}: Main LMArena API call not intercepted within timeout.`);
                    resolve(); 
                }, 15000); 
            });

            await page.waitForTimeout(5000 + Math.random() * 2000);

            const isChallengePage = page.url().includes('challenges.cloudflare.com');
            const isInteractiveWidgetVisible = await page.evaluate(() => 
                !!document.querySelector('iframe[src*="challenges.cloudflare.com/turnstile/if"]') || 
                !!document.querySelector('iframe[title*="captcha"], iframe[title*="challenge"]') 
            );

            if (isChallengePage || isInteractiveWidgetVisible) {
                log('WARN', `Request ${requestId}: CAPTCHA detected (Page: ${isChallengePage}, Widget: ${isInteractiveWidgetVisible}). Attempt #${attempt}`);
                if (attempt < MAX_ATTEMPTS_AFTER_USER_RETRY -1) {
                   sseSend({ type: 'USER_ACTION_REQUIRED', message: `LMArena requires a security check. Please open ${LMARENA_URL} in a new browser tab, solve any CAPTCHAs there to ensure the site loads, then click 'Retry Action' in this app.`, requestId });
                   await waitForUserRetrySignal();
                   page.off('request', requestHandler);
                   page.off('response', responseHandler);
                   await page.setRequestInterception(false);
                   continue;
                } else {
                    log('ERROR', `Request ${requestId}: CAPTCHA persisted after user retry. Aborting.`);
                    sseSend({ type: 'ERROR', message: 'CAPTCHA challenge persisted after retry. Please try a new session.' });
                    break;
                }
            } else {
                log('INFO', `Request ${requestId}: No obvious CAPTCHA detected after action. Assuming API call will proceed or stream will start.`);
                await new Promise(resolve => setTimeout(resolve, 180000));
                log('INFO', `Request ${requestId}: Interaction attempt ${attempt} finished or timed out.`);
                break;
            }

        } catch (error) {
            log('ERROR', `Request ${requestId}: Error during LMArena interaction (Attempt ${attempt}):`, error.message);
            if (attempt < MAX_ATTEMPTS_AFTER_USER_RETRY -1 && error.message.toLowerCase().includes('timeout')) {
                sseSend({ type: 'USER_ACTION_REQUIRED', message: `Interaction timed out (Attempt ${attempt}). This might be a CAPTCHA. Please try solving on ${LMARENA_URL} and click 'Retry Action'.`, requestId });
                await waitForUserRetrySignal();
                page.off('request', requestHandler); 
                page.off('response', responseHandler);
                await page.setRequestInterception(false);
                continue;
            }
            sseSend({ type: 'ERROR', message: `Interaction failed: ${error.message}` });
            break;
        } finally {
            page.off('request', requestHandler);
            page.off('response', responseHandler);
            if (page && typeof page.setRequestInterception === 'function') {
               await page.setRequestInterception(false).catch(e => log('DEBUG',`Error disabling interception: ${e.message}`));
            }
        }
    }

    verboseExit('puppeteerManager.interactWithLMArena', 'Interaction complete');
    log('INFO', `Request ${requestId}: interactWithLMArena finished.`);
}

// --- Model fetching selectors ---
// Please update these selectors by inspecting the LMArena DOM if the UI changes.
const MODE_SELECTOR_DROPDOWN_TRIGGER_SELECTOR = 'button[aria-haspopup="listbox"][id^="radix-"]:not([aria-label="Battle Models"])'; // Central mode dropdown (update as needed)
const SIDE_BY_SIDE_MODE_OPTION_SELECTOR = 'div[role="option"]'; // Will filter by text "Side by Side"
const MODEL_A_DROPDOWN_TRIGGER_SBS_SELECTOR = 'button[aria-haspopup="listbox"][id^="radix-"]:nth-of-type(1)'; // First dropdown after mode switch
const MODEL_B_DROPDOWN_TRIGGER_SBS_SELECTOR = 'button[aria-haspopup="listbox"][id^="radix-"]:nth-of-type(2)'; // Second dropdown after mode switch
const MODEL_LISTBOX_SELECTOR = 'div[role="listbox"]';
const MODEL_LIST_ITEM_SELECTOR_RADIX = `${MODEL_LISTBOX_SELECTOR} div[data-radix-collection-item]`;
const MODEL_LIST_ITEM_SELECTOR_GENERIC = `${MODEL_LISTBOX_SELECTOR} div[role="option"]`;

// Fetch available models by UI scraping, with robust error/logging and fallback
/**
 * Fetches the available models from the LMArena UI, falling back to API or known defaults if needed.
 * @param {import('puppeteer').Page} page - Puppeteer page instance.
 * @param {(data:object)=>void} sseSend - SSE/status feedback callback.
 * @returns {Promise<Array<{id:string,name:string}>>}
 */
async function fetchAvailableModels(page, sseSend) {
    log('INFO', 'Attempting to fetch available models from LMArena UI...');
    let models = [];
    let uniqueModelIds = new Set();

    try {
        const LMARENA_URL = process.env.LMARENA_URL || 'https://beta.lmarena.ai/';
        let initialUrl;
        try {
            initialUrl = page.url();
        } catch (e) {
            log('ERROR', 'Could not get current page URL.', e);
            sseSend({ type: 'ERROR', message: 'Internal error (page url).' });
            return [];
        }

        // --- Navigation ---
        if (!initialUrl.startsWith(LMARENA_URL) || initialUrl.includes("/c/")) {
            log('INFO', `Navigating to ${LMARENA_URL} for model fetching.`);
            try {
                await page.goto(LMARENA_URL, { waitUntil: 'networkidle2', timeout: 60000 });
                sseSend({ type: 'STATUS', message: 'Navigated to LMArena main page.' });
            } catch (e) {
                log('ERROR', 'Failed to navigate to LMArena.', e.message);
                try { await page.screenshot({ path: 'debug_lmarena_nav_fail.png' }); } catch {}
                sseSend({ type: 'ERROR', message: 'Could not navigate to LMArena.' });
                return [];
            }
        } else {
            log('DEBUG', 'Already on LMArena main page.');
            await page.waitForTimeout(1000);
        }

        // --- Step 1: Select "Side by Side" Mode ---
        log('INFO', 'Attempting to select "Side by Side" mode.');
        sseSend({ type: 'STATUS', message: 'Selecting "Side by Side" mode...' });

        let modeDropdownTrigger;
        try {
            modeDropdownTrigger = await page.$(MODE_SELECTOR_DROPDOWN_TRIGGER_SELECTOR);
        } catch (e) {
            log('ERROR', 'Error finding mode dropdown trigger.', e.message);
        }
        if (!modeDropdownTrigger) {
            log('ERROR', 'Main mode dropdown trigger not found.');
            try { await page.screenshot({ path: 'debug_mode_trigger_fail.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Could not find mode selection UI trigger.' });
            return [];
        }
        try {
            await modeDropdownTrigger.click({ delay: 100 + Math.random() * 50 });
            log('DEBUG', 'Clicked main mode dropdown trigger.');
        } catch (e) {
            log('ERROR', 'Failed to click mode dropdown trigger.', e.message);
            try { await page.screenshot({ path: 'debug_mode_dropdown_click_fail.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Could not open mode dropdown.' });
            return [];
        }

        // Wait for the mode selection dropdown to appear
        const modeListboxSelector = 'div[role="listbox"][aria-labelledby*="radix-"]';
        try {
            await page.waitForSelector(modeListboxSelector, { visible: true, timeout: 10000 });
        } catch (e) {
            log('ERROR', 'Mode selection dropdown did not appear.', e.message);
            try { await page.screenshot({ path: 'debug_mode_dropdown_not_visible.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Mode selection dropdown did not appear.' });
            return [];
        }
        log('DEBUG', 'Mode selection dropdown appeared.');

        // Click the "Side by Side" option using text match
        let sideBySideOption = null;
        try {
            const modeOptions = await page.$(SIDE_BY_SIDE_MODE_OPTION_SELECTOR);
            for (const el of modeOptions) {
                const text = await el.evaluate(e => e.textContent.trim());
                if (/side by side/i.test(text)) {
                    sideBySideOption = el;
                    break;
                }
            }
        } catch (e) {
            log('ERROR', 'Error searching for Side by Side mode option.', e.message);
        }
        if (!sideBySideOption) {
            log('ERROR', '"Side by Side" mode option not found in dropdown.');
            try { await page.screenshot({ path: 'debug_sbs_option_fail.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Could not find "Side by Side" mode option.' });
            return [];
        }
        try {
            await sideBySideOption.click({ delay: 100 + Math.random() * 50 });
            log('INFO', '"Side by Side" mode selected.');
            sseSend({ type: 'STATUS', message: '"Side by Side" mode selected.' });
        } catch (e) {
            log('ERROR', 'Failed to click "Side by Side" option.', e.message);
            try { await page.screenshot({ path: 'debug_sbs_option_click_fail.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Could not select "Side by Side" mode.' });
            return [];
        }

        // Wait for the mode switch to take effect (URL or UI state)
        try {
            await page.waitForFunction(
                () => window.location.search.includes('mode=side-by-side'),
                { timeout: 10000 }
            );
            log('INFO', 'URL updated to side-by-side mode.');
        } catch (e) {
            log('WARN', 'URL did not update to side-by-side mode, UI may have changed without URL update.');
            await page.waitForTimeout(3000);
        }

        // --- Step 2: Extract Models from Model B selector ---
        log('INFO', 'Attempting to extract models from "Side by Side" selectors.');
        sseSend({ type: 'STATUS', message: 'Accessing model selection UI...' });

        let modelTriggerToClick;
        try {
            modelTriggerToClick = await page.$(MODEL_B_DROPDOWN_TRIGGER_SBS_SELECTOR);
        } catch (e) {
            log('ERROR', 'Error finding model dropdown trigger.', e.message);
        }
        if (!modelTriggerToClick) {
            log('ERROR', 'Model dropdown trigger (for Side by Side mode) not found.');
            try { await page.screenshot({ path: 'debug_sbs_model_trigger_fail.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Could not find model selectors in Side by Side mode.' });
            return [];
        }
        try {
            await modelTriggerToClick.click({ delay: 100 + Math.random() * 50 });
            log('DEBUG', 'Clicked model dropdown trigger in Side by Side mode.');
        } catch (e) {
            log('ERROR', 'Failed to click model dropdown trigger.', e.message);
            try { await page.screenshot({ path: 'debug_model_dropdown_click_fail.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Could not open model dropdown.' });
            return [];
        }

        try {
            await page.waitForSelector(MODEL_LISTBOX_SELECTOR, { visible: true, timeout: 10000 });
        } catch (e) {
            log('ERROR', 'Model dropdown listbox did not appear.', e.message);
            try { await page.screenshot({ path: 'debug_model_dropdown_not_visible.png' }); } catch {}
            sseSend({ type: 'ERROR', message: 'Model dropdown did not appear.' });
            return [];
        }
        log('INFO', 'Model dropdown listbox (Side by Side) appeared.');

        let modelElements = [];
        try {
            modelElements = await page.$(MODEL_LIST_ITEM_SELECTOR_RADIX);
            if (!modelElements || modelElements.length === 0) {
                modelElements = await page.$(MODEL_LIST_ITEM_SELECTOR_GENERIC);
            }
        } catch (e) {
            log('ERROR', 'Error querying model list items.', e.message);
        }

        if (modelElements && modelElements.length > 0) {
            log('INFO', `Found ${modelElements.length} model list items.`);
            for (const element of modelElements) {
                try {
                    let modelId = await element.evaluate(el => el.textContent?.trim());
                    const dataValue = await element.evaluate(el => el.getAttribute('data-value'));
                    if (dataValue) modelId = dataValue.trim();
                    if (modelId && !uniqueModelIds.has(modelId)) {
                        models.push({ id: modelId, name: modelId });
                        uniqueModelIds.add(modelId);
                    }
                } catch (evalError) {
                    log('WARN', 'Error evaluating a model list item:', evalError.message);
                }
            }
        } else {
            log('ERROR', 'Could not extract model list items from dropdown in Side by Side mode.');
            try { await page.screenshot({ path: 'debug_sbs_model_items_fail.png' }); } catch {}
        }

        // Close the dropdown
        try {
            await page.keyboard.press('Escape');
            log('DEBUG', 'Pressed Escape to close model dropdown.');
        } catch (e) { log('WARN', 'Failed to press Escape for model dropdown.', e.message); }

        // --- Step 3: API Fallback ---
        if (models.length === 0) {
            log('INFO', 'UI model scraping yielded no results. Attempting API fallback...');
            try {
                const apiModels = await page.evaluate(async () => {
                    try {
                        const resp = await fetch('/api/v1/models');
                        return await resp.json();
                    } catch (e) { return null; }
                });
                if (apiModels && apiModels.data) {
                    apiModels.data.forEach(model => {
                        if (model.id && !uniqueModelIds.has(model.id)) {
                            models.push({ id: model.id, name: `${model.id} (API)` });
                            uniqueModelIds.add(model.id);
                        }
                    });
                    log('INFO', `Fetched ${apiModels.data.length} models via API fallback.`);
                }
            } catch (apiErr) { log('WARN', 'API fallback for models failed.', apiErr); }
        }

        // --- Step 4: Default Fallback ---
        if (models.length === 0) {
            log('WARN', 'No models found. Adding known defaults.');
            const defaultModels = [
                { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus (Default)' },
                { id: 'gpt-4o-latest-20250326', name: 'GPT-4o Latest (Default)' },
                { id: 'gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Default)'}
            ];
            defaultModels.forEach(m => {
                if (!uniqueModelIds.has(m.id)) {
                    models.push(m);
                    uniqueModelIds.add(m.id);
                }
            });
        }

        const finalModels = Array.from(uniqueModelIds).map(id => models.find(m => m.id === id)).filter(Boolean);

        log('INFO', `Successfully fetched ${finalModels.length} unique models in total.`);
        sseSend({ type: 'STATUS', message: `Found ${finalModels.length} models.` });
        return finalModels;

    } catch (error) {
        log('ERROR', 'Error in fetchAvailableModels:', error?.stack || error);
        try { await page.screenshot({ path: 'debug_fetch_models_main_error.png' }); } catch (e) {}
        sseSend({ type: 'ERROR', message: 'Failed to fetch model list.' });
        return [];
    }
}

module.exports = { 
    initialize,
    launchOrGetPage,
    closePage,
    closeBrowser,
    interactWithLMArena,
    fetchAvailableModels
};