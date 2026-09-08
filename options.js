document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const openaiKey = document.getElementById('openai-key');
  const anthropicKey = document.getElementById('anthropic-key');
  const geminiKey = document.getElementById('gemini-key');
  
  const chatgptSelectors = document.getElementById('chatgpt-selectors');
  const claudeSelectors = document.getElementById('claude-selectors');
  const geminiSelectors = document.getElementById('gemini-selectors');
  const perplexitySelectors = document.getElementById('perplexity-selectors');
  
  const saveBtn = document.getElementById('save-btn');
  const statusMsg = document.getElementById('status-msg');

  // Default Selectors
  const defaultConfigs = {
    chatgpt: ['#prompt-textarea', '[contenteditable="true"][data-testid]', '.ProseMirror', 'textarea'],
    claude: ['[contenteditable="true"].ProseMirror', 'fieldset [contenteditable="true"]'],
    gemini: ['rich-textarea [contenteditable="true"]', '.ql-editor', 'textarea'],
    perplexity: ['textarea[placeholder*="Ask"]', 'textarea']
  };

  // Load existing options
  try {
    const data = await chrome.storage.local.get(['apiKeys', 'customSelectors']);
    
    if (data.apiKeys) {
      openaiKey.value = data.apiKeys.openai || '';
      anthropicKey.value = data.apiKeys.anthropic || '';
      geminiKey.value = data.apiKeys.gemini || '';
    }
    
    const selectors = data.customSelectors || {};
    chatgptSelectors.value = (selectors.chatgpt?.inputs || defaultConfigs.chatgpt).join(', ');
    claudeSelectors.value = (selectors.claude?.inputs || defaultConfigs.claude).join(', ');
    geminiSelectors.value = (selectors.gemini?.inputs || defaultConfigs.gemini).join(', ');
    perplexitySelectors.value = (selectors.perplexity?.inputs || defaultConfigs.perplexity).join(', ');
  } catch (e) {
    console.error('Failed to load options', e);
  }

  // Save options
  saveBtn.addEventListener('click', async () => {
    const apiKeys = {
      openai: openaiKey.value.trim(),
      anthropic: anthropicKey.value.trim(),
      gemini: geminiKey.value.trim()
    };
    
    const splitAndTrim = (str) => str.split(',').map(s => s.trim()).filter(Boolean);
    
    const customSelectors = {
      chatgpt: { inputs: splitAndTrim(chatgptSelectors.value) || defaultConfigs.chatgpt },
      claude: { inputs: splitAndTrim(claudeSelectors.value) || defaultConfigs.claude },
      gemini: { inputs: splitAndTrim(geminiSelectors.value) || defaultConfigs.gemini },
      perplexity: { inputs: splitAndTrim(perplexitySelectors.value) || defaultConfigs.perplexity }
    };
    
    await chrome.storage.local.set({ apiKeys, customSelectors });
    
    statusMsg.classList.remove('hidden');
    setTimeout(() => {
      statusMsg.classList.add('hidden');
    }, 2000);
  });
});
