/**
 * Model management module
 * @module models
 */

const { log, generateUUID, verboseEntry, verboseExit } = require('./utils');
const config = require('./config');

/**
 * Fetches available models from LMArena
 * @param {import('puppeteer').Page} page - The page to fetch models from
 * @param {Object} options - Options for fetching models
 * @param {string} [options.requestId] - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.forceRefresh=false] - Whether to force a refresh of the model list
 * @returns {Promise<Array<{id:string,name:string,available:boolean}>>} Array of model objects
 */
async function fetchAvailableModels(page, options = {}) {
  const requestId = options.requestId || generateUUID();
  const sseSend =
    options.sseSend ||
    ((data) => {
      log('DEBUG', `SSE update (mock): ${JSON.stringify(data)}`);
    });
  const forceRefresh = options.forceRefresh || false;

  verboseEntry('models.fetchAvailableModels', { requestId, forceRefresh });
  log('INFO', `Request ${requestId}: Attempting to fetch available models from LMArena UI...`);

  // Check if we have cached models and don't need to force refresh
  if (
    !forceRefresh &&
    global.cachedModels &&
    global.cachedModels.length > 0 &&
    global.cachedModelsTimestamp &&
    Date.now() - global.cachedModelsTimestamp < 3600000
  ) {
    // 1 hour cache
    log(
      'INFO',
      `Request ${requestId}: Using cached models (${
        global.cachedModels.length
      } models, cached ${Math.round(
        (Date.now() - global.cachedModelsTimestamp) / 1000 / 60
      )} minutes ago)`
    );
    sseSend({
      type: 'STATUS',
      message: `Using cached list of ${global.cachedModels.length} models.`
    });
    return global.cachedModels;
  }

  let models = [];
  let uniqueModelIds = new Set();

  try {
    // --- Step 1: Navigate to main page if needed --- //
    const initialUrl = page.url();
    log('DEBUG', `Request ${requestId}: Initial page URL for model fetch: ${initialUrl}`);

    if (!initialUrl.startsWith(config.lmArena.url) || initialUrl.includes('/c/')) {
      log('INFO', `Request ${requestId}: Navigating to ${config.lmArena.url} for model fetching.`);
      sseSend({ type: 'STATUS', message: 'Navigating to LMArena main page for model list.' });

      try {
        await page.goto(config.lmArena.url, { waitUntil: 'networkidle2', timeout: 60000 });
        log('INFO', `Request ${requestId}: Successfully navigated to LMArena for model fetch.`);
        sseSend({ type: 'STATUS', message: 'Navigated to LMArena main page.' });
      } catch (e) {
        log(
          'ERROR',
          `Request ${requestId}: Failed to navigate to LMArena for model fetching:`,
          e.stack || e
        );
        sseSend({ type: 'ERROR', message: 'Could not navigate to LMArena to fetch model list.' });
        verboseExit('models.fetchAvailableModels', { requestId, status: 'navigation_failed' });
        return global.cachedModels || config.lmArena.defaultModels; // Return cached or default models on navigation failure
      }
    } else {
      log(
        'DEBUG',
        `Request ${requestId}: Already on LMArena main page or similar, waiting briefly for UI elements.`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait a bit for UI to settle
    }

    // --- Step 2: Try UI Scraping --- //
    log('INFO', `Request ${requestId}: Attempting to extract models from UI...`);
    sseSend({ type: 'STATUS', message: 'Accessing model selection UI...' });

    // Try to scrape models from the UI (will try direct mode first, then side-by-side mode)
    const uiModels = await scrapeModelsFromUI(page, { requestId, sseSend });

    if (uiModels.length > 0) {
      log('INFO', `Request ${requestId}: Successfully scraped ${uiModels.length} models from UI.`);

      // Add models to our collection, avoiding duplicates
      uiModels.forEach((model) => {
        if (!uniqueModelIds.has(model.id)) {
          models.push({
            ...model,
            available: true, // Models from UI are considered available
            source: 'ui'
          });
          uniqueModelIds.add(model.id);
          log('DEBUG', `Request ${requestId}: Added model from UI: ${model.id}`);
        }
      });

      sseSend({ type: 'STATUS', message: `Found ${uiModels.length} models from UI.` });
    } else {
      log('WARN', `Request ${requestId}: UI model scraping yielded no results.`);
      sseSend({ type: 'STATUS', message: 'UI model scraping failed. Trying API fallback...' });
    }

    // --- Step 3: API Fallback --- //
    log('INFO', `Request ${requestId}: Attempting API fetch for models...`);

    try {
      log('DEBUG', `Request ${requestId}: Executing in-page fetch for models API.`);
      const apiModelsResult = await page.evaluate(async (modelsEndpoint) => {
        try {
          const resp = await fetch(modelsEndpoint);
          if (!resp.ok) {
            const errorText = await resp.text();
            throw new Error(
              `API returned status ${resp.status}: ${errorText.substring(0, 100)}...`
            );
          }
          return await resp.json();
        } catch (e) {
          console.error('Error fetching models via API:', e);
          return { error: e.message || 'Unknown API error' };
        }
      }, config.lmArena.api.models);

      if (apiModelsResult && apiModelsResult.data && Array.isArray(apiModelsResult.data)) {
        apiModelsResult.data.forEach((model) => {
          if (model.id) {
            if (!uniqueModelIds.has(model.id)) {
              // Add new model from API
              models.push({
                id: model.id,
                name: model.name || `${model.id} (API)`,
                available: true, // Models from API are considered available
                source: 'api',
                metadata: model.metadata || {}
              });
              uniqueModelIds.add(model.id);
              log('DEBUG', `Request ${requestId}: Added model from API: ${model.id}`);
            } else {
              // Update existing model with API data
              const existingModel = models.find((m) => m.id === model.id);
              if (existingModel) {
                existingModel.available = true;
                existingModel.metadata = model.metadata || existingModel.metadata || {};
                existingModel.source = existingModel.source === 'ui' ? 'ui+api' : 'api';
                log(
                  'DEBUG',
                  `Request ${requestId}: Updated existing model with API data: ${model.id}`
                );
              }
            }
          }
        });

        log('INFO', `Request ${requestId}: Fetched ${apiModelsResult.data.length} models via API.`);
        sseSend({
          type: 'STATUS',
          message: `Fetched ${apiModelsResult.data.length} models via API.`
        });
      } else if (apiModelsResult?.error) {
        log(
          'WARN',
          `Request ${requestId}: API fetch failed with reported error:`,
          apiModelsResult.error
        );
        sseSend({
          type: 'WARNING',
          message: `API fetch for models failed: ${apiModelsResult.error}.`
        });
      } else {
        log('WARN', `Request ${requestId}: API fetch failed or returned unexpected structure.`);
        sseSend({ type: 'WARNING', message: 'API fetch for models failed.' });
      }
    } catch (apiErr) {
      log(
        'ERROR',
        `Request ${requestId}: Error during API fetch execution:`,
        apiErr.stack || apiErr
      );
      sseSend({
        type: 'WARNING',
        message: `Error during API fetch for models: ${apiErr.message}.`
      });
    }

    // --- Step 4: Check model availability --- //
    if (models.length > 0) {
      log('INFO', `Request ${requestId}: Checking model availability...`);
      sseSend({ type: 'STATUS', message: 'Checking model availability...' });

      // Check availability for a subset of models (to avoid checking all models)
      const modelsToCheck = models
        .filter((m) => m.source !== 'default') // Don't check default models
        .slice(0, 3); // Limit to 3 models to check

      if (modelsToCheck.length > 0) {
        for (const model of modelsToCheck) {
          try {
            const isAvailable = await checkModelAvailability(page, model.id, { requestId });

            // Update the model's availability status
            model.available = isAvailable;

            log(
              'DEBUG',
              `Request ${requestId}: Model ${model.id} availability check: ${
                isAvailable ? 'Available' : 'Unavailable'
              }`
            );
          } catch (e) {
            log(
              'WARN',
              `Request ${requestId}: Error checking availability for model ${model.id}:`,
              e.message
            );
            // Don't update availability status on error
          }
        }

        log(
          'INFO',
          `Request ${requestId}: Completed availability check for ${modelsToCheck.length} models.`
        );
        sseSend({
          type: 'STATUS',
          message: `Checked availability for ${modelsToCheck.length} models.`
        });
      }
    }

    // --- Step 5: Add Default Models if needed --- //
    if (models.length === 0) {
      log(
        'WARN',
        `Request ${requestId}: No models found via UI scraping or API. Adding known defaults.`
      );
      sseSend({ type: 'WARNING', message: 'Could not fetch models. Using default list.' });
    }

    // Always add default models (marked as such) if they're not already in the list
    config.lmArena.defaultModels.forEach((m) => {
      if (!uniqueModelIds.has(m.id)) {
        models.push({
          ...m,
          available: true, // Default models are assumed available
          source: 'default'
        });
        uniqueModelIds.add(m.id);
        log('DEBUG', `Request ${requestId}: Added default model: ${m.id}`);
      }
    });

    // Ensure models array contains unique models based on collected IDs
    const finalModels = Array.from(uniqueModelIds)
      .map((id) => models.find((m) => m.id === id))
      .filter(Boolean)
      .sort((a, b) => {
        // Sort by availability first, then by source (ui > api > default), then by name
        if (a.available !== b.available) return b.available ? 1 : -1;

        const sourceOrder = { 'ui+api': 0, ui: 1, api: 2, default: 3 };
        const aOrder = sourceOrder[a.source] || 99;
        const bOrder = sourceOrder[b.source] || 99;
        if (aOrder !== bOrder) return aOrder - bOrder;

        return a.name.localeCompare(b.name);
      });

    log(
      'INFO',
      `Request ${requestId}: Successfully fetched/compiled ${finalModels.length} unique models in total.`
    );
    sseSend({ type: 'STATUS', message: `Found ${finalModels.length} models.` });

    // Cache the models
    global.cachedModels = finalModels;
    global.cachedModelsTimestamp = Date.now();

    verboseExit('models.fetchAvailableModels', {
      requestId,
      status: 'success',
      modelCount: finalModels.length,
      availableCount: finalModels.filter((m) => m.available).length
    });

    return finalModels;
  } catch (error) {
    log(
      'ERROR',
      `Request ${requestId}: Fatal Error in fetchAvailableModels:`,
      error.stack || error
    );
    sseSend({
      type: 'ERROR',
      message: `Failed to fetch model list due to an internal error: ${error.message}.`
    });
    verboseExit('models.fetchAvailableModels', { requestId, status: 'fatal_error' });

    // Return cached models if available, otherwise default models
    return global.cachedModels || config.lmArena.defaultModels;
  }
}

/**
 * Extracts models directly from the DOM structure
 * @param {import('puppeteer').Page} page - The page to extract models from
 * @param {Object} options - Options for extracting models
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<Array<{id:string,name:string}>>} Array of model objects
 */
async function extractModelsFromDOM(page, options = {}) {
  const { requestId = generateUUID(), sseSend = () => {} } = options;
  verboseEntry('models.extractModelsFromDOM', { requestId });

  const models = [];

  try {
    log('INFO', `Request ${requestId}: Attempting to extract models directly from DOM...`);
    sseSend({ type: 'STATUS', message: 'Extracting models from DOM...' });

    // Try multiple approaches to find model elements
    const extractedModels = await page.evaluate(() => {
      const results = [];
      const processedIds = new Set();

      // Helper function to extract models from elements
      const extractFromElements = (elements) => {
        return Array.from(elements)
          .map((el) => {
            // Try to get model ID from data-value attribute first
            let modelId = el.getAttribute('data-value');

            // If no data-value, look for other attributes that might contain the ID
            if (!modelId) {
              modelId =
                el.id ||
                el.getAttribute('id') ||
                el.getAttribute('data-id') ||
                el.getAttribute('data-model-id');
            }

            // If still no ID, try to find a paragraph element with the model name
            let modelName = '';
            const paragraphEl = el.querySelector('p');
            if (paragraphEl) {
              modelName = paragraphEl.textContent.trim();
              // If we have a name but no ID, use the name as ID
              if (!modelId && modelName) {
                modelId = modelName;
              }
            } else {
              // If no paragraph element, use the element's text content
              modelName = el.textContent.trim();
            }

            // Clean up the model name if it contains any special characters
            if (modelName) {
              modelName = modelName.replace(/[^\w\s\-\.]/g, '').trim();
            }

            return { id: modelId, name: modelName };
          })
          .filter((model) => model.id && model.name);
      };

      // APPROACH 1: Try to access React/Next.js internal state
      try {
        // Find all React root elements
        const rootElements = document.querySelectorAll('[data-reactroot], [id^="__next"]');

        // Look for React DevTools global hook
        if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.__NEXT_DATA__) {
          console.log('React/Next.js detected on the page');
        }

        // Try to access Next.js data if available
        if (window.__NEXT_DATA__) {
          console.log('Found Next.js data');
          try {
            const nextData = window.__NEXT_DATA__;
            console.log('Next.js data:', JSON.stringify(nextData).substring(0, 200) + '...');

            // Look for models in the Next.js data
            const extractModelsFromObject = (obj, path = '') => {
              if (!obj) return [];

              // If it's an array of objects that look like models
              if (
                Array.isArray(obj) &&
                obj.length > 0 &&
                (obj[0].id || obj[0].model_id || obj[0].name || obj[0].value)
              ) {
                console.log(`Found potential model array at ${path}`);
                return obj
                  .map((item) => ({
                    id: item.id || item.model_id || item.key || item.value || item.name,
                    name: item.name || item.label || item.display_name || item.id || item.model_id
                  }))
                  .filter((m) => m.id && m.name);
              }

              // If it's an object, recursively search its properties
              if (typeof obj === 'object') {
                let models = [];
                for (const key in obj) {
                  if (
                    // Skip certain properties to avoid infinite recursion
                    key !== 'parent' &&
                    key !== 'children' &&
                    obj[key] !== null &&
                    typeof obj[key] === 'object'
                  ) {
                    const newPath = path ? `${path}.${key}` : key;
                    // Check if this property might contain models
                    if (
                      key === 'models' ||
                      key === 'modelList' ||
                      key === 'availableModels' ||
                      key.includes('model')
                    ) {
                      console.log(`Checking potential model property: ${newPath}`);
                    }
                    models = models.concat(extractModelsFromObject(obj[key], newPath));
                  }
                }
                return models;
              }

              return [];
            };

            const nextDataModels = extractModelsFromObject(nextData);
            if (nextDataModels.length > 0) {
              console.log(`Found ${nextDataModels.length} models in Next.js data`);
              nextDataModels.forEach((model) => {
                if (!processedIds.has(model.id)) {
                  results.push(model);
                  processedIds.add(model.id);
                }
              });
            }
          } catch (e) {
            console.error('Error extracting from Next.js data:', e);
          }
        }

        // Try to access React Fiber
        const getFiberNodeFromDOM = (element) => {
          const keys = Object.keys(element);
          return keys.find(
            (key) =>
              key.startsWith('__reactFiber$') ||
              key.startsWith('__reactInternalInstance$') ||
              key.startsWith('_reactInternal')
          )
            ? element[
                keys.find(
                  (key) =>
                    key.startsWith('__reactFiber$') ||
                    key.startsWith('__reactInternalInstance$') ||
                    key.startsWith('_reactInternal')
                )
              ]
            : null;
        };

        // Try to find Command K component in React Fiber
        for (const root of rootElements) {
          try {
            const fiber = getFiberNodeFromDOM(root);
            if (fiber) {
              console.log('Found React Fiber node');

              // Function to traverse the fiber tree and find Command K components
              const traverseFiber = (fiber, depth = 0) => {
                if (!fiber) return null;

                // Check if this is a Command K component
                const name = fiber.type && (fiber.type.displayName || fiber.type.name);
                if (
                  name &&
                  (name.includes('Command') ||
                    name.includes('CMDK') ||
                    name.includes('Combobox') ||
                    name.includes('Select') ||
                    name.includes('Dropdown') ||
                    name.includes('Menu'))
                ) {
                  console.log(`Found potential Command K component: ${name}`);

                  // Try to extract state or props that might contain models
                  const extractFromProps = (props) => {
                    if (!props) return [];

                    // Look for arrays that might contain models
                    for (const key in props) {
                      if (Array.isArray(props[key]) && props[key].length > 0) {
                        const firstItem = props[key][0];
                        if (
                          firstItem &&
                          typeof firstItem === 'object' &&
                          (firstItem.id || firstItem.value || firstItem.name || firstItem.label)
                        ) {
                          console.log(`Found potential model array in props.${key}`);
                          return props[key]
                            .map((item) => ({
                              id: item.id || item.value || item.key || item.name,
                              name: item.name || item.label || item.text || item.id || item.value
                            }))
                            .filter((m) => m.id && m.name);
                        }
                      }
                    }

                    return [];
                  };

                  // Check memoizedProps and memoizedState
                  if (fiber.memoizedProps) {
                    const propsModels = extractFromProps(fiber.memoizedProps);
                    if (propsModels.length > 0) {
                      return propsModels;
                    }
                  }

                  if (fiber.memoizedState && fiber.memoizedState.memoizedState) {
                    const stateModels = extractFromProps(fiber.memoizedState.memoizedState);
                    if (stateModels.length > 0) {
                      return stateModels;
                    }
                  }
                }

                // Traverse child fibers
                let child = fiber.child;
                while (child) {
                  const result = traverseFiber(child, depth + 1);
                  if (result) return result;
                  child = child.sibling;
                }

                return null;
              };

              const fiberModels = traverseFiber(fiber);
              if (fiberModels && fiberModels.length > 0) {
                console.log(`Found ${fiberModels.length} models in React Fiber`);
                fiberModels.forEach((model) => {
                  if (!processedIds.has(model.id)) {
                    results.push(model);
                    processedIds.add(model.id);
                  }
                });
              }
            }
          } catch (e) {
            console.error('Error traversing React Fiber:', e);
          }
        }
      } catch (e) {
        console.error('Error accessing React/Next.js internals:', e);
      }

      // APPROACH 2: Look for elements with cmdk-item attribute (Command K UI)
      const cmdkItems = document.querySelectorAll('[cmdk-item]');
      if (cmdkItems && cmdkItems.length > 0) {
        console.log(`Found ${cmdkItems.length} cmdk-item elements`);
        const cmdkModels = extractFromElements(cmdkItems);
        cmdkModels.forEach((model) => {
          if (!processedIds.has(model.id)) {
            results.push(model);
            processedIds.add(model.id);
          }
        });
      }

      // APPROACH 3: Look for elements with role="option" attribute
      const optionItems = document.querySelectorAll('[role="option"]');
      if (optionItems && optionItems.length > 0) {
        console.log(`Found ${optionItems.length} role=option elements`);
        const optionModels = extractFromElements(optionItems);
        optionModels.forEach((model) => {
          if (!processedIds.has(model.id)) {
            results.push(model);
            processedIds.add(model.id);
          }
        });
      }

      // APPROACH 4: Look for elements with specific class structure from the HTML snippet
      const flexItems = document.querySelectorAll('.relative.flex.cursor-default');
      if (flexItems && flexItems.length > 0) {
        console.log(`Found ${flexItems.length} flex cursor-default elements`);
        const flexModels = extractFromElements(flexItems);
        flexModels.forEach((model) => {
          if (!processedIds.has(model.id)) {
            results.push(model);
            processedIds.add(model.id);
          }
        });
      }

      return results;
    });

    if (extractedModels && extractedModels.length > 0) {
      log(
        'INFO',
        `Request ${requestId}: Successfully extracted ${extractedModels.length} models directly from DOM.`
      );
      models.push(...extractedModels);
      sseSend({ type: 'STATUS', message: `Found ${extractedModels.length} models in DOM.` });
    } else {
      log(
        'WARN',
        `Request ${requestId}: No models found in DOM extraction. Trying keyboard interaction...`
      );
      sseSend({
        type: 'WARNING',
        message: 'No models found in DOM extraction. Trying keyboard interaction...'
      });

      // Try to interact with Command K UI using keyboard shortcuts
      try {
        // First, try to find any input field that might be the Command K input
        const inputField = await page.$('[cmdk-input], input[type="text"], textarea');

        if (inputField) {
          log(
            'INFO',
            `Request ${requestId}: Found potential Command K input field. Trying keyboard interaction.`
          );

          // Focus the input field
          await inputField.focus();

          // Type a space to trigger the dropdown
          await page.keyboard.type(' ');

          // Wait a bit for the dropdown to appear
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Try to extract models again now that the dropdown might be open
          const keyboardModels = await page.evaluate(() => {
            const results = [];
            const processedIds = new Set();

            // Helper function to extract models from elements
            const extractFromElements = (elements) => {
              return Array.from(elements)
                .map((el) => {
                  // Try to get model ID from data-value attribute first
                  let modelId = el.getAttribute('data-value');

                  // If no data-value, look for other attributes that might contain the ID
                  if (!modelId) {
                    modelId =
                      el.id ||
                      el.getAttribute('id') ||
                      el.getAttribute('data-id') ||
                      el.getAttribute('data-model-id');
                  }

                  // If still no ID, try to find a paragraph element with the model name
                  let modelName = '';
                  const paragraphEl = el.querySelector('p');
                  if (paragraphEl) {
                    modelName = paragraphEl.textContent.trim();
                    // If we have a name but no ID, use the name as ID
                    if (!modelId && modelName) {
                      modelId = modelName;
                    }
                  } else {
                    // If no paragraph element, use the element's text content
                    modelName = el.textContent.trim();
                  }

                  // Clean up the model name if it contains any special characters
                  if (modelName) {
                    modelName = modelName.replace(/[^\w\s\-\.]/g, '').trim();
                  }

                  return { id: modelId, name: modelName };
                })
                .filter((model) => model.id && model.name);
            };

            // Look for Command K items now that the dropdown might be open
            const cmdkItems = document.querySelectorAll('[cmdk-item]');
            if (cmdkItems && cmdkItems.length > 0) {
              console.log(
                `Found ${cmdkItems.length} cmdk-item elements after keyboard interaction`
              );
              const cmdkModels = extractFromElements(cmdkItems);
              cmdkModels.forEach((model) => {
                if (!processedIds.has(model.id)) {
                  results.push(model);
                  processedIds.add(model.id);
                }
              });
            }

            // Also look for role="option" elements
            const optionItems = document.querySelectorAll('[role="option"]');
            if (optionItems && optionItems.length > 0) {
              console.log(
                `Found ${optionItems.length} role=option elements after keyboard interaction`
              );
              const optionModels = extractFromElements(optionItems);
              optionModels.forEach((model) => {
                if (!processedIds.has(model.id)) {
                  results.push(model);
                  processedIds.add(model.id);
                }
              });
            }

            return results;
          });

          if (keyboardModels && keyboardModels.length > 0) {
            log(
              'INFO',
              `Request ${requestId}: Successfully extracted ${keyboardModels.length} models after keyboard interaction.`
            );
            models.push(...keyboardModels);
            sseSend({
              type: 'STATUS',
              message: `Found ${keyboardModels.length} models after keyboard interaction.`
            });
          } else {
            log('WARN', `Request ${requestId}: No models found after keyboard interaction.`);
            sseSend({ type: 'WARNING', message: 'No models found after keyboard interaction.' });
          }

          // Press Escape to close any open dropdown
          await page.keyboard.press('Escape');
        } else {
          log(
            'WARN',
            `Request ${requestId}: Could not find Command K input field for keyboard interaction.`
          );
          sseSend({
            type: 'WARNING',
            message: 'Could not find Command K input field for keyboard interaction.'
          });
        }
      } catch (keyboardError) {
        log(
          'ERROR',
          `Request ${requestId}: Error during keyboard interaction:`,
          keyboardError.stack || keyboardError
        );
        sseSend({ type: 'ERROR', message: 'Error during keyboard interaction.' });
      }
    }
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error extracting models from DOM:`, error.stack || error);
    sseSend({ type: 'ERROR', message: 'Error extracting models from DOM.' });
  }

  verboseExit('models.extractModelsFromDOM', {
    requestId,
    status: models.length > 0 ? 'success' : 'failed',
    modelCount: models.length
  });

  return models;
}

/**
 * Extracts models from network requests by intercepting API calls
 * @param {import('puppeteer').Page} page - The page to extract models from
 * @param {Object} options - Options for extracting models
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<Array<{id:string,name:string}>>} Array of model objects
 */
async function extractModelsFromNetwork(page, options = {}) {
  const { requestId = generateUUID(), sseSend = () => {} } = options;
  verboseEntry('models.extractModelsFromNetwork', { requestId });

  const models = [];

  try {
    log(
      'INFO',
      `Request ${requestId}: Setting up network interception to find models in API responses...`
    );
    sseSend({ type: 'STATUS', message: 'Setting up network interception...' });

    // Create a promise that will resolve when we find models in API responses
    const modelsPromise = new Promise((resolve) => {
      // Set a timeout to resolve the promise after 10 seconds if no models are found
      const timeoutId = setTimeout(() => {
        log('DEBUG', `Request ${requestId}: Network interception timeout reached`);
        resolve([]);
      }, 10000);

      // Set up a response listener to look for model data in API responses
      const responseListener = async (response) => {
        try {
          const url = response.url();
          const contentType = response.headers()['content-type'] || '';

          // Only process JSON responses
          if (contentType.includes('application/json')) {
            log('DEBUG', `Request ${requestId}: Intercepted JSON response from ${url}`);

            try {
              const responseData = await response.json().catch(() => null);

              if (responseData) {
                // Function to extract models from response data
                const extractModels = (data) => {
                  // If it's an array of objects that look like models
                  if (Array.isArray(data) && data.length > 0) {
                    const firstItem = data[0];
                    if (
                      firstItem &&
                      typeof firstItem === 'object' &&
                      (firstItem.id || firstItem.model_id || firstItem.name || firstItem.value)
                    ) {
                      log(
                        'INFO',
                        `Request ${requestId}: Found potential model array in response from ${url}`
                      );

                      return data
                        .map((item) => ({
                          id: item.id || item.model_id || item.key || item.value || item.name,
                          name:
                            item.name || item.label || item.display_name || item.id || item.model_id
                        }))
                        .filter((m) => m.id && m.name);
                    }
                  }

                  // If it's an object with a models property
                  if (responseData.models && Array.isArray(responseData.models)) {
                    log(
                      'INFO',
                      `Request ${requestId}: Found models property in response from ${url}`
                    );
                    return extractModels(responseData.models);
                  }

                  // If it's an object with a data property
                  if (responseData.data && Array.isArray(responseData.data)) {
                    log(
                      'INFO',
                      `Request ${requestId}: Found data property in response from ${url}`
                    );
                    return extractModels(responseData.data);
                  }

                  // If it's an object with a results property
                  if (responseData.results && Array.isArray(responseData.results)) {
                    log(
                      'INFO',
                      `Request ${requestId}: Found results property in response from ${url}`
                    );
                    return extractModels(responseData.results);
                  }

                  // If it's an object with an items property
                  if (responseData.items && Array.isArray(responseData.items)) {
                    log(
                      'INFO',
                      `Request ${requestId}: Found items property in response from ${url}`
                    );
                    return extractModels(responseData.items);
                  }

                  return [];
                };

                const extractedModels = extractModels(responseData);

                if (extractedModels.length > 0) {
                  log(
                    'INFO',
                    `Request ${requestId}: Extracted ${extractedModels.length} models from API response`
                  );
                  clearTimeout(timeoutId);
                  resolve(extractedModels);
                }
              }
            } catch (e) {
              log(
                'DEBUG',
                `Request ${requestId}: Error processing response from ${url}: ${e.message}`
              );
            }
          }
        } catch (error) {
          log('DEBUG', `Request ${requestId}: Error in response listener: ${error.message}`);
        }
      };

      // Add the response listener
      page.on('response', responseListener);

      // Store the listener reference so we can remove it later
      page._modelApiResponseListener = responseListener;
    });

    // Trigger some interactions to make API calls
    log('INFO', `Request ${requestId}: Triggering interactions to make API calls...`);
    sseSend({ type: 'STATUS', message: 'Triggering interactions to make API calls...' });

    // Try to find and click the model selector button
    try {
      const modelSelector = await page.$(config.lmArena.selectors.directModeModelSelector);

      if (modelSelector) {
        log(
          'DEBUG',
          `Request ${requestId}: Found model selector button. Clicking to trigger API calls...`
        );
        await modelSelector.click();

        // Wait a bit for API calls to complete
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } else {
        log(
          'DEBUG',
          `Request ${requestId}: Model selector button not found. Trying keyboard interaction...`
        );

        // Try to find any input field that might be the Command K input
        const inputField = await page.$('[cmdk-input], input[type="text"], textarea');

        if (inputField) {
          log(
            'DEBUG',
            `Request ${requestId}: Found potential input field. Focusing and typing to trigger API calls...`
          );
          await inputField.focus();
          await page.keyboard.type(' ');

          // Wait a bit for API calls to complete
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          log(
            'DEBUG',
            `Request ${requestId}: No input field found. Trying to press Tab and Space...`
          );

          // Try pressing Tab a few times to focus on interactive elements
          for (let i = 0; i < 5; i++) {
            await page.keyboard.press('Tab');
            await new Promise((resolve) => setTimeout(resolve, 200));
          }

          // Press Space to activate the focused element
          await page.keyboard.press('Space');

          // Wait a bit for API calls to complete
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    } catch (e) {
      log('WARN', `Request ${requestId}: Error triggering interactions: ${e.message}`);
    }

    // Wait for the models promise to resolve
    const networkModels = await modelsPromise;

    // Remove the response listener to avoid memory leaks
    if (page._modelApiResponseListener) {
      page.off('response', page._modelApiResponseListener);
      page._modelApiResponseListener = null;
    }

    // Press Escape to close any open dropdowns
    try {
      await page.keyboard.press('Escape');
    } catch (e) {
      log('DEBUG', `Request ${requestId}: Error pressing Escape: ${e.message}`);
    }

    if (networkModels.length > 0) {
      log(
        'INFO',
        `Request ${requestId}: Successfully extracted ${networkModels.length} models from network requests.`
      );
      models.push(...networkModels);
      sseSend({
        type: 'STATUS',
        message: `Found ${networkModels.length} models from network requests.`
      });
    } else {
      log('WARN', `Request ${requestId}: No models found in network requests.`);
      sseSend({ type: 'WARNING', message: 'No models found in network requests.' });
    }
  } catch (error) {
    log(
      'ERROR',
      `Request ${requestId}: Error extracting models from network:`,
      error.stack || error
    );
    sseSend({ type: 'ERROR', message: 'Error extracting models from network.' });
  }

  verboseExit('models.extractModelsFromNetwork', {
    requestId,
    status: models.length > 0 ? 'success' : 'failed',
    modelCount: models.length
  });

  return models;
}

/**
 * Scrapes models from the UI by interacting with the Direct mode or Side by Side mode
 * @param {import('puppeteer').Page} page - The page to scrape models from
 * @param {Object} options - Options for scraping models
 * @param {string} options.requestId - Request ID for logging
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @returns {Promise<Array<{id:string,name:string}>>} Array of model objects
 */
async function scrapeModelsFromUI(page, options = {}) {
  const { requestId = generateUUID(), sseSend = () => {} } = options;
  verboseEntry('models.scrapeModelsFromUI', { requestId });

  const models = [];
  let apiModelsFound = false;

  try {
    // --- Step 1: Set up network interception to capture model API responses --- //
    log('INFO', `Request ${requestId}: Setting up network interception to find model API...`);
    sseSend({ type: 'STATUS', message: 'Setting up network interception to find model API...' });

    // Create a promise that will resolve when we find the models API response
    let apiModelsPromise = new Promise((resolve) => {
      // Set up a request interception to look for model list API calls
      const responseListener = async (response) => {
        const url = response.url();

        try {
          // Look for API responses that might contain model data
          if (
            (url.includes('/api/') && url.includes('models')) ||
            url.includes('model-list') ||
            url.includes('available-models')
          ) {
            const contentType = response.headers()['content-type'] || '';
            if (contentType.includes('application/json')) {
              try {
                const responseData = await response.json().catch(() => null);

                if (responseData) {
                  // Check if this looks like a model list
                  let modelList = null;

                  if (
                    Array.isArray(responseData) &&
                    responseData.length > 0 &&
                    (responseData[0].id || responseData[0].model_id || responseData[0].name)
                  ) {
                    modelList = responseData;
                    log('INFO', `Request ${requestId}: Found models API (array format): ${url}`);
                  } else if (responseData.models && Array.isArray(responseData.models)) {
                    modelList = responseData.models;
                    log(
                      'INFO',
                      `Request ${requestId}: Found models API (object.models format): ${url}`
                    );
                  } else if (responseData.data && Array.isArray(responseData.data)) {
                    modelList = responseData.data;
                    log(
                      'INFO',
                      `Request ${requestId}: Found models API (object.data format): ${url}`
                    );
                  }

                  if (modelList && modelList.length > 0) {
                    // Process the model list
                    const extractedModels = modelList
                      .map((model) => {
                        const id = model.id || model.model_id || model.key || model.value;
                        const name = model.name || model.label || model.display_name || id;

                        return { id, name };
                      })
                      .filter((model) => model.id && model.name);

                    if (extractedModels.length > 0) {
                      log(
                        'INFO',
                        `Request ${requestId}: Extracted ${extractedModels.length} models from API response`
                      );
                      resolve(extractedModels);
                      return;
                    }
                  }
                }
              } catch (e) {
                log(
                  'DEBUG',
                  `Request ${requestId}: Error processing response from ${url}: ${e.message}`
                );
              }
            }
          }
        } catch (error) {
          log('DEBUG', `Request ${requestId}: Error in response listener: ${error.message}`);
        }
      };

      // Add the response listener
      page.on('response', responseListener);

      // Store the listener reference so we can remove it later
      page._modelApiResponseListener = responseListener;

      // Set a timeout to resolve the promise after 10 seconds if no API is found
      setTimeout(() => {
        resolve([]);
        log('DEBUG', `Request ${requestId}: API detection timeout reached`);
      }, 10000);
    });

    // --- Step 2: Navigate to direct mode to trigger API calls and for DOM extraction --- //
    log(
      'INFO',
      `Request ${requestId}: Navigating to direct mode to detect model API and extract DOM...`
    );
    sseSend({ type: 'STATUS', message: 'Navigating to direct mode...' });

    // Check if we're already in direct mode
    const currentUrl = await page.url();
    if (!currentUrl.includes('mode=direct')) {
      await page.goto('https://beta.lmarena.ai/?mode=direct', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for UI to settle
    }

    // --- Step 3: Try all extraction methods in parallel --- //
    log('INFO', `Request ${requestId}: Attempting multiple extraction methods in parallel...`);
    sseSend({ type: 'STATUS', message: 'Attempting multiple extraction methods...' });

    // Run all extraction methods in parallel
    const [domModels, networkModels] = await Promise.all([
      // Method 1: Extract models directly from the DOM without any interaction
      extractModelsFromDOM(page, { requestId, sseSend }).catch((e) => {
        log('WARN', `Request ${requestId}: Error in DOM extraction: ${e.message}`);
        return [];
      }),

      // Method 2: Extract models from network requests
      extractModelsFromNetwork(page, { requestId, sseSend }).catch((e) => {
        log('WARN', `Request ${requestId}: Error in network extraction: ${e.message}`);
        return [];
      })
    ]);

    // Combine models from all methods, avoiding duplicates
    const uniqueModelIds = new Set();
    const combinedModels = [];

    // Helper function to add models to the combined list
    const addModels = (modelList, source) => {
      if (modelList && modelList.length > 0) {
        log('INFO', `Request ${requestId}: Adding ${modelList.length} models from ${source}.`);

        modelList.forEach((model) => {
          if (!uniqueModelIds.has(model.id)) {
            combinedModels.push({
              ...model,
              source
            });
            uniqueModelIds.add(model.id);
            log(
              'DEBUG',
              `Request ${requestId}: Added model from ${source}: ${model.id} (${model.name})`
            );
          }
        });
      }
    };

    // Add models from each source
    addModels(domModels, 'dom_extraction');
    addModels(networkModels, 'network_extraction');

    if (combinedModels.length > 0) {
      log(
        'INFO',
        `Request ${requestId}: Successfully extracted ${combinedModels.length} models from all methods.`
      );
      sseSend({
        type: 'STATUS',
        message: `Found ${combinedModels.length} models from all extraction methods.`
      });

      // Add combined models to our collection
      combinedModels.forEach((model) => {
        models.push(model);
      });

      // If any extraction method was successful, return the models
      log('INFO', `Request ${requestId}: Successfully extracted ${models.length} models.`);
      verboseExit('models.scrapeModelsFromUI', {
        requestId,
        status: 'success',
        modelCount: models.length,
        source: 'multiple_methods'
      });
      return models;
    }

    // --- Step 4: If DOM extraction failed, try to find and click the model selector --- //
    log(
      'INFO',
      `Request ${requestId}: DOM extraction yielded no results, trying to interact with model selector...`
    );
    sseSend({ type: 'STATUS', message: 'Trying to interact with model selector...' });

    // Find the model selector dropdown in direct mode
    log('INFO', `Request ${requestId}: Looking for model selector in direct mode...`);

    // Try to find the model selector button to trigger API calls
    try {
      // Wait for the model selector button to appear
      await page.waitForSelector(config.lmArena.selectors.directModeModelSelector, {
        visible: true,
        timeout: 10000
      });

      // Click on the model selector dropdown to open it (this should trigger API calls)
      const modelSelectorButton = await page.$(config.lmArena.selectors.directModeModelSelector);
      if (modelSelectorButton) {
        log('DEBUG', `Request ${requestId}: Found model selector button in direct mode.`);
        await modelSelectorButton.click({ delay: 100 + Math.random() * 50 });

        // Wait for potential API calls to complete
        log('INFO', `Request ${requestId}: Waiting for potential API responses...`);
        sseSend({ type: 'STATUS', message: 'Waiting for API responses...' });

        // Wait for the API models promise to resolve
        const apiModels = await apiModelsPromise;

        // Remove the response listener to avoid memory leaks
        if (page._modelApiResponseListener) {
          page.off('response', page._modelApiResponseListener);
          page._modelApiResponseListener = null;
        }

        // If we found models from the API, use them
        if (apiModels && apiModels.length > 0) {
          log('INFO', `Request ${requestId}: Found ${apiModels.length} models from API.`);
          sseSend({ type: 'STATUS', message: `Found ${apiModels.length} models from API.` });

          // Add models to our collection
          apiModels.forEach((model) => {
            models.push(model);
            log('DEBUG', `Request ${requestId}: Added model from API: ${model.id} (${model.name})`);
          });

          apiModelsFound = true;

          // Close the dropdown by pressing Escape
          await page.keyboard.press('Escape');
          log('DEBUG', `Request ${requestId}: Closed model dropdown.`);

          // If API models were found, return them
          log(
            'INFO',
            `Request ${requestId}: Successfully extracted ${models.length} models from API.`
          );
          verboseExit('models.scrapeModelsFromUI', {
            requestId,
            status: 'success',
            modelCount: models.length,
            source: 'api'
          });
          return models;
        }

        // --- Step 5: Try DOM extraction again after dropdown is open --- //
        log(
          'INFO',
          `Request ${requestId}: No models found from API, trying DOM extraction with dropdown open...`
        );
        sseSend({ type: 'STATUS', message: 'Trying DOM extraction with dropdown open...' });

        // Try to extract models from the DOM now that the dropdown is open
        const openDropdownDomModels = await extractModelsFromDOM(page, { requestId, sseSend });

        if (openDropdownDomModels && openDropdownDomModels.length > 0) {
          log(
            'INFO',
            `Request ${requestId}: Found ${openDropdownDomModels.length} models from DOM with dropdown open.`
          );
          sseSend({
            type: 'STATUS',
            message: `Found ${openDropdownDomModels.length} models from DOM with dropdown open.`
          });

          // Add models to our collection
          openDropdownDomModels.forEach((model) => {
            models.push(model);
            log(
              'DEBUG',
              `Request ${requestId}: Added model from DOM with dropdown open: ${model.id} (${model.name})`
            );
          });

          // Close the dropdown by pressing Escape
          await page.keyboard.press('Escape');
          log('DEBUG', `Request ${requestId}: Closed model dropdown.`);

          // If DOM extraction was successful, return the models
          log(
            'INFO',
            `Request ${requestId}: Successfully extracted ${models.length} models from DOM with dropdown open.`
          );
          verboseExit('models.scrapeModelsFromUI', {
            requestId,
            status: 'success',
            modelCount: models.length,
            source: 'dom_extraction_dropdown'
          });
          return models;
        }

        // --- Step 6: Fall back to traditional UI scraping as last resort --- //
        log(
          'INFO',
          `Request ${requestId}: DOM extraction with dropdown open failed, falling back to traditional UI scraping...`
        );

        // Wait for the dropdown to appear
        await page.waitForSelector(config.lmArena.selectors.directModeModelOption, {
          visible: true,
          timeout: 5000
        });

        // Extract all model options from the dropdown
        const directModeModels = await page.evaluate((selector) => {
          // Look for all dropdown items that might contain model options
          const modelElements = Array.from(document.querySelectorAll(selector));
          return modelElements
            .map((element) => {
              // Extract model ID and name
              const modelId =
                element.getAttribute('data-value') || element.id || element.getAttribute('id');
              const modelName = element.textContent.trim();
              return { id: modelId || modelName, name: modelName };
            })
            .filter((model) => model.id && model.name); // Filter out any invalid entries
        }, config.lmArena.selectors.directModeModelOption);

        if (directModeModels && directModeModels.length > 0) {
          log(
            'INFO',
            `Request ${requestId}: Found ${directModeModels.length} models in direct mode UI.`
          );
          sseSend({
            type: 'STATUS',
            message: `Found ${directModeModels.length} models in direct mode UI.`
          });

          // Add models to our collection
          directModeModels.forEach((model) => {
            models.push(model);
            log(
              'DEBUG',
              `Request ${requestId}: Added model from direct mode UI: ${model.id} (${model.name})`
            );
          });

          // Close the dropdown by pressing Escape
          await page.keyboard.press('Escape');
          log('DEBUG', `Request ${requestId}: Closed direct mode model dropdown.`);

          // If direct mode UI scraping was successful, return the models
          log(
            'INFO',
            `Request ${requestId}: Successfully scraped ${models.length} models from direct mode UI.`
          );
          verboseExit('models.scrapeModelsFromUI', {
            requestId,
            status: 'success',
            modelCount: models.length,
            source: 'direct_mode_ui'
          });
          return models;
        } else {
          log('WARN', `Request ${requestId}: No models found in direct mode dropdown.`);
        }
      } else {
        log('WARN', `Request ${requestId}: Model selector button not found in direct mode.`);
      }
    } catch (e) {
      log('WARN', `Request ${requestId}: Error scraping models in direct mode:`, e.message);
      sseSend({ type: 'WARNING', message: 'Error finding models in direct mode.' });

      // Remove the response listener if it exists
      if (page._modelApiResponseListener) {
        page.off('response', page._modelApiResponseListener);
        page._modelApiResponseListener = null;
      }
    }

    // --- Step 2: Fall back to Side by Side Mode if Direct Mode failed --- //
    log(
      'INFO',
      `Request ${requestId}: Direct mode failed or found no models. Trying Side by Side mode...`
    );
    sseSend({ type: 'STATUS', message: 'Trying Side by Side mode...' });

    // Navigate to the main page
    await page.goto('https://beta.lmarena.ai/', { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait for UI to settle

    // Find and click the mode dropdown trigger
    let modeDropdownTrigger;
    try {
      modeDropdownTrigger = await page.$(config.lmArena.selectors.modeDropdownTrigger);
      log('DEBUG', `Request ${requestId}: Found mode dropdown trigger.`);
    } catch (e) {
      log('ERROR', `Request ${requestId}: Error finding mode dropdown trigger:`, e.stack || e);
    }

    if (!modeDropdownTrigger) {
      log('ERROR', `Request ${requestId}: Main mode dropdown trigger element not found.`);
      sseSend({ type: 'ERROR', message: 'Could not find mode selection UI trigger.' });
      verboseExit('models.scrapeModelsFromUI', { requestId, status: 'mode_trigger_not_found' });
      return models; // Return any models we might have found so far
    }

    try {
      await modeDropdownTrigger.click({ delay: 100 + Math.random() * 50 });
      log('DEBUG', `Request ${requestId}: Clicked main mode dropdown trigger.`);
    } catch (e) {
      log('ERROR', `Request ${requestId}: Failed to click mode dropdown trigger:`, e.stack || e);
      sseSend({ type: 'ERROR', message: 'Could not open mode dropdown.' });
      verboseExit('models.scrapeModelsFromUI', { requestId, status: 'mode_trigger_click_failed' });
      return models;
    }

    // Wait for the mode selection dropdown listbox to appear
    const modeListboxSelector = 'div[role="listbox"][aria-labelledby*="radix-"]';
    let modeDropdownVisible = false;

    try {
      await page.waitForSelector(modeListboxSelector, { visible: true, timeout: 10000 });
      log('DEBUG', `Request ${requestId}: Mode selection dropdown appeared.`);
      modeDropdownVisible = true;
    } catch (e) {
      log(
        'WARN',
        `Request ${requestId}: Mode selection dropdown listbox did not appear within timeout:`,
        e.message
      );
      sseSend({ type: 'WARNING', message: 'Mode selection dropdown did not appear.' });
      verboseExit('models.scrapeModelsFromUI', { requestId, status: 'mode_dropdown_not_visible' });
      return models;
    }

    // Click the "Side by Side" option
    let sideBySideOptionSelected = false;

    if (modeDropdownVisible) {
      log('DEBUG', `Request ${requestId}: Searching for "Side by Side" option.`);

      let sideBySideOption = null;
      try {
        const modeOptions = await page.$$(config.lmArena.selectors.sideBySideOption);
        log('DEBUG', `Request ${requestId}: Found ${modeOptions.length} potential mode options.`);

        for (const el of modeOptions) {
          try {
            const text = await el.evaluate((e) => e.textContent?.trim());
            if (text && /side by side/i.test(text)) {
              sideBySideOption = el;
              log('DEBUG', `Request ${requestId}: Found "Side by Side" option element.`);
              break;
            }
          } catch (evalError) {
            log(
              'WARN',
              `Request ${requestId}: Error evaluating a mode option element:`,
              evalError.message
            );
          }
        }
      } catch (e) {
        log(
          'ERROR',
          `Request ${requestId}: Error searching for Side by Side mode option elements:`,
          e.stack || e
        );
      }

      if (!sideBySideOption) {
        log(
          'WARN',
          `Request ${requestId}: "Side by Side" mode option element not found in dropdown.`
        );
        sseSend({ type: 'WARNING', message: 'Could not find "Side by Side" mode option.' });
        verboseExit('models.scrapeModelsFromUI', {
          requestId,
          status: 'side_by_side_option_not_found'
        });
        return models;
      }

      try {
        await sideBySideOption.click({ delay: 100 + Math.random() * 50 });
        log('INFO', `Request ${requestId}: "Side by Side" mode selected by clicking element.`);
        sseSend({ type: 'STATUS', message: '"Side by Side" mode selected.' });
        sideBySideOptionSelected = true;
      } catch (e) {
        log(
          'ERROR',
          `Request ${requestId}: Failed to click "Side by Side" option element:`,
          e.stack || e
        );
        sseSend({ type: 'ERROR', message: 'Could not select "Side by Side" mode.' });
        verboseExit('models.scrapeModelsFromUI', {
          requestId,
          status: 'side_by_side_option_click_failed'
        });
        return models;
      }
    }

    // Wait for the mode switch to take effect
    let modelTriggersVisible = false;

    if (sideBySideOptionSelected) {
      log(
        'DEBUG',
        `Request ${requestId}: Waiting for model selectors after selecting Side by Side mode.`
      );

      try {
        await Promise.race([
          page.waitForFunction(() => window.location.search.includes('mode=side-by-side'), {
            timeout: 10000,
            polling: 'mutation'
          }),
          page.waitForSelector(config.lmArena.selectors.modelBDropdownTrigger, {
            visible: true,
            timeout: 10000
          })
        ]);

        log(
          'INFO',
          `Request ${requestId}: Mode switch detected via URL or model selector visibility.`
        );
        modelTriggersVisible = true;
      } catch (e) {
        log(
          'WARN',
          `Request ${requestId}: Timeout waiting for side-by-side mode switch confirmation:`,
          e.message
        );
        log(
          'DEBUG',
          `Request ${requestId}: Proceeding assuming mode switch happened based on previous click.`
        );
        await new Promise((resolve) => setTimeout(resolve, 3000)); // Add a longer static wait as fallback
      }
    }

    // --- Step 3: Extract Models from Model B selector --- //
    if (modelTriggersVisible || sideBySideOptionSelected) {
      log('INFO', `Request ${requestId}: Attempting to extract models from the Model B dropdown.`);
      sseSend({ type: 'STATUS', message: 'Accessing model selection dropdown...' });

      let modelTriggerToClick;
      try {
        modelTriggerToClick = await page.$(config.lmArena.selectors.modelBDropdownTrigger);
        log('DEBUG', `Request ${requestId}: Found Model B dropdown trigger.`);
      } catch (e) {
        log('ERROR', `Request ${requestId}: Error finding Model B dropdown trigger:`, e.stack || e);
      }

      if (!modelTriggerToClick) {
        log('WARN', `Request ${requestId}: Model dropdown trigger element not found.`);
        sseSend({
          type: 'WARNING',
          message: 'Could not find model selectors in Side by Side mode.'
        });
        verboseExit('models.scrapeModelsFromUI', { requestId, status: 'model_trigger_not_found' });
        return models;
      }

      try {
        await modelTriggerToClick.click({ delay: 100 + Math.random() * 50 });
        log('DEBUG', `Request ${requestId}: Clicked Model B dropdown trigger.`);

        // Wait for the model selection dropdown listbox to appear
        try {
          await page.waitForSelector(config.lmArena.selectors.modelListbox, {
            visible: true,
            timeout: 10000
          });

          log('DEBUG', `Request ${requestId}: Model dropdown listbox appeared.`);
          log('INFO', `Request ${requestId}: Model dropdown listbox appeared.`);

          // Extract model elements
          let modelElements = [];
          try {
            log('DEBUG', `Request ${requestId}: Attempting to find model items.`);

            modelElements = await page.$$(
              `${config.lmArena.selectors.modelListbox} ${config.lmArena.selectors.modelListItemRadix}`
            );

            if (!modelElements || modelElements.length === 0) {
              log(
                'DEBUG',
                `Request ${requestId}: Radix selector found no items, trying generic selector.`
              );

              modelElements = await page.$$(
                `${config.lmArena.selectors.modelListbox} ${config.lmArena.selectors.modelListItemGeneric}`
              );
            }

            log(
              'INFO',
              `Request ${requestId}: Found ${modelElements.length} potential model list items.`
            );
          } catch (e) {
            log(
              'ERROR',
              `Request ${requestId}: Error querying model list item elements:`,
              e.stack || e
            );
            sseSend({ type: 'WARNING', message: 'Error finding model list items in UI.' });
          }

          if (modelElements && modelElements.length > 0) {
            for (const element of modelElements) {
              try {
                // Extract text content (model name) and data-value (model ID) if available
                const modelName = await element.evaluate((el) => el.textContent?.trim());
                const dataValue = await element.evaluate((el) => el.getAttribute('data-value'));
                const modelId = dataValue || modelName; // Prioritize data-value, fall back to name

                if (modelId) {
                  models.push({
                    id: modelId.trim(),
                    name: modelName?.trim() || modelId.trim()
                  });

                  log(
                    'DEBUG',
                    `Request ${requestId}: Extracted model: id=${modelId.trim()}, name=${
                      modelName?.trim() || modelId.trim()
                    }`
                  );
                } else {
                  log(
                    'WARN',
                    `Request ${requestId}: Could not extract ID or name from a model list item element.`
                  );
                }
              } catch (evalError) {
                log(
                  'WARN',
                  `Request ${requestId}: Error evaluating a model list item element:`,
                  evalError.message
                );
              }
            }
          } else {
            log('WARN', `Request ${requestId}: Could not find any model list item elements.`);
            sseSend({
              type: 'WARNING',
              message: 'Could not scrape model list items from UI dropdown.'
            });
          }
        } catch (e) {
          log(
            'WARN',
            `Request ${requestId}: Model dropdown listbox did not appear within timeout:`,
            e.message
          );
          sseSend({ type: 'WARNING', message: 'Model dropdown did not appear after clicking.' });
        }

        // Close the dropdown by pressing Escape
        try {
          log('DEBUG', `Request ${requestId}: Pressing Escape to close model dropdown.`);
          await page.keyboard.press('Escape');
          log('DEBUG', `Request ${requestId}: Escape key pressed.`);

          // Wait briefly for dropdown to close
          await page
            .waitForSelector(config.lmArena.selectors.modelListbox, {
              hidden: true,
              timeout: 5000
            })
            .catch(() =>
              log(
                'WARN',
                `Request ${requestId}: Timeout waiting for model dropdown to become hidden after Escape.`
              )
            );
        } catch (e) {
          log(
            'WARN',
            `Request ${requestId}: Failed to press Escape or wait for dropdown to hide:`,
            e.message
          );
        }
      } catch (e) {
        log(
          'ERROR',
          `Request ${requestId}: Failed to click Model B dropdown trigger:`,
          e.stack || e
        );
        sseSend({ type: 'ERROR', message: 'Could not open model dropdown.' });
      }
    } else {
      log(
        'DEBUG',
        `Request ${requestId}: Skipping UI scraping for models as Side by Side mode was not successfully selected.`
      );
      sseSend({ type: 'STATUS', message: 'Skipped UI scraping for models.' });
    }

    verboseExit('models.scrapeModelsFromUI', {
      requestId,
      status: 'success',
      modelCount: models.length
    });
    return models;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in scrapeModelsFromUI:`, error.stack || error);
    verboseExit('models.scrapeModelsFromUI', { requestId, status: 'error' });
    return [];
  }
}

/**
 * Checks if a specific model is available
 * @param {import('puppeteer').Page} page - The page to check model availability on
 * @param {string} modelId - The model ID to check
 * @param {Object} options - Options for checking model availability
 * @param {string} [options.requestId] - Request ID for logging
 * @returns {Promise<boolean>} True if the model is available, false otherwise
 */
async function checkModelAvailability(page, modelId, options = {}) {
  const requestId = options.requestId || generateUUID();
  verboseEntry('models.checkModelAvailability', { requestId, modelId });

  try {
    log('DEBUG', `Request ${requestId}: Checking availability for model: ${modelId}`);

    // Method 1: Check via API
    try {
      const apiAvailability = await page.evaluate(async (modelId) => {
        try {
          // Try to fetch model status from API
          const resp = await fetch(`/api/v1/models/${modelId}/status`);
          if (!resp.ok) {
            return { error: `API returned status ${resp.status}` };
          }
          const data = await resp.json();
          return {
            available: data.available === true || data.status === 'available',
            data
          };
        } catch (e) {
          return { error: e.message || 'Unknown error checking model availability via API' };
        }
      }, modelId);

      if (apiAvailability && !apiAvailability.error) {
        log(
          'DEBUG',
          `Request ${requestId}: Model ${modelId} API availability check: ${apiAvailability.available}`
        );
        verboseExit('models.checkModelAvailability', {
          requestId,
          modelId,
          method: 'api',
          available: apiAvailability.available
        });
        return apiAvailability.available;
      }

      log(
        'DEBUG',
        `Request ${requestId}: API availability check failed: ${
          apiAvailability?.error || 'Unknown error'
        }`
      );
    } catch (e) {
      log('WARN', `Request ${requestId}: Error checking model availability via API: ${e.message}`);
    }

    // Method 2: Check via UI (more reliable but slower)
    try {
      // First check if we're in the right mode for model selection
      const currentUrl = page.url();
      let needsNavigation = false;

      // If we're not on the main page or not in side-by-side mode, navigate
      if (!currentUrl.includes('mode=side-by-side')) {
        needsNavigation = true;
        log('DEBUG', `Request ${requestId}: Not in side-by-side mode, will navigate.`);
      }

      if (needsNavigation) {
        // Navigate to side-by-side mode
        await page.goto(`${config.lmArena.url}?mode=side-by-side`, {
          waitUntil: 'networkidle2',
          timeout: 30000
        });
        log(
          'DEBUG',
          `Request ${requestId}: Navigated to side-by-side mode for model availability check.`
        );
      }

      // Wait for model selectors to appear
      await page.waitForSelector(config.lmArena.selectors.modelBDropdownTrigger, {
        visible: true,
        timeout: 10000
      });

      // Click the model dropdown
      const modelDropdown = await page.$(config.lmArena.selectors.modelBDropdownTrigger);
      await modelDropdown.click();
      log('DEBUG', `Request ${requestId}: Clicked model dropdown for availability check.`);

      // Wait for the dropdown to appear
      await page.waitForSelector(config.lmArena.selectors.modelListbox, {
        visible: true,
        timeout: 5000
      });

      // Check if the model is in the dropdown and not disabled
      const modelAvailable = await page.evaluate(
        (modelId, listboxSelector) => {
          const listbox = document.querySelector(listboxSelector);
          if (!listbox) return false;

          // Look for the model in the dropdown
          const options = Array.from(listbox.querySelectorAll('[role="option"]'));

          for (const option of options) {
            const optionId = option.getAttribute('data-value') || option.textContent?.trim();
            if (optionId === modelId || optionId?.includes(modelId)) {
              // Check if the option is disabled
              const isDisabled =
                option.getAttribute('aria-disabled') === 'true' ||
                option.classList.contains('disabled') ||
                option.classList.contains('opacity-50') ||
                option.style.opacity === '0.5';

              return !isDisabled;
            }
          }

          return false; // Model not found in dropdown
        },
        modelId,
        config.lmArena.selectors.modelListbox
      );

      // Close the dropdown by pressing Escape
      await page.keyboard.press('Escape');

      log(
        'DEBUG',
        `Request ${requestId}: Model ${modelId} UI availability check: ${modelAvailable}`
      );
      verboseExit('models.checkModelAvailability', {
        requestId,
        modelId,
        method: 'ui',
        available: modelAvailable
      });

      return modelAvailable;
    } catch (e) {
      log('WARN', `Request ${requestId}: Error checking model availability via UI: ${e.message}`);
    }

    // If all checks fail, assume the model is available (optimistic approach)
    log(
      'WARN',
      `Request ${requestId}: All availability checks failed for model ${modelId}, assuming available.`
    );
    verboseExit('models.checkModelAvailability', {
      requestId,
      modelId,
      method: 'fallback',
      available: true
    });

    return true;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Fatal error checking model availability: ${error.message}`);
    verboseExit('models.checkModelAvailability', {
      requestId,
      modelId,
      status: 'error',
      available: true // Assume available on error
    });

    return true; // Assume available on error
  }
}

/**
 * Refreshes the model list cache
 * @param {Object} options - Options for refreshing the model list
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {string} [options.requestId] - Request ID for logging
 * @param {import('puppeteer').Page} [options.page] - Existing page to use
 * @param {Array<{id:string,name:string}>} [options.extractedModels] - Models already extracted from the DOM
 * @returns {Promise<void>}
 */
async function refreshModelCache(options = {}) {
  const requestId = options.requestId || generateUUID();
  verboseEntry('models.refreshModelCache', { requestId });

  const sseSend =
    options.sseSend ||
    ((data) => {
      log('DEBUG', `SSE update (mock): ${JSON.stringify(data)}`);
    });

  let page = options.page;
  let needToReleasePage = false;

  try {
    log('INFO', `Request ${requestId}: Starting background model cache refresh.`);

    // If we already have extracted models, add them to the cache
    if (options.extractedModels && options.extractedModels.length > 0) {
      log(
        'INFO',
        `Request ${requestId}: Using ${options.extractedModels.length} pre-extracted models.`
      );

      // Initialize the cache if needed
      if (!global.cachedModels) {
        global.cachedModels = [];
      }

      // Add new models to the cache
      let newModelsAdded = 0;
      options.extractedModels.forEach((model) => {
        if (!global.cachedModels.some((m) => m.id === model.id)) {
          global.cachedModels.push({
            id: model.id,
            name: model.name || model.id,
            available: true,
            source: 'direct_extraction'
          });
          newModelsAdded++;
          log('DEBUG', `Request ${requestId}: Added model to cache: ${model.id}`);
        }
      });

      global.cachedModelsTimestamp = Date.now();
      log(
        'INFO',
        `Request ${requestId}: Added ${newModelsAdded} new models to cache from direct extraction.`
      );

      // If we have a good number of models, we can return early
      if (global.cachedModels.length >= 10) {
        log(
          'INFO',
          `Request ${requestId}: Using ${global.cachedModels.length} models without further fetching.`
        );
        verboseExit('models.refreshModelCache', {
          requestId,
          status: 'success',
          modelCount: global.cachedModels.length
        });
        return;
      }
    }

    // If no page was provided, get a new one
    if (!page) {
      const puppeteerManager = require('./puppeteerManager');
      page = await puppeteerManager.launchOrGetPage({
        requestId,
        priority: true // Mark as high priority
      });
      needToReleasePage = true;
      log('DEBUG', `Request ${requestId}: Created new page for model cache refresh.`);
    } else {
      log('DEBUG', `Request ${requestId}: Using provided page for model cache refresh.`);
    }

    // Fetch models with force refresh
    await fetchAvailableModels(page, {
      requestId,
      sseSend,
      forceRefresh: true
    });

    log('INFO', `Request ${requestId}: Background model cache refresh completed.`);
    verboseExit('models.refreshModelCache', {
      requestId,
      status: 'success',
      modelCount: global.cachedModels?.length || 0
    });
  } catch (error) {
    log(
      'ERROR',
      `Request ${requestId}: Error during background model cache refresh: ${error.message}`
    );
    verboseExit('models.refreshModelCache', {
      requestId,
      status: 'error'
    });
  } finally {
    // Release the page back to the pool if we created it
    if (needToReleasePage && page) {
      try {
        const puppeteerManager = require('./puppeteerManager');
        await puppeteerManager.releasePage(page, { requestId });
        log('DEBUG', `Request ${requestId}: Released page after model cache refresh.`);
      } catch (e) {
        log(
          'WARN',
          `Request ${requestId}: Error releasing page after model cache refresh: ${e.message}`
        );
      }
    }
  }
}

/**
 * Gets the cached models or fetches them if not cached
 * @param {Object} options - Options for getting models
 * @param {Function} [options.sseSend] - Function to send SSE updates
 * @param {boolean} [options.forceRefresh=false] - Whether to force a refresh of the model list
 * @returns {Promise<Array<{id:string,name:string,available:boolean}>>} Array of model objects
 */
async function getModels(options = {}) {
  const requestId = generateUUID();
  verboseEntry('models.getModels', { requestId });

  try {
    // Check if we have cached models and don't need to force refresh
    if (!options.forceRefresh && global.cachedModels && global.cachedModels.length > 0) {
      log(
        'INFO',
        `Request ${requestId}: Using cached models (${global.cachedModels.length} models).`
      );
      verboseExit('models.getModels', {
        requestId,
        status: 'success',
        source: 'cache',
        modelCount: global.cachedModels.length
      });

      // Start a background refresh if the cache is older than 30 minutes
      if (global.cachedModelsTimestamp && Date.now() - global.cachedModelsTimestamp > 1800000) {
        log(
          'DEBUG',
          `Request ${requestId}: Starting background refresh of model cache (last updated ${Math.round(
            (Date.now() - global.cachedModelsTimestamp) / 1000 / 60
          )} minutes ago).`
        );
        refreshModelCache(options).catch((e) => {
          log('WARN', `Request ${requestId}: Background model cache refresh failed: ${e.message}`);
        });
      }

      return global.cachedModels;
    }

    // Get a page instance from the puppeteer manager
    const puppeteerManager = require('./puppeteerManager');
    const page = await puppeteerManager.launchOrGetPage();

    // Fetch models
    const models = await fetchAvailableModels(page, {
      requestId,
      sseSend: options.sseSend,
      forceRefresh: options.forceRefresh
    });

    verboseExit('models.getModels', {
      requestId,
      status: 'success',
      source: 'fetch',
      modelCount: models.length
    });

    return models;
  } catch (error) {
    log('ERROR', `Request ${requestId}: Error in getModels: ${error.message}`);
    verboseExit('models.getModels', {
      requestId,
      status: 'error'
    });

    // Return cached models if available, otherwise default models
    if (global.cachedModels && global.cachedModels.length > 0) {
      log('INFO', `Request ${requestId}: Returning ${global.cachedModels.length} cached models`);
      return global.cachedModels;
    }

    // Initialize cache with default models
    log('INFO', `Request ${requestId}: Initializing cache with default models from config`);
    global.cachedModels = [];

    // Add default models to the cache
    config.lmArena.defaultModels.forEach((model) => {
      global.cachedModels.push({
        id: model.id,
        name: model.name || model.id,
        available: true,
        source: 'default_config'
      });
      log('DEBUG', `Request ${requestId}: Added default model to cache: ${model.id}`);
    });

    global.cachedModelsTimestamp = Date.now();
    log(
      'INFO',
      `Request ${requestId}: Added ${config.lmArena.defaultModels.length} default models to cache`
    );

    return global.cachedModels;
  }
}

module.exports = {
  fetchAvailableModels,
  scrapeModelsFromUI,
  extractModelsFromDOM,
  extractModelsFromNetwork,
  checkModelAvailability,
  refreshModelCache,
  getModels
};
