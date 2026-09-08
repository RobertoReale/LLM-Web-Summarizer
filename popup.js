document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const capturePageBtn = document.getElementById('capture-page-btn');
  const captureSelectionBtn = document.getElementById('capture-selection-btn');
  const clearQueueBtn = document.getElementById('clear-queue-btn');
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

  // Load state
  let state = {
    textQueue: [],
    selectedPrompt: 'Riassumi Brevemente',
    customPromptText: '',
    targetLLM: 'chatgpt',
    executionMode: 'web'
  };

  try {
    const res = await chrome.storage.local.get(null);
    if (res.textQueue) state.textQueue = res.textQueue;
    if (res.selectedPrompt) state.selectedPrompt = res.selectedPrompt;
    if (res.customPromptText) state.customPromptText = res.customPromptText;
    if (res.targetLLM) state.targetLLM = res.targetLLM;
    if (res.executionMode) state.executionMode = res.executionMode;
  } catch (e) {
    console.error("Failed to load state", e);
  }

  // Init UI
  promptType.value = state.selectedPrompt;
  customPrompt.value = state.customPromptText;
  targetLlm.value = state.targetLLM;
  const activeRadio = document.querySelector(`input[name="execution-mode"][value="${state.executionMode}"]`);
  if (activeRadio) activeRadio.checked = true;
  updateUI();

  // Save state helper
  const saveState = async () => {
    await chrome.storage.local.set(state);
    updateUI();
  };

  // UI Event Listeners
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

  // Capture helpers
  const injectAndCall = async (method) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      
      const response = await chrome.tabs.sendMessage(tab.id, { action: method });
      if (response && response.text) {
        state.textQueue.push(response.text);
        await saveState();
      } else {
        // Fallback injection if not already loaded
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content_source.js']
        });
        const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: method });
        if (retryResponse && retryResponse.text) {
          state.textQueue.push(retryResponse.text);
          await saveState();
        }
      }
    } catch (e) {
      console.error("Injection failed", e);
      // Ensure we inject if sending fails
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
         await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content_source.js']
        });
        const retryResponse = await chrome.tabs.sendMessage(tab.id, { action: method }).catch(()=>({}));
        if (retryResponse && retryResponse.text) {
          state.textQueue.push(retryResponse.text);
          await saveState();
        }
      }
    }
  };

  capturePageBtn.addEventListener('click', () => injectAndCall('getPageText'));
  captureSelectionBtn.addEventListener('click', () => injectAndCall('getSelection'));

  clearQueueBtn.addEventListener('click', () => {
    state.textQueue = [];
    saveState();
  });

  // Submit
  submitBtn.addEventListener('click', async () => {
    if (state.textQueue.length === 0) {
      alert("La coda è vuota. Cattura del testo prima di inviare.");
      return;
    }

    const fullText = state.textQueue.join('\n\n---\n\n');
    let prompt = state.selectedPrompt === 'custom' ? state.customPromptText : state.selectedPrompt;
    const finalPayload = `${prompt}\n\nTesto:\n${fullText}`;

    if (state.executionMode === 'web') {
      submitBtn.textContent = 'Apertura Web Mode...';
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

  // Copy API output
  copyOutputBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(apiOutput.innerText);
    copyOutputBtn.textContent = 'Copiato!';
    setTimeout(() => copyOutputBtn.textContent = 'Copia Tutto', 2000);
  });

  // Listen for updates from background (e.g. shortcut triggered)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.textQueue) {
      state.textQueue = changes.textQueue.newValue || [];
      updateUI();
    }
  });

  function updateUI() {
    customPromptContainer.classList.toggle('hidden', state.selectedPrompt !== 'custom');
    queueCounter.textContent = `Elementi in coda: ${state.textQueue.length}`;
    
    const totalChars = state.textQueue.reduce((acc, text) => acc + text.length, 0);
    const estimatedTokens = Math.floor(totalChars / 4);
    lengthText.textContent = `${totalChars.toLocaleString()} Caratteri / ~${estimatedTokens.toLocaleString()} Token`;
    
    // Progress bar (max 20000 chars roughly)
    const MAX_CHARS = 20000;
    let percentage = (totalChars / MAX_CHARS) * 100;
    if (percentage > 100) percentage = 100;
    lengthProgress.style.width = `${percentage}%`;

    if (totalChars > 15000) {
      lengthProgress.style.backgroundColor = 'var(--danger-color)';
      lengthWarning.classList.remove('hidden');
    } else if (totalChars > 10000) {
      lengthProgress.style.backgroundColor = 'var(--warning-color)';
      lengthWarning.classList.add('hidden');
    } else {
      lengthProgress.style.backgroundColor = 'var(--primary-color)';
      lengthWarning.classList.add('hidden');
    }
  }
});
