document.addEventListener('DOMContentLoaded', async () => {
  // --- i18n Localization ---
  const localizeUI = () => {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
      if (msg) {
        // Special case for option elements inside select
        if (el.tagName === 'OPTION') {
          el.innerText = msg;
        } else {
          el.innerHTML = msg;
        }
      }
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
      if (msg) el.setAttribute('placeholder', msg);
    });
  };
  localizeUI();

  // --- Elements ---
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const capturePageBtn = document.getElementById('capture-page-btn');
  const captureSelectionBtn = document.getElementById('capture-selection-btn');
  const clearQueueBtn = document.getElementById('clear-queue-btn');
  const viewQueueBtn = document.getElementById('view-queue-btn');
  const queueViewerContainer = document.getElementById('queue-viewer-container');
  const queueEditor = document.getElementById('queue-editor');
  
  const queueCounter = document.getElementById('queue-counter');
  const lengthProgress = document.getElementById('length-progress');
  const lengthText = document.getElementById('length-text');
  const lengthWarning = document.getElementById('length-warning');
  
  const promptType = document.getElementById('prompt-type');
  const customPromptContainer = document.getElementById('custom-prompt-container');
  const customPrompt = document.getElementById('custom-prompt');
  const targetLlm = document.getElementById('target-llm');
  const modeRadios = document.querySelectorAll('input[name="execution-mode"]');
  const autosubmitContainer = document.getElementById('autosubmit-container');
  const autosubmitCb = document.getElementById('autosubmit-cb');
  
  const submitBtn = document.getElementById('submit-btn');
  const apiOutputContainer = document.getElementById('api-output-container');
  const apiOutput = document.getElementById('api-output');
  const copyOutputBtn = document.getElementById('copy-output-btn');
  const savePromptBtn = document.getElementById('save-prompt-btn');
  const deletePromptBtn = document.getElementById('delete-prompt-btn');

  // --- State ---
  let state = {
    textQueue: [],
    selectedPrompt: 'promptShort',
    customPromptText: '',
    savedPrompts: [], // {id, name, text}
    targetLLM: 'chatgpt',
    executionMode: 'web',
    isDarkMode: false,
    autoSubmit: true
  };

  try {
    const res = await chrome.storage.local.get(null);
    if (res.textQueue) state.textQueue = res.textQueue;
    if (res.savedPrompts) state.savedPrompts = res.savedPrompts;
    if (res.selectedPrompt) state.selectedPrompt = res.selectedPrompt;
    if (res.customPromptText) state.customPromptText = res.customPromptText;
    if (res.targetLLM) state.targetLLM = res.targetLLM;
    if (res.executionMode) state.executionMode = res.executionMode;
    if (res.autoSubmit !== undefined) state.autoSubmit = res.autoSubmit;
    if (res.isDarkMode !== undefined) {
      state.isDarkMode = res.isDarkMode;
    } else {
      // Default to white theme as requested
      state.isDarkMode = false;
    }
  } catch (e) {
    console.error("Failed to load state", e);
  }

  // --- Theme Management ---
  const applyTheme = (isDark) => {
    if (isDark) {
      document.body.classList.add('dark');
      themeToggleBtn.innerText = '☀️';
    } else {
      document.body.classList.remove('dark');
      themeToggleBtn.innerText = '🌙';
    }
  };
  applyTheme(state.isDarkMode);

  themeToggleBtn.addEventListener('click', () => {
    state.isDarkMode = !state.isDarkMode;
    applyTheme(state.isDarkMode);
    chrome.storage.local.set({ isDarkMode: state.isDarkMode });
  });

  // --- Init UI ---
  promptType.value = state.selectedPrompt;
  customPrompt.value = state.customPromptText;
  targetLlm.value = state.targetLLM;
  const activeRadio = document.querySelector(`input[name="execution-mode"][value="${state.executionMode}"]`);
  if (activeRadio) activeRadio.checked = true;
  if (autosubmitCb) autosubmitCb.checked = state.autoSubmit;

  const updateUI = () => {
    // Populate dropdown with saved prompts
    // Keep first 3 fixed (Short, Detailed, Custom), then add saved ones
    while (promptType.options.length > 3) {
      promptType.remove(3);
    }
    state.savedPrompts.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.text = p.name;
      promptType.add(opt);
    });
    promptType.value = state.selectedPrompt;

    // Prompt config
    if (state.selectedPrompt === 'custom' || state.selectedPrompt.startsWith('saved_')) {
      customPromptContainer.classList.remove('hidden');
      if (state.selectedPrompt.startsWith('saved_')) {
        const p = state.savedPrompts.find(x => x.id === state.selectedPrompt);
        if (p) customPrompt.value = p.text;
        deletePromptBtn.classList.remove('hidden');
      } else {
        customPrompt.value = state.customPromptText;
        deletePromptBtn.classList.add('hidden');
      }
    } else {
      customPromptContainer.classList.add('hidden');
    }

    if (state.executionMode === 'web') {
      autosubmitContainer.classList.remove('hidden');
    } else {
      autosubmitContainer.classList.add('hidden');
    }

    // Queue status
    const countMsg = chrome.i18n.getMessage('queueStatus') || 'Elementi in coda: ';
    queueCounter.innerText = `${countMsg}${state.textQueue.length}`;
    
    // Editor syncing
    const fullText = state.textQueue.join('\n\n---\n\n');
    if (document.activeElement !== queueEditor) {
      queueEditor.value = fullText;
    }

    // Token math (approssimazione: 1 token = 4 caratteri)
    const charCount = fullText.length;
    const tokenCount = Math.floor(charCount / 4);
    
    const charMsg = chrome.i18n.getMessage('charCount') || 'Caratteri';
    const tokenMsg = chrome.i18n.getMessage('tokenCount') || 'Token';
    lengthText.innerText = `${charCount.toLocaleString()} ${charMsg} / ~${tokenCount.toLocaleString()} ${tokenMsg}`;

    // Web mode limits warning (approx 12k tokens max for safety)
    const MAX_TOKENS = 12000; 
    const percentage = Math.min((tokenCount / MAX_TOKENS) * 100, 100);
    lengthProgress.style.width = `${percentage}%`;

    if (percentage > 80) {
      lengthProgress.style.backgroundColor = 'var(--warning-color)';
    } else {
      lengthProgress.style.backgroundColor = 'var(--primary-color)';
    }

    if (tokenCount > MAX_TOKENS && state.executionMode === 'web') {
      lengthWarning.classList.remove('hidden');
      lengthProgress.style.backgroundColor = 'var(--danger-color)';
    } else {
      lengthWarning.classList.add('hidden');
    }
  };
  updateUI();

  // Save state helper
  const saveState = async () => {
    await chrome.storage.local.set(state);
    updateUI();
  };

  const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  };

  const debouncedSaveState = debounce(saveState, 500);

  // Listen to storage changes from background.js (e.g., Context Menus)
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.textQueue) {
      state.textQueue = changes.textQueue.newValue || [];
      updateUI();
    }
  });

  // --- UI Event Listeners ---
  promptType.addEventListener('change', (e) => {
    state.selectedPrompt = e.target.value;
    if (state.selectedPrompt === 'custom') {
      state.customPromptText = customPrompt.value;
    }
    saveState();
  });

  customPrompt.addEventListener('input', (e) => {
    if (state.selectedPrompt === 'custom') {
      state.customPromptText = e.target.value;
    } else if (state.selectedPrompt.startsWith('saved_')) {
      const p = state.savedPrompts.find(x => x.id === state.selectedPrompt);
      if (p) p.text = e.target.value;
    }
    debouncedSaveState();
  });

  savePromptBtn.addEventListener('click', () => {
    const text = customPrompt.value.trim();
    if (!text) return;
    if (state.selectedPrompt === 'custom') {
      const name = prompt("Nome del nuovo prompt:");
      if (!name) return;
      const newPrompt = { id: 'saved_' + Date.now(), name, text };
      state.savedPrompts.push(newPrompt);
      state.selectedPrompt = newPrompt.id;
    } else if (state.selectedPrompt.startsWith('saved_')) {
      const p = state.savedPrompts.find(x => x.id === state.selectedPrompt);
      if (p) p.text = text;
      alert("Prompt aggiornato!");
    }
    saveState();
  });

  deletePromptBtn.addEventListener('click', () => {
    if (state.selectedPrompt.startsWith('saved_') && confirm("Vuoi davvero eliminare questo prompt?")) {
      state.savedPrompts = state.savedPrompts.filter(x => x.id !== state.selectedPrompt);
      state.selectedPrompt = 'custom';
      saveState();
    }
  });

  targetLlm.addEventListener('change', (e) => {
    state.targetLLM = e.target.value;
    saveState();
  });

  modeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      state.executionMode = e.target.value;
      saveState();
    });
  });

  autosubmitCb.addEventListener('change', (e) => {
    state.autoSubmit = e.target.checked;
    saveState();
  });

  // Queue Viewer
  viewQueueBtn.addEventListener('click', () => {
    const isHidden = queueViewerContainer.classList.contains('hidden');
    if (isHidden) {
      queueViewerContainer.classList.remove('hidden');
      viewQueueBtn.innerText = chrome.i18n.getMessage('hideQueue') || 'Nascondi';
    } else {
      queueViewerContainer.classList.add('hidden');
      viewQueueBtn.innerText = chrome.i18n.getMessage('viewQueue') || 'Visualizza';
    }
  });

  queueEditor.addEventListener('input', (e) => {
    // If the user edits manually, we flatten the queue to a single item
    state.textQueue = e.target.value.trim() ? [e.target.value] : [];
    debouncedSaveState();
  });

  clearQueueBtn.addEventListener('click', () => {
    state.textQueue = [];
    saveState();
  });

  // --- Capture helpers ---
  const injectAndCall = async (method) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      
      const check = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          hasReadability: typeof Readability !== 'undefined',
          hasTurndown: typeof TurndownService !== 'undefined',
          hasContentSource: typeof window.__llm_summarizer_injected !== 'undefined'
        })
      });
      
      const status = check[0]?.result || {};
      const filesToInject = [];
      if (!status.hasReadability) filesToInject.push('lib/Readability.js');
      if (!status.hasTurndown) filesToInject.push('lib/turndown.js');
      if (!status.hasContentSource) filesToInject.push('content_source.js');

      if (filesToInject.length > 0) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: filesToInject
        });
      }
      
      const response = await chrome.tabs.sendMessage(tab.id, { action: method });
      if (response && response.text) {
        state.textQueue.push(response.text);
        await saveState();
      }
    } catch (e) {
      console.error("Injection failed", e);
    }
  };

  capturePageBtn.addEventListener('click', () => injectAndCall('getPageText'));
  captureSelectionBtn.addEventListener('click', () => injectAndCall('getSelection'));

  // --- Submit ---
  submitBtn.addEventListener('click', async () => {
    if (state.textQueue.length === 0) {
      alert(chrome.i18n.getMessage('queueEmpty') || "La coda è vuota. Cattura del testo prima di inviare.");
      return;
    }

    const fullText = state.textQueue.join('\n\n---\n\n');
    let promptValue = "";
    if (state.selectedPrompt === 'custom') {
      promptValue = state.customPromptText;
    } else if (state.selectedPrompt.startsWith('saved_')) {
      const p = state.savedPrompts.find(x => x.id === state.selectedPrompt);
      promptValue = p ? p.text : "";
    } else {
      promptValue = chrome.i18n.getMessage(state.selectedPrompt) || state.selectedPrompt;
    }
    
    const textLabel = chrome.i18n.getMessage('textLabel') || "Testo:";
    const finalPayload = `${promptValue}\n\n${textLabel}\n${fullText}`;

    if (state.executionMode === 'web') {
      submitBtn.textContent = chrome.i18n.getMessage('submitBtnLoading') || 'Apertura Web Mode...';
      submitBtn.disabled = true;
      chrome.runtime.sendMessage({ action: 'triggerWebMode', payload: finalPayload, target: state.targetLLM, autoSubmit: state.autoSubmit });
      setTimeout(() => window.close(), 1000);
    } else {
      // API Mode 
      apiOutputContainer.classList.remove('hidden');
      apiOutput.innerHTML = "<em>Elaborazione in corso...</em>";
      submitBtn.disabled = true;

      try {
        const data = await chrome.storage.local.get('apiKeys');
        const apiKeys = data.apiKeys || {};
        
        let responseText = "";

        const renderStream = async (reader, decoder, processChunk) => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            responseText += processChunk(chunk);
            if (typeof marked !== 'undefined') {
              apiOutput.innerHTML = marked.parse(responseText);
            } else {
              apiOutput.innerText = responseText;
            }
          }
        };

        if (state.targetLLM === 'chatgpt') {
          if (!apiKeys.openai) throw new Error("API Key OpenAI mancante. Configurala nelle Opzioni.");
          const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKeys.openai}`
            },
            body: JSON.stringify({
              model: 'gpt-3.5-turbo',
              messages: [{ role: 'user', content: finalPayload }],
              stream: true
            })
          });
          if (!res.ok) throw new Error("Errore API OpenAI");
          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          await renderStream(reader, decoder, (chunk) => {
            let addedText = "";
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ') && line.trim() !== 'data: [DONE]') {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.choices[0].delta.content) {
                    addedText += data.choices[0].delta.content;
                  }
                } catch(e) {}
              }
            }
            return addedText;
          });
        } else if (state.targetLLM === 'claude') {
          if (!apiKeys.anthropic) throw new Error("API Key Anthropic mancante. Configurala nelle Opzioni.");
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': apiKeys.anthropic,
              'anthropic-version': '2023-06-01',
              'anthropic-dangerously-allow-browser': 'true'
            },
            body: JSON.stringify({
              model: 'claude-3-haiku-20240307',
              max_tokens: 1024,
              messages: [{ role: 'user', content: finalPayload }],
              stream: true
            })
          });
          if (!res.ok) throw new Error("Errore API Anthropic");
          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          await renderStream(reader, decoder, (chunk) => {
            let addedText = "";
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.type === 'content_block_delta' && data.delta.text) {
                    addedText += data.delta.text;
                  }
                } catch(e) {}
              }
            }
            return addedText;
          });
        } else if (state.targetLLM === 'gemini') {
          if (!apiKeys.gemini) throw new Error("API Key Gemini mancante. Configurala nelle Opzioni.");
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?alt=sse&key=${apiKeys.gemini}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: finalPayload }] }]
            })
          });
          if (!res.ok) throw new Error("Errore API Gemini");
          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          await renderStream(reader, decoder, (chunk) => {
            let addedText = "";
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.substring(6));
                  if (data.candidates && data.candidates[0].content.parts[0].text) {
                    addedText += data.candidates[0].content.parts[0].text;
                  }
                } catch(e) {}
              }
            }
            return addedText;
          });
        } else if (state.targetLLM === 'local') {
          const url = apiKeys.localUrl || 'http://localhost:11434/api/generate';
          // Se usa LM Studio /v1/chat/completions, usa il formato OpenAI
          const isLMApi = url.includes('/v1/chat/completions');
          const payload = isLMApi 
            ? { messages: [{ role: 'user', content: finalPayload }], stream: true }
            : { model: 'llama3', prompt: finalPayload, stream: true }; // Formato Ollama di default
            
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          if (!res.ok) throw new Error("Errore chiamata Local LLM");
          const reader = res.body.getReader();
          const decoder = new TextDecoder("utf-8");
          await renderStream(reader, decoder, (chunk) => {
            let addedText = "";
            const lines = chunk.split('\n');
            for (const line of lines) {
              const cleanedLine = line.startsWith('data: ') ? line.substring(6) : line;
              if (cleanedLine.trim() && cleanedLine.trim() !== '[DONE]') {
                try {
                  const data = JSON.parse(cleanedLine);
                  if (data.response) addedText += data.response; // Ollama
                  if (data.choices && data.choices[0].delta && data.choices[0].delta.content) addedText += data.choices[0].delta.content; // LM Studio
                } catch(e) {}
              }
            }
            return addedText;
          });
        } else {
          throw new Error("L'integrazione API per " + state.targetLLM + " non è supportata in questa versione.");
        }
      } catch (err) {
        apiOutput.innerHTML = `<span style="color: red;">Errore: ${err.message}</span>`;
      } finally {
        submitBtn.disabled = false;
      }
    }
  });

  copyOutputBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(apiOutput.innerText);
    const origText = copyOutputBtn.innerText;
    copyOutputBtn.innerText = 'Copiato!';
    setTimeout(() => copyOutputBtn.innerText = origText, 2000);
  });
});
