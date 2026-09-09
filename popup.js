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

  // --- State ---
  let state = {
    textQueue: [],
    selectedPrompt: 'promptShort',
    customPromptText: '',
    targetLLM: 'chatgpt',
    executionMode: 'web',
    isDarkMode: false,
    autoSubmit: true
  };

  try {
    const res = await chrome.storage.local.get(null);
    if (res.textQueue) state.textQueue = res.textQueue;
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
    // Prompt config
    if (state.selectedPrompt === 'custom') {
      customPromptContainer.classList.remove('hidden');
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
    saveState();
  });

  customPrompt.addEventListener('input', (e) => {
    state.customPromptText = e.target.value;
    debouncedSaveState();
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
    let promptValue = state.selectedPrompt === 'custom' 
      ? state.customPromptText 
      : chrome.i18n.getMessage(state.selectedPrompt) || state.selectedPrompt;
    
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
              messages: [{ role: 'user', content: finalPayload }]
            })
          });
          const json = await res.json();
          if (json.error) throw new Error(json.error.message);
          responseText = json.choices[0].message.content;
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
              messages: [{ role: 'user', content: finalPayload }]
            })
          });
          const json = await res.json();
          if (json.error) throw new Error(json.error.message);
          responseText = json.content[0].text;
        } else if (state.targetLLM === 'gemini') {
          if (!apiKeys.gemini) throw new Error("API Key Gemini mancante. Configurala nelle Opzioni.");
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKeys.gemini}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: finalPayload }] }]
            })
          });
          const json = await res.json();
          if (json.error) throw new Error(json.error.message);
          responseText = json.candidates[0].content.parts[0].text;
        } else {
          throw new Error("L'integrazione API per " + state.targetLLM + " non è supportata in questa versione.");
        }

        if (typeof marked !== 'undefined') {
          apiOutput.innerHTML = marked.parse(responseText);
        } else {
          apiOutput.innerText = responseText;
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
