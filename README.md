# Language Learning Journal

A personal language learning journal that turns the material you collect into practice built around what you are learning.

I'm building this for my own language learning and continuing to improve it as I use it. It also serves as a portfolio project: a place to explore interface design, browser-based storage, and AI-assisted practice in an app I want to keep using.

The starting point is a journal entry—a class, a conversation, a textbook page, or something I want to remember. Words and sentences stay connected to those entries, and practice activities draw from that growing collection. The interface takes its cues from paper notebooks, with serif typography, ruled pages, and a dock for unfinished workbooks.

## What it does

- **Organize learning into notebooks.** Give each notebook a target language, an optional focus, and a language for meanings and translations.
- **Capture material as you go.** Write entries with autosave and attach text, images, PDFs, or audio.
- **Build a vocabulary in context.** Add words and sentences manually, capture selected text, or review AI suggestions extracted from an entry and its supported attachments.
- **Reflect on learning.** Use an AI-guided conversation to think through an entry and collect useful language from it.
- **Practice with your own material.** Six workbooks cover word drills, sentence drills, roleplay, stories, listening, and picture description. Sessions can be minimized into the dock and resumed.
- **Take your journal with you.** Export notebooks and their media to a `.lljournal` file, including readable Markdown copies.

Journal writing and manual vocabulary collection work without an API key. AI-assisted features require a connection and your own xAI API key.

## Run it locally

Use a current Node.js LTS release with npm.

```sh
git clone https://github.com/larrygrpolanco/language-learning-journal.git
cd language-learning-journal
npm ci
npm run dev
```

Open the local URL printed by Vite. Create a notebook, set its target language, and add an entry or a few words to start exploring.

To use AI features, open **Settings → Key**, paste your xAI API key, and save it. The app reads the key from browser storage; no `.env` file is required to run the app. Requests use your own API account and may incur provider charges.

To try the production build locally:

```sh
npm run build
npm run preview
```

The production app includes a web app manifest and a service worker for caching the app shell. Offline availability depends on assets having been cached during an online visit; AI features still require a connection. The service worker is disabled in development.

## Data, privacy, and backups

Journal data and media live in **IndexedDB in the current browser**. There is no application backend, login, or automatic device sync.

AI requests go directly from the browser to xAI. Using an AI feature sends the material needed for that request, which can include journal text, vocabulary, or attachments. The API key is also stored in the browser and is accessible to someone with access to that browser profile. This setup is intended for personal use on a trusted device.

Export regularly from Settings. Clearing site data or browser storage eviction can remove the local journal; installing the app does not replace a backup. Storage is also specific to the site's origin, so another browser, host, or port has a separate library.

A `.lljournal` export is a ZIP containing JSON records, media, and a `readable/` folder of Markdown notebooks. It excludes the API key and unfinished workbook sessions. You can import it on another device as a new copy or replace an existing notebook. **Replace overwrites the whole notebook; it does not merge edits.**

## How it is built

The app uses **React, TypeScript, and Vite**, with **Dexie over IndexedDB**, React Router, plain CSS, and Vitest. Fonts are self-hosted through Fontsource; `fflate` handles journal bundles.

A few decisions shape the implementation:

- **The notebook is the data boundary.** Entries, vocabulary, media, and practice history belong to one notebook.
- **Journal writes are centralized.** `src/journal/writes.ts` handles journal mutations so screens and exercises can share the same behavior.
- **Workbooks receive a small interface.** Each exercise gets a context bundle, AI capabilities, and a scoped journal writer. A manifest registers it with the practice screen.
- **AI extraction produces proposals.** The learner reviews suggested words and sentences before adding them to the journal.
- **Learning signals are derived.** Encounter counts, recency, and estimated familiarity are computed from journal and practice records.
- **Exports remain useful outside the app.** JSON preserves the records, while Markdown makes the journal readable without importing it back.

```text
src/
  ai/          Provider requests, model configuration, extraction, and reflection
  db/          Database schema, types, and normalization
  journal/     Shared writes, proposals, and derived learning signals
  workbooks/   Exercise modules, registry, context, and session handling
  storage/     Journal bundles, import/export, and installation support
  screens/     Journal, vocabulary, practice, and settings views
  ui/          Shared interface components
  styles/      Design tokens and application styles
```

For a closer look:

- [Core concepts and learning model](docs/language-journal-architecture.md)
- [Technical architecture and tradeoffs](docs/technical-architecture.md)
- [Interface design guide](docs/UI-Guide.md)

These documents include design history and ideas beyond the current implementation; the source is the reference for current behavior.

## Development

```sh
npm run typecheck   # Check TypeScript
npm test            # Run the test suite
npm run test:watch  # Run tests while editing
npm run build      # Type-check and create the production bundle in dist/
```

Tests cover data normalization, journal writes and proposals, derived signals, workbook context and sessions, and export/import behavior. They use an in-memory IndexedDB implementation rather than live AI calls.

To add an exercise, start with an existing folder under `src/workbooks/`, implement its manifest and component against [the workbook SDK](src/workbooks/sdk.ts), and register it in [the workbook registry](src/workbooks/index.ts). Provider-specific model IDs live in [src/ai/models.ts](src/ai/models.ts).

Production output is static. A host needs to serve `index.html` for application routes because the app uses browser history routing. HTTPS is needed for service worker support outside localhost.

## Where this is going

This is an ongoing personal project. I'll keep refining the learning flow, exercises, and interface as I discover what helps me study. AI output needs review, and provider models and capabilities may change over time.

If you are looking through the repository to get a feel for my work, the architecture documents and workbook modules are good starting points. If you try it and find something useful—or something that could work better—issues and pull requests are welcome. A new exercise or a small improvement to the journal is a useful place to start.
