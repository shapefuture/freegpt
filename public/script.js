document.addEventListener('DOMContentLoaded', () => {
  console.debug('[DEBUG] DOMContentLoaded');
  const systemPromptEl = document.getElementById('systemPrompt');
  const modelAIdEl = document.getElementById('modelAId');
  const modelBIdEl = document.getElementById('modelBId');
  const userPromptEl = document.getElementById('userPrompt');
  const sendButton = document.getElementById('sendButton');
  const newConversationButton = document.getElementById('newConversationButton');
  const retryActionButton = document.getElementById('retryActionButton');
  const statusAreaEl = document.getElementById('statusArea');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const modelAResponseEl = document.getElementById('modelAResponse');
  const modelBResponseEl = document.getElementById('modelBResponse');
  const messageHistoryEl = document.getElementById('messageHistory');

  // Accessibility: focus management, ARIA feedback, keyboard navigation
  function announceStatus(msg) {
    statusAreaEl.textContent = msg;
    statusAreaEl.setAttribute('aria-live', 'polite');
    setTimeout(() => statusAreaEl.setAttribute('aria-live', 'off'), 1500);
  }

  // Dynamic Model Selectors
  async function fetchModelsAndPopulate() {
    loadingSpinner.style.display = 'inline';
    try {
      const resp = await fetch('/api/models');
      if (!resp.ok) throw new Error('Failed to load model list');
      const data = await resp.json();
      const models = (data.models || []).map((m) => m.id);

      [modelAIdEl, modelBIdEl].forEach((selectEl) => {
        selectEl.innerHTML = '';
        models.forEach((modelId) => {
          const opt = document.createElement('option');
          opt.value = modelId;
          opt.textContent = modelId;
          selectEl.appendChild(opt);
        });
      });
      announceStatus('Models loaded.');
    } catch (e) {
      [modelAIdEl, modelBIdEl].forEach((selectEl) => {
        selectEl.innerHTML = '';
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Unavailable';
        selectEl.appendChild(opt);
      });
      announceStatus('⚠️ Could not load models. Please try again later.');
    } finally {
      loadingSpinner.style.display = 'none';
    }
  }

  fetchModelsAndPopulate();

  // Keyboard accessibility for model selects
  [modelAIdEl, modelBIdEl].forEach((selectEl) => {
    selectEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && selectEl.value) {
        userPromptEl.focus();
      }
    });
  });

  // Analytics stub
  function sendAnalytics(event, details) {
    // You may replace this with a call to analytics endpoint
    console.log('[Analytics]', event, details);
  }

  // Focus management for errors
  function focusFirstError() {
    if (!systemPromptEl.value.trim()) return systemPromptEl.focus();
    if (!modelAIdEl.value) return modelAIdEl.focus();
    if (!userPromptEl.value.trim()) return userPromptEl.focus();
  }

  let clientConversationId = null;
  let clientMessagesHistory = [];
  let currentRequestIdForRetry = null;
  let eventSource = null;

  function generateClientUUID() {
    const uuid = ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) =>
      (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
    );
    console.debug('[DEBUG] Generated client UUID:', uuid);
    return uuid;
  }

  function displayMessageInHistory(role, content) {
    console.debug(`[DEBUG] Displaying message. Role: ${role}, Content: ${content}`);
    const messageDiv = document.createElement('div');
    messageDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
    const span = document.createElement('span');
    span.textContent = content;
    messageDiv.appendChild(span);
    messageHistoryEl.appendChild(messageDiv);
    messageHistoryEl.scrollTop = messageHistoryEl.scrollHeight;
  }

  newConversationButton.addEventListener('click', () => {
    console.debug('[DEBUG] New conversation click');
    clientConversationId = null;
    clientMessagesHistory = [];
    modelAResponseEl.textContent = '';
    modelBResponseEl.textContent = '';
    messageHistoryEl.innerHTML = '';
    statusAreaEl.textContent = 'New conversation started.';
    retryActionButton.style.display = 'none';
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    console.log('New conversation initiated.');
  });

  sendButton.addEventListener('click', () => {
    (async () => {
      try {
        console.debug('[DEBUG] Send button clicked');
        const userPrompt = userPromptEl.value.trim();
        const modelA = modelAIdEl.value;
        const modelB = modelBIdEl.value;
        const sysPrompt = systemPromptEl.value.trim();

        // Input validation
        if (!userPrompt) {
          statusAreaEl.textContent = 'User prompt cannot be empty.';
          userPromptEl.focus();
          return;
        }
        if (!modelA) {
          statusAreaEl.textContent = 'Please select Model A.';
          modelAIdEl.focus();
          return;
        }
        if (!sysPrompt) {
          statusAreaEl.textContent = 'System prompt cannot be empty.';
          systemPromptEl.focus();
          return;
        }

        sendButton.disabled = true;
        loadingSpinner.style.display = 'inline';
        retryActionButton.style.display = 'none';
        modelAResponseEl.textContent = '';
        modelBResponseEl.textContent = '';

        displayMessageInHistory('user', userPrompt);
        clientMessagesHistory.push({ role: 'user', content: userPrompt, id: generateClientUUID() });
        userPromptEl.value = '';

        const payload = {
          userPrompt,
          systemPrompt: sysPrompt,
          targetModelA: modelA,
          targetModelB: modelB,
          clientConversationId: clientConversationId,
          clientMessagesHistory: clientMessagesHistory.slice(0, -1)
        };

        statusAreaEl.textContent = 'Sending request to server...';

        if (eventSource) {
          eventSource.close();
        }

        try {
          const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });

          if (!response.ok) {
            const errData = await response
              .json()
              .catch(() => ({ message: `HTTP error ${response.status}` }));
            console.error('[ERROR] Bad response from /api/chat:', errData);
            throw new Error(errData.message || `Server error: ${response.status}`);
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let partialModelAResponse = '';
          let partialModelBResponse = '';

          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              statusAreaEl.textContent = 'Stream finished.';
              clientMessagesHistory.push({
                role: 'assistant',
                model: 'A',
                content: partialModelAResponse
              });
              clientMessagesHistory.push({
                role: 'assistant',
                model: 'B',
                content: partialModelBResponse
              });
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            const messages = chunk.split('\n\n');
            for (const message of messages) {
              if (message.startsWith('data: ')) {
                try {
                  const data = JSON.parse(message.substring(5).trim());
                  console.debug('[DEBUG] SSE data received:', data);

                  if (data.type === 'STATUS') {
                    statusAreaEl.textContent = data.message;
                  } else if (data.type === 'MODEL_CHUNK') {
                    if (data.modelKey === 'A') {
                      partialModelAResponse += data.content || '';
                      modelAResponseEl.textContent = partialModelAResponse;
                    } else if (data.modelKey === 'B') {
                      partialModelBResponse += data.content || '';
                      modelBResponseEl.textContent = partialModelBResponse;
                    }
                    if (data.finishReason) {
                      statusAreaEl.textContent = `Model ${data.modelKey} finished: ${data.finishReason}.`;
                    }
                  } else if (data.type === 'USER_ACTION_REQUIRED') {
                    statusAreaEl.textContent = data.message;
                    currentRequestIdForRetry = data.requestId;
                    retryActionButton.style.display = 'block';
                  } else if (data.type === 'ERROR') {
                    statusAreaEl.textContent = `Error: ${data.message}`;
                    if (eventSource) eventSource.close();
                    return;
                  } else if (data.type === 'STREAM_END') {
                    statusAreaEl.textContent = 'Models finished responding.';
                    const finalMsgA = clientMessagesHistory.find(
                      (m) => m.role === 'assistant' && m.model === 'A' && m.content === ''
                    );
                    if (finalMsgA) finalMsgA.content = partialModelAResponse;
                    else if (partialModelAResponse)
                      clientMessagesHistory.push({
                        role: 'assistant',
                        model: 'A',
                        content: partialModelAResponse
                      });

                    const finalMsgB = clientMessagesHistory.find(
                      (m) => m.role === 'assistant' && m.model === 'B' && m.content === ''
                    );
                    if (finalMsgB) finalMsgB.content = partialModelBResponse;
                    else if (partialModelBResponse)
                      clientMessagesHistory.push({
                        role: 'assistant',
                        model: 'B',
                        content: partialModelBResponse
                      });
                  }
                  if (data.conversationId && !clientConversationId) {
                    clientConversationId = data.conversationId;
                    console.log('Conversation ID set:', clientConversationId);
                  }
                } catch (e) {
                  console.warn('Error parsing SSE data or non-JSON message:', message, e);
                }
              }
            }
          }
        } catch (error) {
          console.error('[ERROR] Error sending/streaming chat:', error);
          statusAreaEl.textContent = `Error: ${error.message}`;
        } finally {
          sendButton.disabled = false;
          loadingSpinner.style.display = 'none';
          console.debug('[DEBUG] Send button handler complete');
        }
      } catch (outerErr) {
        // Top-level error catch for entire handler
        statusAreaEl.textContent = `UI error: ${outerErr.message || outerErr}`;
        sendButton.disabled = false;
        loadingSpinner.style.display = 'none';
      }
    })();
  });

  retryActionButton.addEventListener('click', async () => {
    console.debug('[DEBUG] Retry action button clicked');
    if (!currentRequestIdForRetry) {
      statusAreaEl.textContent = 'No action to retry.';
      console.warn('[WARN] No requestId for retry');
      return;
    }
    statusAreaEl.textContent = 'Signaling backend to retry action...';
    retryActionButton.disabled = true;
    try {
      const response = await fetch('/api/trigger-retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: currentRequestIdForRetry })
      });
      const data = await response.json();
      if (response.ok) {
        statusAreaEl.textContent =
          data.message +
          ' Waiting for LMArena... (The previous stream should resume or a new one start if retry is processed)';
      } else {
        statusAreaEl.textContent = `Retry signal failed: ${data.error}`;
        console.error('[ERROR] Retry signal failed:', data.error);
      }
    } catch (error) {
      statusAreaEl.textContent = `Error sending retry signal: ${error.message}`;
      console.error('[ERROR] Error sending retry:', error);
    } finally {
      retryActionButton.style.display = 'none';
      retryActionButton.disabled = false;
      currentRequestIdForRetry = null;
    }
  });
});
