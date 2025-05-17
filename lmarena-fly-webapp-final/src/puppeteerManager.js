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