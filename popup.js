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
  
  const submitBtn = document.getElementById('submit-btn');
  const apiOutputContainer = document.getElementById('api-output-container');
  const apiOutput = document.getElementById('api-output');
  const copyOutputBtn = document.getElementById('copy-output-btn');

  // --- State ---
  let state = {
    textQueue: [],
    selectedPrompt: 'Riassumi Brevemente',
    customPromptText: '',
    targetLLM: 'chatgpt',
    executionMode: 'web',
    isDarkMode: true
  };

  try {
    const res = await chrome.storage.local.get(null);
    if (res.textQueue) state.textQueue = res.textQueue;
    if (res.selectedPrompt) state.selectedPrompt = res.selectedPrompt;
    if (res.customPromptText) state.customPromptText = res.customPromptText;
    if (res.targetLLM) state.targetLLM = res.targetLLM;
    if (res.executionMode) state.executionMode = res.executionMode;
    if (res.isDarkMode !== undefined) {
      state.isDarkMode = res.isDarkMode;
    } else {
      // Check system preference
      state.isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
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

  const updateUI = () => {
    // Prompt config
    if (state.selectedPrompt === 'custom') {
      customPromptContainer.classList.remove('hidden');
    } else {
      customPromptContainer.classList.add('hidden');
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
    saveState();
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
    saveState();
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
      
      // Inject scripts first (guarded inside content_source.js to prevent double listeners)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['lib/Readability.js', 'content_source.js']
      });
      
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
    let promptValue = state.selectedPrompt === 'custom' ? state.customPromptText : state.selectedPrompt;
    
    // We should translate the standard prompts if possible, but actually we pass them verbatim to the LLM. 
    // Wait, the standard prompts like "Riassumi Brevemente" are passed to LLM. Better pass the Italian string or let the user decide.
    // For now we pass the literal value.
    
    const finalPayload = `${promptValue}\n\nTesto:\n${fullText}`;

    if (state.executionMode === 'web') {
      submitBtn.textContent = chrome.i18n.getMessage('submitBtnLoading') || 'Apertura Web Mode...';
      submitBtn.disabled = true;
      chrome.runtime.sendMessage({ action: 'triggerWebMode', payload: finalPayload, target: state.targetLLM });
      setTimeout(() => window.close(), 1000);
    } else {
      // API Mode Placeholder
      apiOutputContainer.classList.remove('hidden');
      if (typeof marked !== 'undefined') {
        apiOutput.innerHTML = marked.parse("*L'integrazione API diretta non è configurata in questa demo.*\n\n**Payload preparato di " + finalPayload.length + " caratteri.**");
      } else {
        apiOutput.innerHTML = "<em>L'integrazione API diretta non è configurata in questa demo.</em><br>Payload preparato di " + finalPayload.length + " caratteri.";
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
