# LLM Web-Summarizer & Prompt Injector

Un'estensione per browser (basata su Manifest V3) potente e leggera per estrarre testo dalle pagine web, accodarlo in una clipboard virtuale e inviarlo direttamente all'interfaccia web o tramite API ai principali LLM: **ChatGPT, Claude, Gemini e Perplexity**.

## Caratteristiche Principali

- **Estrazione Intelligente**: Cattura il testo di un'intera pagina pulendolo da menu, script e rumore visivo, o cattura semplicemente la porzione di testo evidenziata.
- **Coda di Testo**: Accumula frammenti di testo da diverse pagine web prima di inviarli al modello, perfetto per analisi incrociate o sintesi di più articoli.
- **Iniezione Web Mode Automatica**: Aggira i limiti degli URL parametrici inviando testi lunghissimi direttamente alle interfacce web degli LLM tramite iniezione sicura del DOM e simulazione della clipboard.
- **Prompt Personalizzabili**: Usa prompt predefiniti ("Riassumi Brevemente", "Spiega come a un bambino") o crea il tuo prompt personalizzato in base alle tue esigenze.
- **Monitoraggio Lunghezza**: Interfaccia reattiva che calcola i caratteri e stima i token, avvisandoti se il testo rischia di eccedere i limiti della Web Mode.
- **Supporto Multipiattaforma**: Scegli dinamicamente a quale intelligenza artificiale inviare il testo.

## Installazione

Essendo un'estensione non ancora pubblicata sugli store, puoi installarla in modalità sviluppatore:

1. Clona o scarica questo repository.
2. Apri Google Chrome o un browser basato su Chromium (Brave, Edge, ecc.).
3. Vai all'indirizzo `chrome://extensions/` o `edge://extensions/`.
4. Attiva la **Modalità Sviluppatore** (Developer mode) in alto a destra.
5. Clicca su **Carica estensione non pacchettizzata** (Load unpacked) e seleziona la cartella di questo progetto.

## Utilizzo

1. **Shortcuts**: Usa `Alt+S` (o `MacCtrl+S` su Mac) per aggiungere rapidamente il testo selezionato alla coda.
2. **Menu Contestuale**: Clicca col tasto destro del mouse su qualsiasi testo selezionato per vedere le opzioni di invio rapido o aggiunta alla coda.
3. **Popup Extension**: Clicca sull'icona dell'estensione per aprire il pannello di controllo, gestire i prompt e inviare tutto il materiale accumulato all'LLM prescelto.

## Tecnologie Utilizzate

- **Manifest V3**: Ultimo standard di sicurezza e performance per le estensioni.
- **Vanilla JS & CSS**: Leggero, veloce, senza dipendenze pesanti.
- **Marked.js**: Per la renderizzazione in Markdown delle potenziali integrazioni API.

## Licenza

Questo progetto è distribuito sotto licenza MIT. Sentiti libero di modificarlo, adattarlo e migliorarlo per le tue esigenze!
