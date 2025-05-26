/**
 * Configuration for the puppeteer manager
 * @module config
 */

// Load environment variables
require('dotenv').config();

/**
 * Browser configuration
 */
const browser = {
  // Connection options
  connectionOptions: {
    browserURL: process.env.BROWSER_URL || 'http://127.0.0.1:9222',
    turnstile: true,
    ignoreHTTPSErrors: true,
    timeout: parseInt(process.env.BROWSER_TIMEOUT || '90000', 10),
    dumpio: process.env.DEBUG_MODE === 'true',
    pipe: false
  },

  // Launch options
  launchOptions: {
    headless: process.env.PUPPETEER_HEADLESS === 'true' ? true : false,
    defaultViewport: null,
    ignoreHTTPSErrors: true,
    args: [
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--window-size=1920,1080',
      '--start-maximized',
      '--no-first-run',
      '--no-zygote',
      ...(process.env.PROXY_SERVER_URL ? [`--proxy-server=${process.env.PROXY_SERVER_URL}`] : [])
    ],
    timeout: parseInt(process.env.BROWSER_TIMEOUT || '90000', 10),
    dumpio: process.env.DEBUG_MODE === 'true'
  },

  // Default viewport settings
  viewport: {
    width: 1920,
    height: 1080,
    deviceScaleFactor: 1,
    hasTouch: false,
    isLandscape: true,
    isMobile: false
  },

  // User agent options
  userAgents: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 Edg/136.0.0.0'
  ],

  // HTTP headers
  headers: {
    'accept-language': 'en-US,en;q=0.9',
    'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': 'macOS'
  },

  // Geolocation (San Francisco)
  geolocation: {
    latitude: 37.7749,
    longitude: -122.4194
  },

  // Timezones for randomization
  timezones: [
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
    'Australia/Sydney'
  ],

  // Default timeouts
  timeouts: {
    navigation: 90000,
    action: 90000,
    captcha: 60000,
    dialog: 10000
  }
};

/**
 * LMArena configuration
 */
const lmArena = {
  // Base URL
  url: process.env.LMARENA_URL || 'https://beta.lmarena.ai/',

  // Selectors
  selectors: {
    promptTextarea:
      'textarea[placeholder*="Ask anything"], textarea[placeholder*="Send a message"]',
    sendButton: 'form button[type="submit"]',
    turnstileIframe: 'iframe[src*="turnstile"]',
    tosForm: 'form[action*="tos"]',
    tosAgreeButton: 'form[action*="tos"] button[type="submit"]',
    tosContent: '.overflow-y-auto',

    // Model selection selectors
    modeDropdownTrigger:
      'button[aria-haspopup="listbox"][id^="radix-"]:not([aria-label="Battle Models"])',
    sideBySideOption: 'div[role="option"]',
    modelADropdownTrigger: 'button[aria-haspopup="listbox"][id^="radix-"]:nth-of-type(1)',
    modelBDropdownTrigger: 'button[aria-haspopup="listbox"][id^="radix-"]:nth-of-type(2)',
    modelListbox: 'div[role="listbox"]',
    modelListItemRadix: 'div[data-radix-collection-item]',
    modelListItemGeneric: 'div[role="option"]',

    // Direct mode selectors
    directModeModelSelector:
      'button:has-text("Select model..."), [cmdk-input], button[aria-expanded], button[aria-haspopup="listbox"], [role="combobox"], button:has-text("Model"), button[aria-label*="model"]',
    directModeModelOption:
      'li[role="option"], [cmdk-item], div[role="option"], [data-value], li[id^="radix-"], div[class*="model-item"]',

    // Advanced model extraction selectors
    modelItemContainer: '[cmdk-group-items], [role="group"], [role="listbox"]',
    modelItem: '[cmdk-item], [role="option"], .relative.flex.cursor-default',
    modelNameElement: '[cmdk-item] p, [role="option"] p, .text-sm.font-heading',
    modelValueAttribute: 'data-value'
  },

  // API endpoints
  api: {
    evaluation: 'arena-api',
    models: '/api/v1/models'
  },

  // Default models (fallback)
  defaultModels: [
    // Chat models
    { id: 'grok-3-preview-02-24', name: 'Grok-3-preview-02-24', type: 'chat' },
    { id: 'gemini-2.0-flash-001', name: 'Gemini-2.0-flash-001', type: 'chat' },
    { id: 'chatgpt-4o-latest-20250326', name: 'Chatgpt-4o-latest-20250326', type: 'chat' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude-3-5-sonnet-20241022', type: 'chat' },
    { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini-2.5-flash-preview-05-20', type: 'chat' },
    { id: 'llama-4-maverick-03-26-experimental', name: 'Llama-4-maverick-03-26-experimental', type: 'chat' },
    { id: 'gpt-4.1-2025-04-14', name: 'Gpt-4.1-2025-04-14', type: 'chat' },
    { id: 'qwq-32b', name: 'Qwq-32b', type: 'chat' },
    { id: 'gpt-4.1-mini-2025-04-14', name: 'Gpt-4.1-mini-2025-04-14', type: 'chat' },
    { id: 'grok-3-mini-beta', name: 'Grok-3-mini-beta', type: 'chat' },
    { id: 'claude-3-7-sonnet-20250219', name: 'Claude-3-7-sonnet-20250219', type: 'chat' },
    { id: 'amazon.nova-pro-v1:0', name: 'Amazon.nova-pro-v1:0', type: 'chat' },
    { id: 'claude-3-7-sonnet-20250219-thinking-32k', name: 'Claude-3-7-sonnet-20250219-thinking-32k', type: 'chat' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude-3-5-haiku-20241022', type: 'chat' },
    { id: 'gemma-3-27b-it', name: 'Gemma-3-27b-it', type: 'chat' },
    { id: 'o3-2025-04-16', name: 'O3-2025-04-16', type: 'chat' },
    { id: 'o3-mini', name: 'O3-mini', type: 'chat' },
    { id: 'o4-mini-2025-04-16', name: 'O4-mini-2025-04-16', type: 'chat' },
    { id: 'command-a-03-2025', name: 'Command-a-03-2025', type: 'chat' },
    { id: 'gemini-2.5-flash-preview-04-17', name: 'Gemini-2.5-flash-preview-04-17', type: 'chat' },
    { id: 'qwen3-235b-a22b', name: 'Qwen3-235b-a22b', type: 'chat' },
    { id: 'qwen-max-2025-01-25', name: 'Qwen-max-2025-01-25', type: 'chat' },
    { id: 'qwen3-30b-a3b', name: 'Qwen3-30b-a3b', type: 'chat' },
    { id: 'claude-sonnet-4-20250514', name: 'Claude-sonnet-4-20250514', type: 'chat' },
    { id: 'deepseek-v3-0324', name: 'Deepseek-v3-0324', type: 'chat' },
    { id: 'llama-3.3-70b-instruct', name: 'Llama-3.3-70b-instruct', type: 'chat' },
    { id: 'llama-4-maverick-17b-128e-instruct', name: 'Llama-4-maverick-17b-128e-instruct', type: 'chat' },
    { id: 'mistral-medium-2505', name: 'Mistral-medium-2505', type: 'chat' },
    { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini-2.5-pro-preview-05-06', type: 'chat' },

    // Image models
    { id: 'gpt-image-1', name: 'Gpt-image-1', type: 'image' },
    { id: 'photon', name: 'Photon', type: 'image' },
    { id: 'imagen-3.0-generate-002', name: 'Imagen-3.0-generate-002', type: 'image' },
    { id: 'ideogram-v2', name: 'Ideogram-v2', type: 'image' },
    { id: 'dall-e-3', name: 'Dall-e-3', type: 'image' },
    { id: 'recraft-v3', name: 'Recraft-v3', type: 'image' },
    { id: 'flux-1.1-pro', name: 'Flux-1.1-pro', type: 'image' }
  ],

  // Retry configuration
  retry: {
    maxAttempts: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    factor: 2
  }
};

/**
 * Logging configuration
 */
const logging = {
  levels: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  },
  currentLevel: process.env.DEBUG_MODE === 'true' ? 0 : 1, // DEBUG or INFO
  timestamps: true
};

module.exports = {
  browser,
  lmArena,
  logging
};
