// content_source.js - Estrae il testo dalla pagina corrente

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getSelection') {
    const selection = window.getSelection().toString().trim();
    sendResponse({ text: selection });
    return true; // async
  }
  
  if (request.action === 'getPageText') {
    // Clone body per pulirlo
    const bodyClone = document.body.cloneNode(true);
    
    // Rimuovi elementi di rumore
    const tagsToRemove = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'header', 'aside', 'svg', 'canvas'];
    tagsToRemove.forEach(tag => {
      const elements = bodyClone.querySelectorAll(tag);
      elements.forEach(el => el.remove());
    });
    
    // Estrai textContent e normalizza spazi
    let text = bodyClone.textContent || "";
    text = text.replace(/\s+/g, ' ').trim();
    
    sendResponse({ text: text });
    return true; // async
  }
});
