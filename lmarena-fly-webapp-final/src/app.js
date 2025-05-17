require('dotenv').config();
const express = require('express');
const path = require('path');
const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');
const puppeteerManager = require('./puppeteerManager');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const waitingForRetryResolvers = new Map(); 

app.get('/', (req, res) => {
    verboseEntry('GET /', { url: req.url, headers: req.headers });
    try {
        res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
        verboseExit('GET /', "Sent index.html");
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

app.listen(PORT, () => {
    log('INFO', `Server listening on port ${PORT}`);
    puppeteerManager.initialize();
});

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