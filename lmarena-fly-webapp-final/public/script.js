document.addEventListener('DOMContentLoaded', () => {
    const systemPromptEl = document.getElementById('systemPrompt');
    const modelAIdEl = document.getElementById('modelAId');
    const modelBIdEl = document.getElementById('modelBId');
    const userPromptEl = document.getElementById('userPrompt');
    const sendButton = document.getElementById('sendButton');
    const newConversationButton = document.getElementById('newConversationButton');
    const retryActionButton = document.getElementById('retryActionButton');
    const statusAreaEl = document.getElementById('statusArea');
    const modelAResponseEl = document.getElementById('modelAResponse');
    const modelBResponseEl = document.getElementById('modelBResponse');
    const messageHistoryEl = document.getElementById('messageHistory');

    let clientConversationId = null;
    let clientMessagesHistory = [];
    let currentRequestIdForRetry = null;
    let eventSource = null;

    function generateClientUUID() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    }

    function displayMessageInHistory(role, content) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add(role === 'user' ? 'user-message' : 'assistant-message');
        const span = document.createElement('span');
        span.textContent = content;
        messageDiv.appendChild(span);
        messageHistoryEl.appendChild(messageDiv);
        messageHistoryEl.scrollTop = messageHistoryEl.scrollHeight;
    }

    newConversationButton.addEventListener('click', () => {
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
        console.log("New conversation initiated.");
    });

    sendButton.addEventListener('click', async () => {
        const userPrompt = userPromptEl.value.trim();
        if (!userPrompt) {
            statusAreaEl.textContent = 'User prompt cannot be empty.';
            return;
        }

        sendButton.disabled = true;
        retryActionButton.style.display = 'none';
        modelAResponseEl.textContent = '';
        modelBResponseEl.textContent = '';

        displayMessageInHistory('user', userPrompt);
        clientMessagesHistory.push({ role: 'user', content: userPrompt, id: generateClientUUID() });
        userPromptEl.value = '';

        const payload = {
            userPrompt,
            systemPrompt: systemPromptEl.value.trim(),
            targetModelA: modelAIdEl.value.trim(),
            targetModelB: modelBIdEl.value.trim(),
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
                const errData = await response.json().catch(() => ({ message: `HTTP error ${response.status}`}));
                throw new Error(errData.message || `Server error: ${response.status}`);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let partialModelAResponse = "";
            let partialModelBResponse = "";

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    statusAreaEl.textContent = 'Stream finished.';
                    clientMessagesHistory.push({ role: 'assistant', model: 'A', content: partialModelAResponse });
                    clientMessagesHistory.push({ role: 'assistant', model: 'B', content: partialModelBResponse });
                    break;
                }
                
                const chunk = decoder.decode(value, { stream: true });
                const messages = chunk.split('\n\n');
                for (const message of messages) {
                    if (message.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(message.substring(5).trim());

                            if (data.type === 'STATUS') {
                                statusAreaEl.textContent = data.message;
                            } else if (data.type === 'MODEL_CHUNK') {
                                if (data.modelKey === 'A') {
                                    partialModelAResponse += data.content || "";
                                    modelAResponseEl.textContent = partialModelAResponse;
                                } else if (data.modelKey === 'B') {
                                    partialModelBResponse += data.content || "";
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
                                if(eventSource) eventSource.close();
                                return;
                            } else if (data.type === 'STREAM_END') {
                                statusAreaEl.textContent = 'Models finished responding.';
                                const finalMsgA = clientMessagesHistory.find(m => m.role === 'assistant' && m.model === 'A' && m.content === "");
                                if (finalMsgA) finalMsgA.content = partialModelAResponse; else if(partialModelAResponse) clientMessagesHistory.push({role: 'assistant', model: 'A', content: partialModelAResponse});
                                
                                const finalMsgB = clientMessagesHistory.find(m => m.role === 'assistant' && m.model === 'B' && m.content === "");
                                if (finalMsgB) finalMsgB.content = partialModelBResponse; else if(partialModelBResponse) clientMessagesHistory.push({role: 'assistant', model: 'B', content: partialModelBResponse});
                            }
                            if (data.conversationId && !clientConversationId) {
                                clientConversationId = data.conversationId;
                                console.log("Conversation ID set:", clientConversationId);
                            }

                        } catch (e) {
                            console.warn('Error parsing SSE data or non-JSON message:', message, e);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Error sending/streaming chat:", error);
            statusAreaEl.textContent = `Error: ${error.message}`;
        } finally {
            sendButton.disabled = false;
        }
    });

    retryActionButton.addEventListener('click', async () => {
        if (!currentRequestIdForRetry) {
            statusAreaEl.textContent = "No action to retry.";
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
                statusAreaEl.textContent = data.message + " Waiting for LMArena... (The previous stream should resume or a new one start if retry is processed)";
            } else {
                statusAreaEl.textContent = `Retry signal failed: ${data.error}`;
            }
        } catch (error) {
            statusAreaEl.textContent = `Error sending retry signal: ${error.message}`;
        } finally {
            retryActionButton.style.display = 'none';
            retryActionButton.disabled = false;
            currentRequestIdForRetry = null;
        }
    });
});