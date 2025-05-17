const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');

puppeteer.use(StealthPlugin());

let browserInstance = null;
let currentPageInstance = null; 

const LMARENA_URL = process.env.LMARENA_URL || 'https://beta.lmarena.ai/';
const PROMPT_TEXTAREA_SELECTOR = 'textarea[placeholder*="Ask anything"], textarea[placeholder*="Send a message"]';
const SEND_BUTTON_SELECTOR = 'form button[type="submit"]';

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

async function launchOrGetPage() {
    verboseEntry('puppeteerManager.launchOrGetPage', {});
    try {
        if (browserInstance && browserInstance.isConnected()) {
            if (currentPageInstance && !currentPageInstance.isClosed()) {
                try {
                    await currentPageInstance.goto('about:blank', {waitUntil: 'networkidle2'});
                    log('DEBUG', 'Reusing existing page, navigated to about:blank.');
                } catch (e) {
                    log('WARN', 'Failed to navigate existing page to about:blank, creating new.', e.message);
                    try { await currentPageInstance.close(); } catch (closeErr) { log('WARN', 'Error closing page', closeErr); }
                    currentPageInstance = await browserInstance.newPage();
                }
            } else {
                currentPageInstance = await browserInstance.newPage();
                log('DEBUG', 'Created new page in existing browser.');
            }
        } else {
            log('INFO', 'Launching new browser instance...');
            const headlessMode = process.env.PUPPETEER_HEADLESS === 'true' ? 'new' : false;
            const launchOptions = {
                headless: headlessMode,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ]
            };
            if (process.env.PROXY_SERVER_URL) {
                launchOptions.args.push(`--proxy-server=${process.env.PROXY_SERVER_URL}`);
            }
            browserInstance = await puppeteer.launch(launchOptions);
            log('INFO', 'Browser instance launched.');
            browserInstance.on('disconnected', () => {
                log('WARN', 'Browser disconnected!');
                browserInstance = null;
                currentPageInstance = null;
            });
            currentPageInstance = await browserInstance.newPage();
            log('DEBUG', 'Created new page in new browser.');
        }

        await currentPageInstance.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36');
        await currentPageInstance.setViewport({ width: 1366, height: 768 });

        await currentPageInstance.evaluateOnNewDocument(() => {
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

async function interactWithLMArena(page, options, sseSend, waitForUserRetrySignal) {
    verboseEntry('puppeteerManager.interactWithLMArena', { options });
    const { userPrompt, systemPrompt, targetModelA, targetModelB, clientConversationId, clientMessagesHistory, requestId } = options;
    let attempt = 0;
    const MAX_ATTEMPTS_AFTER_USER_RETRY = 2;

    while(attempt < MAX_ATTEMPTS_AFTER_USER_RETRY) {
        attempt++;
        log('INFO', `Request ${requestId}: LMArena interaction attempt #${attempt}`);
        sseSend({ type: 'STATUS', message: `Attempting interaction with LMArena (Attempt ${attempt})...` });

        try {
            await page.goto(LMARENA_URL, { waitUntil: 'networkidle2', timeout: 60000 });
            sseSend({ type: 'STATUS', message: 'Navigated to LMArena.' });

            const cookies = await page.cookies(LMARENA_URL);
            const authCookie = cookies.find(cookie => cookie.name === 'arena-auth-prod-v1');
            const supabaseJWT = authCookie ? authCookie.value : null;
            if (!supabaseJWT) log('WARN', `Request ${requestId}: Supabase JWT (arena-auth-prod-v1) not found.`);
            
            await page.setRequestInterception(true);
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
            
            await page.waitForSelector(SEND_BUTTON_SELECTOR, { timeout: 5000 });
            await page.click(SEND_BUTTON_SELECTOR);
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

module.exports = { initialize, launchOrGetPage, closePage, closeBrowser, interactWithLMArena };