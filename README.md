# LLM Web-Summarizer & Prompt Injector

Un'estensione per browser (**Manifest V3**, compatibile con **Chrome / Edge / Brave** e **Firefox 140+**) leggera e modulare per estrarre testo pulito dalle pagine web, accumularlo in una coda persistente e inviarlo ai principali LLM — **ChatGPT, Claude, Gemini, Perplexity e modelli locali (Ollama / LM Studio)** — tramite **Web Mode** o **API Mode**.

## Caratteristiche Principali

- **Estrazione Pulita (Readability + Turndown)**: Estrae il contenuto principale delle pagine web in Markdown pulito (con opzioni per preservare link/immagini e auto-scroll progressivo per contenuti lazy-loaded), proteggendo l'articolo principale dai selettori di pulizia.
- **Coda Persistente e Modificabile**: Accumula testo da più pagine o selezioni (via popup, menu contestuale o shortcut `Alt+S`) e rivedilo prima dell'invio.
- **Web Mode Affidabile**: Apre la chat dell'LLM in una nuova scheda e inietta automaticamente il prompt nel composer con verifica dell'avvenuto inserimento (anche quando ChatGPT/Claude/Gemini trasformano incollaggi lunghi in allegati), supporto multilingua per l'invio automatico e banner di fallback con copia manuale in caso di modifiche al DOM.
- **API Mode in Streaming Persistente**: Supporta **OpenAI**, **Anthropic**, **Google Gemini**, **Perplexity** e **Local (Ollama / LM Studio)** con modelli configurabili dalle Opzioni, parser SSE/NDJSON bufferizzato, pulsante **Stop** e persistenza in background (chiudere il popup non interrompe la generazione).
- **Rendering Markdown Sicuro (Zero XSS)**: Renderer Markdown integrato senza dipendenze esterne con escape HTML completo prima del rendering.
- **Prompt Predefiniti e Salvati**: Include preset strutturati (*Riassunto Corto*, *Riassunto Dettagliato*, *Punti Chiave*) più gestione inline di prompt personalizzati salvati.
- **Dividi e Copia per Testi Lunghi**: Quando il testo supera il limite consigliato del composer web dell'LLM selezionato, divide il testo sui confini di paragrafo/frase e copia le parti in sequenza.
- **Tema Chiaro/Scuro & i18n Completa**: Sincronizzato tra popup e pagina Opzioni, tradotto in Italiano, Inglese, Tedesco, Spagnolo e Francese.

## Installazione (Modalità Sviluppatore)

### Chrome / Edge / Brave
1. Clona o scarica questo repository.
2. Apri `chrome://extensions/` (o `edge://extensions/`).
3. Attiva **Modalità sviluppatore** (Developer mode).
4. Clicca su **Carica estensione non pacchettizzata** (Load unpacked) e seleziona la cartella del progetto.

### Firefox
1. Apri `about:debugging#/runtime/this-firefox`.
2. Clicca su **Carica componente aggiuntivo temporaneo...** e seleziona `manifest.json`.

## Utilizzo

1. **Shortcut**: Premi `Alt+S` (o `MacCtrl+S` su Mac) per aggiungere alla coda il testo selezionato.
2. **Menu Contestuale**: Seleziona del testo, clicca col tasto destro e scegli **Aggiungi al riassunto (LLM)**.
3. **Popup**: Cattura pagine o selezioni, modifica la coda, scegli il prompt e l'LLM, poi invia in **Web Mode** o **API Mode**.
4. **Opzioni (⚙️ nel popup)**: Configura chiavi API, modelli personalizzati, endpoint Ollama/LM Studio, selettori CSS personalizzati per la Web Mode e preferenze di estrazione.

> **Nota Ollama**: se Ollama restituisce HTTP `403`, avvialo consentendo le origini dell'estensione:
> `OLLAMA_ORIGINS="chrome-extension://*,moz-extension://*" ollama serve`

## Sviluppo e Test

Nessuna fase di build richiesta (ES Modules nativi + Vanilla JS/CSS).

```bash
# Controllo sintassi di tutti i moduli
npm run check

# Test unitari (Node >= 20 built-in test runner)
npm test

# Test End-to-End reali in Chromium (richiede Python + Playwright)
python test/e2e/test_extension.py
```

## Licenza

Distribuito sotto licenza [MIT](LICENSE).
