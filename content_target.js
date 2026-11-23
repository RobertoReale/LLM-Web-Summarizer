// content_target.js — Auto-injects queued prompts into LLM web interfaces (ChatGPT, Claude, Gemini, Perplexity).

if (typeof window.__llm_summarizer_target_started === 'undefined') {
  window.__llm_summarizer_target_started = true;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVisible(el) {
    if (!el) return false;
    return el.offsetParent !== null || el.getClientRects().length > 0;
  }

  function queryFirstVisible(selectors) {
    for (const sel of selectors || []) {
      try {
        const el = document.querySelector(sel);
        if (isVisible(el) && !el.disabled && !el.readOnly) return el;
      } catch {
        // Ignore invalid custom CSS selector from user options
      }
    }
    return null;
  }

  function waitForInput(selectors, timeoutMs = 15000) {
    return new Promise((resolve) => {
      const existing = queryFirstVisible(selectors);
      if (existing) return resolve(existing);

      let settled = false;
      const finish = (el) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        obs.disconnect();
        resolve(el);
      };

      const obs = new MutationObserver(() => {
        const found = queryFirstVisible(selectors);
        if (found) finish(found);
      });
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

      const timer = setTimeout(() => {
        let found = queryFirstVisible(selectors);
        if (!found) {
          // Heuristic fallback if the provider redesigned its composer
          const candidates = document.querySelectorAll(
            'textarea, [contenteditable="true"][role="textbox"], [contenteditable="true"]'
          );
          for (const candidate of candidates) {
            if (isVisible(candidate) && !candidate.readOnly && !candidate.disabled) {
              found = candidate;
              break;
            }
          }
        }
        finish(found);
      }, timeoutMs);
    });
  }

  function readInputText(el) {
    if (!el) return '';
    if ('value' in el && typeof el.value === 'string') return el.value;
    return el.innerText || el.textContent || '';
  }

  function inputContainsText(el, text) {
    const current = readInputText(el).trim();
    if (!current) return false;
    const probe = text.trim().slice(0, 32);
    if (probe.length <= 8) return current.includes(probe);
    return current.includes(probe.slice(0, 16)) || current.length >= Math.min(text.length * 0.5, 40);
  }

  function countAttachments(attachmentSelectors) {
    let total = 0;
    for (const sel of attachmentSelectors || []) {
      try {
        total += document.querySelectorAll(sel).length;
      } catch {
        // ignore invalid selector
      }
    }
    return total;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function clearInput(el) {
    if (!el) return;
    try {
      if ('value' in el && typeof el.value === 'string') {
        setNativeValue(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      el.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand('delete')) {
        el.textContent = '';
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } catch {
      // ignore
    }
  }

  function pasteText(el, text) {
    // Method 1: Synthetic ClipboardEvent (ProseMirror / Lexical / Quill / React editors)
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const ev = new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });
      // Firefox/Gecko leaves ev.clipboardData empty when passed to constructor
      if (!ev.clipboardData || ev.clipboardData.getData('text/plain') !== text) {
        try {
          Object.defineProperty(ev, 'clipboardData', { value: dt, configurable: true });
        } catch {
          // ignore
        }
      }
      const notCancelled = el.dispatchEvent(ev);
      if (!notCancelled) return true;
    } catch {
      // continue to fallback
    }

    // Method 2: execCommand('insertText') fallback
    try {
      el.focus();
      if (document.execCommand('insertText', false, text)) return true;
    } catch {
      // continue to fallback
    }

    // Method 3: Native value setter for React-controlled <textarea>/<input> or textContent
    try {
      if ('value' in el && typeof el.value === 'string') {
        setNativeValue(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  }

  async function waitForLanded(selectors, el, text, attachmentBaseline, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (inputContainsText(el, text)) return { input: el, attached: false };
      for (const sel of selectors.inputs || []) {
        try {
          const alt = document.querySelector(sel);
          if (alt && alt !== el && inputContainsText(alt, text)) {
            return { input: alt, attached: false };
          }
        } catch {
          // ignore
        }
      }
      if (countAttachments(selectors.attachments) > attachmentBaseline) {
        return { input: el, attached: true };
      }
      await sleep(200);
    }
    return null;
  }

  async function submitForm(inputEl, submitSelectors) {
    // Poll briefly for the Send button to mount & enable after paste
    const deadline = Date.now() + 3500;
    while (Date.now() < deadline) {
      for (const sel of submitSelectors || []) {
        try {
          const btn = document.querySelector(sel);
          if (btn && isVisible(btn) && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
            btn.click();
            return true;
          }
        } catch {
          // ignore
        }
      }
      await sleep(200);
    }

    // Fallback: Enter key + form submit
    if (inputEl) {
      inputEl.focus();
      const keyOpts = {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true,
      };
      inputEl.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', keyOpts));
      const form = inputEl.closest('form');
      if (form) {
        try {
          form.requestSubmit();
        } catch {
          // ignore
        }
      }
      return true;
    }
    return false;
  }

  function showFallbackBanner(text) {
    if (!document.body) return;
    let host = document.getElementById('llm-summarizer-fallback-host');
    if (host) host.remove();

    host = document.createElement('div');
    host.id = 'llm-summarizer-fallback-host';
    Object.assign(host.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      zIndex: '2147483647',
    });
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const card = document.createElement('div');
    card.setAttribute('role', 'alert');
    card.style.cssText = [
      'background: #1e293b',
      'color: #f8fafc',
      'border: 1px solid #ef4444',
      'border-left: 4px solid #ef4444',
      'border-radius: 10px',
      'padding: 14px 16px',
      'max-width: 340px',
      'box-shadow: 0 8px 24px rgba(0,0,0,0.35)',
      'font-family: system-ui, -apple-system, sans-serif',
      'font-size: 13px',
      'line-height: 1.45',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-weight: 700; margin-bottom: 6px; font-size: 14px;';
    title.textContent = chrome.i18n.getMessage('extensionName') || 'LLM Web-Summarizer';

    const msg = document.createElement('div');
    msg.style.cssText = 'margin-bottom: 10px; color: #cbd5e1;';
    msg.textContent =
      chrome.i18n.getMessage('fallbackPasteMsg') ||
      'Automatic paste failed. Click below to copy the prompt, then press Ctrl+V (or Cmd+V).';

    const row = document.createElement('div');
    row.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.textContent = chrome.i18n.getMessage('fallbackCopyBtn') || 'Copy Prompt';
    copyBtn.style.cssText = [
      'background: #3b82f6',
      'color: #ffffff',
      'border: none',
      'border-radius: 6px',
      'padding: 6px 12px',
      'font-size: 12px',
      'font-weight: 600',
      'cursor: pointer',
    ].join(';');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = chrome.i18n.getMessage('copiedLabel') || 'Copied!';
        chrome.runtime.sendMessage({ action: 'completePendingInjection' }).catch(() => {});
        setTimeout(() => host.remove(), 1800);
      } catch {
        copyBtn.textContent = 'Error';
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = chrome.i18n.getMessage('closeLabel') || 'Close';
    closeBtn.style.cssText = [
      'background: transparent',
      'color: #cbd5e1',
      'border: 1px solid #475569',
      'border-radius: 6px',
      'padding: 6px 10px',
      'font-size: 12px',
      'cursor: pointer',
    ].join(';');
    closeBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'completePendingInjection' }).catch(() => {});
      host.remove();
    });

    row.appendChild(copyBtn);
    row.appendChild(closeBtn);
    card.appendChild(title);
    card.appendChild(msg);
    card.appendChild(row);
    shadow.appendChild(card);

    // Best-effort silent clipboard copy (may be blocked without user gesture, hence the button)
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        msg.textContent =
          chrome.i18n.getMessage('fallbackCopiedAutoMsg') ||
          'Automatic paste failed. Prompt copied to clipboard — press Ctrl+V (or Cmd+V).';
      })
      .catch(() => {});

    setTimeout(() => {
      if (host.isConnected) {
        chrome.runtime.sendMessage({ action: 'completePendingInjection' }).catch(() => {});
        host.remove();
      }
    }, 20000);
  }

  function isLikelyAuthPage() {
    const host = (location.hostname || '').toLowerCase();
    const path = (location.pathname || '').toLowerCase();
    if (host === 'accounts.google.com' || host.startsWith('auth.')) return true;
    return /^\/(?:login|signin|sign-in|auth|oauth|sso)(?:\/|$)/i.test(path);
  }

  async function injectPayload() {
    // Wait silently if redirected to a login/auth page; keep pendingInjection intact
    // so injection runs cleanly once the user signs in and returns to the chat composer.
    if (isLikelyAuthPage()) return;

    let response;
    try {
      response = await chrome.runtime.sendMessage({ action: 'claimPendingInjection' });
    } catch {
      return;
    }

    const payload = response?.payload;
    const selectors = response?.selectors;
    if (!payload || !payload.text || !selectors) return;

    const { text, autoSubmit } = payload;
    let input = await waitForInput(selectors.inputs, 15000);
    if (!input) {
      showFallbackBanner(text);
      return;
    }

    let landed = null;
    for (let attempt = 0; attempt < 2 && !landed; attempt++) {
      if (attempt > 0) {
        input = queryFirstVisible(selectors.inputs) || input;
        clearInput(input);
        await sleep(300);
      }
      const baseline = countAttachments(selectors.attachments);
      input.focus();
      await sleep(350);
      pasteText(input, text);
      landed = await waitForLanded(selectors, input, text, baseline, 4000);
    }

    await chrome.runtime.sendMessage({ action: 'completePendingInjection' }).catch(() => {});

    if (!landed) {
      showFallbackBanner(text);
      return;
    }

    if (autoSubmit) {
      await sleep(400);
      await submitForm(landed.input, selectors.submits);
    }
  }

  injectPayload();
}
