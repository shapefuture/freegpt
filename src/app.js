require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');
const puppeteerManager = require('./puppeteerManager');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

// Winston file logger for production
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/app.log' })
  ]
});

// Runtime ENV validation
const REQUIRED_ENV_VARS = ['LMARENA_URL', 'PORT'];
REQUIRED_ENV_VARS.forEach((envKey) => {
  if (!process.env[envKey]) {
    log('WARN', `Missing environment variable: ${envKey}`);
    logger.warn({ message: `Missing environment variable: ${envKey}` });
  }
});

// Security & CORS
app.set('trust proxy', 1); // Trust first proxy

// Static list of models
const AVAILABLE_MODELS = [
  { id: 'gpt-4', name: 'GPT-4' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  { id: 'claude-3-opus', name: 'Claude 3 Opus' },
  { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet' },
  { id: 'gemini-pro', name: 'Gemini Pro' },
  { id: 'llama-3-70b', name: 'Llama 3 70B' },
  { id: 'llama-3-8b', name: 'Llama 3 8B' }
];

// Configure CSP with relaxed settings for development
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'", "'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https:'],
  fontSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  upgradeInsecureRequests: []
};

// Use helmet with minimal configuration
app.use(helmet({
  contentSecurityPolicy: {
    directives: cspDirectives,
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  hsts: false // Disable HSTS for development
}));

app.use(cors({ origin: '*' }));
app.use(rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: 'Too many requests from this IP, please try again after 10 minutes'
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const waitingForRetryResolvers = new Map(); 

// Serve static files with error handling
app.use((req, res, next) => {
  console.log(`Serving static file: ${req.path}`);
  next();
});

app.get('/', (req, res) => {
    verboseEntry('GET /', { url: req.url, headers: req.headers });
    try {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'), (err) => {
            if (err) {
                console.error('Error sending index.html:', err);
                res.status(500).send('Error loading the application');
            } else {
                verboseExit('GET /', "Sent index.html");
            }
        });
    } catch (err) {
        log('ERROR', 'Failed to send index.html', err);
        res.status(500).send('Server error');
    }
});

app.post('/api/chat', async (req, res) => {
    verboseEntry('POST /api/chat', req.body);
    const { 
        userPrompt, systemPrompt, targetModelA, targetModelB, 
        clientConversationId: existingClientConversationId, 
        clientMessagesHistory = []
    } = req.body;
    
    const requestId = generateUUID();
    log('INFO', `Request ${requestId}: Received /api/chat`, { userPrompt: userPrompt ? userPrompt.substring(0,30)+'...' : 'N/A' });

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
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
            throw new Error("Failed to launch or get Puppeteer page.");
        }
        
        const waitForUserRetrySignal = () => {
            log('DEBUG', `[${requestId}] Waiting for user retry signal`);
            return new Promise((resolve) => {
                waitingForRetryResolvers.set(requestId, resolve);
                log('DEBUG', `Request ${requestId}: Paused, waiting for user retry signal.`);
            });
        };

        await puppeteerManager.interactWithLMArena(
            pageInstance,
            { 
                userPrompt, systemPrompt, targetModelA, targetModelB, 
                clientConversationId: existingClientConversationId || generateUUID(),
                clientMessagesHistory,
                requestId
            },
            sseSend,
            waitForUserRetrySignal
        );
        verboseExit('POST /api/chat', "Chat interaction finished.");
    } catch (error) {
        log('ERROR', `Request ${requestId}: Error in /api/chat handler:`, error.stack || error.message || error);
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

app.post('/api/trigger-retry', (req, res) => {
    verboseEntry('POST /api/trigger-retry', req.body);
    const { requestId } = req.body;
    log('INFO', `Request ${requestId}: Received /api/trigger-retry`);

    if (waitingForRetryResolvers.has(requestId)) {
        const resolve = waitingForRetryResolvers.get(requestId);
        resolve({ userRetrying: true });
        waitingForRetryResolvers.delete(requestId);
        res.json({ status: 'OK', message: 'Retry signal sent to backend task.' });
        verboseExit('POST /api/trigger-retry', "Retry resolver executed");
    } else {
        log('WARN', `Request ${requestId}: No active action waiting for retry.`);
        res.status(404).json({ error: 'No active action waiting for retry, or request ID mismatched.' });
        verboseExit('POST /api/trigger-retry', "No resolver found for this requestId");
    }
});

// API: Dynamic Model List
app.get('/api/models', async (req, res) => {
    verboseEntry('GET /api/models', {});
    try {
        // Return the static list of models
        verboseExit('GET /api/models', { modelCount: AVAILABLE_MODELS.length });
        res.json({ models: AVAILABLE_MODELS });
    } catch (err) {
        log('ERROR', 'Failed to fetch models', err);
        res.status(500).json({ error: 'Failed to fetch models' });
    }
});

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Fallback for non-API 404s
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
});

// Express error handler
app.use((err, req, res, next) => {
  log('ERROR', 'Express error handler', err.stack || err);
  logger.error({ message: err.message, stack: err.stack, url: req.url });
  if (req.path.startsWith('/api/')) {
    res.status(500).json({ error: 'Internal server error' });
  } else {
    res.status(500).sendFile(path.join(__dirname, '..', 'public', '500.html'));
  }
});

if (require.main === module) {
  const server = app.listen(PORT, () => {
    log('INFO', `Server listening on port ${PORT}`);
    
    // Initialize Puppeteer only when needed, not at server start
    // puppeteerManager.initialize().catch(e => log('ERROR', 'Failed to initialize Puppeteer:', e));
    
    // Auto-open the browser when the server starts
    const { exec } = require('child_process');
    const url = `http://localhost:${PORT}`;
    const start = (process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open');
    exec(`${start} ${url}`);
    console.log(`\nApplication is running at: ${url}\n`);
  });
}

module.exports = app;

process.on('SIGINT', async () => { 
    log('INFO', 'SIGINT received, shutting down...');
    await puppeteerManager.closeBrowser(); 
    process.exit(0); 
});
process.on('SIGTERM', async () => { 
    log('INFO', 'SIGTERM received, shutting down...');
    await puppeteerManager.closeBrowser(); 
    process.exit(0); 
});