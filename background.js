// background.js — MV3 Service Worker / Firefox Event Page (ES Module)

import {
  LLM_URLS,
  PROVIDERS,
  PENDING_INJECTION_TTL_MS,
  MAX_API_HISTORY,
  getTargetSelectors,
  resolveModel,
  createQueueItem,
  normalizeQueue,
} from './modules/config.js';
import { streamLLM, testProviderConnection } from './modules/llm-stream.js';

const MAX_INJECTION_ATTEMPTS = 3;
let pendingTabCreation = null;
let activeApiController = null;
let activeApiJobId = null;

// --- Action Badge (Queue Counter) ---
async function updateQueueBadge(rawQueue) {
  try {
    let queue = rawQueue;
    if (queue === undefined) {
      const stored = await chrome.storage.local.get('textQueue');
      queue = stored.textQueue;
    }
    const count = normalizeQueue(queue).length;
    const text = count <= 0 ? '' : count > 99 ? '99+' : String(count);
    await chrome.action.setBadgeText({ text });
    if (count > 0) {
      await chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });
      if (chrome.action.setBadgeTextColor) {
        await chrome.action.setBadgeTextColor({ color: '#ffffff' });
      }
    }
  } catch {
    // Ignore badge errors in restricted contexts
  }
}

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.textQueue) {
    updateQueueBadge(changes.textQueue.newValue);
  }
});

// --- Context Menus ---
function setupContextMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      void chrome.runtime.lastError;
      chrome.contextMenus.create(
        {
          id: 'add-to-queue',
          title: chrome.i18n.getMessage('contextMenuAdd') || 'Add to Summary (LLM)',
          contexts: ['selection'],
        },
        () => {
          void chrome.runtime.lastError;
        }
      );
    });
  } catch (err) {
    console.error('Failed to setup context menus:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
  updateQueueBadge();
});

chrome.runtime.onStartup.addListener(() => {
  setupContextMenus();
  updateQueueBadge();
});

// Sync badge on worker wake-up
updateQueueBadge();

// --- Content Capture Helpers ---
function isRestrictedUrl(url) {
  if (!url) return false;
  return (
    /^(chrome|chrome-extension|edge|about|moz-extension|view-source|devtools|brave|opera|vivaldi):/i.test(url) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|addons\.mozilla\.org)\b/i.test(url)
  );
}

async function ensureContentSource(tabId, frameId = 0, { needsPageLibs = false } = {}) {
  const target = frameId ? { tabId, frameIds: [frameId] } : { tabId };
  const check = await chrome.scripting.executeScript({
    target,
    func: () => ({
      hasReadability: typeof Readability !== 'undefined',
      hasTurndown: typeof TurndownService !== 'undefined',
      hasContentSource: typeof window.__llm_summarizer_source_injected !== 'undefined',
    }),
  });

  const status = check?.[0]?.result || {};
  const filesToInject = [];
  if (needsPageLibs && !status.hasReadability) filesToInject.push('lib/Readability.js');
  if (needsPageLibs && !status.hasTurndown) filesToInject.push('lib/turndown.js');
  if (!status.hasContentSource) filesToInject.push('content_source.js');

  if (filesToInject.length > 0) {
    await chrome.scripting.executeScript({
      target,
      files: filesToInject,
    });
  }
}

/**
 * Capture selected text across all accessible frames (top document + iframes).
 * Highlights in the frame holding the selection and renders the toast in the top frame.
 */
async function captureSelectionAcrossFrames(tab) {
  const tabId = tab.id;
  let frameResults = [];
  try {
    frameResults = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => {
        try {
          const sel = window.getSelection();
          const text = (sel?.toString() || '').trim();
          return { text, title: document.title || '', url: location.href || '' };
        } catch {
          return { text: '', title: '', url: '' };
        }
      },
    });
  } catch {
    frameResults = [];
  }

  const hit = frameResults.find((r) => r?.result?.text);
  if (!hit) {
    return null;
  }

  const frameId = hit.frameId ?? 0;
  let captured = hit.result;

  try {
    await ensureContentSource(tabId, frameId, { needsPageLibs: false });
    const res = await chrome.tabs.sendMessage(
      tabId,
      { action: 'getSelection', showLocalToast: frameId === 0 },
      { frameId }
    );
    if (res?.text) {
      captured = res;
    }
    // If selection came from a nested iframe, render toast in top frame so it is never clipped.
    if (frameId !== 0 && captured.text) {
      try {
        await ensureContentSource(tabId, 0, { needsPageLibs: false });
        const prefix = chrome.i18n.getMessage('toastCapturedSelection') || 'Captured selection:';
        const preview = captured.text.length > 45 ? `${captured.text.slice(0, 45)}...` : captured.text;
        await chrome.tabs.sendMessage(tabId, { action: 'showToast', message: `${prefix} "${preview}"` }, { frameId: 0 });
      } catch {
        // Ignore toast failure on top frame
      }
    }
  } catch {
    // Keep text from executeScript scan if messaging failed
  }

  return {
    text: captured.text,
    title: tab.title || captured.title || '',
    url: tab.url || captured.url || '',
    kind: 'selection',
  };
}

async function captureFullPage(tab) {
  const tabId = tab.id;
  await ensureContentSource(tabId, 0, { needsPageLibs: true });
  const res = await chrome.tabs.sendMessage(tabId, { action: 'getPageText' }, { frameId: 0 });
  const text = String(res?.text || '').trim();
  if (!text) return null;
  return {
    text,
    title: res?.title || tab.title || '',
    url: res?.url || tab.url || '',
    kind: 'page',
  };
}

async function addToQueue(entry) {
  const item = createQueueItem(entry);
  if (!item) return null;
  const { textQueue = [] } = await chrome.storage.local.get('textQueue');
  const nextQueue = [...normalizeQueue(textQueue), item];
  await chrome.storage.local.set({ textQueue: nextQueue });
  await updateQueueBadge(nextQueue);
  return item;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'add-to-queue' || !tab?.id) return;

  let captured = null;
  // Prefer DOM selection (preserves newlines, works across iframes, triggers toast & highlight),
  // falling back to Chrome's info.selectionText on restricted frames/PDFs.
  if (!isRestrictedUrl(tab.url)) {
    try {
      captured = await captureSelectionAcrossFrames(tab);
    } catch {
      captured = null;
    }
  }
  if (!captured && info.selectionText?.trim()) {
    captured = {
      text: info.selectionText.trim(),
      title: tab.title || '',
      url: info.pageUrl || tab.url || '',
      kind: 'selection',
    };
  }
  if (captured) {
    await addToQueue(captured);
  }
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'add-to-queue') return;
  let targetTab = tab;
  if (!targetTab?.id) {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetTab = active;
  }
  if (!targetTab?.id || isRestrictedUrl(targetTab.url)) return;
  try {
    const captured = await captureSelectionAcrossFrames(targetTab);
    if (captured) await addToQueue(captured);
  } catch (err) {
    console.error('Shortcut capture failed:', err);
  }
});

// --- Web Mode Orchestration ---
async function triggerWebMode(payload, targetLlm, autoSubmit) {
  const provider = PROVIDERS[targetLlm];
  if (!provider || !provider.hasWebUI || !LLM_URLS[targetLlm]) {
    return { ok: false, errorCode: 'webModeUnsupported' };
  }

  const url = LLM_URLS[targetLlm];
  let resolveCreation;
  pendingTabCreation = new Promise((resolve) => {
    resolveCreation = resolve;
  });

  try {
    const newTab = await chrome.tabs.create({ url, active: true });
    await chrome.storage.local.set({
      pendingInjection: {
        tabId: newTab.id,
        text: payload,
        target: targetLlm,
        autoSubmit: Boolean(autoSubmit),
        timestamp: Date.now(),
        attempts: 0,
      },
    });
    return { ok: true, tabId: newTab.id };
  } catch (err) {
    console.error('triggerWebMode failed:', err);
    return { ok: false, errorCode: 'webModeOpenFailed', error: err.message };
  } finally {
    resolveCreation();
    pendingTabCreation = null;
  }
}

async function handleClaimPendingInjection(senderTabId) {
  if (pendingTabCreation) {
    try {
      await pendingTabCreation;
    } catch {
      // ignore
    }
  }
  if (typeof senderTabId !== 'number') return { payload: null };

  const { pendingInjection, customSelectors } = await chrome.storage.local.get([
    'pendingInjection',
    'customSelectors',
  ]);
  if (!pendingInjection) return { payload: null };

  if (Date.now() - (pendingInjection.timestamp || 0) > PENDING_INJECTION_TTL_MS) {
    await chrome.storage.local.remove('pendingInjection');
    return { payload: null };
  }

  if (pendingInjection.tabId !== senderTabId) {
    return { payload: null };
  }

  const nextAttempts = (pendingInjection.attempts || 0) + 1;
  if (nextAttempts > MAX_INJECTION_ATTEMPTS) {
    await chrome.storage.local.remove('pendingInjection');
    return { payload: null };
  }

  await chrome.storage.local.set({
    pendingInjection: { ...pendingInjection, attempts: nextAttempts },
  });

  return {
    payload: {
      text: pendingInjection.text,
      target: pendingInjection.target,
      autoSubmit: Boolean(pendingInjection.autoSubmit),
    },
    selectors: getTargetSelectors(pendingInjection.target, customSelectors),
  };
}

async function handleCompletePendingInjection(senderTabId) {
  const { pendingInjection } = await chrome.storage.local.get('pendingInjection');
  if (pendingInjection && (senderTabId === undefined || pendingInjection.tabId === senderTabId)) {
    await chrome.storage.local.remove('pendingInjection');
  }
  return { ok: true };
}

// --- Persistent Background API Mode + History ---
async function appendApiHistory(job) {
  if (!job || !job.text?.trim()) return;
  try {
    const { apiHistory = [] } = await chrome.storage.local.get('apiHistory');
    const list = Array.isArray(apiHistory) ? apiHistory.filter((h) => h && h.id !== job.id) : [];
    const entry = {
      id: job.id,
      target: job.target,
      model: job.model,
      title: job.title || '',
      text: job.text,
      truncated: Boolean(job.truncated),
      status: job.status,
      createdAt: job.startedAt || Date.now(),
    };
    const next = [entry, ...list].slice(0, MAX_API_HISTORY);
    await chrome.storage.local.set({ apiHistory: next });
  } catch (err) {
    console.error('Failed to save API history:', err);
  }
}

async function runApiSummary({ payload, systemPrompt, userPrompt, target, title = '' }) {
  if (activeApiController) {
    activeApiController.abort();
    activeApiController = null;
  }

  const provider = PROVIDERS[target];
  if (!provider) {
    return { ok: false, error: `Unsupported LLM provider: ${target}` };
  }

  const { apiKeys = {}, apiModels = {} } = await chrome.storage.local.get(['apiKeys', 'apiModels']);
  const apiKey = apiKeys[provider.apiKeyField] || '';
  const model = resolveModel(target, apiModels[target]);
  const localUrl = apiKeys.localUrl || PROVIDERS.local.defaultUrl;

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  activeApiJobId = jobId;
  const controller = new AbortController();
  activeApiController = controller;

  const promptInput =
    typeof userPrompt === 'string' && userPrompt.length > 0
      ? { system: String(systemPrompt || ''), user: userPrompt }
      : String(payload || '');

  let job = {
    id: jobId,
    status: 'streaming',
    target,
    model,
    title: String(title || '').trim(),
    text: '',
    error: '',
    truncated: false,
    finishReason: '',
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };

  // Single update channel: chrome.storage.local (avoids duplicate renders in popup/panel)
  await chrome.storage.local.set({ apiJob: job });

  (async () => {
    let lastPersist = 0;
    const persistThrottled = () => {
      const now = Date.now();
      if (now - lastPersist < 150) return;
      lastPersist = now;
      job = { ...job, updatedAt: now };
      chrome.storage.local.set({ apiJob: job }).catch(() => {});
    };

    try {
      const { text, truncated, finishReason } = await streamLLM(
        promptInput,
        { target, apiKey, model, localUrl },
        (_chunk, fullText) => {
          if (activeApiJobId !== jobId) return;
          job = { ...job, text: fullText };
          persistThrottled();
        },
        { signal: controller.signal }
      );

      if (activeApiJobId === jobId) {
        job = {
          ...job,
          status: 'done',
          text,
          error: '',
          truncated: Boolean(truncated),
          finishReason: finishReason || '',
          updatedAt: Date.now(),
        };
        await chrome.storage.local.set({ apiJob: job });
        await appendApiHistory(job);
      }
    } catch (err) {
      if (activeApiJobId === jobId) {
        const status = err?.aborted ? 'aborted' : 'error';
        job = {
          ...job,
          status,
          error: err?.aborted ? '' : err?.message || String(err),
          updatedAt: Date.now(),
        };
        await chrome.storage.local.set({ apiJob: job });
        if (status === 'aborted' && job.text?.trim()) {
          await appendApiHistory(job);
        }
      }
    } finally {
      if (activeApiController === controller) {
        activeApiController = null;
      }
    }
  })();

  return { ok: true, job };
}

async function cancelApiSummary() {
  if (activeApiController) {
    activeApiController.abort();
    activeApiController = null;
  } else {
    const { apiJob } = await chrome.storage.local.get('apiJob');
    if (apiJob && apiJob.status === 'streaming') {
      const updated = { ...apiJob, status: 'aborted', updatedAt: Date.now() };
      await chrome.storage.local.set({ apiJob: updated });
    }
  }
  return { ok: true };
}

// --- Message Router ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handle = async () => {
    switch (request?.action) {
      case 'captureActiveTab': {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) return { ok: false, errorCode: 'noActiveTab' };
        if (isRestrictedUrl(tab.url)) return { ok: false, errorCode: 'restrictedPage' };
        try {
          const captured =
            request.method === 'getSelection'
              ? await captureSelectionAcrossFrames(tab)
              : await captureFullPage(tab);
          if (!captured || !captured.text) {
            return {
              ok: false,
              errorCode: request.method === 'getSelection' ? 'emptySelection' : 'emptyPage',
            };
          }
          const item = await addToQueue(captured);
          return { ok: true, charCount: item.text.length, item };
        } catch (err) {
          console.error('captureActiveTab failed:', err);
          return { ok: false, errorCode: 'captureFailed', error: err.message };
        }
      }

      case 'triggerWebMode':
        return triggerWebMode(request.payload, request.target, request.autoSubmit);

      case 'claimPendingInjection':
        return handleClaimPendingInjection(sender.tab?.id);

      case 'completePendingInjection':
        return handleCompletePendingInjection(sender.tab?.id);

      case 'startApiSummary':
        return runApiSummary({
          payload: request.payload,
          systemPrompt: request.systemPrompt,
          userPrompt: request.userPrompt,
          target: request.target,
          title: request.title,
        });

      case 'cancelApiSummary':
        return cancelApiSummary();

      case 'reconcileApiJob': {
        const { apiJob } = await chrome.storage.local.get('apiJob');
        if (apiJob && apiJob.status === 'streaming' && (!activeApiController || activeApiJobId !== apiJob.id)) {
          const reconciled = { ...apiJob, status: 'aborted', updatedAt: Date.now() };
          await chrome.storage.local.set({ apiJob: reconciled });
          return { ok: true, job: reconciled };
        }
        return { ok: true, job: apiJob || null };
      }

      case 'clearApiJob':
        if (activeApiController) {
          activeApiController.abort();
          activeApiController = null;
        }
        activeApiJobId = null;
        await chrome.storage.local.remove('apiJob');
        return { ok: true };

      case 'testApiConnection': {
        try {
          const res = await testProviderConnection({
            target: request.target,
            apiKey: request.apiKey,
            model: request.model,
            localUrl: request.localUrl,
          });
          return res;
        } catch (err) {
          return { ok: false, error: err?.message || String(err) };
        }
      }

      default:
        return { ok: false, error: 'Unknown action' };
    }
  };

  handle()
    .then((res) => sendResponse(res))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;
});
