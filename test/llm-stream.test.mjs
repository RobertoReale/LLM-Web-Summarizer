import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRequest,
  parseSSE,
  parseNDJSON,
  streamLLM,
  testProviderConnection,
  LLMError,
} from '../modules/llm-stream.js';

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

test('buildRequest constructs valid headers, endpoints, and system/user messages for every provider', () => {
  const input = { system: 'Be concise.', user: '<document>Hi</document>' };

  const openai = buildRequest(input, { target: 'chatgpt', apiKey: 'sk-test', model: 'gpt-6.1-sol' });
  assert.equal(openai.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(openai.headers.Authorization, 'Bearer sk-test');
  assert.equal(openai.body.model, 'gpt-6.1-sol');
  assert.deepEqual(openai.body.messages, [
    { role: 'system', content: 'Be concise.' },
    { role: 'user', content: '<document>Hi</document>' },
  ]);

  const claude = buildRequest(input, { target: 'claude', apiKey: 'sk-ant-test' });
  assert.equal(claude.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(claude.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(claude.headers['x-api-key'], 'sk-ant-test');
  assert.equal(claude.body.system, 'Be concise.');
  assert.equal(claude.body.messages[0].content, '<document>Hi</document>');

  const gemini = buildRequest(input, { target: 'gemini', apiKey: 'AIza-secret' });
  assert.ok(!gemini.url.includes('AIza-secret'), 'Gemini key must NOT appear in URL query');
  assert.equal(gemini.headers['x-goog-api-key'], 'AIza-secret');
  assert.equal(gemini.body.systemInstruction.parts[0].text, 'Be concise.');
  assert.equal(gemini.body.contents[0].parts[0].text, '<document>Hi</document>');

  const pplx = buildRequest(input, { target: 'perplexity', apiKey: 'pplx-key' });
  assert.equal(pplx.url, 'https://api.perplexity.ai/orchestrator/v1/chat/completions');
  assert.equal(pplx.body.model, 'perplexity/auto');
  assert.equal(pplx.headers.Authorization, 'Bearer pplx-key');
  assert.equal(pplx.body.messages[0].role, 'system');

  const ollamaGen = buildRequest(input, {
    target: 'local',
    localUrl: 'http://localhost:11434/api/generate',
    model: 'llama3.2',
  });
  assert.equal(ollamaGen.protocol, 'ollama');
  assert.equal(ollamaGen.body.model, 'llama3.2');
  assert.equal(ollamaGen.body.system, 'Be concise.');
  assert.equal(ollamaGen.body.prompt, '<document>Hi</document>');

  const ollamaChat = buildRequest(input, {
    target: 'local',
    localUrl: 'http://localhost:11434/api/chat',
    model: 'qwen2.5',
  });
  assert.equal(ollamaChat.protocol, 'ollama');
  assert.equal(ollamaChat.body.messages[0].role, 'system');
  assert.equal(ollamaChat.body.messages[1].content, '<document>Hi</document>');

  const lmStudio = buildRequest(input, {
    target: 'local',
    localUrl: 'http://localhost:1234/v1/chat/completions',
    model: 'local-model',
    apiKey: 'local-secret',
  });
  assert.equal(lmStudio.protocol, 'openai');
  assert.equal(lmStudio.headers.Authorization, 'Bearer local-secret');
  assert.equal(lmStudio.body.model, 'local-model');
  assert.equal(lmStudio.body.messages[0].role, 'system');
});

test('buildRequest throws clean error when cloud API key is missing or local URL invalid', () => {
  assert.throws(() => buildRequest('Hi', { target: 'chatgpt', apiKey: '' }), LLMError);
  assert.throws(() => buildRequest('Hi', { target: 'claude', apiKey: '   ' }), LLMError);
  assert.throws(() => buildRequest('Hi', { target: 'gemini', apiKey: '' }), LLMError);
  assert.throws(() => buildRequest('Hi', { target: 'local', localUrl: 'ftp://bad' }), LLMError);
  assert.throws(() => buildRequest('Hi', { target: 'local', localUrl: 'localhost:11434' }), LLMError);
});

test('parseSSE reassembles JSON lines split across arbitrary chunk boundaries', async () => {
  const body = streamFromChunks([
    ': keep-alive\r\n\r\n',
    'data: {"choices":[{"delta":{"content":"Hello "}}]}\r\n\r\n',
    'data: {"choices":[{"del',
    'ta":{"content":"split-chunk "}}]}\n\n',
    'event: custom\ndata: {"choices":[{"delta":{"content":"world"}}]}\n',
  ]);

  const events = [];
  await parseSSE(body, (ev, data) => events.push({ ev, data }));
  assert.equal(events.length, 3);
  assert.equal(events[0].data.choices[0].delta.content, 'Hello ');
  assert.equal(events[1].data.choices[0].delta.content, 'split-chunk ');
  assert.equal(events[2].ev, 'custom');
  assert.equal(events[2].data.choices[0].delta.content, 'world');
});

test('parseNDJSON reassembles Ollama chunks split across TCP frames', async () => {
  const body = streamFromChunks([
    '{"response":"Part 1"}\n{"res',
    'ponse":" + Part 2"}\n{"response":" + Part 3","done":true}',
  ]);
  const objs = [];
  await parseNDJSON(body, (o) => objs.push(o));
  assert.equal(objs.map((o) => o.response).join(''), 'Part 1 + Part 2 + Part 3');
});

test('streamLLM streams responses accurately and detects output truncation across all protocols', async () => {
  // OpenAI with finish_reason: length
  const openaiFetch = async () =>
    new Response(
      streamFromChunks([
        'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"B"},"finish_reason":"length"}]}\n\n',
        'data: [DONE]\n\n',
      ]),
      { status: 200 }
    );
  const r1 = await streamLLM('p', { target: 'chatgpt', apiKey: 'k' }, () => {}, { fetchImpl: openaiFetch });
  assert.equal(r1.text, 'AB');
  assert.equal(r1.truncated, true);
  assert.equal(r1.finishReason, 'length');

  // Anthropic with stop_reason: max_tokens
  const claudeFetch = async () =>
    new Response(
      streamFromChunks([
        'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Claude OK"}}\n\n',
        'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      ]),
      { status: 200 }
    );
  const r2 = await streamLLM('p', { target: 'claude', apiKey: 'k' }, () => {}, { fetchImpl: claudeFetch });
  assert.equal(r2.text, 'Claude OK');
  assert.equal(r2.truncated, true);

  // Gemini with MAX_TOKENS (ignores thought parts)
  const geminiFetch = async () =>
    new Response(
      streamFromChunks([
        'data: {"candidates":[{"content":{"parts":[{"text":"hidden","thought":true},{"text":"Visible"}]},"finishReason":"MAX_TOKENS"}]}\n\n',
      ]),
      { status: 200 }
    );
  const r3 = await streamLLM('p', { target: 'gemini', apiKey: 'k' }, () => {}, { fetchImpl: geminiFetch });
  assert.equal(r3.text, 'Visible');
  assert.equal(r3.truncated, true);

  // Ollama with done_reason: length
  const ollamaFetch = async () =>
    new Response(
      streamFromChunks(['{"response":"Local "}\n', '{"response":"AI","done":true,"done_reason":"length"}\n']),
      { status: 200 }
    );
  const r4 = await streamLLM('p', { target: 'local' }, () => {}, { fetchImpl: ollamaFetch });
  assert.equal(r4.text, 'Local AI');
  assert.equal(r4.truncated, true);
});

test('testProviderConnection sends compact maxTokens probe and returns latency', async () => {
  let seenBody = null;
  const mockFetch = async (_url, init) => {
    seenBody = JSON.parse(init.body);
    return new Response('data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', {
      status: 200,
    });
  };
  const res = await testProviderConnection({ target: 'chatgpt', apiKey: 'sk-ok' }, { fetchImpl: mockFetch });
  assert.equal(res.ok, true);
  assert.equal(res.sample, 'OK');
  assert.equal(seenBody.max_completion_tokens, 16);
});

test('streamLLM surfaces detailed HTTP errors and Ollama 403 CORS hint', async () => {
  const err401 = async () =>
    new Response(JSON.stringify({ error: { message: 'Invalid API key', type: 'auth_error' } }), { status: 401 });
  await assert.rejects(
    () => streamLLM('p', { target: 'chatgpt', apiKey: 'bad' }, () => {}, { fetchImpl: err401 }),
    (err) => err instanceof LLMError && err.status === 401 && err.message.includes('Invalid API key')
  );

  const err403 = async () => new Response('Forbidden', { status: 403 });
  await assert.rejects(
    () => streamLLM('p', { target: 'local' }, () => {}, { fetchImpl: err403 }),
    (err) => err instanceof LLMError && err.status === 403 && err.message.includes('OLLAMA_ORIGINS')
  );
});

test('streamLLM supports user abort via AbortSignal', async () => {
  const ctrl = new AbortController();
  const slowFetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });

  setTimeout(() => ctrl.abort(), 30);
  await assert.rejects(
    () => streamLLM('p', { target: 'chatgpt', apiKey: 'k' }, () => {}, { fetchImpl: slowFetch, signal: ctrl.signal }),
    (err) => err instanceof LLMError && err.aborted === true
  );
});
