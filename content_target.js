// content_target.js - Inietta il prompt nelle UI degli LLM

async function injectPayload() {
  const { pendingInjection } = await chrome.storage.local.get('pendingInjection');
  if (!pendingInjection) return;
  
  // TTL of 5 minutes to avoid pasting old stuff
  if (Date.now() - pendingInjection.timestamp > 5 * 60 * 1000) {
    await chrome.storage.local.remove('pendingInjection');
    return;
  }

  const { text, target } = pendingInjection;

  const { customSelectors } = await chrome.storage.local.get('customSelectors');
  
  // Configuration per target
  const defaultConfigs = {
    chatgpt: {
      inputs: ['#prompt-textarea', '[contenteditable="true"][data-testid]', '.ProseMirror', 'textarea'],
    },
    claude: {
      inputs: ['[contenteditable="true"].ProseMirror', 'fieldset [contenteditable="true"]'],
    },
    gemini: {
      inputs: ['rich-textarea [contenteditable="true"]', '.ql-editor', 'textarea'],
    },
    perplexity: {
      inputs: ['textarea[placeholder*="Ask"]', 'textarea']
    }
  };

  const configs = customSelectors || defaultConfigs;
  const cfg = configs[target] || defaultConfigs.chatgpt;
  
  // Wait for input to be ready
  const input = await waitForInput(cfg.inputs, 15000);
  if (!input) {
    console.error("LLM Web-Summarizer: Impossibile trovare l'area di testo per", target);
    return;
  }

  // Focus
  input.focus();
  await new Promise(r => setTimeout(r, 500));

  // Incolla
  const success = pasteText(input, text);
  if (success) {
    console.log("LLM Web-Summarizer: Testo incollato con successo.");
    await chrome.storage.local.remove('pendingInjection');
  } else {
    console.error("LLM Web-Summarizer: Fallita simulazione incolla.");
  }
}

function waitForInput(selectors, timeoutMs) {
  return new Promise((resolve) => {
    const find = () => {
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) return el;
      }
      return null;
    };

    const el = find();
    if (el) return resolve(el);

    let timer = null;
    const obs = new MutationObserver(() => {
      const found = find();
      if (found) { clearTimeout(timer); obs.disconnect(); resolve(found); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(() => { obs.disconnect(); resolve(find()); }, timeoutMs);
  });
}

function pasteText(el, text) {
  // Method 1: ClipboardEvent (React/ProseMirror/Lexical usually handle this)
  try {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    
    if (!ev.clipboardData || ev.clipboardData.getData('text/plain') !== text) {
      try { Object.defineProperty(ev, 'clipboardData', { value: dt, configurable: true }); } catch (_) {}
    }
    
    const notCancelled = el.dispatchEvent(ev);
    if (!notCancelled) return true; 
  } catch (_) {}

  // Method 2: execCommand fallback
  try { 
    if (document.execCommand('insertText', false, text)) return true; 
  } catch (_) {}

  // Method 3: plain textarea/input fallback
  try {
    if ('value' in el) {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    } else {
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
  } catch (_) {}
  
  return false;
}

// Avvia iniezione all'avvio dello script
injectPayload();
