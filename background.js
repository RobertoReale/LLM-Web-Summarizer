// background.js

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "add-to-queue",
    title: chrome.i18n.getMessage("contextMenuAdd") || "Aggiungi al riassunto (LLM)",
    contexts: ["selection"]
  });
});

async function extractSelection(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['lib/Readability.js', 'content_source.js']
    });
    const res = await chrome.tabs.sendMessage(tabId, { action: 'getSelection' });
    return res?.text;
  } catch (err) {
    console.error("Failed to extract selection", err);
    return null;
  }
}

async function addToQueue(text) {
  if (!text) return;
  const { textQueue = [] } = await chrome.storage.local.get('textQueue');
  textQueue.push(text);
  await chrome.storage.local.set({ textQueue });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  const text = info.selectionText || await extractSelection(tab.id);
  if (!text) return;

  if (info.menuItemId === "add-to-queue") {
    await addToQueue(text);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "add-to-queue" && tab) {
    const text = await extractSelection(tab.id);
    if (text) {
      await addToQueue(text);
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'triggerWebMode') {
    triggerWebMode(request.payload, request.target);
  }
});

const LLM_URLS = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  gemini: "https://gemini.google.com/app",
  perplexity: "https://www.perplexity.ai/"
};

async function triggerWebMode(payload, targetLlm) {
  const url = LLM_URLS[targetLlm] || LLM_URLS.chatgpt;
  
  // Salva il payload per il content_target
  await chrome.storage.local.set({ 
    pendingInjection: {
      text: payload,
      target: targetLlm,
      timestamp: Date.now()
    }
  });
  
  // Apri la tab
  chrome.tabs.create({ url }, (newTab) => {
    // Inietto content_target.js quando la pagina è caricata
    chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
      if (tabId === newTab.id && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.scripting.executeScript({
          target: { tabId: newTab.id },
          files: ['content_target.js']
        });
      }
    });
  });
}
