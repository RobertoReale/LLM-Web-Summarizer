// content_source.js - Estrae il testo dalla pagina corrente

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    const selection = window.getSelection().toString().trim();
    sendResponse({ text: selection });
    return true; // async
  }
  
  if (request.action === 'getPageText') {
    try {
      if (typeof Readability !== 'undefined') {
        const documentClone = document.cloneNode(true);
        const article = new Readability(documentClone).parse();
        
        if (article && article.textContent) {
          // Article title + clean text content
          const text = `${article.title}\n\n${article.textContent.replace(/\s+/g, ' ').trim()}`;
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
      let text = bodyClone.textContent || "";
      text = text.replace(/\s+/g, ' ').trim();
      sendResponse({ text: text });
      
    } catch (e) {
      console.error("Extraction error:", e);
      sendResponse({ text: document.body.innerText });
    }
    
    return true; // async
  }
});
