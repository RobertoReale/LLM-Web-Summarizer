import asyncio
import json
import sys
import tempfile
import threading
import time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from playwright.async_api import async_playwright

EXT_PATH = str(Path(__file__).resolve().parents[2])
LAST_API_REQUEST_BODY = None


class MockServerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/article":
            html = """<!doctype html><html><head><title>Quantum Article</title></head><body>
            <nav>Site Navigation</nav>
            <main><article>
              <h1>Quantum Computing Basics</h1>
              <p>Quantum computing harnesses quantum mechanics to process information in fundamentally new ways. Unlike classical bits that are 0 or 1, qubits can exist in superposition states.</p>
              <p>See <a href="https://example.com/qubits">qubit guide</a> and <img src="https://example.com/q.png" alt="Diagram">.</p>
              <span class="mw-editsection">[edit]</span>
              <sup class="reference">[1]</sup>
              <p>Entanglement correlates qubits across distances, enabling exponential speedups on specialized tasks like factoring and quantum simulation.</p>
            </article></main>
            <footer>Footer copyright</footer>
            </body></html>"""
            self._send_html(html)
        elif self.path == "/cookie-protected":
            html = """<!doctype html><html><head><title>Protected News</title></head>
            <body class="cookie-consent-accepted">
              <div class="cookie-banner">We use cookies. Accept all.</div>
              <div id="app" class="paywall-free-tier">
                <article>
                  <h1>Critical Article Must Survive</h1>
                  <p>This article is wrapped inside a body with class cookie-consent-accepted and an app container with class paywall-free-tier.</p>
                  <p>The short cookie banner must be removed, while Readability must preserve this entire article cleanly without losing any paragraph.</p>
                  <p>Third substantial paragraph confirming Readability parses the complete article structure reliably.</p>
                </article>
              </div>
            </body></html>"""
            self._send_html(html)
        elif self.path == "/iframe-host":
            html = """<!doctype html><html><head><title>Iframe Host</title></head><body>
              <p>Top frame paragraph</p>
              <iframe id="child-frame" src="/iframe-child" style="width:400px;height:120px;"></iframe>
            </body></html>"""
            self._send_html(html)
        elif self.path == "/iframe-child":
            html = """<!doctype html><html><head><title>Iframe Child</title></head><body>
              <p id="inside-p">IFRAME_SELECTED_SNIPPET_OK</p>
            </body></html>"""
            self._send_html(html)
        elif self.path == "/mock-llm-chat":
            html = """<!doctype html><html><head><title>Mock LLM Chat</title></head><body>
              <div id="composer" contenteditable="true" role="textbox" style="width:400px;height:100px;border:1px solid #333;"></div>
              <button id="send-btn" aria-label="Invia messaggio" disabled>Invia</button>
              <div id="submitted-log"></div>
              <script>
                const box = document.getElementById('composer');
                const btn = document.getElementById('send-btn');
                box.addEventListener('paste', (e) => {
                  e.preventDefault();
                  const txt = e.clipboardData.getData('text/plain');
                  box.textContent = txt;
                  btn.disabled = !txt.trim();
                });
                box.addEventListener('input', () => {
                  btn.disabled = !box.textContent.trim();
                });
                btn.addEventListener('click', () => {
                  document.getElementById('submitted-log').textContent = 'SUBMITTED:' + box.textContent;
                  box.textContent = '';
                });
              </script>
            </body></html>"""
            self._send_html(html)
        elif self.path == "/login":
            self._send_html("<!doctype html><html><head><title>Sign In</title></head><body><input type='email'></body></html>")
        elif self.path == "/mock-empty":
            self._send_html("<!doctype html><html><head><title>No Composer</title></head><body><p>Empty page</p></body></html>")
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global LAST_API_REQUEST_BODY
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length)
        try:
            LAST_API_REQUEST_BODY = json.loads(raw_body.decode("utf-8"))
        except Exception:
            LAST_API_REQUEST_BODY = None

        if self.path == "/v1/chat/completions":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            chunk1 = b'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"del'
            chunk2 = b'ta":{"content":"SPLIT_TOKEN_SURVIVED "}}]}\n\ndata: {"choices":[{"delta":{"content":"**Bold** <img id=xss-probe src=x onerror=alert(1)>"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'
            self.wfile.write(chunk1)
            self.wfile.flush()
            time.sleep(0.08)
            self.wfile.write(chunk2)
            self.wfile.flush()
        elif self.path == "/api/generate":
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(b'{"response":"Ollama "}\n{"res')
            self.wfile.flush()
            time.sleep(0.06)
            self.wfile.write(b'ponse":"NDJSON OK","done":true}\n')
            self.wfile.flush()
        elif self.path == "/v1/chat/completions-slow":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            try:
                self.wfile.write(b'data: {"choices":[{"delta":{"content":"Starting stream..."}}]}\n\n')
                self.wfile.flush()
                for _ in range(25):
                    time.sleep(0.2)
                    self.wfile.write(b'data: {"choices":[{"delta":{"content":"."}}]}\n\n')
                    self.wfile.flush()
            except Exception:
                pass
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _send_html(self, html):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(html.encode("utf-8"))


async def main():
    global LAST_API_REQUEST_BODY
    server = ThreadingHTTPServer(("127.0.0.1", 0), MockServerHandler)
    port = server.server_address[1]
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    base = f"http://127.0.0.1:{port}"

    user_data_dir = tempfile.mkdtemp(prefix="llm_ext_v21_e2e_")
    failures = []

    def check(condition, msg):
        if not condition:
            failures.append(msg)
            print(f"FAIL: {msg}")
        else:
            print(f"PASS: {msg}")

    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(
            user_data_dir,
            headless=True,
            channel="chromium",
            permissions=["clipboard-read", "clipboard-write"],
            args=[
                f"--disable-extensions-except={EXT_PATH}",
                f"--load-extension={EXT_PATH}",
            ],
        )

        # 1. Service worker boot
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event("serviceworker", timeout=10000)
        ext_id = sw.url.split("/")[2]
        sw_errors = []
        sw.on("console", lambda m: sw_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        manifest = await sw.evaluate("() => chrome.runtime.getManifest()")
        check(manifest["version"] == "2.1.0", "Extension v2.1.0 loaded cleanly in Chromium")

        # 2. Popup UI, Side Panel / Tab layouts, accessibility, local guard
        popup = await ctx.new_page()
        popup_errors = []
        popup.on("pageerror", lambda err: popup_errors.append(f"PAGEERROR: {err}"))
        popup.on("console", lambda m: popup_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        await popup.goto(f"chrome-extension://{ext_id}/popup.html", wait_until="networkidle")

        ui = await popup.evaluate("""() => ({
            hasOptionsBtn: !!document.getElementById('options-btn'),
            hasSidePanelBtn: !document.getElementById('sidepanel-btn').classList.contains('hidden'),
            hasLangSelect: !!document.getElementById('output-language'),
            radioDisplay: getComputedStyle(document.querySelector('input[name="execution-mode"]')).display,
            checkboxDisplay: getComputedStyle(document.getElementById('autosubmit-cb')).display,
        })""")
        check(ui["hasOptionsBtn"] and ui["hasSidePanelBtn"] and ui["hasLangSelect"], "Popup has Options, Side Panel, and Output Language controls")
        check(ui["radioDisplay"] != "none" and ui["checkboxDisplay"] != "none", "Radios & checkboxes remain keyboard-accessible (.sr-only)")

        # Check Side Panel responsive layout (?view=panel)
        panel_page = await ctx.new_page()
        await panel_page.goto(f"chrome-extension://{ext_id}/popup.html?view=panel", wait_until="networkidle")
        panel_ok = await panel_page.evaluate("""() => ({
            panelClass: document.body.classList.contains('panel-mode'),
            sideBtnHidden: document.getElementById('sidepanel-btn').classList.contains('hidden'),
        })""")
        check(panel_ok["panelClass"] and panel_ok["sideBtnHidden"], "Side Panel mode applies responsive .panel-mode class and hides redundant icon")
        await panel_page.close()

        # Local target disables Web Mode
        await popup.select_option("#target-llm", "local")
        await popup.wait_for_timeout(120)
        local_state = await popup.evaluate("""() => ({
            webDisabled: document.querySelector('input[value="web"]').disabled,
            apiChecked: document.querySelector('input[value="api"]').checked,
            hintVisible: !document.getElementById('local-web-hint').classList.contains('hidden'),
        })""")
        check(local_state["webDisabled"] and local_state["apiChecked"] and local_state["hintVisible"], "Selecting Local disables Web Mode and switches to API Mode")

        await popup.select_option("#target-llm", "chatgpt")
        await popup.locator('label[id="web-mode-label"]').click()

        # 3. Structured Queue Cards + Badge Counter (Bug #4 fix: editing 1 item must NOT collapse N items into 1!)
        await popup.evaluate("""() => chrome.storage.local.set({
            textQueue: [
                { id: 'q1', text: 'First captured article body', title: 'Article One', url: 'https://example.com/1', kind: 'page', addedAt: 1 },
                { id: 'q2', text: 'Second captured excerpt', title: 'Article Two', url: 'https://example.com/2', kind: 'selection', addedAt: 2 }
            ]
        })""")
        await popup.wait_for_timeout(200)
        badge_2 = await sw.evaluate("() => chrome.action.getBadgeText({})")
        check(badge_2 == "2", f"Action badge shows '2' for two queued items (got: {badge_2!r})")

        await popup.click("#view-queue-btn")
        await popup.wait_for_timeout(120)
        cards_count = await popup.locator(".queue-card").count()
        check(cards_count == 2, f"Structured queue displays 2 individual cards (got: {cards_count})")

        # Edit item #1 -> count MUST stay 2!
        await popup.locator('.queue-card[data-item-id="q1"] .queue-card-btn.edit').click()
        await popup.locator('.queue-card[data-item-id="q1"] .queue-item-editor').fill("First captured article EDITED")
        await popup.locator('.queue-card[data-item-id="q1"] .queue-item-editor').blur()
        await popup.wait_for_timeout(200)
        after_edit_len = await popup.evaluate("async () => (await chrome.storage.local.get('textQueue')).textQueue.length")
        check(after_edit_len == 2, f"Editing one queue item preserves all other items (len={after_edit_len})")

        # Remove item #2 -> count becomes 1 and badge updates to '1'
        await popup.locator('.queue-card[data-item-id="q2"] .queue-card-btn.remove').click()
        await popup.wait_for_timeout(200)
        badge_1 = await sw.evaluate("() => chrome.action.getBadgeText({})")
        check(badge_1 == "1", f"Removing one queue item updates badge to '1' (got: {badge_1!r})")

        # 4. Non-destructive Prompt Editing, Rename, Preset Preview/Override, Output Language
        await popup.select_option("#prompt-type", "promptShort")
        await popup.click("#toggle-prompt-editor-btn")
        await popup.wait_for_timeout(100)
        preset_visible = await popup.locator("#custom-prompt-container").is_visible()
        check(preset_visible, "Built-in preset can be inspected/edited via toggle button")

        # Create a saved prompt
        await popup.select_option("#prompt-type", "custom")
        await popup.fill("#custom-prompt", "TEMPLATE_ORIGINAL_TEXT")
        await popup.click("#save-prompt-btn")
        await popup.fill("#prompt-name-input", "Saved Alpha")
        await popup.click("#confirm-save-prompt-btn")
        await popup.wait_for_timeout(200)
        saved_id = await popup.evaluate("() => Array.from(document.getElementById('prompt-type').options).find(o => o.value.startsWith('saved_'))?.value")
        check(bool(saved_id), "Saved prompt created inline without window.prompt()")

        # Modify saved prompt WITHOUT clicking Update -> stored template MUST NOT be overwritten!
        await popup.fill("#custom-prompt", "TEMPORARY_ONE_OFF_EDIT")
        await popup.locator("#custom-prompt").blur()
        await popup.wait_for_timeout(400)
        stored_template_text = await popup.evaluate("(id) => chrome.storage.local.get('savedPrompts').then(d => d.savedPrompts.find(p => p.id === id)?.text)", saved_id)
        modified_badge_visible = await popup.locator("#prompt-modified-badge").is_visible()
        check(stored_template_text == "TEMPLATE_ORIGINAL_TEXT" and modified_badge_visible, "Editing a saved prompt does NOT silently overwrite template and shows Modified badge")

        # Explicit Update saves it
        await popup.click("#update-prompt-btn")
        await popup.wait_for_timeout(150)
        updated_template_text = await popup.evaluate("(id) => chrome.storage.local.get('savedPrompts').then(d => d.savedPrompts.find(p => p.id === id)?.text)", saved_id)
        check(updated_template_text == "TEMPORARY_ONE_OFF_EDIT", "Clicking Update explicitly persists changes to saved prompt")

        # Rename saved prompt
        await popup.click("#rename-prompt-btn")
        await popup.fill("#prompt-name-input", "Saved Beta")
        await popup.click("#confirm-save-prompt-btn")
        await popup.wait_for_timeout(150)
        renamed_name = await popup.evaluate("(id) => chrome.storage.local.get('savedPrompts').then(d => d.savedPrompts.find(p => p.id === id)?.name)", saved_id)
        check(renamed_name == "Saved Beta", f"Inline rename works cleanly (got: {renamed_name!r})")

        # Two-step inline delete
        await popup.click("#delete-prompt-btn")
        await popup.click("#delete-prompt-btn")
        await popup.wait_for_timeout(150)
        remaining_saved = await popup.evaluate("() => Array.from(document.getElementById('prompt-type').options).filter(o => o.value.startsWith('saved_')).length")
        check(remaining_saved == 0, "Inline two-step prompt deletion works cleanly")

        # Output language selector
        await popup.select_option("#output-language", "it")
        await popup.wait_for_timeout(100)
        saved_lang = await popup.evaluate("() => chrome.storage.local.get('outputLanguage').then(d => d.outputLanguage)")
        check(saved_lang == "it", "Output language selection persists to storage")

        # 5. Persistent Split & Copy across popup CLOSE + REOPEN (Bug #1 fix!)
        big_text = "This is a complete sentence for testing chunk boundaries cleanly.\n\n" * 1050  # ~70k chars
        await popup.evaluate("(txt) => chrome.storage.local.set({ textQueue: [txt], executionMode: 'web', targetLLM: 'chatgpt', selectedPrompt: 'promptShort' })", big_text)
        await popup.wait_for_timeout(250)
        check(await popup.locator("#split-copy-btn").is_visible(), "Split & Copy button shown for >60k text on ChatGPT Web Mode")
        await popup.click("#split-copy-btn")
        await popup.wait_for_timeout(150)
        clip1 = await popup.evaluate("() => navigator.clipboard.readText()")
        check("PART 1/" in clip1 or "PARTE 1/" in clip1, "Split & Copy Part 1 copied to clipboard")

        # CLOSE POPUP AND REOPEN -> progress MUST persist and next click copies Part 2!
        await popup.close()
        popup = await ctx.new_page()
        popup.on("pageerror", lambda err: popup_errors.append(f"PAGEERROR: {err}"))
        popup.on("console", lambda m: popup_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        await popup.goto(f"chrome-extension://{ext_id}/popup.html", wait_until="networkidle")
        await popup.wait_for_timeout(200)
        pill1_copied = await popup.locator(".split-part-pill").first.evaluate("el => el.classList.contains('copied')")
        check(pill1_copied, "Split & Copy Part 1 marked as copied AFTER popup close & reopen")
        await popup.click("#split-copy-btn")
        await popup.wait_for_timeout(150)
        clip2 = await popup.evaluate("() => navigator.clipboard.readText()")
        check("2/" in clip2, "Split & Copy advances to Part 2 cleanly after popup reopen!")

        # 6. API Mode: system/user separation, buffered SSE, XSS safety, truncation warning, history, .md download
        LAST_API_REQUEST_BODY = None
        await popup.evaluate("""async (url) => {
            await chrome.storage.local.set({
                textQueue: [{ id: 'q_api', text: 'Sample text for API test', title: 'My Source Doc', url: 'https://example.org/doc', kind: 'page', addedAt: 1 }],
                targetLLM: 'local',
                executionMode: 'api',
                selectedPrompt: 'promptShort',
                outputLanguage: 'en',
                apiKeys: { localUrl: url },
                apiHistory: []
            });
        }""", f"{base}/v1/chat/completions")
        await popup.reload(wait_until="networkidle")
        await popup.click("#submit-btn")
        await popup.wait_for_timeout(600)

        check(
            LAST_API_REQUEST_BODY is not None
            and len(LAST_API_REQUEST_BODY.get("messages", [])) == 2
            and LAST_API_REQUEST_BODY["messages"][0]["role"] == "system"
            and "<document>" in LAST_API_REQUEST_BODY["messages"][1]["content"]
            and "https://example.org/doc" in LAST_API_REQUEST_BODY["messages"][1]["content"],
            f"API request separates system/user messages and wraps source metadata in <document> (got: {LAST_API_REQUEST_BODY})"
        )

        api_out = await popup.evaluate("""() => {
            const out = document.getElementById('api-output');
            return {
                text: out.innerText,
                hasImgTag: !!out.querySelector('#xss-probe, img'),
                hasBold: !!out.querySelector('strong'),
                truncatedVisible: !document.getElementById('api-truncated-warning').classList.contains('hidden'),
                historyBtnVisible: !document.getElementById('history-toggle-btn').classList.contains('hidden'),
            };
        }""")
        check("SPLIT_TOKEN_SURVIVED" in api_out["text"], "Buffered SSE parser preserved split TCP chunk")
        check(api_out["hasBold"] and not api_out["hasImgTag"], "Safe Markdown renders bold and neutralizes XSS <img>")
        check(api_out["truncatedVisible"], "Output truncation warning shown when finish_reason='length'")
        check(api_out["historyBtnVisible"], "API summary saved to history and history button visible")

        # Verify .md download triggers cleanly without error
        async with popup.expect_download() as dl_info:
            await popup.click("#download-md-btn")
        dl = await dl_info.value
        check(dl.suggested_filename.endswith(".md") and "my-source-doc" in dl.suggested_filename, f"Download .md triggered with clean filename ({dl.suggested_filename})")

        # Close and reopen popup -> persisted API response survives
        await popup.close()
        popup = await ctx.new_page()
        popup.on("pageerror", lambda err: popup_errors.append(f"PAGEERROR: {err}"))
        popup.on("console", lambda m: popup_errors.append(f"[{m.type}] {m.text}") if m.type == "error" else None)
        await popup.goto(f"chrome-extension://{ext_id}/popup.html", wait_until="networkidle")
        await popup.wait_for_timeout(200)
        persisted_text = await popup.locator("#api-output").inner_text()
        check("SPLIT_TOKEN_SURVIVED" in persisted_text, "API output persists across popup close/reopen")

        # Ollama /api/generate NDJSON + History reload
        await popup.evaluate("(url) => chrome.storage.local.set({ apiKeys: { localUrl: url } })", f"{base}/api/generate")
        await popup.click("#submit-btn")
        await popup.wait_for_timeout(450)
        ollama_text = await popup.locator("#api-output").inner_text()
        check("Ollama NDJSON OK" in ollama_text, f"Ollama NDJSON streaming works (got: {ollama_text!r})")

        # Open History and reload previous OpenAI summary
        await popup.click("#history-toggle-btn")
        await popup.wait_for_timeout(120)
        hist_count = await popup.locator(".history-item").count()
        check(hist_count >= 2, f"API History records multiple summaries (count={hist_count})")
        await popup.locator(".history-item-btn").nth(1).click()
        await popup.wait_for_timeout(150)
        reloaded_hist = await popup.locator("#api-output").inner_text()
        check("SPLIT_TOKEN_SURVIVED" in reloaded_hist, "Clicking an API history item restores that summary cleanly")

        # Stop button on slow stream
        await popup.evaluate("(url) => chrome.storage.local.set({ apiKeys: { localUrl: url } })", f"{base}/v1/chat/completions-slow")
        await popup.click("#submit-btn")
        await popup.wait_for_timeout(300)
        check(await popup.locator("#stop-btn").is_visible(), "Stop button visible while API stream is active")
        await popup.click("#stop-btn")
        await popup.wait_for_timeout(300)
        aborted_text = await popup.locator("#api-output").inner_text()
        check("Starting stream" in aborted_text and not await popup.locator("#stop-btn").is_visible(), "Stop button aborts stream cleanly while keeping partial output")

        # Zombie streaming job reconciliation
        await popup.evaluate("""() => chrome.storage.local.set({
            apiJob: { id: 'zombie_job_1', status: 'streaming', target: 'chatgpt', model: 'gpt-6.1-sol', text: 'Partial before restart', error: '' }
        })""")
        await popup.reload(wait_until="networkidle")
        await popup.wait_for_timeout(200)
        zombie_reconciled = await popup.evaluate("""async () => {
            const j = (await chrome.storage.local.get('apiJob')).apiJob;
            return { status: j?.status, submitDisabled: document.getElementById('submit-btn').disabled };
        }""")
        check(zombie_reconciled["status"] == "aborted" and not zombie_reconciled["submitDisabled"], "Orphaned streaming job reconciled cleanly on reopen")

        # 7. Options page: theme sync, secret toggle, invalid URL validation, Connection Test, Prompt Manager, selector reset
        await popup.click("#theme-toggle-btn")
        options = await ctx.new_page()
        options_errors = []
        options.on("pageerror", lambda err: options_errors.append(f"PAGEERROR: {err}"))
        await options.goto(f"chrome-extension://{ext_id}/options.html", wait_until="networkidle")
        opt_ui = await options.evaluate("""() => {
            const box = document.querySelector('#keep-links + .checkbox-custom');
            return {
                darkSynced: document.body.classList.contains('dark'),
                checkboxWidth: getComputedStyle(box).width,
                openaiModel: document.getElementById('openai-model').value,
                claudeModel: document.getElementById('anthropic-model').value,
                geminiModel: document.getElementById('gemini-model').value,
                perplexityModel: document.getElementById('perplexity-model').value,
            };
        }""")
        check(opt_ui["darkSynced"], "Options page syncs dark theme with popup")
        check(opt_ui["checkboxWidth"] == "18px", "Options checkboxes properly styled")
        check(
            opt_ui["openaiModel"] == "gpt-6.1-sol"
            and opt_ui["claudeModel"] == "claude-sonnet-5-5"
            and opt_ui["geminiModel"] == "gemini-3.8-flash"
            and opt_ui["perplexityModel"] == "perplexity/auto",
            f"Options displays current default models including Perplexity Orchestrator ({opt_ui})"
        )

        # Show/hide secret toggle
        await options.locator('.toggle-secret-btn[data-target="openai-key"]').click()
        key_type = await options.locator("#openai-key").get_attribute("type")
        check(key_type == "text", "Show/hide API key toggle reveals password input")

        # Invalid localUrl MUST show error status and NOT save silently (Bug #6 fix!)
        await options.fill("#local-url", "localhost:11434/api/generate")
        await options.click("#save-btn")
        await options.wait_for_timeout(150)
        invalid_err = await options.evaluate("""() => ({
            hasInvalidClass: document.getElementById('local-url').classList.contains('invalid'),
            statusIsError: document.getElementById('status-msg').classList.contains('error'),
        })""")
        check(invalid_err["hasInvalidClass"] and invalid_err["statusIsError"], "Invalid local URL without protocol surfaces explicit error")

        # Valid local URL + Connection Test button
        await options.fill("#local-url", f"{base}/api/generate")
        await options.locator('.test-conn-btn[data-provider="local"]').click()
        await options.wait_for_timeout(450)
        test_ok = await options.evaluate("() => document.getElementById('test-status-local').classList.contains('ok')")
        check(test_ok, "Options 'Test' connection button validates local LLM end-to-end")

        # Prompt Manager: add 2 prompts, reorder, customize preset, clear selector -> save
        await options.fill("#new-prompt-name", "Prompt First")
        await options.fill("#new-prompt-text", "Instruction 1 {{text}}")
        await options.click("#add-saved-prompt-btn")
        await options.fill("#new-prompt-name", "Prompt Second")
        await options.fill("#new-prompt-text", "Instruction 2")
        await options.click("#add-saved-prompt-btn")
        await options.locator(".saved-prompt-card").nth(1).locator(".move-up").click()
        await options.fill("#preset-short", "Custom Short Preset Override")
        await options.fill("#chatgpt-selectors", "   ")
        await options.click("#save-btn")
        await options.wait_for_timeout(250)

        saved_opts = await options.evaluate("async () => chrome.storage.local.get(['customSelectors', 'savedPrompts', 'customPresetOverrides'])")
        check("#prompt-textarea" in saved_opts["customSelectors"]["chatgpt"]["inputs"], "Clearing selector restores defaults")
        check(
            len(saved_opts["savedPrompts"]) == 2 and saved_opts["savedPrompts"][0]["name"] == "Prompt Second",
            f"Options Prompt Manager persists created and reordered prompts ({saved_opts['savedPrompts']})"
        )
        check(
            saved_opts["customPresetOverrides"].get("promptShort") == "Custom Short Preset Override",
            "Options Prompt Manager saves built-in preset overrides"
        )
        check(len(options_errors) == 0, f"Zero JS errors in options page (errors: {options_errors})")

        # 8. Content extraction + iframe selection capture
        async def extract_url(url, md_opts):
            pg = await ctx.new_page()
            await pg.goto(url, wait_until="networkidle")
            await sw.evaluate("(opts) => chrome.storage.local.set({ markdownOptions: opts })", md_opts)
            res = await sw.evaluate("""async (targetUrl) => {
                const tabs = await chrome.tabs.query({});
                const tab = tabs.find(t => t.url === targetUrl);
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['lib/Readability.js', 'lib/turndown.js', 'content_source.js']
                });
                return chrome.tabs.sendMessage(tab.id, { action: 'getPageText' });
            }""", url)
            await pg.close()
            return res

        norm_default = await extract_url(f"{base}/article", {"keepLinks": False, "keepImages": False, "autoScroll": False})
        check("Quantum Computing Basics" in norm_default["text"] and norm_default["url"] == f"{base}/article" and "[edit]" not in norm_default["text"], "Default extraction strips noise and returns title+URL metadata")

        norm_keep = await extract_url(f"{base}/article", {"keepLinks": True, "keepImages": True, "autoScroll": False})
        check("[qubit guide](https://example.com/qubits)" in norm_keep["text"] and "![Diagram](https://example.com/q.png)" in norm_keep["text"], "keepLinks & keepImages options preserve Markdown links and images")

        cookie_res = await extract_url(f"{base}/cookie-protected", {"keepLinks": False, "keepImages": False, "autoScroll": False})
        check("Critical Article Must Survive" in cookie_res["text"] and "We use cookies" not in cookie_res["text"], "Protected wrapper survives Readability while short cookie banner is stripped")

        # Selection inside nested iframe captured via allFrames: true!
        iframe_page = await ctx.new_page()
        await iframe_page.goto(f"{base}/iframe-host", wait_until="networkidle")
        child = iframe_page.frame(url=f"{base}/iframe-child")
        await child.evaluate("""() => {
            const p = document.getElementById('inside-p');
            const r = document.createRange();
            r.selectNodeContents(p);
            const s = window.getSelection();
            s.removeAllRanges();
            s.addRange(r);
        }""")
        iframe_sel_res = await sw.evaluate("""async (targetUrl) => {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(t => t.url === targetUrl);
            const hits = await chrome.scripting.executeScript({
                target: { tabId: tab.id, allFrames: true },
                func: () => (window.getSelection()?.toString() || '').trim()
            });
            return hits.find(h => h.result)?.result || '';
        }""", f"{base}/iframe-host")
        check(iframe_sel_res == "IFRAME_SELECTED_SNIPPET_OK", f"Multi-frame selection captures text inside nested iframe (got: {iframe_sel_res!r})")
        await iframe_page.close()

        # 9. Web Mode content_target.js: valid claim, tab isolation, /login skip, fallback cleanup
        chat_page = await ctx.new_page()
        chat_errors = []
        chat_page.on("pageerror", lambda err: chat_errors.append(f"PAGEERROR: {err}"))
        await chat_page.goto(f"{base}/mock-llm-chat", wait_until="networkidle")

        unrelated_page = await ctx.new_page()
        await unrelated_page.goto(f"{base}/mock-llm-chat", wait_until="networkidle")

        await sw.evaluate("""async (targetUrl) => {
            const tabs = await chrome.tabs.query({});
            const matching = tabs.filter(t => t.url === targetUrl);
            const targetTab = matching[0];
            const otherTab = matching[1];
            await chrome.storage.local.set({
                pendingInjection: {
                    tabId: targetTab.id,
                    text: 'HELLO_WEB_MODE_V21',
                    target: 'chatgpt',
                    autoSubmit: true,
                    timestamp: Date.now(),
                    attempts: 0
                }
            });
            await chrome.scripting.executeScript({ target: { tabId: otherTab.id }, files: ['content_target.js'] });
            await new Promise(r => setTimeout(r, 250));
            await chrome.scripting.executeScript({ target: { tabId: targetTab.id }, files: ['content_target.js'] });
        }""", f"{base}/mock-llm-chat")

        await chat_page.wait_for_timeout(1400)
        submitted_log = await chat_page.locator("#submitted-log").inner_text()
        unrelated_log = await unrelated_page.locator("#submitted-log").inner_text()
        pending_after = await sw.evaluate("async () => (await chrome.storage.local.get('pendingInjection')).pendingInjection")

        check(len(chat_errors) == 0, f"content_target.js runs with zero errors ({chat_errors})")
        check(submitted_log == "SUBMITTED:HELLO_WEB_MODE_V21", f"Web Mode pasted text and clicked Italian submit button ({submitted_log!r})")
        check(unrelated_log == "", "Unrelated LLM tab did NOT steal pendingInjection")
        check(pending_after is None, "pendingInjection cleaned up after paste")

        # Login redirect page must NOT claim attempts or show fallback banner
        login_page = await ctx.new_page()
        await login_page.goto(f"{base}/login", wait_until="networkidle")
        await sw.evaluate("""async (targetUrl) => {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(t => t.url === targetUrl);
            await chrome.storage.local.set({
                pendingInjection: {
                    tabId: tab.id,
                    text: 'WAIT_FOR_LOGIN',
                    target: 'claude',
                    autoSubmit: false,
                    timestamp: Date.now(),
                    attempts: 0
                }
            });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_target.js'] });
        }""", f"{base}/login")
        await login_page.wait_for_timeout(400)
        login_pending = await sw.evaluate("async () => (await chrome.storage.local.get('pendingInjection')).pendingInjection")
        check(login_pending is not None and login_pending.get("attempts") == 0, f"/login redirect skips injection without burning attempts ({login_pending})")
        await login_page.close()

        # Fallback banner renders when composer missing and clears pendingInjection on Close
        empty_page = await ctx.new_page()
        await empty_page.goto(f"{base}/mock-empty", wait_until="networkidle")
        await sw.evaluate("""async (targetUrl) => {
            const tabs = await chrome.tabs.query({});
            const tab = tabs.find(t => t.url === targetUrl);
            await chrome.storage.local.set({
                pendingInjection: {
                    tabId: tab.id,
                    text: 'FALLBACK_PROMPT_TEXT',
                    target: 'chatgpt',
                    autoSubmit: false,
                    timestamp: Date.now(),
                    attempts: 0
                }
            });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_target.js'] });
        }""", f"{base}/mock-empty")
        await empty_page.wait_for_selector("#llm-summarizer-fallback-host", timeout=18000)
        banner_info = await empty_page.evaluate("""() => {
            const host = document.getElementById('llm-summarizer-fallback-host');
            const btns = host?.shadowRoot?.querySelectorAll('button') || [];
            const texts = Array.from(btns).map(b => b.textContent);
            if (btns.length >= 2) btns[1].click();
            return { count: btns.length, texts, hostStillConnected: host?.isConnected };
        }""")
        pending_after_close = "not_checked"
        for _ in range(15):
            await empty_page.wait_for_timeout(150)
            pending_after_close = await sw.evaluate("async () => (await chrome.storage.local.get('pendingInjection')).pendingInjection")
            if pending_after_close is None:
                break
        check(
            banner_info["count"] >= 2 and pending_after_close is None,
            f"Fallback Shadow DOM banner renders and clears pendingInjection on Close (banner={banner_info}, pending={pending_after_close})"
        )

        check(len(popup_errors) == 0, f"Zero console/page errors in popup (errors: {popup_errors})")
        check(len(sw_errors) == 0, f"Zero console errors in service worker (errors: {sw_errors})")

        await ctx.close()

    server.shutdown()
    print(f"\nE2E SUMMARY: {len(failures)} failures")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
