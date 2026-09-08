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
      const selection = window.getSelection().toString().trim();
      if (selection) {
        const prefix = chrome.i18n.getMessage("toastCapturedSelection") || "Catturata selezione:";
        showToast(`${prefix} "${selection.substring(0, 40)}..."`);
      }
      sendResponse({ text: selection });
      return true; // async
    }
    
    if (request.action === 'getPageText') {
      try {
        if (typeof Readability !== 'undefined') {
          const documentClone = document.cloneNode(true);
          const article = new Readability(documentClone).parse();
          
          if (article && (article.content || article.textContent)) {
            // Convert to Markdown if possible, otherwise plain text
            let extractedText = "";
            if (typeof TurndownService !== 'undefined') {
              const turndownService = new TurndownService({ headingStyle: 'atx' });
              extractedText = turndownService.turndown(article.content || "");
            } else {
              extractedText = (article.textContent || "").replace(/\s+/g, ' ').trim();
            }
            const text = `${article.title}\n\n${extractedText}`;
            const prefix = chrome.i18n.getMessage("toastCapturedPage") || "Catturata pagina:";
            showToast(`${prefix} ${text.length} char`);
            sendResponse({ text });
            return true;
          }
        }
        
        // Fallback in caso Readability fallisca o non sia caricato
        const bodyClone = document.body.cloneNode(true);
        const tagsToRemove = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'aside', 'svg', 'canvas'];
        tagsToRemove.forEach(tag => {
          const elements = bodyClone.querySelectorAll(tag);
          elements.forEach(el => el.remove());
        });
        let text = "";
        if (typeof TurndownService !== 'undefined') {
          const turndownService = new TurndownService({ headingStyle: 'atx' });
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
      
      return true; // async
    }
  });
}
