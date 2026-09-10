// content_source.js - Estrae il testo dalla pagina corrente

if (typeof window.__llm_summarizer_injected === 'undefined') {
  window.__llm_summarizer_injected = true;

  function showToast(message) {
    let host = document.getElementById('llm-summarizer-toast-host');
    let toast;
    
    if (!host) {
      host = document.createElement('div');
      host.id = 'llm-summarizer-toast-host';
      // Ensure the host sits on top and doesn't interfere
      Object.assign(host.style, {
        position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647', pointerEvents: 'none'
      });
      document.body.appendChild(host);
      
      const shadow = host.attachShadow({ mode: 'open' });
      
      toast = document.createElement('div');
      toast.id = 'toast';
      
      toast.style.cssText = `
        background-color: #323232;
        color: #ffffff;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 14px;
        transition: opacity 0.3s ease, transform 0.3s ease;
        transform: translateY(100px);
        opacity: 0;
        pointer-events: none;
      `;
      shadow.appendChild(toast);
    } else {
      toast = host.shadowRoot.getElementById('toast');
    }
    
    // Force reflow
    toast.offsetHeight;
    
    toast.textContent = message;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
    
    if (window.__llm_toast_timeout) clearTimeout(window.__llm_toast_timeout);
    window.__llm_toast_timeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
    }, 3000);
  }

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSelection') {
      const selectionObj = window.getSelection();
      const selection = selectionObj.toString().trim();
      if (selection) {
        if (selectionObj.rangeCount > 0) {
          const range = selectionObj.getRangeAt(0);
          try {
            if (CSS.highlights) {
              const highlight = new Highlight(range);
              CSS.highlights.set("llm-summarizer-hl", highlight);
              if (!document.getElementById('llm-hl-style')) {
                const style = document.createElement('style');
                style.id = 'llm-hl-style';
                style.textContent = `::highlight(llm-summarizer-hl) { background-color: rgba(255, 235, 59, 0.5); }`;
                document.head.appendChild(style);
              }
              setTimeout(() => { CSS.highlights.delete("llm-summarizer-hl"); }, 2000);
            }
          } catch(e) {}
        }
        
        const prefix = chrome.i18n.getMessage("toastCapturedSelection") || "Catturata selezione:";
        showToast(`${prefix} "${selection.substring(0, 40)}..."`);
      }
      sendResponse({ text: selection });
      return true; // async
    }
    
    if (request.action === 'getPageText') {
      chrome.storage.local.get('markdownOptions').then(async (data) => {
        const keepLinks = data.markdownOptions?.keepLinks || false;
        const keepImages = data.markdownOptions?.keepImages || false;
        const autoScroll = data.markdownOptions?.autoScroll || false;

        if (autoScroll) {
          const originalScroll = window.scrollY;
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise(r => setTimeout(r, 400));
          window.scrollTo(0, originalScroll);
          await new Promise(r => setTimeout(r, 100));
        }

        try {
          if (typeof Readability !== 'undefined') {
            const documentClone = document.cloneNode(true);
            
            // Pre-clean common noise elements (Wikipedia references, edit links, hidden stuff)
            const elementsToRemove = documentClone.querySelectorAll('.mw-editsection, .reference, .navbox, .metadata, .infobox, .thumb, [aria-hidden="true"], nav, footer, aside, .cookie-banner, #cookie-notice, .paywall-overlay, [id*="cookie"], [class*="cookie"], [id*="paywall"], [class*="paywall"], dialog');
            elementsToRemove.forEach(el => el.remove());

            const article = new Readability(documentClone).parse();
            
            if (article && (article.content || article.textContent)) {
              // Convert to Markdown if possible, otherwise plain text
              let extractedText = "";
              if (typeof TurndownService !== 'undefined') {
                const turndownService = new TurndownService({ headingStyle: 'atx' });
                
                if (!keepLinks) {
                  turndownService.addRule('removeLinks', {
                    filter: 'a',
                    replacement: function (content) { return content; }
                  });
                }
                
                if (!keepImages) {
                  turndownService.addRule('removeImages', {
                    filter: 'img',
                    replacement: function () { return ''; }
                  });
                }

                extractedText = turndownService.turndown(article.content || "");
              } else {
                extractedText = (article.textContent || "").replace(/\s+/g, ' ').trim();
              }
              const text = `${article.title}\n\n${extractedText}`;
              const prefix = chrome.i18n.getMessage("toastCapturedPage") || "Catturata pagina:";
              showToast(`${prefix} ${text.length} char`);
              sendResponse({ text });
              return;
            }
          }
          
          // Fallback in caso Readability fallisca o non sia caricato
          const bodyClone = document.body.cloneNode(true);
          const tagsToRemove = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'aside', 'svg', 'canvas', '.mw-editsection', '.reference', '.navbox', '.cookie-banner', '#cookie-notice', '.paywall-overlay', '[id*="cookie"]', '[class*="cookie"]', '[id*="paywall"]', '[class*="paywall"]', 'dialog'];
          tagsToRemove.forEach(selector => {
            const elements = bodyClone.querySelectorAll(selector);
            elements.forEach(el => el.remove());
          });
          
          let text = "";
          if (typeof TurndownService !== 'undefined') {
            const turndownService = new TurndownService({ headingStyle: 'atx' });
            if (!keepLinks) {
              turndownService.addRule('removeLinks', {
                filter: 'a',
                replacement: function (content) { return content; }
              });
            }
            if (!keepImages) {
              turndownService.addRule('removeImages', {
                filter: 'img',
                replacement: function () { return ''; }
              });
            }
            text = turndownService.turndown(bodyClone.innerHTML);
          } else {
            text = bodyClone.textContent || "";
            text = text.replace(/\s+/g, ' ').trim();
          }
          const prefix = chrome.i18n.getMessage("toastCapturedPage") || "Catturata pagina:";
          showToast(`${prefix} ${text.length} char`);
          sendResponse({ text: text });
          
        } catch (e) {
          console.error("Extraction error:", e);
          sendResponse({ text: document.body.innerText });
        }
      });
      
      return true; // async
    }
  });
}
