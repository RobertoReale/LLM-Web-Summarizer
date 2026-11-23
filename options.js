// options.js — Options page controller with Prompt Manager, Validation, and Connection Testing (ES Module)

import {
  PROVIDERS,
  BUILTIN_PROMPT_IDS,
  DEFAULT_MODELS,
  DEFAULT_SELECTORS,
  getDefaultPresetText,
  parseSelectorList,
  resolveModel,
  validateLocalUrl,
} from './modules/config.js';

const t = (key, fallback = '') => {
  try {
    return chrome.i18n?.getMessage(key) || fallback;
  } catch {
    return fallback;
  }
};

document.addEventListener('DOMContentLoaded', async () => {
  // --- Localization ---
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

  // --- Elements ---
  const themeToggleBtn = document.getElementById('theme-toggle-btn');

  const keyInputs = {
    chatgpt: document.getElementById('openai-key'),
    claude: document.getElementById('anthropic-key'),
    gemini: document.getElementById('gemini-key'),
    perplexity: document.getElementById('perplexity-key'),
    local: document.getElementById('local-key'),
  };
  const localUrl = document.getElementById('local-url');

  const modelInputs = {
    chatgpt: document.getElementById('openai-model'),
    claude: document.getElementById('anthropic-model'),
    gemini: document.getElementById('gemini-model'),
    perplexity: document.getElementById('perplexity-model'),
    local: document.getElementById('local-model'),
  };

  const datalists = {
    chatgpt: document.getElementById('openai-models'),
    claude: document.getElementById('anthropic-models'),
    gemini: document.getElementById('gemini-models'),
    perplexity: document.getElementById('perplexity-models'),
    local: document.getElementById('local-models'),
  };

  const presetInputs = {
    promptShort: document.getElementById('preset-short'),
    promptDetailed: document.getElementById('preset-detailed'),
    promptKeyPoints: document.getElementById('preset-keypoints'),
  };

  const savedPromptsList = document.getElementById('saved-prompts-list');
  const newPromptName = document.getElementById('new-prompt-name');
  const newPromptText = document.getElementById('new-prompt-text');
  const addSavedPromptBtn = document.getElementById('add-saved-prompt-btn');
  const resetPresetsBtn = document.getElementById('reset-presets-btn');

  const selectorInputs = {
    chatgpt: document.getElementById('chatgpt-selectors'),
    claude: document.getElementById('claude-selectors'),
    gemini: document.getElementById('gemini-selectors'),
    perplexity: document.getElementById('perplexity-selectors'),
  };

  const includeSourceMetaCb = document.getElementById('include-source-meta');
  const keepLinksCb = document.getElementById('keep-links');
  const keepImagesCb = document.getElementById('keep-images');
  const autoScrollCb = document.getElementById('auto-scroll');
  const autoClearQueueCb = document.getElementById('auto-clear-queue');

  const resetModelsBtn = document.getElementById('reset-models-btn');
  const resetSelectorsBtn = document.getElementById('reset-selectors-btn');
  const saveBtn = document.getElementById('save-btn');
  const statusMsg = document.getElementById('status-msg');

  let savedPrompts = [];
  let statusTimer = null;

  const showStatus = (text, kind = 'success', durationMs = 2800) => {
    statusMsg.textContent = text;
    statusMsg.className = `status${kind === 'success' ? '' : ` ${kind}`}`;
    clearTimeout(statusTimer);
    if (durationMs > 0) {
      statusTimer = setTimeout(() => {
        statusMsg.classList.add('hidden');
      }, durationMs);
    }
  };

  // Populate model suggestion datalists
  Object.entries(datalists).forEach(([target, dl]) => {
    (PROVIDERS[target]?.suggestedModels || []).forEach((modelId) => {
      const opt = document.createElement('option');
      opt.value = modelId;
      dl.appendChild(opt);
    });
  });

  // Show/hide API key toggles
  document.querySelectorAll('.toggle-secret-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? '🙈' : '👁️';
    });
  });

  // Theme sync
  let isDarkMode = false;
  const applyTheme = (dark) => {
    isDarkMode = Boolean(dark);
    document.body.classList.toggle('dark', isDarkMode);
    themeToggleBtn.textContent = isDarkMode ? '☀️' : '🌙';
  };

  themeToggleBtn.addEventListener('click', () => {
    applyTheme(!isDarkMode);
    chrome.storage.local.set({ isDarkMode });
  });

  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns !== 'local') return;
    if (changes.isDarkMode) applyTheme(changes.isDarkMode.newValue);
    if (changes.savedPrompts) {
      savedPrompts = Array.isArray(changes.savedPrompts.newValue) ? changes.savedPrompts.newValue : [];
      renderSavedPrompts();
    }
    if (changes.customPresetOverrides) {
      loadPresetInputs(changes.customPresetOverrides.newValue || {});
    }
  });

  // --- Prompt Manager Helpers ---
  const loadPresetInputs = (overrides = {}) => {
    BUILTIN_PROMPT_IDS.forEach((id) => {
      const custom = String(overrides[id] || '').trim();
      presetInputs[id].value = custom || getDefaultPresetText(id, t);
    });
  };

  const renderSavedPrompts = () => {
    savedPromptsList.textContent = '';
    if (savedPrompts.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'saved-prompt-empty';
      empty.textContent = t('noSavedPromptsMsg', 'Nessun prompt personalizzato salvato.');
      savedPromptsList.appendChild(empty);
      return;
    }

    savedPrompts.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'saved-prompt-card';
      card.dataset.promptId = item.id;

      const head = document.createElement('div');
      head.className = 'saved-prompt-head';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.value = item.name;
      nameInput.setAttribute('aria-label', t('promptNamePlaceholder', 'Nome del prompt'));
      nameInput.addEventListener('input', (e) => {
        item.name = e.target.value;
      });

      const controls = document.createElement('div');
      controls.className = 'saved-prompt-controls';

      const upBtn = document.createElement('button');
      upBtn.type = 'button';
      upBtn.className = 'mini-btn move-up';
      upBtn.textContent = '↑';
      upBtn.disabled = idx === 0;
      upBtn.title = t('moveUpBtn', 'Sposta su');
      upBtn.addEventListener('click', () => {
        if (idx === 0) return;
        const copy = [...savedPrompts];
        [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
        savedPrompts = copy;
        renderSavedPrompts();
      });

      const downBtn = document.createElement('button');
      downBtn.type = 'button';
      downBtn.className = 'mini-btn move-down';
      downBtn.textContent = '↓';
      downBtn.disabled = idx === savedPrompts.length - 1;
      downBtn.title = t('moveDownBtn', 'Sposta giù');
      downBtn.addEventListener('click', () => {
        if (idx >= savedPrompts.length - 1) return;
        const copy = [...savedPrompts];
        [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
        savedPrompts = copy;
        renderSavedPrompts();
      });

      let confirmDel = false;
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'mini-btn danger delete-saved-prompt';
      delBtn.textContent = t('deletePromptBtn', 'Elimina');
      delBtn.addEventListener('click', () => {
        if (!confirmDel) {
          confirmDel = true;
          delBtn.textContent = t('deletePromptConfirm', 'Conferma?');
          setTimeout(() => {
            confirmDel = false;
            if (delBtn.isConnected) delBtn.textContent = t('deletePromptBtn', 'Elimina');
          }, 3000);
          return;
        }
        savedPrompts = savedPrompts.filter((p) => p.id !== item.id);
        renderSavedPrompts();
      });

      controls.appendChild(upBtn);
      controls.appendChild(downBtn);
      controls.appendChild(delBtn);

      head.appendChild(nameInput);
      head.appendChild(controls);

      const textArea = document.createElement('textarea');
      textArea.rows = 2;
      textArea.value = item.text;
      textArea.addEventListener('input', (e) => {
        item.text = e.target.value;
      });

      card.appendChild(head);
      card.appendChild(textArea);
      savedPromptsList.appendChild(card);
    });
  };

  addSavedPromptBtn.addEventListener('click', () => {
    const name = newPromptName.value.trim();
    const text = newPromptText.value.trim();
    if (!name || !text) {
      showStatus(t('promptNameAndTextRequired', 'Inserisci nome e testo del prompt.'), 'warning', 3000);
      return;
    }
    savedPrompts = [...savedPrompts, { id: `saved_${Date.now()}`, name, text }];
    newPromptName.value = '';
    newPromptText.value = '';
    renderSavedPrompts();
    chrome.storage.local.set({ savedPrompts });
    showStatus(t('promptSavedMsg', 'Prompt salvato!'), 'success', 2000);
  });

  resetPresetsBtn.addEventListener('click', () => {
    loadPresetInputs({});
  });

  // --- Connection Testing ---
  const ensureHostPermissionIfNeeded = async (urlCheck) => {
    if (urlCheck.isLoopback) return true;
    try {
      const alreadyHas = await chrome.permissions?.contains({ origins: [urlCheck.originPattern] });
      if (alreadyHas) return true;
      return Boolean(await chrome.permissions?.request({ origins: [urlCheck.originPattern] }));
    } catch {
      return false;
    }
  };

  document.querySelectorAll('.test-conn-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const target = btn.dataset.provider;
      const statusEl = document.getElementById(`test-status-${target}`);
      if (!target || !statusEl) return;

      const apiKey = keyInputs[target]?.value.trim() || '';
      const model = resolveModel(target, modelInputs[target]?.value);
      let validatedLocalUrl = PROVIDERS.local.defaultUrl;

      if (target === 'local') {
        const check = validateLocalUrl(localUrl.value);
        if (!check.ok) {
          localUrl.classList.add('invalid');
          statusEl.className = 'test-status error';
          statusEl.textContent = `❌ ${t('errInvalidLocalUrl', 'URL locale non valido: deve iniziare con http:// o https://')}`;
          return;
        }
        localUrl.classList.remove('invalid');
        const granted = await ensureHostPermissionIfNeeded(check);
        if (!granted) {
          statusEl.className = 'test-status error';
          statusEl.textContent = `❌ ${t('errLocalHostPermDenied', 'Permesso di accesso negato per questo host locale.')}`;
          return;
        }
        validatedLocalUrl = check.normalized;
      }

      btn.disabled = true;
      statusEl.className = 'test-status pending';
      statusEl.textContent = t('testingConnMsg', 'Test connessione in corso...');

      try {
        const res = await chrome.runtime.sendMessage({
          action: 'testApiConnection',
          target,
          apiKey,
          model,
          localUrl: validatedLocalUrl,
        });
        if (res?.ok) {
          statusEl.className = 'test-status ok';
          statusEl.textContent = `✅ ${t('testConnOk', 'Connessione riuscita')} (${model}, ${res.latencyMs} ms)`;
        } else {
          statusEl.className = 'test-status error';
          statusEl.textContent = `❌ ${res?.error || t('errorPrefix', 'Errore')}`;
        }
      } catch (err) {
        statusEl.className = 'test-status error';
        statusEl.textContent = `❌ ${err?.message || String(err)}`;
      } finally {
        btn.disabled = false;
      }
    });
  });

  // --- Load Stored Settings ---
  try {
    const data = await chrome.storage.local.get([
      'apiKeys',
      'apiModels',
      'customSelectors',
      'markdownOptions',
      'isDarkMode',
      'savedPrompts',
      'customPresetOverrides',
    ]);

    applyTheme(data.isDarkMode);

    const keys = data.apiKeys || {};
    keyInputs.chatgpt.value = keys.openai || '';
    keyInputs.claude.value = keys.anthropic || '';
    keyInputs.gemini.value = keys.gemini || '';
    keyInputs.perplexity.value = keys.perplexity || '';
    localUrl.value = keys.localUrl || PROVIDERS.local.defaultUrl;
    keyInputs.local.value = keys.localKey || '';

    const models = data.apiModels || {};
    Object.entries(modelInputs).forEach(([target, input]) => {
      input.value = resolveModel(target, models[target]);
    });

    loadPresetInputs(data.customPresetOverrides || {});
    savedPrompts = Array.isArray(data.savedPrompts) ? data.savedPrompts.map((p) => ({ ...p })) : [];
    renderSavedPrompts();

    const selectors = data.customSelectors || {};
    Object.entries(selectorInputs).forEach(([target, input]) => {
      const saved = selectors[target]?.inputs;
      const effective = Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_SELECTORS[target].inputs;
      input.value = effective.join(', ');
    });

    const md = data.markdownOptions || {};
    includeSourceMetaCb.checked = md.includeSourceMeta !== false;
    keepLinksCb.checked = Boolean(md.keepLinks);
    keepImagesCb.checked = Boolean(md.keepImages);
    autoScrollCb.checked = Boolean(md.autoScroll);
    autoClearQueueCb.checked = Boolean(md.autoClearQueue);
  } catch (err) {
    console.error('Failed to load options:', err);
  }

  localUrl.addEventListener('input', () => {
    localUrl.classList.remove('invalid');
  });

  // --- Reset Buttons ---
  resetModelsBtn.addEventListener('click', () => {
    Object.entries(modelInputs).forEach(([target, input]) => {
      input.value = DEFAULT_MODELS[target];
    });
  });

  resetSelectorsBtn.addEventListener('click', () => {
    Object.entries(selectorInputs).forEach(([target, input]) => {
      input.value = DEFAULT_SELECTORS[target].inputs.join(', ');
    });
  });

  // --- Save with Explicit URL & Permission Validation (Bug #6 fixed!) ---
  saveBtn.addEventListener('click', async () => {
    const urlCheck = validateLocalUrl(localUrl.value);
    if (!urlCheck.ok) {
      localUrl.classList.add('invalid');
      localUrl.focus();
      showStatus(
        t('errInvalidLocalUrl', 'URL locale non valido: deve iniziare con http:// o https://'),
        'error',
        5000
      );
      return;
    }
    localUrl.classList.remove('invalid');
    localUrl.value = urlCheck.normalized;

    let permissionWarning = false;
    if (!urlCheck.isLoopback) {
      const granted = await ensureHostPermissionIfNeeded(urlCheck);
      if (!granted) permissionWarning = true;
    }

    const apiKeys = {
      openai: keyInputs.chatgpt.value.trim(),
      anthropic: keyInputs.claude.value.trim(),
      gemini: keyInputs.gemini.value.trim(),
      perplexity: keyInputs.perplexity.value.trim(),
      localUrl: urlCheck.normalized,
      localKey: keyInputs.local.value.trim(),
    };

    const apiModels = {};
    Object.entries(modelInputs).forEach(([target, input]) => {
      const resolved = resolveModel(target, input.value);
      apiModels[target] = resolved;
      input.value = resolved;
    });

    const customPresetOverrides = {};
    BUILTIN_PROMPT_IDS.forEach((id) => {
      const val = presetInputs[id].value.trim();
      const def = getDefaultPresetText(id, t).trim();
      if (val && val !== def) {
        customPresetOverrides[id] = val;
      } else {
        presetInputs[id].value = def;
      }
    });

    const cleanedSavedPrompts = savedPrompts
      .map((p) => ({ id: p.id, name: String(p.name || '').trim(), text: String(p.text || '').trim() }))
      .filter((p) => p.name && p.text);
    savedPrompts = cleanedSavedPrompts;
    renderSavedPrompts();

    const customSelectors = {};
    Object.entries(selectorInputs).forEach(([target, input]) => {
      const list = parseSelectorList(input.value, DEFAULT_SELECTORS[target].inputs);
      customSelectors[target] = { inputs: list };
      input.value = list.join(', ');
    });

    const markdownOptions = {
      includeSourceMeta: includeSourceMetaCb.checked,
      keepLinks: keepLinksCb.checked,
      keepImages: keepImagesCb.checked,
      autoScroll: autoScrollCb.checked,
      autoClearQueue: autoClearQueueCb.checked,
    };

    await chrome.storage.local.set({
      apiKeys,
      apiModels,
      customPresetOverrides,
      savedPrompts: cleanedSavedPrompts,
      customSelectors,
      markdownOptions,
    });

    if (permissionWarning) {
      showStatus(
        t(
          'optSavedPermWarning',
          'Impostazioni salvate, ma il permesso per l\'host locale è stato negato: le richieste verso quell\'URL potrebbero fallire.'
        ),
        'warning',
        6000
      );
    } else {
      showStatus(t('optionsSaved', 'Salvato con successo!'), 'success', 2400);
    }
  });
});
