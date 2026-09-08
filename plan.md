# Documento di Specifiche e Piano di Implementazione: "LLM Web-Summarizer"

## 1. Panoramica del Progetto

Creazione di un'estensione per browser (Chrome/Edge basata su **Manifest V3**) che permette di estrarre testo dalle pagine web (intera pagina o testo selezionato), accodarlo in una clipboard virtuale, abbinarlo a prompt predefiniti o personalizzati, e inviarlo a vari LLM (ChatGPT, Claude, Gemini, Perplexity) tramite "Web Mode" (automazione della UI web) o "API Mode" (chiamata diretta con visualizzazione in-popup).

## 2. Struttura dei File dell'Estensione

L'estensione avrà la seguente alberatura:

```text
/llm-summarizer-ext
│── manifest.json         # Configurazione Manifest V3, permessi, shortcuts
│── popup.html            # Interfaccia utente del popup
│── popup.js              # Logica del popup (gestione UI, storage, counter)
│── popup.css             # Stili (inclusa renderizzazione base per Markdown in API Mode)
│── background.js         # Service Worker (Context Menu, Shortcuts, Gestione Tab Web Mode)
│── content_source.js     # Content script per estrarre il testo dalle pagine navigate
│── content_target.js     # Content script per incollare il prompt nelle UI degli LLM (Web Mode)
└── lib/                  # Eventuali librerie (es. marked.js per il rendering Markdown)

```

## 3. Specifiche Tecniche e Funzionali (Modulo per Modulo)

### A. Manifest V3 (`manifest.json`)

* **Permessi richiesti:** `activeTab`, `scripting`, `storage`, `contextMenus`, `clipboardWrite`, `clipboardRead`.
* **Host Permissions:** `*://*/*` (per estrarre testo da qualsiasi sito e per iniettare `content_target.js` sui siti degli LLM).
* **Commands (Shortcuts):** Definire `alt+s` (o `macctrl+s`) con descrizione "Aggiungi testo alla coda".
* **Background:** Registrare `background.js` come `service_worker`.
* **Action:** Registrare `popup.html` come azione al click dell'icona.

### B. Gestione dello Stato e Persistenza (`chrome.storage.local`)

Tutto lo stato temporaneo deve risiedere in `chrome.storage.local` per evitare la perdita di dati alla chiusura del popup.
Variabili da salvare:

* `textQueue`: Array di stringhe (i frammenti di testo selezionati).
* `selectedPrompt`: Stringa (es. "Riassumi Brevemente", "Dettagliato", o custom).
* `customPromptText`: Stringa (il testo del prompt scritto dall'utente).
* `targetLLM`: Stringa (es. "chatgpt", "claude", "gemini", "perplexity").
* `executionMode`: Stringa ("web" o "api").

### C. Menu Contestuale & Shortcuts (`background.js`)

* **Context Menu:** Alla rimozione/creazione, aggiungere le seguenti voci per testi evidenziati:
1. "Aggiungi alla coda"
2. "Riassumi (Breve) - Web Mode"
3. "Applica prompt personalizzato"


* **Listener Shortcuts:** Ascoltare `chrome.commands.onCommand`. Se il comando è quello di accodamento, inviare un messaggio al `content_source.js` del tab attivo per ottenere il testo evidenziato e salvarlo in `textQueue` nello storage.
* **Gestione Web Mode:** Quando viene attivata la Web Mode (dal popup o dal menu contestuale), il `background.js`:
1. Legge il testo totale + il prompt dallo storage.
2. Salva il payload finale (Prompt + Testo) in una variabile di storage temporanea (es. `pendingInjection`).
3. Apre una nuova tab con l'URL dell'LLM selezionato:
* ChatGPT: `[https://chatgpt.com/](https://chatgpt.com/)`
* Claude: `[https://claude.ai/new](https://claude.ai/new)`
* Gemini: `[https://gemini.google.com/app](https://gemini.google.com/app)`
* Perplexity: `[https://www.perplexity.ai/](https://www.perplexity.ai/)`


4. Attende che la tab sia caricata (`chrome.tabs.onUpdated`) e inietta `content_target.js`.



### D. Interfaccia Popup (`popup.html` & `popup.js`)

L'interfaccia deve essere divisa in 3 sezioni principali:

1. **Gestione Testo (Input/Coda):**
* Pulsanti: "Cattura intera pagina" | "Cattura selezione".
* Area "Coda di testo": Mostra quanti frammenti sono in coda e un pulsante "Svuota coda".
* **Indicatore di Lunghezza:** Un contatore dinamico (Caratteri / Token stimati: `chars / 4`). Se supera i 15.000 caratteri, deve colorarsi di giallo/rosso con un tooltip: *"Attenzione: I testi molto lunghi potrebbero essere troncati o causare instabilità nella Web Mode."*


2. **Configurazione Prompt & LLM:**
* Dropdown "Tipo di Prompt": Riassunto Corto, Riassunto Dettagliato, Spiega come a un bambino, Custom.
* Textarea "Prompt Custom" (visibile solo se Custom è selezionato).
* Dropdown "LLM di Destinazione": ChatGPT, Claude, Gemini, Perplexity.
* Toggle/Radio Button: "Web Mode" vs "API Mode".


3. **Azione e Output (Per API Mode):**
* Pulsante enorme: **"Invia a LLM"** (Trigger).
* Area Output (visibile solo in API Mode): Un div dove stampare la risposta.
* Pulsante: **"Copia tutto"** (copia negli appunti).
* Integrazione di `marked.js` per il rendering dell'output API in Markdown pulito.



### E. Estrazione Testo (`content_source.js`)

* Deve esportare due funzioni principali (chiamate via message passing):
1. `getSelection()`: Ritorna `window.getSelection().toString()`.
2. `getPageText()`: Estrae il testo pulito della pagina (es. leggendo `document.body.innerText`, o preferibilmente clonando il body, rimuovendo script, stili, nav, footer e restituendo il `textContent` per ridurre il rumore).



### F. Iniezione Prompt via Web Mode (`content_target.js`)

Questa è la parte più delicata per eludere le limitazioni degli URL lunghi. [NOTA PER L'LLM]: Per capire l'approccio logico da usare per la Web Mode, analizza il codice di una mia estensione esistente a questo link: https://github.com/RobertoReale/YT-Transcript-Summarizer (C:\Users\Admin\Documents\Roberto Reale\Projects\Coding\GitHub\YT-Transcript-Summarizer). Non devi replicarlo identico, ma usalo come reference tecnica per vedere come ho già gestito con successo l'apertura della chat web e l'iniezione del testo.


* **Simulazione Inserimento:** Per i framework moderni (React/Next.js) aggiornare solo il `.value` non attiva il tasto "Invia". Il sistema deve copiare il testo nella Clipboard di sistema (`navigator.clipboard.writeText`) e simulare l'evento di Incolla (`paste`) o simulare gli eventi `input` e `change` nativi, per poi cancellare la clipboard.
* (Opzionale/Avanzato) Simula il click sul pulsante "Invia".

---

## 4. Fasi di Sviluppo (Istruzioni per l'LLM)

L'LLM generatore dovrà fornire il codice procedendo per questi **step consecutivi**, aspettando conferma o generandoli tutti se in un'unica risposta lunga:

* **Step 1:** Scrittura del `manifest.json` completo con tutti i permessi corretti.
* **Step 2:** Sviluppo dell'UI del Popup (`popup.html` e `popup.css`) strutturata e responsiva.
* **Step 3:** Implementazione della logica di stato nel `popup.js` (salvataggio configurazioni, aggiornamento UI e calcolo tokens/caratteri).
* **Step 4:** Implementazione di `content_source.js` (estrazione pagina e selezione).
* **Step 5:** Implementazione del `background.js` (Menu contestuale, Shortcuts e orchestrazione della Web Mode).
* **Step 6:** Sviluppo del file cruciale `content_target.js` contenente le query DOM aggiornate per iniettare con successo il testo in ChatGPT, Claude, Gemini e Perplexity tramite simulazione degli eventi DOM/Clipboard.

**Vincoli architetturali per il codice generato:**

* Non usare URL Parameters (`?q=...`) per la Web Mode, falliscono miseramente con testi lunghi (riassunti di articoli). Usa SEMPRE il passaggio tramite `chrome.storage.local` seguito da iniezione nel DOM (`content_target.js`).
* Gestire le Promises e le API di Chrome con sintassi `async/await`.
* Fornire un approccio "Safe" per le clipboard API.
Reference Web Mode: Prima di scrivere il codice per content_target.js e la gestione delle tab nel background.js, naviga e leggi i file pertinenti nel repository GitHub fornito sopra per allinearti allo stile di iniezione già testato.