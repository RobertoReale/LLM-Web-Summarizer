// modules/llm-stream.js — Unified, buffered streaming client for all supported LLM APIs.
// Supports OpenAI, Anthropic, Google Gemini, Perplexity (Orchestrator), and Local (Ollama + OpenAI-compatible).
// Supports system/user message separation, truncation detection, abort, idle timeout, and connection tests.

import { PROVIDERS, resolveModel, validateLocalUrl } from './config.js';

const ENDPOINTS = {
  chatgpt: 'https://api.openai.com/v1/chat/completions',
  claude: 'https://api.anthropic.com/v1/messages',
  perplexity: 'https://api.perplexity.ai/orchestrator/v1/chat/completions',
};

const ANTHROPIC_MAX_TOKENS = 8192;
const DEFAULT_IDLE_TIMEOUT_MS = 90000;

export class LLMError extends Error {
  constructor(message, { status = 0, type = '', aborted = false } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.type = type;
    this.aborted = aborted;
  }
}

function normalizePromptInput(input) {
  if (input && typeof input === 'object') {
    return {
      system: String(input.system || '').trim(),
      user: String(input.user || ''),
    };
  }
  return { system: '', user: String(input ?? '') };
}

/**
 * Pure request builder — easy to unit test without network calls.
 * `promptInput` can be a plain string or `{ system?: string, user: string }`.
 * @returns {{ url: string, headers: Record<string, string>, body: object, protocol: 'openai'|'anthropic'|'gemini'|'ollama' }}
 */
export function buildRequest(promptInput, config) {
  const target = config?.target || 'chatgpt';
  const provider = PROVIDERS[target];
  if (!provider) {
    throw new LLMError(`Unsupported LLM provider: ${target}`);
  }

  const { system, user } = normalizePromptInput(promptInput);
  const apiKey = String(config?.apiKey || '').trim();
  const model = resolveModel(target, config?.model);
  const maxTokens = Number(config?.maxTokens) > 0 ? Math.floor(Number(config.maxTokens)) : 0;

  if (target === 'chatgpt') {
    if (!apiKey) throw new LLMError('OpenAI API key missing. Configure it in Options.');
    const messages = system
      ? [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]
      : [{ role: 'user', content: user }];
    const body = { model, messages, stream: true };
    if (maxTokens) body.max_completion_tokens = maxTokens;
    return {
      protocol: 'openai',
      url: ENDPOINTS.chatgpt,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    };
  }

  if (target === 'claude') {
    if (!apiKey) throw new LLMError('Anthropic API key missing. Configure it in Options.');
    const body = {
      model,
      max_tokens: maxTokens || ANTHROPIC_MAX_TOKENS,
      messages: [{ role: 'user', content: user }],
      stream: true,
    };
    if (system) body.system = system;
    return {
      protocol: 'anthropic',
      url: ENDPOINTS.claude,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
    };
  }

  if (target === 'gemini') {
    if (!apiKey) throw new LLMError('Gemini API key missing. Configure it in Options.');
    const body = {
      contents: [{ role: 'user', parts: [{ text: user }] }],
    };
    if (system) {
      body.systemInstruction = { parts: [{ text: system }] };
    }
    if (maxTokens) {
      body.generationConfig = { maxOutputTokens: maxTokens };
    }
    return {
      protocol: 'gemini',
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body,
    };
  }

  if (target === 'perplexity') {
    if (!apiKey) throw new LLMError('Perplexity API key missing. Configure it in Options.');
    const messages = system
      ? [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ]
      : [{ role: 'user', content: user }];
    const body = { model, messages, stream: true };
    if (maxTokens) body.max_tokens = maxTokens;
    return {
      protocol: 'openai',
      url: ENDPOINTS.perplexity,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body,
    };
  }

  if (target === 'local') {
    const validated = validateLocalUrl(config?.localUrl);
    if (!validated.ok) {
      throw new LLMError('Local LLM URL must be a valid http:// or https:// URL.');
    }
    const url = validated.normalized;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const isOpenAICompat = /\/v1\/chat\/completions\/?$/i.test(url);
    if (isOpenAICompat) {
      const messages = system
        ? [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ]
        : [{ role: 'user', content: user }];
      const body = { messages, stream: true };
      if (model) body.model = model;
      if (maxTokens) body.max_tokens = maxTokens;
      return { protocol: 'openai', url, headers, body };
    }

    const isOllamaChat = /\/api\/chat\/?$/i.test(url);
    if (isOllamaChat) {
      const messages = system
        ? [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ]
        : [{ role: 'user', content: user }];
      const body = {
        model: model || PROVIDERS.local.defaultModel,
        messages,
        stream: true,
      };
      if (maxTokens) body.options = { num_predict: maxTokens };
      return { protocol: 'ollama', url, headers, body };
    }

    const body = {
      model: model || PROVIDERS.local.defaultModel,
      prompt: user,
      stream: true,
    };
    if (system) body.system = system;
    if (maxTokens) body.options = { num_predict: maxTokens };
    return { protocol: 'ollama', url, headers, body };
  }

  throw new LLMError(`Unsupported LLM provider: ${target}`);
}

/**
 * Buffered Server-Sent Events parser. Properly reassembles lines split across
 * arbitrary TCP/HTTP chunk boundaries, handles CRLF and LF, multi-line `data:`,
 * comments, and trailing final events without a blank line.
 */
export async function parseSSE(body, onEvent) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const dispatch = () => {
    if (!dataLines.length) {
      eventName = '';
      return;
    }
    const raw = dataLines.join('\n');
    dataLines = [];
    let parsed = raw;
    if (raw !== '[DONE]') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        // Keep raw string if not JSON
      }
    }
    const currentEvent = eventName;
    eventName = '';
    onEvent(currentEvent, parsed);
  };

  const feedLine = (line) => {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // SSE comment / keep-alive
    const colonIdx = line.indexOf(':');
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') dataLines.push(value);
    else if (field === 'event') eventName = value;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        feedLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) feedLine(buffer.replace(/\r$/, ''));
    dispatch();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/**
 * Buffered NDJSON (newline-delimited JSON) parser for Ollama `/api/generate` and `/api/chat`.
 */
export async function parseNDJSON(body, onObject) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const feedLine = (rawLine) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    const cleaned = trimmed.startsWith('data: ') ? trimmed.slice(6).trim() : trimmed;
    if (!cleaned || cleaned === '[DONE]') return;
    try {
      onObject(JSON.parse(cleaned));
    } catch {
      // Ignore malformed keep-alive line
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        feedLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer) feedLine(buffer.replace(/\r$/, ''));
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

async function parseHttpError(res, target) {
  const label = PROVIDERS[target]?.label || target;
  const raw = await res.text().catch(() => '');
  let detail = '';
  let type = '';
  try {
    const json = JSON.parse(raw);
    const err = Array.isArray(json) ? json[0]?.error : json.error;
    detail = typeof err === 'string' ? err : err?.message || json.message || '';
    type = err?.type || err?.status || '';
  } catch {
    detail = raw.trim().slice(0, 240);
  }
  if (target === 'local' && res.status === 403) {
    detail =
      (detail ? `${detail} — ` : '') +
      'If using Ollama, allow extension origin via OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*"';
  }
  const suffix = detail || res.statusText || 'request failed';
  return new LLMError(`${label} API error ${res.status}${type ? ` (${type})` : ''}: ${suffix}`, {
    status: res.status,
    type,
  });
}

function handleOpenAIEvent(data, emit, meta, label) {
  if (data === '[DONE]' || !data || typeof data !== 'object') return;
  if (data.error) {
    const err = data.error;
    throw new LLMError(`${label} API error: ${err.message || JSON.stringify(err).slice(0, 200)}`, {
      status: Number(err.code) || 0,
      type: err.type || '',
    });
  }
  const choice = data.choices?.[0];
  const delta = choice?.delta?.content;
  if (typeof delta === 'string') emit(delta);
  if (choice?.finish_reason) {
    meta.finishReason = String(choice.finish_reason);
    if (choice.finish_reason === 'length') meta.truncated = true;
  }
}

function handleAnthropicEvent(eventName, data, emit, meta, label) {
  if (!data || typeof data !== 'object') return;
  if (eventName === 'error' || data.type === 'error') {
    const err = data.error || {};
    throw new LLMError(`${label} API error (${err.type || 'stream'}): ${err.message || 'stream error'}`, {
      status: err.type === 'overloaded_error' ? 529 : 0,
      type: err.type || '',
    });
  }
  if (data.type === 'content_block_delta' && typeof data.delta?.text === 'string') {
    emit(data.delta.text);
  }
  if (data.type === 'message_delta' && data.delta?.stop_reason) {
    meta.finishReason = String(data.delta.stop_reason);
    if (data.delta.stop_reason === 'max_tokens') meta.truncated = true;
  }
}

function handleGeminiEvent(data, emit, meta, label) {
  if (!data || typeof data !== 'object') return;
  if (data.error) {
    throw new LLMError(`${label} API error ${data.error.code || ''}: ${data.error.message || 'stream error'}`, {
      status: Number(data.error.code) || 0,
      type: data.error.status || '',
    });
  }
  const candidate = data.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  for (const part of parts) {
    if (!part.thought && typeof part.text === 'string') emit(part.text);
  }
  if (candidate?.finishReason) {
    meta.finishReason = String(candidate.finishReason);
    if (candidate.finishReason === 'MAX_TOKENS') meta.truncated = true;
  }
}

function handleOllamaEvent(data, emit, meta, label) {
  if (!data || typeof data !== 'object') return;
  if (data.error) {
    throw new LLMError(`${label} error: ${data.error}`);
  }
  if (typeof data.response === 'string') emit(data.response);
  if (typeof data.message?.content === 'string') emit(data.message.content);
  if (typeof data.choices?.[0]?.delta?.content === 'string') emit(data.choices[0].delta.content);
  if (data.done_reason) {
    meta.finishReason = String(data.done_reason);
    if (data.done_reason === 'length') meta.truncated = true;
  }
}

/**
 * Execute a streaming completion against the configured provider.
 * Returns `{ text, truncated, finishReason }`.
 */
export async function streamLLM(promptInput, config, onChunk = () => {}, opts = {}) {
  const { signal, idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS, fetchImpl } = opts;
  const doFetch = fetchImpl || globalThis.fetch;
  const req = buildRequest(promptInput, config);
  const label = PROVIDERS[config?.target]?.label || config?.target || 'LLM';

  const ctrl = new AbortController();
  let idleTimer = null;
  let timedOut = false;

  const armIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, idleTimeoutMs);
  };

  const onCallerAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  let fullText = '';
  const meta = { truncated: false, finishReason: '' };
  const emit = (chunk) => {
    if (!chunk) return;
    fullText += chunk;
    onChunk(chunk, fullText);
  };

  const toAbortError = (err) => {
    if (timedOut) {
      return new LLMError(`${label}: timed out after ${Math.round(idleTimeoutMs / 1000)}s of inactivity.`, {
        status: 504,
      });
    }
    if (signal?.aborted) {
      return new LLMError('Generation stopped by user.', { aborted: true });
    }
    return err instanceof LLMError ? err : new LLMError(err?.message || String(err));
  };

  try {
    armIdle();
    let res;
    try {
      res = await doFetch(req.url, {
        method: 'POST',
        headers: req.headers,
        body: JSON.stringify(req.body),
        signal: ctrl.signal,
      });
    } catch (err) {
      throw toAbortError(err);
    }

    if (!res.ok) {
      throw await parseHttpError(res, config.target);
    }
    if (!res.body) {
      throw new LLMError(`${label} returned an empty response body.`);
    }

    try {
      if (req.protocol === 'ollama') {
        await parseNDJSON(res.body, (obj) => {
          armIdle();
          handleOllamaEvent(obj, emit, meta, label);
        });
      } else {
        await parseSSE(res.body, (eventName, data) => {
          armIdle();
          if (req.protocol === 'anthropic') handleAnthropicEvent(eventName, data, emit, meta, label);
          else if (req.protocol === 'gemini') handleGeminiEvent(data, emit, meta, label);
          else handleOpenAIEvent(data, emit, meta, label);
        });
      }
    } catch (err) {
      if (err instanceof LLMError) throw err;
      throw toAbortError(err);
    }
  } finally {
    clearTimeout(idleTimer);
    if (signal) signal.removeEventListener('abort', onCallerAbort);
  }

  if (!fullText.trim()) {
    throw new LLMError(`${label} returned an empty response.`);
  }

  return { text: fullText, truncated: meta.truncated, finishReason: meta.finishReason };
}

/**
 * Lightweight end-to-end provider connectivity test (verifies key, model, CORS, and streaming).
 */
export async function testProviderConnection(config, opts = {}) {
  const start = Date.now();
  const res = await streamLLM(
    { system: '', user: 'Reply with OK.' },
    { ...config, maxTokens: 16 },
    () => {},
    { idleTimeoutMs: 20000, ...opts }
  );
  return {
    ok: true,
    latencyMs: Date.now() - start,
    sample: res.text.trim().slice(0, 40),
  };
}
