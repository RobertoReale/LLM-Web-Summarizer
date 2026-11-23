// content_source.js — Extracts page content or selected text from the active tab.

if (typeof window.__llm_summarizer_source_injected === 'undefined') {
  window.__llm_summarizer_source_injected = true;

  const MAX_OVERLAY_CHARS = 1500;
  const PROTECTED_TAGS = new Set(['HTML', 'BODY', 'MAIN', 'ARTICLE']);

  function showToast(message) {
    if (!document.body) return;
    let host = document.getElementById('llm-summarizer-toast-host');
    let toast;

    if (!host) {
      host = document.createElement('div');
      host.id = 'llm-summarizer-toast-host';
      Object.assign(host.style, {
        position: 'fixed',
        bottom: '20px',
        right: '20px',
        zIndex: '2147483647',
        pointerEvents: 'none',
      });
      document.body.appendChild(host);

      const shadow = host.attachShadow({ mode: 'open' });
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.style.cssText = [
        'background-color: #1e293b',
        'color: #f8fafc',
        'padding: 12px 18px',
        'border-radius: 8px',
        'box-shadow: 0 6px 20px rgba(0,0,0,0.22)',
        'font-family: system-ui, -apple-system, sans-serif',
        'font-size: 13px',
        'line-height: 1.4',
        'max-width: 340px',
        'transition: opacity 0.25s ease, transform 0.25s ease',
        'transform: translateY(24px)',
        'opacity: 0',
        'pointer-events: none',
      ].join(';');
      shadow.appendChild(toast);
    } else {
      toast = host.shadowRoot?.getElementById('toast');
    }

    if (!toast) return;
    void toast.offsetHeight;
    toast.textContent = message;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';

    if (window.__llm_toast_timeout) clearTimeout(window.__llm_toast_timeout);
    window.__llm_toast_timeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(16px)';
    }, 3000);
  }

  async function progressiveAutoScroll() {
    const startY = window.scrollY;
    const viewportH = Math.max(window.innerHeight || 800, 300);
    const totalH = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
    if (totalH <= viewportH) return;

    const steps = Math.min(8, Math.ceil(totalH / viewportH));
    for (let i = 1; i <= steps; i++) {
      const targetY = Math.min(totalH, Math.round((totalH * i) / steps));
      window.scrollTo(0, targetY);
      await new Promise((r) => setTimeout(r, 180));
    }
    window.scrollTo(0, startY);
    await new Promise((r) => setTimeout(r, 120));
  }

  /**
   * Safely removes UI noise from a cloned DOM tree without ever deleting
   * <body>, <main>, <article>, or content wrappers whose class/id happens to
   * contain "cookie" or "paywall" (e.g. `<body class="cookie-consent-accepted">`).
   */
  function stripNoiseFromClone(root, { keepImages = false, includeHeader = false } = {}) {
    const safeSelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'svg',
      'canvas',
      '.mw-editsection',
      '.reference',
      '.navbox',
      '.metadata',
      '.infobox',
      '[aria-hidden="true"]',
      'nav',
      'footer',
      'aside',
    ];
    if (!keepImages) safeSelectors.push('.thumb');
    if (includeHeader) safeSelectors.push('header');

    try {
      root.querySelectorAll(safeSelectors.join(', ')).forEach((el) => {
        if (!PROTECTED_TAGS.has(el.tagName)) el.remove();
      });
    } catch {
      // ignore selector error
    }

    const overlaySelectors = [
      '.cookie-banner',
      '#cookie-notice',
      '.paywall-overlay',
      'dialog',
      '[role="dialog"]',
      '[id*="cookie" i]',
      '[class*="cookie" i]',
      '[id*="paywall" i]',
      '[class*="paywall" i]',
    ];

    try {
      root.querySelectorAll(overlaySelectors.join(', ')).forEach((el) => {
        if (PROTECTED_TAGS.has(el.tagName)) return;
        if (el.querySelector('article, main')) return;
        const textLen = (el.textContent || '').trim().length;
        if (textLen > MAX_OVERLAY_CHARS) return;
        el.remove();
      });
    } catch {
      // ignore selector error
    }
  }

  function htmlToCleanText(html, fallbackPlainText, { keepLinks = false, keepImages = false } = {}) {
    if (typeof TurndownService !== 'undefined') {
      const turndownService = new TurndownService({ headingStyle: 'atx' });
      if (!keepLinks) {
        turndownService.addRule('stripLinks', {
          filter: 'a',
          replacement: (content) => content,
        });
      }
      if (!keepImages) {
        turndownService.addRule('stripImages', {
          filter: 'img',
          replacement: () => '',
        });
      }
      return turndownService
        .turndown(html || '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    }
    return String(fallbackPlainText || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatWithTitle(title, body) {
    const cleanBody = String(body || '').trim();
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return cleanBody;
    const firstLine = cleanBody.split('\n')[0]?.replace(/^#+\s*/, '').trim() || '';
    if (firstLine && firstLine.toLowerCase() === cleanTitle.toLowerCase()) {
      return cleanBody;
    }
    return cleanBody ? `${cleanTitle}\n\n${cleanBody}` : cleanTitle;
  }

  function highlightSelection(selectionObj) {
    try {
      if (!selectionObj || selectionObj.rangeCount === 0 || !CSS.highlights) return;
      const range = selectionObj.getRangeAt(0);
      const highlight = new Highlight(range);
      CSS.highlights.set('llm-summarizer-hl', highlight);
      if (!document.getElementById('llm-hl-style')) {
        const style = document.createElement('style');
        style.id = 'llm-hl-style';
        style.textContent = '::highlight(llm-summarizer-hl) { background-color: rgba(255, 235, 59, 0.5); }';
        (document.head || document.documentElement).appendChild(style);
      }
      setTimeout(() => {
        try {
          CSS.highlights.delete('llm-summarizer-hl');
        } catch {
          // ignore
        }
      }, 2000);
    } catch {
      // CSS Custom Highlight API unsupported
    }
  }

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request?.action === 'showToast') {
      if (request.message) showToast(String(request.message));
      sendResponse({ ok: true });
      return false;
    }

    if (request?.action === 'getSelection') {
      const selectionObj = window.getSelection();
      const selection = (selectionObj?.toString() || '').trim();
      if (selection) {
        highlightSelection(selectionObj);
        if (request.showLocalToast !== false) {
          const prefix = chrome.i18n.getMessage('toastCapturedSelection') || 'Captured selection:';
          const preview = selection.length > 45 ? `${selection.slice(0, 45)}...` : selection;
          showToast(`${prefix} "${preview}"`);
        }
      }
      sendResponse({
        text: selection,
        title: document.title || '',
        url: location.href || '',
        kind: 'selection',
      });
      return false;
    }

    if (request?.action === 'getPageText') {
      chrome.storage.local
        .get('markdownOptions')
        .catch(() => ({}))
        .then(async (data) => {
          const opts = data?.markdownOptions || {};
          const keepLinks = Boolean(opts.keepLinks);
          const keepImages = Boolean(opts.keepImages);
          const autoScroll = Boolean(opts.autoScroll);

          if (autoScroll) {
            await progressiveAutoScroll();
          }

          try {
            if (typeof Readability !== 'undefined') {
              const documentClone = document.cloneNode(true);
              stripNoiseFromClone(documentClone, { keepImages, includeHeader: false });
              const article = new Readability(documentClone).parse();

              if (article && (article.content || article.textContent)) {
                const body = htmlToCleanText(article.content, article.textContent, { keepLinks, keepImages });
                const pageTitle = String(article.title || document.title || '').trim();
                const text = formatWithTitle(pageTitle, body);
                if (text) {
                  const prefix = chrome.i18n.getMessage('toastCapturedPage') || 'Captured page:';
                  showToast(`${prefix} ${text.length.toLocaleString()} char`);
                  sendResponse({ text, title: pageTitle, url: location.href || '', kind: 'page' });
                  return;
                }
              }
            }

            // Fallback extraction if Readability fails or returns empty
            const bodyClone = document.body.cloneNode(true);
            stripNoiseFromClone(bodyClone, { keepImages, includeHeader: true });
            const body = htmlToCleanText(bodyClone.innerHTML, bodyClone.textContent, { keepLinks, keepImages });
            const pageTitle = String(document.title || '').trim();
            const text = formatWithTitle(pageTitle, body);
            const prefix = chrome.i18n.getMessage('toastCapturedPage') || 'Captured page:';
            showToast(`${prefix} ${text.length.toLocaleString()} char`);
            sendResponse({ text, title: pageTitle, url: location.href || '', kind: 'page' });
          } catch (err) {
            console.error('Extraction error:', err);
            const fallbackText = (document.body?.innerText || '').trim();
            sendResponse({
              text: fallbackText,
              title: String(document.title || '').trim(),
              url: location.href || '',
              kind: 'page',
            });
          }
        });

      return true;
    }

    return false;
  });
}
