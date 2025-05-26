# FreeGPT Project Overview

## Project Description

FreeGPT is a Node.js application that provides a proxy service for accessing LMArena's AI models through a web interface. The application uses Puppeteer to automate browser interactions with LMArena, handling navigation, CAPTCHA solving, and model selection. It implements various strategies to overcome connection issues, including proxy rotation, browser profile switching, and multiple navigation paths.

## Architecture

The application follows a modular architecture with clear separation of concerns:

1. **Core Application** (`app.js`): The main entry point that sets up the Express server, middleware, routes, and error handlers.
2. **API Routes** (`routes/api.routes.js`): Handles API endpoints for chat, model listing, IP checking, and proxy management.
3. **Static Routes** (`routes/static.routes.js`): Serves static files and diagnostic endpoints.
4. **Navigation** (`navigation/lmarenaNavigator.js`): Implements strategies for navigating to LMArena with fallbacks.
5. **Puppeteer Management** (`puppeteerManager.js`): Manages browser instances, pages, and interactions.
6. **Model Management** (`models.js`): Handles fetching and caching available models from LMArena.
7. **Proxy Management** (`proxy/freeProxyManager.js`): Manages free proxies from various sources, testing and rotating them.
8. **Verification Service** (`services/verificationService.js`): Performs initial checks for model availability and CAPTCHA/Cloudflare verification.

## Project Structure

```
freegpt/
├── cache/                  # Cache directory for proxies and other data
├── logs/                   # Log files and screenshots
├── public/                 # Static files served to clients
│   ├── index.html          # Main application page
│   ├── script.js           # Client-side JavaScript
│   ├── styles.css          # CSS styles
│   └── utils.js            # Client-side utility functions
├── src/                    # Source code
│   ├── app.js              # Main application entry point
│   ├── browser.js          # Browser management
│   ├── captcha.js          # CAPTCHA detection and solving
│   ├── config.js           # Configuration
│   ├── dialog.js           # Dialog handling
│   ├── interaction.js      # LMArena interaction
│   ├── models.js           # Model management
│   ├── network.js          # Network request/response handling
│   ├── page.js             # Page management
│   ├── puppeteerManager.js # Puppeteer orchestration
│   ├── utils.js            # Utility functions
│   ├── config/             # Configuration modules
│   │   └── app.config.js   # Application configuration
│   ├── middleware/         # Express middleware
│   │   ├── errorHandlers.js # Error handling middleware
│   │   └── index.js        # Middleware setup
│   ├── navigation/         # Navigation strategies
│   │   └── lmarenaNavigator.js # LMArena navigation
│   ├── proxy/              # Proxy management
│   │   ├── freeProxyManager.js # Free proxy management
│   │   ├── freeProxyRoutes.js  # Free proxy routes
│   │   ├── proxyManager.js     # General proxy management
│   │   └── proxyRoutes.js      # Proxy routes
│   ├── routes/             # Express routes
│   │   ├── api.routes.js   # API routes
│   │   ├── index.js        # Route registration
│   │   └── static.routes.js # Static routes
│   ├── services/           # Service modules
│   │   └── verificationService.js # Verification service
│   └── utils/              # Utility modules
│       ├── logger.js       # Logging utilities
│       └── turnstileSolver.js # Turnstile CAPTCHA solver
├── .env                    # Environment variables
├── package.json            # Node.js dependencies
└── README.md               # Project documentation
```

## Key Components and Functions

### Application Core (`app.js`)

- **startServer()**: Initializes and starts the Express server
- **setupMiddleware()**: Configures Express middleware for security, CORS, rate limiting
- **registerRoutes()**: Registers API and static routes

### API Routes (`routes/api.routes.js`)

- **POST /api/chat**: Main endpoint for interacting with LMArena models
- **GET /api/models**: Retrieves available models from LMArena
- **GET /api/ip-check**: Checks current IP and proxy status
- **GET /api/set-known-proxy**: Sets a known working proxy
- **POST /api/trigger-retry**: Allows retrying a failed request

### Navigation (`navigation/lmarenaNavigator.js`)

- **navigateToLMArena()**: Implements multiple strategies to navigate to LMArena
  - Uses multiple navigation paths (direct mode, side-by-side mode, chat path)
  - Rotates browser profiles (Chrome Mac, Chrome Windows, Safari Mac, Edge Windows)
  - Implements fallback mechanisms and error handling

### Puppeteer Management (`puppeteerManager.js`)

- **initialize()**: Sets up the Puppeteer browser instance
- **launchOrGetPage()**: Gets a page from the pool or creates a new one
- **releasePage()**: Returns a page to the pool
- **interactWithLMArena()**: Main function for interacting with LMArena
- **handleCaptchaIfPresent()**: Detects and handles CAPTCHAs
- **setupNetworkInterception()**: Monitors network requests for debugging

### Model Management (`models.js`)

- **fetchAvailableModels()**: Retrieves available models from LMArena
- **checkModelAvailability()**: Checks if a specific model is available
- **scrapeModelsFromUI()**: Extracts models from the LMArena UI
- **extractModelsFromDOM()**: Extracts models directly from the DOM structure

### Proxy Management (`proxy/freeProxyManager.js`)

- **initialize()**: Sets up the proxy manager
- **fetchProxies()**: Retrieves proxies from various free sources
- **testProxies()**: Tests proxies for availability and LMArena compatibility
- **getCurrentProxy()**: Gets the current active proxy
- **rotateProxy()**: Rotates to the next working proxy

### Verification Service (`services/verificationService.js`)

- **performInitialVerificationChecks()**: Runs initial checks for model availability and CAPTCHA/Cloudflare verification

## Navigation Strategies

The application implements multiple strategies to overcome connection issues with LMArena:

1. **Multiple Navigation Paths**:
   - Direct mode (`/?mode=direct`)
   - Default mode (`/`)
   - Side-by-side mode (`/?mode=side-by-side`)
   - Chat path (`/chat`)
   - Cache bypass variations

2. **Browser Profile Rotation**:
   - Chrome Mac
   - Chrome Windows
   - Safari Mac
   - Edge Windows

3. **Proxy Management**:
   - Fetches free proxies from multiple sources
   - Tests proxies for general connectivity and LMArena compatibility
   - Rotates proxies when connections fail
   - Uses a known working proxy as fallback

## Error Handling and Recovery

The application implements robust error handling and recovery mechanisms:

1. **Connection Issues**:
   - Detects timeouts and connection failures
   - Implements multiple fallback strategies
   - Rotates browser profiles and proxies

2. **CAPTCHA Detection and Solving**:
   - Automatically detects Cloudflare and Turnstile CAPTCHAs
   - Implements solving strategies

3. **Model Availability**:
   - Checks model availability before sending requests
   - Falls back to available models when requested models are unavailable

## Caching and Performance

1. **Model Caching**:
   - Caches available models to reduce requests to LMArena
   - Implements cache invalidation strategies

2. **Proxy Caching**:
   - Caches working proxies to disk
   - Prioritizes known working proxies

3. **Page Pooling**:
   - Maintains a pool of browser pages for reuse
   - Implements page lifecycle management

## Logging and Diagnostics

1. **Verbose Logging**:
   - Implements detailed logging with entry/exit tracking
   - Logs network requests and responses

2. **Diagnostic Endpoints**:
   - `/diagnostics`: Provides detailed system information
   - `/api/ip-check`: Shows current IP and proxy status

## Default Models

The application maintains a list of default models from LMArena:

1. **Chat Models**:
   - Grok-3-preview-02-24
   - Gemini-2.0-flash-001
   - Chatgpt-4o-latest-20250326
   - Claude-3-5-sonnet-20241022
   - And many more...

2. **Image Models**:
   - Gpt-image-1
   - Photon
   - Imagen-3.0-generate-002
   - Ideogram-v2
   - Dall-e-3
   - Recraft-v3
   - Flux-1.1-pro

## Complete Function List

### Application Core (`app.js`)
- **startServer()**: Initializes and starts the Express server
- **setupMiddleware()**: Configures Express middleware for security, CORS, rate limiting
- **registerRoutes()**: Registers API and static routes

### API Routes (`routes/api.routes.js`)
- **router.post('/chat')**: Main endpoint for interacting with LMArena models
- **router.post('/trigger-retry')**: Allows retrying a failed request
- **router.get('/ip-check')**: Checks current IP and proxy status
- **router.get('/models')**: Retrieves available models from LMArena
- **router.get('/set-known-proxy')**: Sets a known working proxy

### Static Routes (`routes/static.routes.js`)
- **router.get('/')**: Serves the main application page
- **router.get('/healthz')**: Health check endpoint
- **router.get('/diagnostics')**: Provides detailed system information

### Navigation (`navigation/lmarenaNavigator.js`)
- **navigateToLMArena()**: Implements multiple strategies to navigate to LMArena

### Puppeteer Management (`puppeteerManager.js`)
- **initialize()**: Sets up the Puppeteer browser instance
- **launchOrGetPage()**: Gets a page from the pool or creates a new one
- **releasePage()**: Returns a page to the pool
- **closeSpecificPage()**: Closes a specific page
- **closeAllPages()**: Closes all pages in the pool
- **closeBrowser()**: Closes the browser instance
- **handleCaptchaIfPresent()**: Detects and handles CAPTCHAs
- **handleDialogs()**: Handles any dialogs that appear during interaction
- **setupNetworkInterception()**: Monitors network requests for debugging
- **interactWithLMArena()**: Main function for interacting with LMArena
- **fetchAvailableModels()**: Retrieves available models from LMArena

### Model Management (`models.js`)
- **fetchAvailableModels()**: Retrieves available models from LMArena
- **extractModelsFromDOM()**: Extracts models directly from the DOM structure
- **scrapeModelsFromUI()**: Extracts models from the LMArena UI
- **checkModelAvailability()**: Checks if a specific model is available
- **getModels()**: Gets models from cache or fetches new ones
- **refreshModelCache()**: Refreshes the model cache

### Proxy Management (`proxy/freeProxyManager.js`)
- **initialize()**: Sets up the proxy manager
- **loadFromCache()**: Loads proxies from cache file
- **saveToCache()**: Saves proxies to cache file
- **fetchProxies()**: Retrieves proxies from various free sources
- **fetchFromProxyScrape()**: Fetches proxies from ProxyScrape
- **fetchFromProxifly()**: Fetches proxies from Proxifly
- **fetchFromFreeProxyList()**: Fetches proxies from Free Proxy List
- **fetchFromGeoNode()**: Fetches proxies from GeoNode
- **fetchFromProxyList()**: Fetches proxies from Proxy-List
- **deduplicateProxies()**: Removes duplicate proxies
- **testProxies()**: Tests proxies for availability and LMArena compatibility
- **testProxy()**: Tests a single proxy
- **testProxyWithLMArena()**: Tests a proxy specifically with LMArena
- **getCurrentProxy()**: Gets the current active proxy
- **rotateProxy()**: Rotates to the next working proxy

### Verification Service (`services/verificationService.js`)
- **performInitialVerificationChecks()**: Runs initial checks for model availability and CAPTCHA/Cloudflare verification

### Browser Management (`browser.js`)
- **initialize()**: Initializes the browser instance
- **getBrowser()**: Gets the current browser instance
- **setBrowser()**: Sets the browser instance
- **closeBrowser()**: Closes the browser instance
- **getCurrentBrowser()**: Gets the current browser instance

### Page Management (`page.js`)
- **getPage()**: Gets a page from the pool or creates a new one
- **releasePage()**: Returns a page to the pool
- **closeSpecificPage()**: Closes a specific page
- **closeAllPages()**: Closes all pages in the pool
- **getPagePoolInfo()**: Gets information about the page pool

### CAPTCHA Handling (`captcha.js`)
- **isCaptchaPresent()**: Checks if a CAPTCHA is present on the page
- **solveCaptcha()**: Attempts to solve a CAPTCHA
- **handleCloudflare()**: Handles Cloudflare challenges
- **handleTurnstile()**: Handles Turnstile CAPTCHAs

### Dialog Handling (`dialog.js`)
- **handleDialogs()**: Handles any dialogs that appear during interaction
- **isDialogPresent()**: Checks if a dialog is present on the page
- **dismissDialog()**: Dismisses a dialog

### Network Handling (`network.js`)
- **setupNetworkInterception()**: Sets up request and response interception
- **monitorRequests()**: Monitors requests for debugging
- **monitorResponses()**: Monitors responses for debugging

### Interaction (`interaction.js`)
- **interactWithLMArena()**: Main function for interacting with LMArena
- **sendPrompt()**: Sends a prompt to LMArena
- **waitForResponse()**: Waits for a response from LMArena
- **extractResponse()**: Extracts the response from LMArena

### Middleware (`middleware/index.js`)
- **setupMiddleware()**: Sets up Express middleware

### Error Handlers (`middleware/errorHandlers.js`)
- **notFoundHandler()**: Handles 404 errors
- **globalErrorHandler()**: Handles all other errors

## Conclusion

FreeGPT is a sophisticated application that provides access to LMArena's AI models through a web interface. It implements multiple strategies to overcome connection issues, including proxy rotation, browser profile switching, and multiple navigation paths. The modular architecture makes it easy to maintain and extend.
