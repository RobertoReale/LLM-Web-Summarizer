// popup.js — Popup, Side Panel, and Full-Tab controller (ES Module)

import {
  PROVIDERS,
  BUILTIN_PROMPT_IDS,
  DEFAULT_CHUNK_CHARS,
  getWebWarningLimitChars,
  getDefaultPresetText,
  resolveModel,
  resolvePromptText,
  normalizeQueue,
  createQueueItem,
  formatQueueForPrompt,
  buildPayloads,
  computeTextSignature,
  splitTextIntoChunks,
  buildSplitChunkPayload,
} from './modules/config.js';
import { renderMarkdown } from './modules/markdown.js';

const t = (key, fallback = '') => {
  try {
    return chrome.i18n?.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
};

function safeHostname(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function slugifyFilename(raw) {
  const clean = String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${clean || 'summary'}-${stamp}.md`;
}

document.addEventListener('DOMContentLoaded', async () => {
  // --- View mode (popup | panel | tab) ---
  const viewMode = new URLSearchParams(location.search).get('view') || 'popup';
  if (viewMode === 'panel') document.body.classList.add('panel-mode');
  else if (viewMode === 'tab') document.body.classList.add('tab-mode');

  // Cache current windowId early so chrome.sidePanel.open() runs synchronously on click
  let currentWindowId = null;
  try {
    const win = await chrome.windows?.getCurrent();
    currentWindowId = win?.id ?? null;
  } catch {
    currentWindowId = null;
  }

  // --- Localization ---
  const localizeUI = () => {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = t(el.getAttribute('data-i18n'));
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const msg = t(el.getAttribute('data-i18n-placeholder'));
      if (msg) el.setAttribute('placeholder', msg);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const msg = t(el.getAttribute('data-i18n-title'));
      if (msg) {
        el.setAttribute('title', msg);
        el.setAttribute('aria-label', msg);
      }
    });
  };
  localizeUI();

  // --- Elements ---
  const sidepanelBtn = document.getElementById('sidepanel-btn');
  const optionsBtn = document.getElementById('options-btn');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const statusBanner = document.getElementById('status-banner');

  const capturePageBtn = document.getElementById('capture-page-btn');
  const captureSelectionBtn = document.getElementById('capture-selection-btn');
  const clearQueueBtn = document.getElementById('clear-queue-btn');
  const viewQueueBtn = document.getElementById('view-queue-btn');
  const queueViewerContainer = document.getElementById('queue-viewer-container');
  const queueItemsList = document.getElementById('queue-items-list');
  const addManualItemBtn = document.getElementById('add-manual-item-btn');
  const manualAddRow = document.getElementById('manual-add-row');
  const manualItemInput = document.getElementById('manual-item-input');
  const confirmManualItemBtn = document.getElementById('confirm-manual-item-btn');
  const cancelManualItemBtn = document.getElementById('cancel-manual-item-btn');
  const queueCounter = document.getElementById('queue-counter');

  const lengthProgress = document.getElementById('length-progress');
  const lengthText = document.getElementById('length-text');
  const lengthWarning = document.getElementById('length-warning');

  const promptType = document.getElementById('prompt-type');
  const togglePromptEditorBtn = document.getElementById('toggle-prompt-editor-btn');
  const outputLanguageSelect = document.getElementById('output-language');
  const customPromptContainer = document.getElementById('custom-prompt-container');
  const promptModifiedBadge = document.getElementById('prompt-modified-badge');
  const customPrompt = document.getElementById('custom-prompt');
  const promptNameRow = document.getElementById('prompt-name-row');
  const promptNameInput = document.getElementById('prompt-name-input');
  const confirmSavePromptBtn = document.getElementById('confirm-save-prompt-btn');
  const cancelSavePromptBtn = document.getElementById('cancel-save-prompt-btn');
  const updatePromptBtn = document.getElementById('update-prompt-btn');
  const savePromptBtn = document.getElementById('save-prompt-btn');
  const renamePromptBtn = document.getElementById('rename-prompt-btn');
  const revertPromptBtn = document.getElementById('revert-prompt-btn');
  const deletePromptBtn = document.getElementById('delete-prompt-btn');

  const targetLlm = document.getElementById('target-llm');
  const modeRadios = document.querySelectorAll('input[name="execution-mode"]');
  const webModeRadio = document.querySelector('input[name="execution-mode"][value="web"]');
  const apiModeRadio = document.querySelector('input[name="execution-mode"][value="api"]');
  const webModeLabel = document.getElementById('web-mode-label');
  const localWebHint = document.getElementById('local-web-hint');
  const autosubmitContainer = document.getElementById('autosubmit-container');
  const autosubmitCb = document.getElementById('autosubmit-cb');
  const apiModelBar = document.getElementById('api-model-bar');
  const apiModelBadge = document.getElementById('api-model-badge');
  const configureApiBtn = document.getElementById('configure-api-btn');

  const submitBtn = document.getElementById('submit-btn');
  const stopBtn = document.getElementById('stop-btn');
  const splitCopyBox = document.getElementById('split-copy-box');
  const splitCopyBtn = document.getElementById('split-copy-btn');
  const splitPartsRow = document.getElementById('split-parts-row');

  const historyStandaloneRow = document.getElementById('history-standalone-row');
  const openHistoryStandaloneBtn = document.getElementById('open-history-standalone-btn');
  const apiHistoryPanel = document.getElementById('api-history-panel');
  const apiHistoryList = document.getElementById('api-history-list');
  const clearHistoryBtn = document.getElementById('clear-history-btn');

  const apiOutputContainer = document.getElementById('api-output-container');
  const apiOutputTitle = document.getElementById('api-output-title');
  const historyToggleBtn = document.getElementById('history-toggle-btn');
  const copyOutputBtn = document.getElementById('copy-output-btn');
  const downloadMdBtn = document.getElementById('download-md-btn');
  const clearOutputBtn = document.getElementById('clear-output-btn');
  const apiTruncatedWarning = document.getElementById('api-truncated-warning');
  const apiOutput = document.getElementById('api-output');

  if (viewMode !== 'popup') {
    sidepanelBtn.classList.add('hidden');
  }

  // --- State ---
  const state = {
    textQueue: [],
    selectedPrompt: 'promptShort',
    customPromptText: '',
    savedPrompts: [],
    customPresetOverrides: {},
    promptDraft: null, // { promptId: string, text: string } — non-destructive edit buffer
    outputLanguage: 'auto',
    targetLLM: 'chatgpt',
    executionMode: 'web',
    isDarkMode: false,
    autoSubmit: true,
    apiModels: {},
    markdownOptions: { includeSourceMeta: true },
    apiJob: null,
    apiHistory: [],
    splitProgress: null, // { signature: string, copiedIndices: number[], nextIndex: number }
  };

  let promptEditorExpanded = false;
  let promptNameMode = 'new'; // 'new' | 'rename'
  let editingQueueItemId = null;
  let bannerTimer = null;
  let pendingDeleteConfirm = false;
  let deleteConfirmTimer = null;
  let queueDirty = false;
  let promptDirty = false;
  let lastRenderedJobKey = '';
  let cachedSplitChunks = [];
  let cachedSplitSig = '';

  const showBanner = (message, kind = 'info', durationMs = 3500) => {
    if (!message) {
      statusBanner.classList.add('hidden');
      return;
    }
    statusBanner.textContent = message;
    statusBanner.className = `status-banner ${kind}`;
    clearTimeout(bannerTimer);
    if (durationMs > 0) {
      bannerTimer = setTimeout(() => {
        statusBanner.classList.add('hidden');
      }, durationMs);
    }
  };

  const resetDeleteConfirm = () => {
    pendingDeleteConfirm = false;
    clearTimeout(deleteConfirmTimer);
    deletePromptBtn.textContent = t('deletePromptBtn', 'Elimina');
  };

  const hidePromptNameRow = () => {
    promptNameRow.classList.add('hidden');
    promptNameInput.value = '';
    promptNameMode = 'new';
  };

  const persistKeys = async (patch) => {
    try {
      await chrome.storage.local.set(patch);
    } catch (err) {
      console.error('Failed to persist state:', err);
    }
  };

  const debounce = (fn, wait) => {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  };

  const flushQueueEditor = () => {
    if (!queueDirty) return;
    queueDirty = false;
    persistKeys({ textQueue: state.textQueue });
  };

  const flushPromptEditor = () => {
    if (!promptDirty) return;
    promptDirty = false;
    persistKeys({
      customPromptText: state.customPromptText,
      promptDraft: state.promptDraft,
    });
  };

  const flushAllPending = () => {
    flushQueueEditor();
    flushPromptEditor();
  };

  const debouncedSaveQueue = debounce(flushQueueEditor, 300);
  const debouncedSavePrompt = debounce(flushPromptEditor, 300);

  // Flush BOTH queue & prompt editors when popup closes or blurs (Bug #5 fix!)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAllPending();
  });
  window.addEventListener('pagehide', flushAllPending);

  // --- Prompt Helpers ---
  const getBasePromptText = (promptId = state.selectedPrompt) =>
    resolvePromptText(
      {
        selectedPrompt: promptId,
        customPromptText: state.customPromptText,
        savedPrompts: state.savedPrompts,
        customPresetOverrides: state.customPresetOverrides,
      },
      t
    );

  const hasActiveDraft = () =>
    state.selectedPrompt !== 'custom' &&
    state.promptDraft &&
    state.promptDraft.promptId === state.selectedPrompt &&
    state.promptDraft.text !== getBasePromptText(state.selectedPrompt);

  const getEffectivePromptText = () => {
    if (state.selectedPrompt === 'custom') {
      return String(state.customPromptText || '').trim();
    }
    if (state.promptDraft && state.promptDraft.promptId === state.selectedPrompt) {
      return String(state.promptDraft.text || '').trim();
    }
    return getBasePromptText(state.selectedPrompt);
  };

  const includeSourceMeta = () => state.markdownOptions?.includeSourceMeta !== false;

  const getFormattedQueueText = () =>
    formatQueueForPrompt(state.textQueue, { includeSourceMeta: includeSourceMeta() });

  // --- Load Initial State ---
  try {
    const stored = await chrome.storage.local.get([
      'textQueue',
      'savedPrompts',
      'customPresetOverrides',
      'selectedPrompt',
      'customPromptText',
      'promptDraft',
      'outputLanguage',
      'targetLLM',
      'executionMode',
      'autoSubmit',
      'isDarkMode',
      'apiModels',
      'markdownOptions',
      'apiJob',
      'apiHistory',
      'splitProgress',
    ]);

    if (Array.isArray(stored.textQueue)) state.textQueue = normalizeQueue(stored.textQueue);
    if (Array.isArray(stored.savedPrompts)) state.savedPrompts = stored.savedPrompts;
    if (stored.customPresetOverrides && typeof stored.customPresetOverrides === 'object') {
      state.customPresetOverrides = stored.customPresetOverrides;
    }
    if (stored.selectedPrompt) state.selectedPrompt = stored.selectedPrompt;
    if (typeof stored.customPromptText === 'string') state.customPromptText = stored.customPromptText;
    if (stored.promptDraft && typeof stored.promptDraft === 'object') state.promptDraft = stored.promptDraft;
    if (typeof stored.outputLanguage === 'string' && stored.outputLanguage) {
      state.outputLanguage = stored.outputLanguage;
    }
    if (stored.targetLLM && PROVIDERS[stored.targetLLM]) state.targetLLM = stored.targetLLM;
    if (stored.executionMode === 'web' || stored.executionMode === 'api') state.executionMode = stored.executionMode;
    if (stored.autoSubmit !== undefined) state.autoSubmit = Boolean(stored.autoSubmit);
    if (stored.isDarkMode !== undefined) state.isDarkMode = Boolean(stored.isDarkMode);
    if (stored.apiModels && typeof stored.apiModels === 'object') state.apiModels = stored.apiModels;
    if (stored.markdownOptions && typeof stored.markdownOptions === 'object') {
      state.markdownOptions = { includeSourceMeta: true, ...stored.markdownOptions };
    }
    if (stored.apiJob && typeof stored.apiJob === 'object') state.apiJob = stored.apiJob;
    if (Array.isArray(stored.apiHistory)) state.apiHistory = stored.apiHistory;
    if (stored.splitProgress && typeof stored.splitProgress === 'object') {
      state.splitProgress = stored.splitProgress;
    }
  } catch (err) {
    console.error('Failed to load state:', err);
  }

  const isValidPrompt = (val) =>
    BUILTIN_PROMPT_IDS.includes(val) ||
    val === 'custom' ||
    state.savedPrompts.some((p) => p.id === val);
  if (!isValidPrompt(state.selectedPrompt)) {
    state.selectedPrompt = 'promptShort';
  }
  if (state.selectedPrompt === 'custom' || hasActiveDraft()) {
    promptEditorExpanded = true;
  }

  if (!PROVIDERS[state.targetLLM]?.hasWebUI) {
    state.executionMode = 'api';
  }

  // --- Theme & Navigation ---
  const applyTheme = (isDark) => {
    document.body.classList.toggle('dark', Boolean(isDark));
    themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
  };
  applyTheme(state.isDarkMode);

  themeToggleBtn.addEventListener('click', () => {
    state.isDarkMode = !state.isDarkMode;
    applyTheme(state.isDarkMode);
    persistKeys({ isDarkMode: state.isDarkMode });
  });

  const openOptions = () => chrome.runtime.openOptionsPage();
  optionsBtn.addEventListener('click', openOptions);
  configureApiBtn.addEventListener('click', openOptions);

  sidepanelBtn.addEventListener('click', () => {
    flushAllPending();
    if (chrome.sidePanel?.open && currentWindowId !== null) {
      chrome.sidePanel
        .open({ windowId: currentWindowId })
        .then(() => window.close())
        .catch(() => {
          chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
          window.close();
        });
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
      window.close();
    }
  });

  // --- Structured Queue Rendering ---
  const renderQueueCards = () => {
    queueItemsList.textContent = '';
    if (state.textQueue.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'queue-empty-hint';
      empty.textContent = t('queueEditorPlaceholder', 'Il testo in coda apparirà qui...');
      queueItemsList.appendChild(empty);
      return;
    }

    const kindLabels = {
      page: t('queueKindPage', 'Pagina'),
      selection: t('queueKindSelection', 'Selezione'),
      manual: t('queueKindManual', 'Nota'),
    };

    state.textQueue.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'queue-card';
      card.dataset.itemId = item.id;

      const header = document.createElement('div');
      header.className = 'queue-card-header';

      const meta = document.createElement('div');
      meta.className = 'queue-card-meta';

      const titleRow = document.createElement('div');
      titleRow.className = 'queue-card-title-row';

      const badge = document.createElement('span');
      badge.className = 'queue-kind-badge';
      badge.textContent = kindLabels[item.kind] || kindLabels.manual;

      const titleEl = document.createElement('span');
      titleEl.className = 'queue-card-title';
      const fallbackTitle = item.text.split('\n')[0].slice(0, 52);
      titleEl.textContent = item.title || fallbackTitle || `#${idx + 1}`;
      titleEl.title = item.title || item.text.slice(0, 140);

      titleRow.appendChild(badge);
      titleRow.appendChild(titleEl);

      const sub = document.createElement('div');
      sub.className = 'queue-card-sub';
      const host = safeHostname(item.url);
      const chars = `${item.text.length.toLocaleString()} ${t('charCount', 'Caratteri')}`;
      sub.textContent = host ? `${host} · ${chars}` : chars;

      meta.appendChild(titleRow);
      meta.appendChild(sub);

      const actions = document.createElement('div');
      actions.className = 'queue-card-actions';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'queue-card-btn edit';
      editBtn.textContent = editingQueueItemId === item.id ? '✓' : '✎';
      editBtn.title = t('editItemBtn', 'Modifica');
      editBtn.setAttribute('aria-label', t('editItemBtn', 'Modifica'));
      editBtn.addEventListener('click', () => {
        flushQueueEditor();
        editingQueueItemId = editingQueueItemId === item.id ? null : item.id;
        renderQueueCards();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'queue-card-btn remove';
      removeBtn.textContent = '×';
      removeBtn.title = t('removeItemBtn', 'Rimuovi');
      removeBtn.setAttribute('aria-label', t('removeItemBtn', 'Rimuovi'));
      removeBtn.addEventListener('click', () => {
        flushQueueEditor();
        state.textQueue = state.textQueue.filter((q) => q.id !== item.id);
        if (editingQueueItemId === item.id) editingQueueItemId = null;
        persistKeys({ textQueue: state.textQueue });
        updateUI();
      });

      actions.appendChild(editBtn);
      actions.appendChild(removeBtn);

      header.appendChild(meta);
      header.appendChild(actions);
      card.appendChild(header);

      if (editingQueueItemId === item.id) {
        const editor = document.createElement('textarea');
        editor.className = 'queue-item-editor';
        editor.value = item.text;
        editor.addEventListener('input', (e) => {
          const target = state.textQueue.find((q) => q.id === item.id);
          if (target) {
            target.text = e.target.value;
            queueDirty = true;
            debouncedSaveQueue();
            updateLengthAndSplitUI();
          }
        });
        editor.addEventListener('blur', () => {
          // Remove item only if explicitly emptied after blur
          const target = state.textQueue.find((q) => q.id === item.id);
          if (target && !target.text.trim()) {
            state.textQueue = state.textQueue.filter((q) => q.id !== item.id);
            editingQueueItemId = null;
            queueDirty = false;
            persistKeys({ textQueue: state.textQueue });
            updateUI();
          } else {
            flushQueueEditor();
          }
        });
        card.appendChild(editor);
      }

      queueItemsList.appendChild(card);
    });
  };

  // --- API Output & History Rendering (Single render path — Bug #3 fixed!) ---
  const renderHistoryUI = () => {
    const count = state.apiHistory.length;
    const hasOutput = !apiOutputContainer.classList.contains('hidden');

    historyToggleBtn.classList.toggle('hidden', count === 0);
    historyToggleBtn.textContent = count > 0 ? `🕒 ${count}` : '🕒';

    historyStandaloneRow.classList.toggle('hidden', hasOutput || count === 0);
    if (count > 0) {
      openHistoryStandaloneBtn.textContent = `🕒 ${t('historyTitle', 'Cronologia API')} (${count})`;
    }

    if (count === 0) {
      apiHistoryPanel.classList.add('hidden');
      return;
    }

    apiHistoryList.textContent = '';
    state.apiHistory.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'history-item';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'history-item-btn';

      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = entry.title || entry.text.split('\n')[0].replace(/^#+\s*/, '').slice(0, 48) || entry.model;

      const meta = document.createElement('div');
      meta.className = 'history-item-meta';
      const dateStr = entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '';
      meta.textContent = `${entry.model || entry.target} · ${dateStr}`;

      btn.appendChild(title);
      btn.appendChild(meta);
      btn.addEventListener('click', () => {
        const loadedJob = {
          id: entry.id,
          status: entry.status === 'aborted' ? 'aborted' : 'done',
          target: entry.target,
          model: entry.model,
          title: entry.title || '',
          text: entry.text,
          error: '',
          truncated: Boolean(entry.truncated),
          startedAt: entry.createdAt,
        };
        apiHistoryPanel.classList.add('hidden');
        persistKeys({ apiJob: loadedJob });
        renderApiJob(loadedJob);
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'queue-card-btn remove';
      delBtn.textContent = '×';
      delBtn.title = t('removeItemBtn', 'Rimuovi');
      delBtn.setAttribute('aria-label', t('removeItemBtn', 'Rimuovi'));
      delBtn.addEventListener('click', () => {
        state.apiHistory = state.apiHistory.filter((h) => h.id !== entry.id);
        persistKeys({ apiHistory: state.apiHistory });
        renderHistoryUI();
      });

      row.appendChild(btn);
      row.appendChild(delBtn);
      apiHistoryList.appendChild(row);
    });
  };

  const renderApiJob = (job) => {
    state.apiJob = job || null;
    if (!job) {
      lastRenderedJobKey = '';
      apiOutputContainer.classList.add('hidden');
      apiTruncatedWarning.classList.add('hidden');
      stopBtn.classList.add('hidden');
      submitBtn.disabled = false;
      submitBtn.textContent = t('submitBtn', 'Invia a LLM');
      renderHistoryUI();
      return;
    }

    const renderKey = `${job.id}|${job.status}|${(job.text || '').length}|${job.error || ''}|${Boolean(job.truncated)}`;
    if (renderKey === lastRenderedJobKey) return;
    lastRenderedJobKey = renderKey;

    apiOutputContainer.classList.remove('hidden');
    const isStreaming = job.status === 'streaming';
    stopBtn.classList.toggle('hidden', !isStreaming);
    submitBtn.disabled = isStreaming;
    submitBtn.textContent = isStreaming
      ? t('apiStreamingBtn', 'Generazione in corso...')
      : t('submitBtn', 'Invia a LLM');

    const titleBase = t('apiOutputTitle', 'Risposta API');
    apiOutputTitle.textContent = job.model ? `${titleBase} (${job.model})` : titleBase;
    apiTruncatedWarning.classList.toggle('hidden', !job.truncated);
    renderHistoryUI();

    if (job.status === 'error') {
      apiOutput.textContent = '';
      if (job.text) {
        const partial = document.createElement('div');
        partial.innerHTML = renderMarkdown(job.text);
        apiOutput.appendChild(partial);
      }
      const errDiv = document.createElement('div');
      errDiv.className = 'output-error';
      errDiv.textContent = `${t('errorPrefix', 'Errore:')} ${job.error || 'Unknown error'}`;
      apiOutput.appendChild(errDiv);
      return;
    }

    if (!job.text && isStreaming) {
      apiOutput.textContent = '';
      const loading = document.createElement('div');
      loading.className = 'output-loading';
      loading.textContent = t('apiProcessing', 'Elaborazione in corso...');
      apiOutput.appendChild(loading);
      return;
    }

    // Safe XSS-escaped Markdown rendering
    apiOutput.innerHTML = renderMarkdown(job.text || '');
    if (job.status === 'aborted') {
      const note = document.createElement('div');
      note.className = 'output-loading';
      note.textContent = t('apiAbortedNotice', '[Generazione interrotta]');
      apiOutput.appendChild(note);
    }
  };

  // --- Persistent Split & Copy Helpers (Bug #1 fixed!) ---
  const copySplitPartAt = async (index) => {
    flushAllPending();
    const fullText = getFormattedQueueText();
    if (!fullText.trim()) return;

    const maxCap = Math.min(getWebWarningLimitChars(state.targetLLM) - 1500, DEFAULT_CHUNK_CHARS);
    const promptText = getEffectivePromptText();
    const sig = computeTextSignature(`${fullText}|${promptText}|${state.targetLLM}|${state.outputLanguage}`);

    if (cachedSplitSig !== sig || cachedSplitChunks.length === 0) {
      cachedSplitChunks = splitTextIntoChunks(fullText, Math.max(8000, maxCap));
      cachedSplitSig = sig;
    }

    const total = cachedSplitChunks.length;
    if (total === 0 || index < 0 || index >= total) return;

    const payload = buildSplitChunkPayload({
      chunks: cachedSplitChunks,
      index,
      promptText,
      outputLanguage: state.outputLanguage,
      labels: {
        intro: t('splitIntroPrefix', '').replace('{total}', String(total)) || undefined,
        part: t('splitPartWord', 'PART'),
        endMarker: t('splitEndMarker', 'END OF TEXT'),
      },
    });

    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      showBanner(t('errClipboardWrite', 'Impossibile copiare negli appunti.'), 'error');
      return;
    }

    const existing =
      state.splitProgress && state.splitProgress.signature === sig
        ? state.splitProgress
        : { signature: sig, copiedIndices: [], nextIndex: 0 };

    const copiedSet = new Set(Array.isArray(existing.copiedIndices) ? existing.copiedIndices : []);
    copiedSet.add(index);
    const nextIndex = index + 1 < total ? index + 1 : 0;

    state.splitProgress = {
      signature: sig,
      copiedIndices: [...copiedSet].sort((a, b) => a - b),
      nextIndex,
    };
    await persistKeys({ splitProgress: state.splitProgress });

    if (copiedSet.size === total) {
      showBanner(t('splitAllCopied', 'Tutte le parti copiate!'), 'success');
    } else {
      showBanner(`${t('splitCopiedNext', 'Copiata parte')} ${index + 1}/${total}`, 'success', 2000);
    }
    updateLengthAndSplitUI();
  };

  const updateLengthAndSplitUI = () => {
    const fullText = getFormattedQueueText();
    const charCount = fullText.length;
    const tokenCount = Math.floor(charCount / 4);
    const charMsg = t('charCount', 'Caratteri');
    const tokenMsg = t('tokenCount', 'Token');
    lengthText.textContent = `${charCount.toLocaleString()} ${charMsg} / ~${tokenCount.toLocaleString()} ${tokenMsg}`;

    const maxWebChars = getWebWarningLimitChars(state.targetLLM);
    const percentage = Math.min((charCount / maxWebChars) * 100, 100);
    lengthProgress.style.width = `${percentage}%`;

    const isOverWebLimit = charCount > maxWebChars && state.executionMode === 'web';
    if (!isOverWebLimit) {
      lengthProgress.style.backgroundColor = percentage > 80 ? 'var(--warning-color)' : 'var(--primary-color)';
      lengthWarning.classList.add('hidden');
      splitCopyBox.classList.add('hidden');
      return;
    }

    lengthProgress.style.backgroundColor = 'var(--danger-color)';
    lengthWarning.classList.remove('hidden');
    splitCopyBox.classList.remove('hidden');

    const promptText = getEffectivePromptText();
    const sig = computeTextSignature(`${fullText}|${promptText}|${state.targetLLM}|${state.outputLanguage}`);
    if (cachedSplitSig !== sig || cachedSplitChunks.length === 0) {
      const maxCap = Math.min(maxWebChars - 1500, DEFAULT_CHUNK_CHARS);
      cachedSplitChunks = splitTextIntoChunks(fullText, Math.max(8000, maxCap));
      cachedSplitSig = sig;
    }

    const total = cachedSplitChunks.length;
    const validProgress =
      state.splitProgress && state.splitProgress.signature === sig
        ? state.splitProgress
        : { signature: sig, copiedIndices: [], nextIndex: 0 };

    const copiedSet = new Set(Array.isArray(validProgress.copiedIndices) ? validProgress.copiedIndices : []);
    const nextIdx =
      Number.isInteger(validProgress.nextIndex) && validProgress.nextIndex >= 0 && validProgress.nextIndex < total
        ? validProgress.nextIndex
        : 0;

    if (copiedSet.size === 0) {
      splitCopyBtn.textContent = `${t('splitCopyStart', 'Testo lungo: Dividi e Copia (Parte 1)')} (${total})`;
    } else if (copiedSet.size >= total) {
      splitCopyBtn.textContent = t('splitAllCopied', 'Tutte le parti copiate! (Ricomincia)');
    } else {
      splitCopyBtn.textContent = `${t('splitNextPart', 'Copia parte')} ${nextIdx + 1}/${total}`;
    }

    splitPartsRow.textContent = '';
    for (let i = 0; i < total; i++) {
      const pill = document.createElement('button');
      pill.type = 'button';
      const isCopied = copiedSet.has(i);
      const isNext = i === nextIdx && copiedSet.size < total;
      pill.className = `split-part-pill${isCopied ? ' copied' : ''}${isNext ? ' next' : ''}`;
      pill.textContent = isCopied ? `✓ ${i + 1}` : `${t('splitPartShort', 'P')}${i + 1}`;
      pill.title = `${t('splitNextPart', 'Copia parte')} ${i + 1}/${total}`;
      pill.addEventListener('click', () => copySplitPartAt(i));
      splitPartsRow.appendChild(pill);
    }
  };

  // --- Prompt UI Sync ---
  const FIXED_PROMPT_OPTIONS_COUNT = 4; // Short, Detailed, KeyPoints, Custom

  const updatePromptEditorUI = () => {
    const isCustom = state.selectedPrompt === 'custom';
    const isSaved = state.selectedPrompt.startsWith('saved_');
    const isPreset = BUILTIN_PROMPT_IDS.includes(state.selectedPrompt);
    const showEditor = isCustom || promptEditorExpanded;

    togglePromptEditorBtn.classList.toggle('active', showEditor);
    customPromptContainer.classList.toggle('hidden', !showEditor);

    if (!showEditor) {
      hidePromptNameRow();
      resetDeleteConfirm();
      return;
    }

    if (document.activeElement !== customPrompt) {
      if (isCustom) {
        customPrompt.value = state.customPromptText;
      } else if (state.promptDraft && state.promptDraft.promptId === state.selectedPrompt) {
        customPrompt.value = state.promptDraft.text;
      } else {
        customPrompt.value = getBasePromptText(state.selectedPrompt);
      }
    }

    const modified = hasActiveDraft();
    const hasPresetOverride = isPreset && Boolean(String(state.customPresetOverrides?.[state.selectedPrompt] || '').trim());

    promptModifiedBadge.classList.toggle('hidden', !modified);
    updatePromptBtn.classList.toggle('hidden', isCustom || !modified);
    renamePromptBtn.classList.toggle('hidden', !isSaved);
    revertPromptBtn.classList.toggle('hidden', isCustom || (!modified && !hasPresetOverride));
    deletePromptBtn.classList.toggle('hidden', !isSaved);
  };

  // --- Main UI Sync ---
  const updateUI = () => {
    while (promptType.options.length > FIXED_PROMPT_OPTIONS_COUNT) {
      promptType.remove(FIXED_PROMPT_OPTIONS_COUNT);
    }
    state.savedPrompts.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      promptType.add(opt);
    });
    promptType.value = state.selectedPrompt;
    outputLanguageSelect.value = state.outputLanguage;

    updatePromptEditorUI();

    targetLlm.value = state.targetLLM;
    const supportsWeb = Boolean(PROVIDERS[state.targetLLM]?.hasWebUI);
    webModeRadio.disabled = !supportsWeb;
    webModeLabel.classList.toggle('disabled', !supportsWeb);
    localWebHint.classList.toggle('hidden', supportsWeb);
    if (!supportsWeb && state.executionMode === 'web') {
      state.executionMode = 'api';
    }
    webModeRadio.checked = state.executionMode === 'web';
    apiModeRadio.checked = state.executionMode === 'api';
    autosubmitCb.checked = state.autoSubmit;

    autosubmitContainer.classList.toggle('hidden', state.executionMode !== 'web');
    apiModelBar.classList.toggle('hidden', state.executionMode !== 'api');
    if (state.executionMode === 'api') {
      const model = resolveModel(state.targetLLM, state.apiModels[state.targetLLM]);
      apiModelBadge.textContent = `${t('activeModelPrefix', 'Modello:')} ${model}`;
    }

    const countMsg = t('queueStatus', 'Elementi in coda: ');
    queueCounter.textContent = `${countMsg}${state.textQueue.length}`;

    if (
      !queueViewerContainer.classList.contains('hidden') &&
      !document.activeElement?.classList?.contains('queue-item-editor')
    ) {
      renderQueueCards();
    }
    updateLengthAndSplitUI();
    renderHistoryUI();
  };

  updateUI();
  if (state.apiJob?.status === 'streaming') {
    try {
      const rec = await chrome.runtime.sendMessage({ action: 'reconcileApiJob' });
      if (rec?.ok) state.apiJob = rec.job;
    } catch {
      // ignore
    }
  }
  renderApiJob(state.apiJob);

  // --- Live Storage Listener (single source of truth across popup, side panel, and options) ---
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local') return;
    let needsUi = false;
    if (changes.textQueue) {
      state.textQueue = normalizeQueue(changes.textQueue.newValue);
      needsUi = true;
    }
    if (changes.selectedPrompt) {
      const next = changes.selectedPrompt.newValue;
      if (isValidPrompt(next)) {
        state.selectedPrompt = next;
        needsUi = true;
      }
    }
    if (changes.customPromptText && typeof changes.customPromptText.newValue === 'string') {
      state.customPromptText = changes.customPromptText.newValue;
      needsUi = true;
    }
    if (changes.promptDraft) {
      state.promptDraft = changes.promptDraft.newValue || null;
      needsUi = true;
    }
    if (changes.outputLanguage && typeof changes.outputLanguage.newValue === 'string') {
      state.outputLanguage = changes.outputLanguage.newValue;
      needsUi = true;
    }
    if (changes.targetLLM && PROVIDERS[changes.targetLLM.newValue]) {
      state.targetLLM = changes.targetLLM.newValue;
      needsUi = true;
    }
    if (changes.executionMode && (changes.executionMode.newValue === 'web' || changes.executionMode.newValue === 'api')) {
      state.executionMode = changes.executionMode.newValue;
      needsUi = true;
    }
    if (changes.autoSubmit) {
      state.autoSubmit = Boolean(changes.autoSubmit.newValue);
      needsUi = true;
    }
    if (changes.isDarkMode) {
      state.isDarkMode = Boolean(changes.isDarkMode.newValue);
      applyTheme(state.isDarkMode);
    }
    if (changes.apiModels) {
      state.apiModels = changes.apiModels.newValue || {};
      needsUi = true;
    }
    if (changes.markdownOptions) {
      state.markdownOptions = { includeSourceMeta: true, ...(changes.markdownOptions.newValue || {}) };
      needsUi = true;
    }
    if (changes.savedPrompts) {
      state.savedPrompts = Array.isArray(changes.savedPrompts.newValue) ? changes.savedPrompts.newValue : [];
      if (!isValidPrompt(state.selectedPrompt)) state.selectedPrompt = 'promptShort';
      needsUi = true;
    }
    if (changes.customPresetOverrides) {
      state.customPresetOverrides = changes.customPresetOverrides.newValue || {};
      needsUi = true;
    }
    if (changes.splitProgress) {
      state.splitProgress = changes.splitProgress.newValue || null;
      needsUi = true;
    }
    if (changes.apiHistory) {
      state.apiHistory = Array.isArray(changes.apiHistory.newValue) ? changes.apiHistory.newValue : [];
      renderHistoryUI();
    }
    if (changes.apiJob) {
      renderApiJob(changes.apiJob.newValue || null);
    }
    if (needsUi) updateUI();
  });

  // --- Prompt Listeners (Non-destructive editing!) ---
  promptType.addEventListener('change', (e) => {
    flushPromptEditor();
    state.selectedPrompt = e.target.value;
    if (state.selectedPrompt === 'custom') {
      promptEditorExpanded = true;
    }
    hidePromptNameRow();
    resetDeleteConfirm();
    persistKeys({ selectedPrompt: state.selectedPrompt });
    updateUI();
  });

  togglePromptEditorBtn.addEventListener('click', () => {
    if (state.selectedPrompt === 'custom') {
      customPrompt.focus();
      return;
    }
    promptEditorExpanded = !promptEditorExpanded;
    updatePromptEditorUI();
    if (promptEditorExpanded) customPrompt.focus();
  });

  outputLanguageSelect.addEventListener('change', (e) => {
    state.outputLanguage = e.target.value;
    persistKeys({ outputLanguage: state.outputLanguage });
    updateLengthAndSplitUI();
  });

  customPrompt.addEventListener('input', (e) => {
    const val = e.target.value;
    if (state.selectedPrompt === 'custom') {
      state.customPromptText = val;
    } else {
      const base = getBasePromptText(state.selectedPrompt);
      state.promptDraft = val === base ? null : { promptId: state.selectedPrompt, text: val };
    }
    promptDirty = true;
    debouncedSavePrompt();
    updatePromptEditorUI();
    updateLengthAndSplitUI();
  });

  customPrompt.addEventListener('blur', flushPromptEditor);

  // Explicit Update of saved prompt OR preset override
  updatePromptBtn.addEventListener('click', () => {
    const text = customPrompt.value.trim();
    if (!text) {
      showBanner(t('promptEmptyError', 'Scrivi un prompt prima di salvarlo.'), 'warning');
      return;
    }
    if (state.selectedPrompt.startsWith('saved_')) {
      const found = state.savedPrompts.find((x) => x.id === state.selectedPrompt);
      if (found) {
        found.text = text;
        state.promptDraft = null;
        promptDirty = false;
        persistKeys({ savedPrompts: state.savedPrompts, promptDraft: null });
        updatePromptEditorUI();
        showBanner(t('promptUpdatedMsg', 'Prompt aggiornato!'), 'success');
      }
      return;
    }
    if (BUILTIN_PROMPT_IDS.includes(state.selectedPrompt)) {
      state.customPresetOverrides = { ...state.customPresetOverrides, [state.selectedPrompt]: text };
      state.promptDraft = null;
      promptDirty = false;
      persistKeys({ customPresetOverrides: state.customPresetOverrides, promptDraft: null });
      updatePromptEditorUI();
      showBanner(t('promptUpdatedMsg', 'Prompt aggiornato!'), 'success');
    }
  });

  // Save as new named prompt
  savePromptBtn.addEventListener('click', () => {
    const text = customPrompt.value.trim();
    if (!text) {
      showBanner(t('promptEmptyError', 'Scrivi un prompt prima di salvarlo.'), 'warning');
      return;
    }
    promptNameMode = 'new';
    promptNameInput.value = '';
    promptNameRow.classList.remove('hidden');
    promptNameInput.focus();
  });

  // Rename existing saved prompt
  renamePromptBtn.addEventListener('click', () => {
    if (!state.selectedPrompt.startsWith('saved_')) return;
    const found = state.savedPrompts.find((x) => x.id === state.selectedPrompt);
    if (!found) return;
    promptNameMode = 'rename';
    promptNameInput.value = found.name;
    promptNameRow.classList.remove('hidden');
    promptNameInput.focus();
    promptNameInput.select();
  });

  // Revert unsaved draft (or reset built-in preset back to default)
  revertPromptBtn.addEventListener('click', () => {
    if (hasActiveDraft()) {
      state.promptDraft = null;
      promptDirty = false;
      persistKeys({ promptDraft: null });
      customPrompt.value = getBasePromptText(state.selectedPrompt);
      updatePromptEditorUI();
      showBanner(t('promptRevertedMsg', 'Modifiche annullate.'), 'info');
      return;
    }
    if (BUILTIN_PROMPT_IDS.includes(state.selectedPrompt) && state.customPresetOverrides[state.selectedPrompt]) {
      const nextOverrides = { ...state.customPresetOverrides };
      delete nextOverrides[state.selectedPrompt];
      state.customPresetOverrides = nextOverrides;
      persistKeys({ customPresetOverrides: nextOverrides });
      customPrompt.value = getDefaultPresetText(state.selectedPrompt, t);
      updatePromptEditorUI();
      showBanner(t('presetRestoredMsg', 'Preset predefinito ripristinato.'), 'info');
    }
  });

  const commitPromptName = () => {
    const name = promptNameInput.value.trim();
    if (!name) {
      showBanner(t('promptNameRequired', 'Inserisci un nome per il prompt.'), 'warning');
      promptNameInput.focus();
      return;
    }

    if (promptNameMode === 'rename' && state.selectedPrompt.startsWith('saved_')) {
      const found = state.savedPrompts.find((x) => x.id === state.selectedPrompt);
      if (found) {
        found.name = name;
        hidePromptNameRow();
        persistKeys({ savedPrompts: state.savedPrompts });
        updateUI();
        showBanner(t('promptRenamedMsg', 'Prompt rinominato!'), 'success');
      }
      return;
    }

    const text = customPrompt.value.trim();
    if (!text) {
      showBanner(t('promptEmptyError', 'Scrivi un prompt prima di salvarlo.'), 'warning');
      return;
    }
    const newPrompt = { id: `saved_${Date.now()}`, name, text };
    state.savedPrompts.push(newPrompt);
    state.selectedPrompt = newPrompt.id;
    state.promptDraft = null;
    promptDirty = false;
    hidePromptNameRow();
    persistKeys({
      savedPrompts: state.savedPrompts,
      selectedPrompt: state.selectedPrompt,
      promptDraft: null,
    });
    updateUI();
    showBanner(t('promptSavedMsg', 'Prompt salvato!'), 'success');
  };

  confirmSavePromptBtn.addEventListener('click', commitPromptName);
  promptNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPromptName();
    } else if (e.key === 'Escape') {
      hidePromptNameRow();
    }
  });
  cancelSavePromptBtn.addEventListener('click', hidePromptNameRow);

  deletePromptBtn.addEventListener('click', () => {
    if (!state.selectedPrompt.startsWith('saved_')) return;
    if (!pendingDeleteConfirm) {
      pendingDeleteConfirm = true;
      deletePromptBtn.textContent = t('deletePromptConfirm', 'Conferma elimina?');
      clearTimeout(deleteConfirmTimer);
      deleteConfirmTimer = setTimeout(resetDeleteConfirm, 3500);
      return;
    }
    state.savedPrompts = state.savedPrompts.filter((x) => x.id !== state.selectedPrompt);
    state.selectedPrompt = 'custom';
    state.promptDraft = null;
    resetDeleteConfirm();
    persistKeys({
      savedPrompts: state.savedPrompts,
      selectedPrompt: state.selectedPrompt,
      promptDraft: null,
    });
    updateUI();
    showBanner(t('promptDeletedMsg', 'Prompt eliminato.'), 'info');
  });

  // --- LLM / Mode Listeners ---
  targetLlm.addEventListener('change', (e) => {
    state.targetLLM = e.target.value;
    if (!PROVIDERS[state.targetLLM]?.hasWebUI) {
      state.executionMode = 'api';
    }
    persistKeys({
      targetLLM: state.targetLLM,
      executionMode: state.executionMode,
    });
    updateUI();
  });

  modeRadios.forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (e.target.disabled) return;
      state.executionMode = e.target.value;
      persistKeys({ executionMode: state.executionMode });
      updateUI();
    });
  });

  autosubmitCb.addEventListener('change', (e) => {
    state.autoSubmit = e.target.checked;
    persistKeys({ autoSubmit: state.autoSubmit });
  });

  // --- Queue Listeners ---
  viewQueueBtn.addEventListener('click', () => {
    const isHidden = queueViewerContainer.classList.contains('hidden');
    queueViewerContainer.classList.toggle('hidden', !isHidden);
    viewQueueBtn.textContent = isHidden ? t('hideQueue', 'Nascondi') : t('viewQueue', 'Visualizza');
    if (isHidden) renderQueueCards();
  });

  addManualItemBtn.addEventListener('click', () => {
    manualAddRow.classList.remove('hidden');
    manualItemInput.focus();
  });

  cancelManualItemBtn.addEventListener('click', () => {
    manualAddRow.classList.add('hidden');
    manualItemInput.value = '';
  });

  confirmManualItemBtn.addEventListener('click', () => {
    const text = manualItemInput.value.trim();
    if (!text) return;
    const item = createQueueItem({ text, kind: 'manual' });
    if (item) {
      state.textQueue = [...state.textQueue, item];
      persistKeys({ textQueue: state.textQueue });
      manualItemInput.value = '';
      manualAddRow.classList.add('hidden');
      updateUI();
    }
  });

  clearQueueBtn.addEventListener('click', () => {
    state.textQueue = [];
    editingQueueItemId = null;
    queueDirty = false;
    persistKeys({ textQueue: [], splitProgress: null });
    updateUI();
  });

  // --- Capture Actions ---
  const captureFromActiveTab = async (method, btn) => {
    const origText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t('capturingBtn', 'Estrazione...');
    try {
      const res = await chrome.runtime.sendMessage({ action: 'captureActiveTab', method });
      if (res?.ok) {
        const msg =
          method === 'getSelection'
            ? t('statusSelectionCaptured', 'Selezione aggiunta alla coda.')
            : t('statusPageCaptured', 'Pagina aggiunta alla coda.');
        showBanner(`${msg} (${res.charCount.toLocaleString()} ${t('charCount', 'caratteri')})`, 'success');
      } else {
        const codeMap = {
          restrictedPage: t('errRestrictedPage', 'Impossibile estrarre testo da questa pagina interna del browser.'),
          emptySelection: t('errEmptySelection', 'Nessun testo selezionato nella pagina corrente.'),
          emptyPage: t('errEmptyPage', 'Nessun testo leggibile trovato nella pagina.'),
          noActiveTab: t('errNoActiveTab', 'Nessuna scheda attiva trovata.'),
        };
        const msg = codeMap[res?.errorCode] || res?.error || t('errCaptureFailed', 'Estrazione non riuscita.');
        showBanner(msg, 'warning', 4500);
      }
    } catch (err) {
      showBanner(err?.message || t('errCaptureFailed', 'Estrazione non riuscita.'), 'error', 4500);
    } finally {
      btn.disabled = false;
      btn.textContent = origText;
    }
  };

  capturePageBtn.addEventListener('click', () => captureFromActiveTab('getPageText', capturePageBtn));
  captureSelectionBtn.addEventListener('click', () => captureFromActiveTab('getSelection', captureSelectionBtn));

  // --- Split & Copy Button ---
  splitCopyBtn.addEventListener('click', () => {
    const fullText = getFormattedQueueText();
    const promptText = getEffectivePromptText();
    const sig = computeTextSignature(`${fullText}|${promptText}|${state.targetLLM}|${state.outputLanguage}`);
    const nextIdx =
      state.splitProgress && state.splitProgress.signature === sig && Number.isInteger(state.splitProgress.nextIndex)
        ? state.splitProgress.nextIndex
        : 0;
    copySplitPartAt(nextIdx);
  });

  // --- Submit / Stop ---
  submitBtn.addEventListener('click', async () => {
    flushAllPending();
    if (state.textQueue.length === 0) {
      showBanner(t('queueEmpty', 'La coda è vuota. Cattura del testo prima di inviare.'), 'warning');
      return;
    }

    const promptText = getEffectivePromptText();
    if (!promptText) {
      showBanner(t('promptEmptyError', 'Scrivi un prompt prima di inviare.'), 'warning');
      return;
    }

    const fullText = getFormattedQueueText();
    const textLabel = t('textLabel', 'Testo:');
    const { webPayload, systemPrompt, userPrompt } = buildPayloads({
      promptText,
      contentText: fullText,
      outputLanguage: state.outputLanguage,
      textLabel,
    });

    if (state.executionMode === 'web') {
      if (!PROVIDERS[state.targetLLM]?.hasWebUI) {
        showBanner(t('localApiOnlyHint', 'I modelli locali supportano solo la modalità API.'), 'warning');
        return;
      }
      submitBtn.textContent = t('submitBtnLoading', 'Apertura Web Mode...');
      submitBtn.disabled = true;
      const res = await chrome.runtime.sendMessage({
        action: 'triggerWebMode',
        payload: webPayload,
        target: state.targetLLM,
        autoSubmit: state.autoSubmit,
      });
      if (res?.ok) {
        if (state.markdownOptions?.autoClearQueue) {
          state.textQueue = [];
          await persistKeys({ textQueue: [], splitProgress: null });
        }
        if (viewMode === 'popup') {
          setTimeout(() => window.close(), 600);
        } else {
          submitBtn.disabled = false;
          submitBtn.textContent = t('submitBtn', 'Invia a LLM');
        }
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = t('submitBtn', 'Invia a LLM');
        showBanner(res?.error || t('errWebModeFailed', 'Impossibile avviare la Web Mode.'), 'error');
      }
      return;
    }

    // API Mode (system/user separation, runs in background.js)
    const primaryTitle = state.textQueue[0]?.title || state.textQueue[0]?.text.split('\n')[0].slice(0, 60) || '';
    submitBtn.disabled = true;
    const res = await chrome.runtime.sendMessage({
      action: 'startApiSummary',
      systemPrompt,
      userPrompt,
      target: state.targetLLM,
      title: primaryTitle,
    });
    if (res?.ok && res.job) {
      renderApiJob(res.job);
      if (state.markdownOptions?.autoClearQueue) {
        state.textQueue = [];
        await persistKeys({ textQueue: [], splitProgress: null });
        updateUI();
      }
    } else {
      submitBtn.disabled = false;
      showBanner(res?.error || t('errorPrefix', 'Errore'), 'error');
    }
  });

  stopBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'cancelApiSummary' });
  });

  // --- Output & History Actions ---
  const toggleHistoryPanel = () => {
    apiHistoryPanel.classList.toggle('hidden');
    if (!apiHistoryPanel.classList.contains('hidden')) renderHistoryUI();
  };
  historyToggleBtn.addEventListener('click', toggleHistoryPanel);
  openHistoryStandaloneBtn.addEventListener('click', toggleHistoryPanel);

  clearHistoryBtn.addEventListener('click', () => {
    state.apiHistory = [];
    apiHistoryPanel.classList.add('hidden');
    persistKeys({ apiHistory: [] });
    renderHistoryUI();
  });

  copyOutputBtn.addEventListener('click', async () => {
    const raw = state.apiJob?.text || apiOutput.innerText || '';
    if (!raw.trim()) return;
    try {
      await navigator.clipboard.writeText(raw);
      const orig = copyOutputBtn.textContent;
      copyOutputBtn.textContent = t('copiedLabel', 'Copiato!');
      setTimeout(() => {
        copyOutputBtn.textContent = orig;
      }, 1800);
    } catch {
      showBanner(t('errClipboardWrite', 'Impossibile copiare negli appunti.'), 'error');
    }
  });

  downloadMdBtn.addEventListener('click', () => {
    const raw = state.apiJob?.text || '';
    if (!raw.trim()) return;
    const filename = slugifyFilename(state.apiJob?.title);
    const blob = new Blob([raw], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showBanner(`${t('downloadedMdMsg', 'Scaricato:')} ${filename}`, 'success', 2200);
  });

  clearOutputBtn.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'clearApiJob' });
    renderApiJob(null);
  });
});
