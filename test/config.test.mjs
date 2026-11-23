import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MODELS,
  DEFAULT_SELECTORS,
  resolveModel,
  validateLocalUrl,
  parseSelectorList,
  getTargetSelectors,
  resolvePromptText,
  normalizeQueue,
  createQueueItem,
  formatQueueForPrompt,
  buildPayloads,
  computeTextSignature,
  splitTextIntoChunks,
  buildSplitChunkPayload,
  getWebWarningLimitChars,
} from '../modules/config.js';

test('resolveModel migrates retired cloud models including legacy Perplexity Sonar to current defaults', () => {
  assert.equal(resolveModel('chatgpt', 'gpt-3.5-turbo'), DEFAULT_MODELS.chatgpt);
  assert.equal(resolveModel('chatgpt', 'gpt-3.5-turbo-0125'), DEFAULT_MODELS.chatgpt);
  assert.equal(resolveModel('claude', 'claude-3-haiku-20240307'), DEFAULT_MODELS.claude);
  assert.equal(resolveModel('gemini', 'gemini-1.5-flash'), DEFAULT_MODELS.gemini);
  assert.equal(resolveModel('gemini', 'gemini-2.0-flash'), DEFAULT_MODELS.gemini);
  assert.equal(DEFAULT_MODELS.perplexity, 'perplexity/auto');
  assert.equal(resolveModel('perplexity', 'sonar'), 'perplexity/auto');
  assert.equal(resolveModel('perplexity', 'sonar-pro'), 'perplexity/auto');
  assert.equal(resolveModel('perplexity', 'perplexity/sonar'), 'perplexity/auto');
});

test('resolveModel preserves valid custom models and fills empty with default', () => {
  assert.equal(resolveModel('chatgpt', ''), DEFAULT_MODELS.chatgpt);
  assert.equal(resolveModel('chatgpt', '  gpt-4o-mini  '), 'gpt-4o-mini');
  assert.equal(resolveModel('claude', 'claude-opus-5-5'), 'claude-opus-5-5');
  assert.equal(resolveModel('perplexity', 'perplexity/glm-5.3'), 'perplexity/glm-5.3');
  assert.equal(resolveModel('local', 'qwen2.5:14b'), 'qwen2.5:14b');
  assert.equal(resolveModel('local', ''), DEFAULT_MODELS.local);
});

test('validateLocalUrl checks protocol, syntax, and loopback vs LAN host', () => {
  const def = validateLocalUrl('');
  assert.equal(def.ok, true);
  assert.equal(def.isLoopback, true);
  assert.equal(def.normalized, 'http://localhost:11434/api/generate');

  const lan = validateLocalUrl('http://192.168.1.50:11434/api/chat');
  assert.equal(lan.ok, true);
  assert.equal(lan.isLoopback, false);
  assert.equal(lan.originPattern, 'http://192.168.1.50:11434/*');

  assert.equal(validateLocalUrl('localhost:11434/api/generate').ok, false);
  assert.equal(validateLocalUrl('ftp://localhost:11434').ok, false);
  assert.equal(validateLocalUrl('http://').ok, false);
});

test('parseSelectorList restores fallback when input is empty or whitespace', () => {
  const fb = ['#prompt-textarea', 'textarea'];
  assert.deepEqual(parseSelectorList('', fb), fb);
  assert.deepEqual(parseSelectorList('   , , ', fb), fb);
  assert.deepEqual(parseSelectorList(' #a , .b , ', fb), ['#a', '.b']);
});

test('getTargetSelectors merges custom inputs and preserves multilingual submits', () => {
  const merged = getTargetSelectors('chatgpt', { chatgpt: { inputs: ['#custom-box'] } });
  assert.deepEqual(merged.inputs, ['#custom-box']);
  assert.ok(merged.submits.some((s) => s.includes('invia')));
  assert.ok(merged.attachments.length > 0);

  const fallback = getTargetSelectors('perplexity', { perplexity: { inputs: [] } });
  assert.deepEqual(fallback.inputs, DEFAULT_SELECTORS.perplexity.inputs);
  assert.ok(fallback.inputs.some((s) => s.includes('contenteditable')));
});

test('resolvePromptText supports localized presets, customPresetOverrides, custom, and saved prompts', () => {
  const fakeI18n = (key) => (key === 'promptShortInstruction' ? 'Riassumi in breve:' : '');
  assert.equal(resolvePromptText({ selectedPrompt: 'promptShort' }, fakeI18n), 'Riassumi in breve:');
  assert.equal(
    resolvePromptText(
      { selectedPrompt: 'promptShort', customPresetOverrides: { promptShort: 'My custom short preset' } },
      fakeI18n
    ),
    'My custom short preset'
  );
  assert.ok(resolvePromptText({ selectedPrompt: 'promptDetailed' }).length > 40);
  assert.equal(
    resolvePromptText({ selectedPrompt: 'custom', customPromptText: '  My prompt  ' }),
    'My prompt'
  );
  assert.equal(
    resolvePromptText({
      selectedPrompt: 'saved_1',
      savedPrompts: [{ id: 'saved_1', name: 'A', text: 'Saved instruction' }],
    }),
    'Saved instruction'
  );
});

test('normalizeQueue and formatQueueForPrompt upgrade legacy strings and include source metadata cleanly', () => {
  const mixed = [
    'Legacy plain text',
    createQueueItem({ text: 'Article Title\n\nBody text', title: 'Article Title', url: 'https://example.com/a', kind: 'page' }),
  ];
  const normalized = normalizeQueue(mixed);
  assert.equal(normalized.length, 2);
  assert.equal(normalized[0].kind, 'manual');
  assert.equal(normalized[1].url, 'https://example.com/a');

  const formatted = formatQueueForPrompt(normalized, { includeSourceMeta: true });
  assert.ok(formatted.includes('--- [1/2] ---'));
  assert.ok(formatted.includes('--- [2/2] Source: https://example.com/a ---'));
  assert.ok(!formatted.includes('Article Title (https://example.com/a)'), 'Should not duplicate title when already first line');

  const noMeta = formatQueueForPrompt([normalized[1]], { includeSourceMeta: false });
  assert.ok(!noMeta.includes('Source:'));
});

test('buildPayloads separates system/user for API mode, applies outputLanguage, and supports {{text}} placeholder', () => {
  const standard = buildPayloads({
    promptText: 'Summarize this.',
    contentText: 'Hello web content',
    outputLanguage: 'it',
    textLabel: 'Testo:',
  });
  assert.equal(standard.usedPlaceholder, false);
  assert.ok(standard.systemPrompt.includes('Summarize this.'));
  assert.ok(standard.systemPrompt.includes('Write your response in Italian.'));
  assert.ok(standard.systemPrompt.includes('<document>'));
  assert.equal(standard.userPrompt, '<document>\nHello web content\n</document>');
  assert.ok(standard.webPayload.includes('Write your response in Italian.'));
  assert.ok(standard.webPayload.includes('Testo:\nHello web content'));

  const templated = buildPayloads({
    promptText: 'Extract JSON from:\n{{text}}\nReturn only JSON.',
    contentText: 'Sample data',
    outputLanguage: 'en',
  });
  assert.equal(templated.usedPlaceholder, true);
  assert.equal(templated.userPrompt, 'Extract JSON from:\nSample data\nReturn only JSON.');
  assert.equal(templated.systemPrompt, 'Write your response in English.');
  assert.ok(templated.webPayload.includes('Extract JSON from:\nSample data\nReturn only JSON.'));
});

test('computeTextSignature is deterministic and sensitive to edits', () => {
  assert.equal(computeTextSignature('abc'), computeTextSignature('abc'));
  assert.notEqual(computeTextSignature('abc'), computeTextSignature('abd'));
});

test('splitTextIntoChunks respects paragraph/sentence boundaries and builds payloads', () => {
  const para = 'Sentence one is here. Sentence two ends nicely.\n\n';
  const big = para.repeat(120);
  const chunks = splitTextIntoChunks(big, 2000);
  assert.ok(chunks.length >= 3);
  chunks.forEach((c) => assert.ok(c.length <= 2000));
  assert.ok(chunks[0].endsWith('.'));

  const p1 = buildSplitChunkPayload({ chunks, index: 0, promptText: 'Summarize {{text}}', outputLanguage: 'it' });
  const pMid = buildSplitChunkPayload({ chunks, index: 1, promptText: 'Summarize this' });
  const pLast = buildSplitChunkPayload({ chunks, index: chunks.length - 1, promptText: 'Summarize this' });

  assert.ok(p1.includes('Summarize'));
  assert.ok(!p1.includes('{{text}}'));
  assert.ok(p1.includes('Write your response in Italian.'));
  assert.ok(p1.includes(`PART 1/${chunks.length}`));
  assert.ok(!pMid.includes('Summarize this'));
  assert.ok(pLast.includes('END OF TEXT'));
});

test('getWebWarningLimitChars returns provider-specific limits', () => {
  assert.equal(getWebWarningLimitChars('gemini'), 32000);
  assert.equal(getWebWarningLimitChars('chatgpt'), 60000);
  assert.equal(getWebWarningLimitChars('claude'), 90000);
  assert.ok(getWebWarningLimitChars('local') > 0);
});
