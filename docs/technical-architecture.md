# Language Learning Journal: Technical Architecture

> Scope. The stack, where data lives, how it moves between devices, how the workbook dock and
> highlight-to-capture work, and how AI calls are made. Companion to
> `language-journal-architecture.md` (concepts and mechanics) and `UI-Guide.md` (look and layout).
> Those two are authoritative on *what* and *how it looks*. This one is authoritative on *how it is built*.
>
> **Status: describes a built app, not a plan.** M1 through M5 are complete (§14). Everything below was
> revised against the code and against live API probes after the build, so where this document once
> guessed, it now reports. The places it was wrong are called out rather than quietly corrected, because
> the wrong guess is usually the more instructive half. M6 Tauri was decided against (§12).

---

## 1. Decisions

Everything below follows from these. They were chosen for simplicity, and each one removes work.

| Decision | Consequence |
|---|---|
| No server, no account, no login | Nothing to deploy, nothing to pay for, no auth code |
| Data lives in the browser, in IndexedDB | Works offline, instant reads, no network in the write path |
| The thing the learner owns is a single exportable file | Backup and device transfer are one action each |
| One device is home. Others hold copies | No sync, no merge, no conflict resolution, ever |
| AI calls go straight to xAI with the learner's own key | No proxy, no backend, no usage billing to absorb |
| Generated audio and images live only in the session unless the learner keeps them | Storage stays small, nothing accumulates silently |
| A workbook is a code module with a small SDK | Free to build any exercise shape, one folder each |
| Derived signals are computed on read | Nothing to invalidate, nothing to migrate, no caches to be wrong |

The app is a React single-page app. Tauri later is a packaging change, not a rewrite (§12).

### What "simple" means here, concretely

No background work of any kind. No schedulers, no queues, no retries, no polling loops, no
notifications, no streaks, no review inbox. Every AI call and every write happens because the learner
just pressed something. If a call fails, it says so and offers the button again.

There is exactly one service worker and it does exactly one thing: cache the shell so the app opens
without a network (§4). It has no sync, no push, no periodic sync, and no queue of failed writes.

One deliberate exception to "no polling loops": `video.ts` polls a generation until it finishes. That
runs because the learner pressed something and is watching, and nothing calls it in v1.

Nothing expires and nothing nags. A half-finished workbook sits in the dock for three months and
looks exactly the same on day 90 as on day 1. A book left face down on the desk.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, strict | The data model is the design. Types keep it honest |
| UI | React 19 | Largest ecosystem, and the path to Tauri is well worn |
| Build | Vite | Instant dev server, static output, nothing to configure |
| Routing | React Router, declarative | Overlays as URL state gives back-button behavior for free (§6) |
| Store | Dexie over IndexedDB | `useLiveQuery` makes the UI reactive with no state library at all |
| Styling | Plain CSS, the existing `styles.css` tokens | The design system is already CSS variables. Nothing to translate |
| Icons | Lucide React | Named in the UI guide |
| Zip | fflate | ~8kB, and the bundle format is a zip (§4) |
| Tests | Vitest | Pure functions only (§13) |

### Actually installed

As built, for when a version turns out to matter. TypeScript runs under `strict` plus
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals`, `noUnusedParameters` and
`verbatimModuleSyntax`, which is what makes `compact()` and the `Compacted<T>` type in §3 necessary
rather than fussy.

```
react 19.3.0            dexie 4.4.6           react-router-dom 7.18.3
vite 6.4.3              vitest 5.0.1          typescript 5.9.3
fflate 0.8.3            lucide-react 0.469.0  node 24.19.0
@fontsource/{cormorant-garamond, lora, noto-serif-kr}
fake-indexeddb          (tests only, via src/test/setup.ts)
```

The production bundle is 18 files and 1.59 MB, of which 971 kB is the Korean font subset and only
fetched by a notebook that contains Hangul. JS is 478 kB raw, 154 kB gzipped.

### The source map

Where everything lives, since the sections below name modules without ever showing the shape.

```
src/
  App.tsx              routes, plus <WorkbookLayer> as their sibling (§6)
  main.tsx             font subsets, storage.persist(), install hooks, mount
  ai/                  client models text speech image video extract reflect      (§9, §10)
  db/                  db.ts (schema, compact) types.ts normalize.ts              (§3)
  journal/             derive.ts writes.ts proposals.ts                           (§3, §5, §10)
  workbooks/           index sdk sessions context writer + word-drill/            (§7, §8)
  storage/             bundle readable files transfer install                     (§4)
  screens/             Notebooks Timeline EntryDetail Composer Reflect Extract
                       Words Sentences Practice Settings Sandbox
  ui/                  Shell Plate Dashes QuickAdd Capturable Speak Dock
                       WorkbookLayer format.ts hooks.ts
  styles/              tokens.css app.css
  test/setup.ts        fake-indexeddb
public/                manifest, service worker, icons                            (§4)
scripts/make-icons.ps1 regenerates the icons from the tokens
docs/                  this file, the concepts doc, the UI guide, ui-screens/
```

Two boundaries in there are load-bearing rather than tidy. `journal/writes.ts` is the only module that
writes journal data (§5), and `storage/files.ts` is the only module that touches a file (§4, §12). Both
hold as of M5.

Screens under `screens/` are routed; `Extract.tsx` is the exception, a dialog rendered by `EntryDetail`
behind `?extract=1` rather than a route of its own (§6).

### Not using, deliberately

No state management library. Dexie live queries plus React state cover it. No Tailwind or CSS-in-JS,
the tokens exist. No backend, no ORM, no API layer. No component library, the UI guide specifies
hand-built components against a specific look. No auth. No analytics. No error reporting service.

### Typography, two things the UI guide misses

Cormorant Garamond and Lora carry no Hangul or Han glyphs. Korean text will silently fall back to a
system font and look wrong next to the English. On Windows that fallback is Malgun Gothic, a
sans-serif, which is about as far from this design as a font can get.

The fix is to name the CJK face in every stack rather than in one opt-in class. Font fallback is
per-character, so Latin still renders in Cormorant and Lora and only the Hangul reaches Noto Serif KR.

```css
--font-cjk:     'Noto Serif KR', 'Noto Serif SC';
--font-heading: 'Cormorant Garamond', var(--font-cjk), Georgia, serif;
--font-body:    'Lora', var(--font-cjk), Georgia, serif;
--font-target:  'Lora', var(--font-cjk), Georgia, serif;
```

`--font-target` survives only for target-language prose that should read in the body serif inside a
heading context. An earlier draft of this section had it as the mechanism, applied by hand to terms,
sentences and entry bodies. That was wrong, and it broke on the first screen built: the notebook title
carried both `.nb-title` and `.target`, the two tied on specificity, the later rule won, and the
Hangul dropped to Malgun Gothic. Anything you have to remember to apply is something you will forget.

Noto Serif KR is large, around 950kB for the Korean subset. Fontsource ships it without a
`unicode-range`, so the gating is per-character fallback rather than an explicit range: a notebook
with no Hangul in it never fetches the file. Import the Korean subset alone, not the whole face, and
drop the legacy `.woff` beside every `.woff2` at build time. Left alone those two things put 2.9MB of
never-downloaded bytes in `dist`.

Second, self-host the fonts rather than pulling from Google Fonts. The app must work offline and must
work in Tauri, and a CDN link breaks both. Fontsource is the least work here.

---

## 3. Data model

One Dexie database, `llj`, version-migrated by Dexie's own schema versioning. Every record carries
`notebookId` because the notebook is the boundary (concepts §6). Ids are `crypto.randomUUID()`.
Timestamps are ISO 8601 strings, stored as text so the bundle stays human-readable.

```ts
type Id = string
type Iso = string
type Familiarity = 'new' | 'getting it' | 'got it'

interface Notebook {
  id: Id
  title: string
  language: string          // target language, free text
  focus?: string            // also the notebook's profile for the LLM
  meaningLanguage?: string
  copiedFromId?: Id
  createdAt: Iso
  lastOpenedAt: Iso         // drives the gold spine on the notebooks screen
}

interface Entry {
  id: Id
  notebookId: Id
  date: Iso                 // defaults to now, editable
  body: string              // '' is legal if an attachment exists
  title?: string
  source?: string
  topic?: string           // dead: patchable in writes.ts, searched in Timeline.tsx, never written
  origin: 'learner' | 'activity'
  createdAt: Iso
  updatedAt: Iso
}

interface Attachment {
  id: Id
  notebookId: Id
  entryId: Id
  kind: 'text' | 'image' | 'pdf' | 'audio'
  text?: string             // pasted text and transcripts live here
  mediaId?: Id              // everything else points at a blob
  filename?: string
  createdAt: Iso
}

interface Media {
  id: Id
  notebookId: Id
  mime: string
  bytes: Blob               // IndexedDB stores Blobs natively. Never base64
  width?: number
  height?: number
  durationMs?: number
  voice?: string            // on generated speech, the voice it was spoken in (§9)
}

interface Word {
  id: Id
  notebookId: Id
  term: string
  termKey: string           // normalized, unique per notebook (see below)
  meaning?: string
  note?: string
  familiarity?: Familiarity // unset means estimate it
  audioMediaId?: Id         // the kept clip, written on first play. Renaming drops it (§9)
  createdAt: Iso
  updatedAt: Iso
}

interface Sentence {
  id: Id
  notebookId: Id
  text: string
  translation?: string
  note?: string
  audioMediaId?: Id         // as Word. Editing the text drops it (§9)
  createdAt: Iso
}

interface Encounter {                     // Entry -> Word and Entry -> Sentence
  id: Id
  notebookId: Id
  entryId: Id
  targetType: 'word' | 'sentence'
  targetId: Id              // unique with entryId, see below
  createdAt: Iso
}

interface WordInSentence {                // Word -> Sentence, derived but editable
  id: Id
  notebookId: Id
  wordId: Id
  sentenceId: Id
  source: 'derived' | 'manual'
}

interface PracticeEvent {
  id: Id
  notebookId: Id
  workbookId: string
  targetType: 'word' | 'sentence'
  targetId: Id
  outcome: 'right' | 'wrong' | 'shown'
  at: Iso
}
```

Two more tables are app state rather than journal data. `WorkbookSession` is in §7, `Proposal` in
§10, and both live in `db/types.ts` alongside the journal records. Settings is a single-row table
holding the API key, the meaning-language default, and `lastExportedAt`.

`ProposalDraft` is a proposal before it is a record: the same words and sentences with no id and no
status. It is what Extract produces and what `JournalWriter.propose` takes (§8).

### Two helpers the strict flags force

`exactOptionalPropertyTypes` refuses an explicit `undefined` on an optional field, which is exactly
what you get building a record from form input. IndexedDB would also persist the key, and it would then
surface in the export bundle as a null nobody meant to write. So every record is built through
`compact()`, which strips undefined values, and `Compacted<T>` describes what that does to the type so
the result still satisfies the record interface.

### Dexie schema

```ts
db.version(1).stores({
  notebooks:       'id, lastOpenedAt',
  entries:         'id, notebookId, [notebookId+date]',
  attachments:     'id, notebookId, entryId',
  media:           'id, notebookId',
  words:           'id, notebookId, [notebookId+termKey], [notebookId+term]',
  sentences:       'id, notebookId',
  encounters:      'id, notebookId, entryId, targetId, &[entryId+targetId], [notebookId+targetType]',
  wordInSentences: 'id, notebookId, wordId, sentenceId',
  practiceEvents:  'id, notebookId, targetId, at',
  sessions:        'id, notebookId, status',
  proposals:       'id, notebookId, entryId, status',
  settings:        'id',
})
```

### Term normalization

Word uniqueness is per notebook after normalization (concepts §7). `termKey` is stored and indexed
so the check is a lookup, not a scan.

```ts
const normalizeTerm = (s: string) =>
  s.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
```

NFC matters more than it looks. macOS hands over decomposed Hangul, so ㅎ+ㅏ+ㄴ typed on a Mac and
한 pasted from a website are different strings until normalized, and you get silent duplicate words.

### One encounter per entry

`[entryId+targetId]` is unique, which is what the `&` in the schema above buys. Adding the same word
twice in one sitting, or re-extracting an entry that already yielded it, is a no-op rather than a
second encounter. So `timesEncountered` reads as the number of distinct entries a word came up in.
That is the number the words screen shows and the number behind Extract's "11th time" line, and it
agrees with `firstSeen` and `lastSeen` already being entry dates.

### Word to Sentence links

Derived on write, then editable, so the record carries `source`. For space-delimited languages use
`Intl.Segmenter` with `granularity: 'word'`. For Korean and Chinese, segmentation is unreliable, so
fall back to substring match of `termKey` against the normalized sentence. That over-matches
occasionally. It is a UI convenience, not data anyone depends on, and the learner can remove a wrong
link.

### Derived signals

Computed on read as pure functions over encounters and practice events, never stored (concepts §10).
A heavy notebook is a few thousand rows, which is nothing.

```ts
timesEncountered(wordId)   // count of encounters
firstSeen / lastSeen       // min / max entry date via encounters
lastPracticed(wordId)      // max practiceEvent.at
estimatedFamiliarity(word) // only when word.familiarity is unset
```

Keep the estimate dumb. It renders as three dashes and nothing branches on it.

| Estimate | Rule |
|---|---|
| new | fewer than 2 encounters and no correct practice |
| getting it | anything in between |
| got it | 5+ encounters and a correct practice event in the last 30 days |

---

## 4. Storage and the file the learner owns

IndexedDB is the working store. It is not the artifact. The artifact is a `.lljournal` file.

### The bundle

A zip written with fflate. Plain JSON so it survives this app being abandoned.

```
manifest.json                      { format: "lljournal", version: 1, exportedAt, app }
notebooks/<slug>/notebook.json     every record for that notebook, media referenced by id
notebooks/<slug>/media/<id>.<ext>  the raw bytes
readable/<slug>.md                 generated on export, ignored on import
```

`readable/` is the reason to bother with a folder structure. It is the whole notebook rendered as
plain Markdown, one file per notebook, entries newest first with words and sentences under each. It
costs about fifty lines of code and it means the journal is readable in any text editor forever, with
no app and no import step. Given how much of this design is about a journal that just works, the data
should be readable the same way.

### Export and import

Export writes one notebook or the whole library. Import reads `manifest.version` and refuses a major
it does not know.

When an imported notebook id already exists locally, the learner picks.

| Option | Behavior |
|---|---|
| New copy (default) | Fresh ids throughout, sits alongside the original |
| Replace | Deletes the local notebook and its records, inserts the imported one |

Replace is a whole-notebook overwrite, not a merge. That is the entire reason this design has no sync
machinery. The cost is real and worth stating plainly. Edit on two devices between exports and one
side's edits are lost. The working rule is that one device is home and the others hold copies.

### Browser eviction is the actual risk

IndexedDB is not permanent storage. Browsers evict it under pressure, and clearing site data wipes
it. Three mitigations, all boring.

1. Call `navigator.storage.persist()` on first run, which upgrades the origin to persistent storage
   when granted.
2. Show `lastExportedAt` in Settings as a plain line of text.
3. If it has been more than 14 days, that line reads that it has been a while. One line, no badge, no
   modal, no red dot.

Once the app is a Tauri build this stops being a concern, because the store is a file on disk.

### All file I/O lives in one module

`storage/files.ts` exposes `saveBundle(bytes, filename)` and
`openBundle(accept?): Promise<Uint8Array | undefined>`. Browser implementation uses a download and an
`<input type="file">`. Tauri swaps in the fs plugin. Nothing else in the app touches files, so §12
stays a one-file change.

Two details that are not obvious and are load-bearing. `openBundle` resolves `undefined` on cancel,
settled by whichever comes first of `change` or the window regaining focus, because a file input has no
reliable cancel event and without this the import screen waits forever. And `saveBundle` copies into a
fresh exact-size `Uint8Array` before constructing the Blob, because a `Uint8Array` from fflate may be a
view onto a larger buffer and handing that straight to `Blob` writes the whole thing. The same guard
appears in `bundle.ts` on the way in and in `ai/client.ts` for generated media.

### The shell cache and installing

The app is installable and its shell is cached. Both halves are small and neither touches the journal.

```
public/manifest.webmanifest   name, icons, standalone display, #f3f2f2 on both colours
public/sw.js                  the shell cache, hand-written
public/icon-{192,512}.png     generated from the design tokens
public/icon-maskable-512.png  content inside the 80% safe circle
public/apple-touch-icon.png   iOS reads this rather than the manifest
scripts/make-icons.ps1        regenerates all four from the tokens
src/storage/install.ts        registration, and holding `beforeinstallprompt`
```

The service worker is hand-written rather than generated by a plugin. It caches the five shell files on
install, then caches any same-origin asset the first time it is fetched, which is how it picks up
Vite's hashed filenames without a build-time manifest. Navigations are network first with the cached
shell as the fallback; hashed assets are cache first, because a content hash means a cached copy can
never be the wrong version.

Two rules keep it honest. **Same-origin GET only**, so calls to `api.x.ai` are never intercepted,
never cached and never replayed: an AI call is something the learner just pressed (§9), and a stale
cached answer would be a lie. And it registers in production only, because in dev it would serve stale
modules and fight Vite's HMR.

Registration fails quietly by design. A service worker needs a secure context, so it does nothing on
`file://` and nothing inside a Tauri webview, and neither wants it: a Tauri build already has its
assets on disk. Nothing is lost either way, because the journal is in IndexedDB rather than on a server.

`install.ts` catches `beforeinstallprompt` before React mounts, since the event fires early and is gone
if nobody holds it, and calls `preventDefault()` so Chromium's mini-infobar does not appear over the
journal. The offer surfaces as a button in Settings instead, and when the browser is not offering to
install, the button is simply absent rather than present and dead.

Worth being plain about what installing does not do. It gives the journal its own window and its own
icon and it opens without a network. It does not make the data safer: an installed PWA is the same
evictable IndexedDB, so the export above is still the only real backstop.

---

## 5. Writes, autosave, and input

Every write goes through a small `journal/` layer, never Dexie directly from a component. That layer
owns the rules that concepts §9 sets out, so no caller can forget them.

- A word or sentence added anywhere links to today's entry, creating that entry if needed.
- Re-encountering an existing word creates a new `Encounter`, never a second `Word`.
- An entry with an empty body and no attachments is not valid and is deleted when the composer closes.
- Deleting an entry deletes its attachments, their media, and its encounters. Words and sentences
  survive, one encounter lighter. Deleting a notebook deletes every record carrying its `notebookId`,
  which is what import-Replace depends on (§4).

### The surface

`journal/writes.ts` is the only module that writes journal data. Every write function takes an optional
`JournalDb` as its last argument, which is what lets the tests run against a throwaway database and
what lets `/sandbox` (§8) point a workbook at a fixture.

| Group | Functions |
|---|---|
| Notebooks | `createNotebook`, `touchNotebook`, `deleteNotebook` |
| Entries | `createEntry`, `saveEntry`, `todayEntry`, `entryOrdinal`, `neighbourEntries` |
| Pruning | `pruneEntryIfEmpty`, `pruneEmptyEntries`, `deleteEntryPreview`, `deleteEntry` |
| Words | `addWord`, `updateWord`, `setFamiliarity`, `deleteWord` |
| Sentences | `addSentence`, `updateSentence`, `deleteSentence`, `deriveWordLinks`, `unlinkWordFromSentence` |
| Attachments | `addAttachment`, `deleteAttachment` |
| Links | `encounter` |
| Reflect | `appendReflection` |
| Proposals | `draftProposal`, `saveProposal`, `acceptProposal`, `discardProposal` |
| Workbooks | `saveMoment`, `recordPractice` |

Plus `localDayRange`, a date helper rather than a write, exported because `todayEntry` and the tests both
need the same local-calendar-day bounds.

Workbook **sessions** are the one exception, and deliberately so: they are app state rather than
journal data, so they live in `workbooks/sessions.ts` (§7). The rule that matters still holds, because
no component touches Dexie either way.

One of these is worth knowing about beyond its name. `appendReflection` writes a Reflect turn into
the entry body under a `---` separator, chosen because it is a real Markdown thematic break so it
survives into `readable/` as a rule, and because it passes through that renderer's line escaper
untouched.

`deleteWord` and `deleteSentence` were added with the sentences section (§6) and are symmetric on
purpose. Both take the target's encounters and its `wordInSentences` links, leave the thing on the other
side of those links alone, and then run `pruneEntryIfEmpty` on every entry they touched, so a quick-add
that created today's entry and was then deleted leaves nothing behind.

The word delete lived inline in the words screen until then, which was the one place a component wrote
to Dexie directly. Moving it here restored the rule at the top of this section, and it gained the entry
prune the inline version never had.

### Autosave

A 400ms debounce on the composer, writing the whole entry record. The UI guide's "Entry saves as you
write" is literal. There is no save button anywhere and no dirty state to track.

Two things learned building it, both of which look like bugs if you meet them cold. The composer seeds
its fields from the record once, on the first render where the record exists, because re-seeding on
every live update fights the cursor: the debounced write comes back through the same live query. And
the autosave has an equality guard against the live record, because seeding makes the fields go from
undefined to values, which looks exactly like a change, so without it the composer wrote on mount and
read "saved" before a key was pressed.

Related, and the reason `pruneEmptyEntries` exists: the composer creates its entry eagerly because
autosave needs an id to write into, and pruning runs when the **timeline** mounts rather than in the
composer's unmount. Unmount fires twice under React's strict double-invoke in development, and the
first pass would delete the entry the second pass reloads.

### IME

Korean and Chinese typing goes through composition events. Any keystroke handling must ignore events
while `event.isComposing` is true, or half-formed syllables get treated as input. The debounced
autosave is unaffected because it only reads the field value.

Four places carry the guard, and all four would be a real bug without it: submit-on-Enter in Reflect
and in the workbook answer field, Escape-to-dismiss on the capture chip, and Escape-to-minimize on the
workbook sheet. Escape during Hangul composition cancels the syllable, and it must not also close the
thing you are typing into.

---

## 6. Shell, routes, and overlays

The persistent chrome is the kicker strip, the 64px gutter rail, and the workbook dock at the foot of
the rail. Content swaps underneath. Mobile moves the rail to a bottom bar and the dock to a strip
above it, per the UI guide.

| Route | Screen |
|---|---|
| `/` | Notebooks |
| `/n/:nb` | Journal timeline |
| `/n/:nb/e/:id` | Entry detail |
| `/n/:nb/e/:id/edit` | Composer |
| `/n/:nb/e/:id/reflect` | Reflect |
| `/n/:nb/words` and `/n/:nb/words/:id` | Words, index and detail |
| `/n/:nb/sentences` and `/n/:nb/sentences/:id` | Sentences, index and detail |
| `/n/:nb/practice` | Workbooks contents page |
| `/settings` | Settings, including the API key and export |
| `/sandbox` | Dev only (§8). Registered in every build, redirects to `/` in production |
| `*` | Redirects to `/` |

An earlier draft listed `/n/:nb/new` for a new entry. It was never built and is not needed: "New entry"
calls `createEntry` and then navigates to that entry's `/edit`, because the composer needs a record to
autosave into (§5) and a route that creates one as a side effect of rendering would create a second on
React's strict double-invoke.

Only routes with a screen behind them are registered. There are no placeholders anywhere: until M4
landed, `/n/:nb/practice` and the `Practice` action were absent rather than leading to an empty
contents page.

Extract is a modal over the entry, so it is a search param rather than a route. `?extract=1`. Same
for an open workbook, `?workbook=<sessionId>`. Both then get browser back for free, and back out of a
workbook means minimize, which is exactly the intent.

Search is a filter over the timeline, not a screen of its own. `?q=` narrows the visible entries by
substring over title, body, and source, and the dated hairlines collapse to only the days that still
have an entry. Same search-param reasoning as above, so back clears it and a filtered view survives a
reload. The words and sentences screens keep their own separate filters over their own text.

Reflect gets a real route because the UI guide gives it the full shell.

### The notebook has four sections, not three

Added after M5. `Sentence` is one of the two learning units (concepts §5) and it had no home: a sentence
was reachable only from the entry it came from, from a word that appears in it, and from a count on the
timeline that was not a link. There was no way to see a notebook's sentences at all, and no way to find
one without remembering the day.

So Sentences is its own section beside Words rather than a tab inside a renamed one. The two lists want
different shapes, which is the whole argument. Words sort alphabetically and carry three familiarity
dashes and an encounter count. Sentences sort newest first and have nothing useful to sort
alphabetically by. One column serving both would have made both worse.

The frame is shared and the rows are not, which is what the `ix-` CSS prefix marks: `ix-split`,
`ix-list`, `ix-rule`, `ix-detail` and the row and detail chrome are the index-screen scaffolding, while
`wd-` and `sn-` carry only what is specific to a word row or a sentence row. Before this there was one
such screen and the scaffolding was named `wd-`.

The rail is the same four links on all four screens, so it is one `SectionRail` component rather than a
block copied into each screen. It was copied into three before this, and a fourth copy is how they drift.
Words is `Type` and Sentences is `Quote`, which is the pair the composer's rail already uses for adding
one of each.

The timeline's sentence count became a link to `/n/:nb/sentences?entry=<id>`, which narrows the list to
that entry. Same search-param-as-filter reasoning as `?q=`, so back clears it, and the section label
says what it is scoped to with the way out of it on the same line.

One cost, stated rather than fixed. On mobile the rail is a row of 44px targets with the dock chips on
the end and no wrap or scroll. Five icons plus the hairline is 221px of the 360px bar, so three docked
sessions fit where four did before. This was not verified in a browser: the harness viewport could not
be driven below the 720px breakpoint.

### Where the pieces mount

Worth stating, because §7 depends on it. `<Shell>` is rendered by each screen, and it renders `<Dock>`
at the foot of the rail itself, so a docked exercise is reachable from every screen in the notebook
rather than only from the practice page. The `<WorkbookLayer>` that puts the sheet on screen is a
**sibling of `<Routes>`**, not a child of any screen. That is what lets the sheet appear over the
current route without unmounting it.

`<Dock>` reads `:nb` from the route params, so on the library and on Settings there is no notebook and
it renders nothing.

---

## 7. The workbook dock

This is the interaction the whole app is judged on, so it gets spelled out.

A workbook opens as a sheet over the current route. The journal stays mounted behind it. Minimizing
drops the sheet and leaves the journal exactly where it was, same scroll position, same open entry,
cursor still in the composer if it was. Restoring puts the sheet back. That is the entire mechanic.
Because the workbook is an overlay on the journal rather than a separate destination, writing an entry
mid-exercise is one press away and back again.

### The session record

```ts
interface WorkbookSession {
  id: Id
  notebookId: Id
  workbookId: string        // which module
  label: string             // what the dock chip reads, set by the workbook
  state: unknown            // opaque JSON, owned entirely by the workbook
  status: 'open' | 'docked'
  openedAt: Iso
  touchedAt: Iso
}
```

`workbooks/sessions.ts` is the whole surface on it: `openSession`, `expandSession`, `dockSession`,
`saveSessionState`, `setSessionLabel`, `closeSession`, `getSession`, `dockedSessions`. Same optional-db
argument as the write layer, which is what lets the round trip be tested (§13).

Minimize writes `state` and sets `status: 'docked'`. Restore mounts the same component with that
state. There is no separate suspend path and no serialization protocol. The workbook hands over a
JSON-able object, gets it back, and continues.

Because state is in IndexedDB rather than memory, a session survives a reload, a browser restart, and
closing the laptop. Same code path, no extra work. It goes through structured clone rather than
`JSON.stringify`, so what comes back is structurally equal but not the same object, and a workbook
cannot be handed a live reference to its own stored state.

### How the param and the record stay in agreement

`?workbook=<sessionId>` is authoritative for what is on screen. The record has to follow it, and there
is exactly one place that makes it: `WorkbookLayer` calls `expandSession` in its load effect. That
covers every way in — pressing a chip, following a link, and reloading with the param still in the URL
— and `expandSession` is also what docks any other open session, which is how the "at most one
expanded" rule below is enforced.

This was got wrong first. The dock chip originally just set the param, so the chip stayed in the rail
beside its own expanded sheet and the record said `docked` while the learner was looking at it. Putting
the reconciliation in the layer rather than in the chip's handler is what fixed it for all three paths
at once.

Going the other way, the layer's unmount cleanup writes the state and docks the session. So browser
back docks, and so does following any link out of the current route: navigating away parks the exercise
rather than losing it.

### State, and where it is held

`setState` is debounced 400ms into the session record, but the value itself is kept in a ref rather than
in React state. That matters at the moment of docking: docking writes what the workbook currently
holds, not whatever last survived the debounce. The state handed **to** the workbook is separate and
stable for the life of the session, so a re-render cannot make the prop change under it.

Closing drops the pending write rather than flushing it, because closing saves nothing (below), and
sets a flag so the unmount cleanup does not then dock a row that has just been deleted.

### Rules

- Any number of sessions can be docked. At most one is expanded.
- Opening a second workbook while one is expanded docks the first. No prompt.
- Docked sessions live until the learner closes them. No expiry, no cleanup job, no "resume?" prompt.
- The dock chip shows the workbook name and its label. No progress bar, no timer, no unread count.
- Closing a session asks nothing and saves nothing to the journal. Whatever the learner wanted kept,
  they already saved through `saveMoment` (§8). So closing is a delete, not a status.
- The notebook is the boundary. Sessions are scoped to one notebook, and opening an exercise in one
  notebook leaves an expanded session in another alone.

### Media in a session

Generated audio and images are held as Blobs in React state for the life of the sheet, not in
IndexedDB. Minimizing a session drops that state, so a docked session costs a few hundred bytes of
JSON. This follows from the storage decision in §1.

Audio survives it anyway. Clips on a word or a sentence are kept in `media` from first play, and
everything else `speak` holds in a module-level map for the page load (§9), so reopening a minimized
exercise replays without a second API call. Images have no such map and do re-fetch, which is fine
while nothing in v1 draws.

### Verified, not assumed

This is the one mechanic in the app that cannot be checked by reading the code, so it was checked in a
browser. With a workbook expanded over the composer, the cursor placed mid-word inside 치우겠습니다 and
the page scrolled 318px down, minimizing left every one of these intact: the route, the scroll position,
the body text, the cursor offset, the cursor still splitting `치우|겠습니다`, focus still in the
textarea, and the title field. The sheet went, the chip came back, the param cleared, and the console
stayed empty. Browser back behaves identically to the minimize button.

Nothing was restored, which is the point. The journal never unmounted, so there was nothing to restore.

---

## 8. Workbook modules

A workbook is a folder. Adding one is a folder plus one line in the registry.

```
workbooks/
  index.ts       the registry, an array, plus workbookById()
  sdk.ts         types only, and register()
  sessions.ts    session CRUD (§7)
  context.ts     buildContext(), the pure selection rules, focusCandidates()
  level.ts       the one copy of the level rule, plus used/word matching
  writer.ts      journalWriterFor(), aiFor()
  drill.tsx      the cue, answer, verdict, follow-up loop both drills run on
  word-drill/
    manifest.ts
    Workbook.tsx
    prompt.ts
  sentence-drill/  roleplay/  story/  listening/  describe/    same three files each
```

### Three things that are shared rather than per workbook

The workbooks would each have arrived at their own answer to the same three questions, and would
have drifted apart on the day one of them was tuned. So each lives in exactly one file.

**Focus**, `WorkbookScope` in `db/types.ts`, resolved in `context.ts`. A marking rather than a filter:
chosen words and sentences are flagged, exempted from the request's own `familiarity` and `recentDays`
filters, and sorted first, while the rest of the notebook still arrives behind them. The exemption is
the part that matters — without it, focusing an entry from eight months ago against word drill's
`recentDays: 60` would filter the chosen words straight back out. The scope carries resolved ids, not
entry ids alone, so a docked session cannot gain material because one of its entries was edited
afterwards. `ui/FocusPicker.tsx` is where it is set, on the practice row.

**The support ladder**, `ui/Support.tsx`. Three presses, each giving less help than the next, and only
the third records `'shown'`. `estimateFamiliarity` counts only `'right'`, so taking the answer leaves
the word where it was: credit withheld, nothing deducted, nothing said. Nothing anywhere branches on
`'shown'`, which is what keeps §16's ban on automatic difficulty adjustment true. The component takes a
three-tuple of reveals and an `onSpend`, and never touches the journal, so a workbook cannot decide how
many rungs there are or which one costs. The roleplay has no ladder on purpose: support there is asking
the character in the target language, and asking is genuine use.

**The level rule**, `workbooks/level.ts`. `levelRules(bundle)` and `materialLines(bundle)`, pasted into
every generative prompt. Deliberately about the material rather than about a level: "write at A2" asks
the model to guess at a scale nobody shares, where "use these words and nothing harder" is checkable,
and the `used` field every generative workbook returns is what checks it. `usedTargets` resolves that
field back to word and sentence ids, which is what the ladder's third rung records against, since
`targetType` is `'word' | 'sentence'` and a generated scene is neither. `wordsUsedIn` does the reverse
for the learner's own writing, which is what the roleplay and describe record `'right'` from.

The rule has two reaches. `strict`, the default, holds a story scene or a dialog to the listed material
and the shape of the listed sentences, because a text read cold stops being readable one unknown word
too early. `stretch` is for the roleplay, where the material is the anchor rather than the fence: the
character leans on it, reaches for everyday words a learner could guess from context, and never copies
a listed sentence back. A character held to `strict` texts the learner's own sentences back at them,
and a thread like that gives them nothing to answer.

```ts
interface WorkbookManifest<S = unknown> {
  id: string
  name: string                                   // Cormorant 21px on the practice page
  icon: LucideIcon                               // its own glyph, from Lucide's book family
  request: BundleRequest                         // what it needs from the notebook
  describes: (b: ContextBundle) => string        // "Draws on 14 recent words"
  Component: ComponentType<WorkbookProps<S>>
}

interface WorkbookProps<S = unknown> {
  bundle: ContextBundle
  state: S | undefined             // stable for the life of the session
  setState: (next: S) => void      // debounced write to the session record
  setLabel: (s: string) => void    // what the dock chip reads
  ai: AI                           // §9
  journal: JournalWriter
  minimize: () => void
  close: () => void
}
```

Each workbook is generic in its own state type, and an array of differently-parameterised manifests has
no useful common type. So the registry holds `AnyWorkbook`, and `register(manifest)` is the one function
that narrows to it, keeping the cast contained to a single line. The dock never inspects state, it only
round-trips it, so the erasure costs nothing and the real type stays inside the workbook where it means
something.

### What a workbook may do to the journal

Nothing directly. It gets a `JournalWriter` and that is the whole surface, which keeps concepts §7
true by construction.

```ts
interface JournalWriter {
  saveMoment(m: { title?: string; body: string; source?: string; media?: Blob[] }): Promise<Id>
  addWord(w: { term: string; meaning?: string; note?: string }): Promise<Id>
  addSentence(s: { text: string; translation?: string }): Promise<Id>
  propose(p: ProposalDraft): Promise<Id>
  recordPractice(e: Omit<PracticeEvent, 'id' | 'notebookId' | 'at'>): Promise<void>
}
```

`saveMoment` is the one the learner triggers, and it is the only thing that turns a workbook session
into an entry. It writes an entry with `origin: 'activity'`. Nothing else in a workbook creates
entries. A session the learner never explicitly saves leaves no trace in the journal beyond practice
events.

`origin: 'activity'` is also what keeps a saved exercise out of `todayEntry`, so a word quick-added
later that day never lands inside someone else's session.

Both objects are built per session and closed over the notebook id, which is the actual enforcement
mechanism: a workbook cannot name another notebook, cannot reach Dexie, and cannot call `fetch`. Note
what `recordPractice` omits — a workbook says what happened, not which workbook it was or when.

### What a workbook may ask xAI

```ts
interface AI {
  complete(input, opts?): Promise<string>
  completeJson<T>(input, opts): Promise<T>
  speak(text: string): Promise<Blob>          // notebook language already bound
  draw(prompt: string): Promise<Blob>
  animate(prompt: string, signal?): Promise<Blob>   // unverified, see §9
}
```

Functions rather than the `ai/` modules themselves, so the key lookup, the error normalisation and the
model pinning stay somewhere a workbook cannot route around. `speak` takes only text because the
language is the notebook's, and a workbook should not be able to ask for the wrong one.

The language is read from the notebook record, not from `bundle.profile`. A workbook that never asked
for `notebookProfile` would otherwise get an AI surface that speaks in no language at all.

### Asking the journal for material

```ts
interface BundleRequest {
  notebookProfile?: boolean
  words?: {
    limit?: number
    familiarity?: Familiarity[]
    recentDays?: number
    order?: 'recent' | 'least-practiced' | 'random'
  }
  sentences?: { limit?: number }
  entries?: { limit?: number; includeBody?: boolean }
}

interface ContextBundle {
  notebookId: Id
  profile?: { title: string; language: string; focus?: string; meaningLanguage: string }
  words: { word: Word; signals: WordSignals }[]
  sentences: Sentence[]
  entries: { id: Id; date: Iso; title?: string; source?: string; body?: string }[]
}
```

One function, `buildContext(notebookId, request)`, serves any request. Workbooks never query. This is
where the derived signals get attached, so a workbook receives words already carrying encounter counts
and familiarity.

Named `buildContext` and not `buildBundle`, which is already taken by `storage/transfer.ts` for the
export zip. Two different things under one name in one codebase is a bug waiting for a tired afternoon.

An absent key means **none**, not everything: a workbook that forgets to ask for sentences gets an empty
array rather than the whole notebook. `limit: 0` likewise means none rather than unlimited.

The filtering and ordering are pure functions, `selectWords` and `selectSentences`, exported and tested
separately from the database read. Two rules in there are decisions rather than mechanics.
`least-practiced` puts words with no practice event at all first, because a word never practised is the
least practised thing in the notebook. And `random` is a real Fisher-Yates shuffle, not
`sort(() => Math.random() - 0.5)`, which is biased in a way a learner notices before the code does.
`recent` orders by the date of the entry a word was last met in, and a word never met sorts last.

### The sandbox

`/sandbox` mounts any registered workbook against a fixture notebook, in a **separate Dexie database**
named `llj-sandbox`, so nothing there can reach a real notebook. `JournalDb` already took a name
parameter, which is what made that a guarantee rather than a careful convention. This is where a new
exercise gets built and thrown away without needing a real journal in a real state.

The fixture is seeded in code rather than from a JSON file: one Korean notebook with a focus, eight words
each with a meaning and one encounter spread over the last month, and a sentence. It is written once and
left alone on later visits, so an exercise behaves the same way twice. There is a button to delete the
database and reseed.

Dev only: in a production build the route is registered but renders a redirect to `/`. Registered in
both so the router does not differ between builds, since a route that redirects is easier to reason
about than a route that sometimes exists.

Harness design, teaching logic, and prompts per workbook are out of scope here, same as in the
concepts doc.

### word-drill, as an example of the shape

The first workbook, and the pattern a second should follow. It asks for `notebookProfile` and eight
words ordered `least-practiced` within the last 60 days. Per word it makes one call for a cue, which is
asked to give a situation rather than a definition, takes a typed answer, and makes one structured call
to mark it. Marking is deliberately generous: using the word acceptably counts even if something else in
the sentence is off, and the correction rides along in a `better` field instead.

A cue's angle is picked in code, not by the model: a reply to something someone said, a reason, the
past, a question, a refusal, an offer, or a second word from the bundle to combine with. The cue goes to
the quick model, which does not deliberate, so asking it to "be varied" gets eight cues of the same
shape. Choosing the angle in code gets variety for nothing.

Marking also writes the next round. The verdict carries a `next` field: a follow-up cue that reacts to
what the learner wrote and asks for something the last answer did not need, such as a different form, a
reason, or a detail. One call rather than two, because the follow-up has to have read the answer, and
the marking call already has. An item gets at most `MAX_ROUNDS` rounds, three, and on the last one the
prompt asks for an empty `next`. Moving on is one press at any point. Every answer records a practice
event. That inflates nothing, because `estimateFamiliarity` asks whether there is a recent `'right'`,
not how many.

The loop lives in `workbooks/drill.tsx`. Word drill and sentence drill are the same exercise over
different material, so each is a thin `Workbook.tsx` that hands `Drill` its items, a `view` into the
shape the engine displays, and its three prompts. The teaching logic stays in each `prompt.ts`.

Its state is `{ at: number; rounds: Round[]; done: Record<Id, { answers: string[]; right: boolean }> }`.
`rounds` is the exchange on the current item and is kept. A different opening cue for the same word
is still that word's drill, but a follow-up is a reply to what the learner wrote, and losing it would
lose the exercise rather than repeat it. The persistence rule below applies. `restore` reads the older
single-`answer` shape, so a session docked before follow-ups existed still opens. Its output is wrapped
in `<Capturable>` (§11), so pulling a word out of an exercise gains a word on today's entry and nothing
else. It is also the support ladder's first consumer. The ladder is keyed on the item and the round,
so every follow-up starts back at the bottom rung.

**Sentence drill** is its twin over `sentences: { limit: 8 }`. Each cue asks for the sentence's pattern
bent to a new situation: another time, another listener, the negative, a question, a reply, or a reason
added. Saying a collected sentence back proves nothing. It is right when the pattern survives the
change, and practice is recorded with `targetType: 'sentence'`.

### The other four

| Workbook | Leads with | Generated content persists | Costs beyond text |
|---|---|---|---|
| Text-message roleplay | entry bodies, to find people | the whole thread | none |
| Choose your own story | focus and entry bodies | every scene's prose | one image per scene, opt in |
| Listening dialog | sentences | the dialog and the answers | two TTS calls per line played, cached |
| Describe the picture | words | the brief and the verdict | one image per press |

The persistence column is the one rule worth stating, because §7 says generated content dies with the
sheet and three of these keep text. The line is this: **text persists where regenerating it would lose
the exercise rather than repeat it.** Word drill's cue is regenerated because a different cue for the
same word is still that word's drill. A different thread, a different story, or a different dialog is a
different exercise, and a learner who put one down mid-conversation would come back to someone else's.
Media never persists, in any of them.

---

## 9. AI

One module, one key. xAI covers text, image, video and voice on a single key, which is the reason for
the choice.

```
ai/
  client.ts    fetch wrapper, base URL, auth header, error normalisation, blob helpers
  models.ts    pinned model id per capability, and the reasoning-effort default
  text.ts      complete(), completeJson(schema), attachmentPart()
  speech.ts    speak(text, language, opts?) -> Blob     // opts.voice, for a two-speaker dialog
  image.ts     draw(prompt) -> Blob[], drawOne(prompt) -> Blob
  video.ts     animate(prompt, signal?) -> Blob   // defined, unused, unverified
  extract.ts   extractFromEntry(input) -> ProposalDraft   (§10)
  reflect.ts   nextQuestion(context, turns) -> string | undefined   (§10)
```

The two feature modules sit here rather than in `journal/` because they are prompt-and-parse and nothing
else: neither writes. `extract.ts` returns a draft that §10's dedupe resolves and the learner accepts;
`reflect.ts` returns one question. There is no `transcribe()`, per the STT correction below.

| Capability | Endpoint | Model |
|---|---|---|
| Text | `POST /v1/responses` | `grok-4.6` |
| Image | `POST /v1/images/generations` | `grok-imagine-image-2.0` |
| Video | `POST /v1/videos/generations`, then poll `GET /v1/videos/{id}` | `grok-imagine-video-1.5` |
| Speech to text | `/v1/stt`, **a WebSocket, not a POST** | — |
| Text to speech | `POST /v1/tts` | — |

Base URL is `https://api.x.ai/v1`. The API is OpenAI-shaped, and `/v1/responses` is the current
recommendation with chat completions marked legacy.

Model ids belong in `models.ts` and nowhere else. xAI retires slugs on a schedule and redirects old
ones, so these will drift.

### What the API actually does, verified 2026-09-15

Every route below was probed against the live API before `ai/` was written. Where this contradicts an
earlier draft of this section, the probe is right.

**The message is not `output[0]`.** `/v1/responses` returns `output` as an array whose first element is
a `reasoning` item on every call observed. The answer is the element with `type: 'message'`, and its
text is the `output_text` parts of its `content`. Taking `output[0]` yields the model's summary of the
prompt: prose that will not parse for a JSON call, and the wrong text for a prose one.

**Setups reason, turns do not.** `MODELS.quick` is a non-reasoning model, and a JSON answer comes back
from it in about one second against about five from `grok-4.6` at `low`. The split follows the shape
of each workbook. The call that designs the exercise is made once and decides its quality, so it
reasons: roleplay's people, the story's setup, the listening dialog. Every call the learner waits on
between their own moves goes quick: drill cues, marking and follow-ups, each roleplay turn, each story
scene, listening's marks, and the ladder's rungs. The exception is anything that reads an image.
Describe's brief, marking and hints stay on `text`, because the quick model misreads pictures.

**Reasoning effort is a cost decision, not a quality dial.** `grok-4.6` reasons at `high` unless told
otherwise. Measured on a two-word answer: `high` spent 1671 reasoning tokens against 34 real ones,
`low` spent 69. A structured Extract-shaped call cost 109.8M usd-ticks at the default and 9.6M at
`low`. Every call here is a learner pressing a button on their own key, so `low` is the default and
only Reflect asks for `medium`. `none` is rejected by this model; `minimal` is silently treated as
`low`.

**`/v1/tts` takes `language` in the body, not the query.** An earlier draft had
`POST /v1/tts?language=ko` with only `text` in the body. Wrong: omitting `language` from the **body**
returns 422 `missing field \`language\`` whatever the query string says. Body is
`{ text, language, voice? }`. The response is raw `audio/mpeg`. There is no `model` or
`response_format` field — both are accepted and silently ignored. An unknown `voice` is a 404, not a
fallback. Voices are listed at `GET /v1/tts/voices` and every one reports `language: multilingual`.

**Images should come back as base64, not a URL.** The default response is a URL on `imgen.x.ai`, a
second origin whose CORS policy is undocumented, and it expires: a URL from one probe was already dead
minutes later. `response_format: 'b64_json'` returns the bytes inline on `api.x.ai`, which is the
origin already confirmed to allow browser calls. That removes the expiry window and the second origin
in one move, at the cost of base64 inflating a 400kB image to about 530kB. Worth it for a capability
that might otherwise simply not work with no server to proxy through.

**Attachments both work, and PDFs need a valid PDF.** Images go as
`{ type: 'input_image', image_url: '<data url>' }`. PDFs go as
`{ type: 'input_file', file_data: '<data url>', filename }`. A structurally invalid PDF fails with
`failed to ingest inline file bytes via media service`, which reads like an unsupported part type but
is not: a PDF with a correct xref table is read fine.

**`/v1/stt` is a WebSocket.** A GET returns ``  `Upgrade` header did not include 'websocket' ``, the
same as `/v1/realtime`. A browser `WebSocket` cannot set an `Authorization` header, which is the exact
wall that puts realtime voice out of scope. So spoken answers are **not** built: typing is the input
mode in workbooks, which this section already required to be available and the transcript editable
anyway. This corrects the claim below that "TTS and STT round trips work fine from the browser" — TTS
does, STT does not.

**`/v1/audio/speech` is not available.** Returns 403 "Team is not authorized", so the
OpenAI-compatible audio path is closed on this account.

**Video is the one unverified route.** `animate()` is written against the documented shape and has not
been probed. It is defined and unused, per the decision below, and the file says so in a comment rather
than implying it works.

Why TTS matters more than it looks: `speechSynthesis` on the machine this was built for carries three
voices, all `en-US`, with no Korean voice pack. There is no local fallback for Korean audio, so this
route is the only way to hear a Korean word spoken, and a fallback to the system voice would either
say nothing or read Hangul in an American accent.

### Four things about this that will bite

**Media URLs are temporary, so images do not use one.** Video responses come back as an xAI-hosted URL
that expires, and `animate()` fetches the bytes in the same tick. Images sidestep the problem entirely
via `response_format: 'b64_json'`, per the correction above. Never store a URL and expect it to work
later.

**Video is defined and unused in v1.** The adapter exists so no restructuring is needed later. No v1
workbook calls it. It is the most expensive capability by a wide margin, and it is the one route never
probed.

**Live speech-to-speech is out of scope.** The realtime voice API is a WebSocket, and the documented
client-side path is ephemeral tokens minted by a server. No server means no realtime voice. TTS works
fine from the browser, so Reflect can speak its questions. STT does not, per the correction above, so
answers are typed. It is not a phone call.

**CORS is confirmed.** Verified 2026-09-15. A preflight `OPTIONS /v1/responses` returns 200 with
`access-control-allow-origin: *`, `access-control-allow-methods: *`, and `access-control-allow-headers: *`,
and the real POST carries the origin header as well. Direct browser calls work, so the no-backend plan
holds and nothing needs to be proxied. If xAI ever tightens this, the fix is still one serverless
function forwarding to xAI, and `client.ts` is the only file that changes.

One caveat the probe surfaced: this only covers `api.x.ai`. The image route's default URL host,
`imgen.x.ai`, was never confirmed to allow a browser read, which is a second reason images take the
base64 path.

### The key

Stored in the settings record, entered in Settings, never leaves the device except to xAI. There is no
environment-variable path, in dev or anywhere else, so the key never enters the bundle and a checkout
of this repo carries no secret. Being honest about what this is. Anyone with access to the browser can read it, and xAI's own guidance is
not to put a key in a browser. Fine for one person on their own machine, which is what this is.
Shipping to other people means the proxy above, which is also what makes the key worth hiding.

### Where audio is actually used

TTS is a play affordance on a word and on a sentence. Where it belongs to a record it is kept, and
where it does not it is held for the page load.

**Kept, on a word or a sentence.** The first play writes the clip to `media` and points
`Word.audioMediaId` or `Sentence.audioMediaId` at it, so it survives a reload and goes in the bundle.
First play rather than on add, because persisting on add would mean accepting five words out of Extract
fires five calls nobody pressed for, and §1 holds that every AI call follows a press. The learner
cannot tell the two apart, since the only way to notice a missing clip is to press play and pressing
play is what creates it. Renaming a term or editing a sentence drops the clip, because it speaks the
old wording, and `Regenerate audio` in the edit block replaces a reading that came out wrong. The
media row carries no `Attachment`, because an attachment says raw material belongs to an entry while
this belongs to the term. `journal/audio.ts` holds that policy and is the one module in `journal/`
that reaches for `ai/`.

**Held, for anything else.** Practice lines and reflection questions are not records, so `speak` keeps
them in a module-level map keyed by language, voice and text, capped at 150 and dropped on reload. A
failed call drops its key so the button still works.

There is no audio capture in the composer and no voice memo, so `Attachment.kind: 'audio'` exists for
material the learner attaches and for workbook output, not for recording into the journal.

STT is an input mode inside workbooks, where typing is always available alongside it and the
transcript lands in the text field for editing before anything is submitted. That last part carries
the weight. Korean recognition is the part of this most likely to disappoint, and a transcript the
learner can fix is a nuisance, while one that submits itself is a wrong answer.

**Not built, as of M4.** `/v1/stt` turned out to be a WebSocket a browser cannot authenticate against
(see the corrections above), so the workbook answer field is typed only. The two remaining routes to
spoken input are an xAI socket that can somehow carry the key without a header, or
`webkitSpeechRecognition`, which is free and supports `ko-KR` but does its recognition server-side at
Google, cutting against the whole no-server premise. Nothing else in the design depends on it.

### Failure

Every AI call is something the learner just pressed. On failure, show what went wrong and leave the
button. No retry logic, no queue, no offline buffer. Missing key gets a line pointing at Settings.

In practice that is one `AiError` carrying a `kind` and a message already fit to put on screen. The four
kinds are `no-key` (the only failure with a specific thing to do about it), `refused`, `offline` and
`unreadable` — the last being a 200 whose body was not the shape the app expects. `failureLine(e)`
turns anything thrown into a single sentence, so no screen ever renders a stack.

Error bodies are inconsistent and all three shapes are normalised in one place: `/v1/responses` returns
`{"code":"...","error":"..."}`, `/v1/tts` returns `{"error":"..."}`, and a malformed request comes back
as bare `text/plain`.

Verified: with no key in Settings, pressing Extract shows "No key yet. Add an xAI key in Settings and
this will work." and nothing else — no stack, and the Add button is absent because there is nothing to
add.

---

## 10. Extract and Reflect

Both are ordinary buttons in the entry's action bar. No AI branding anywhere, per the UI guide.

### Extract

Send the entry body, its text attachments, its images and PDFs, and the notebook's `focus` as a profile.
Ask for structured JSON.

```ts
interface ProposalDraft {
  entryId: Id
  words: { term: string; meaning?: string; note?: string }[]
  sentences: { text: string; translation?: string }[]
}
```

Before showing anything, every proposed term is normalized and looked up. A hit is marked known, and
accepting it writes an `Encounter` only. That is what produces the UI guide's "already in this
notebook · 11th time" line, and it is what keeps concepts §11 true. The write goes through the same
`addWord` every other capture path uses, so the dialog cannot promise something the write layer then
does differently.

A row is dropped only when accepting it would do nothing at all, which is the case for a known word this
entry has **already** encountered. A known word met in other entries is still shown, because noticing
something for the eleventh time is information.

The proposal is stored with `status: 'draft'` against its entry, so it survives a reload and can sit
forever. No badge, no inbox, no count. One draft per entry at most: a second Extract merges into it
rather than stacking, which is what makes "proposes only terms that are still absent, and never touches
a field the learner edited" a property of the record rather than of the dialog.

Pressing Add resolves the draft to `accepted`. Unticked rows are simply not written, and since they are
still absent from the notebook a later Extract can propose them again. "Not now" leaves the draft as it
stands. Those are the only two outcomes, plus an explicit discard.

Images and PDFs go to the vision-capable text model as attachments in the same call. An unprocessed
attachment stays valid forever, so failure here changes nothing.

The dedupe split is pure and separately tested (§13): proposals and the notebook's words in, a
known/new split out. It also collapses proposals that normalize to the same term, because otherwise a
dialog offering five things could write four.

On the frame: the UI guide's prose describes a 600px dialog over the entry, and its mock draws a 302px
panel pinned top-right with the terms underlined and numbered inside the entry body. Built to the prose,
because the guide separately calls that in-body underlining "decoration in the mock, not a feature". The
row anatomy and the per-item Edit each panel come from the mock, which specifies them concretely.

### Reflect

A short text exchange about the entry. Each completed turn appends to the entry body under a hairline,
which is what makes Reflect worth having even for someone who never extracts anything. Ends by offering
Extract, which the learner can ignore.

The turn is written into the entry **before** the next question is requested, so a failure on the way to
question three cannot lose answer two. The conversation itself is only in React state: a reload loses an
unsent answer and keeps everything already submitted, which is the right side of §1 to err on.

The entry is captured once, when the first question is asked, and held. Re-reading it each turn would
feed the conversation its own appended answers back as source material.

TTS on questions is built, per §9. The mic in the UI guide's rail is not: STT is a WebSocket a browser
cannot authenticate against, so answers are typed. Reflect asks for `medium` reasoning effort, the only
place in the app that asks for more than `low`, because a question that builds on the last answer is the
one place the model actually has to think.

The model ends the exchange by replying `ENOUGH`, which is turned into an ending rather than shown. It is
nudged toward that after four answered turns.

---

## 11. Highlight to capture

Any saved prose the learner might pull a word out of renders inside one component. Entry bodies, text
attachments, workbook output.

```tsx
<Capturable notebookId={nb} entryId={id}>{text}</Capturable>
```

On selection release it reads `window.getSelection()`, takes
`getRangeAt(0).getBoundingClientRect()` for position, and floats a small chip with two text buttons,
`word` and `sentence`. Pressing one calls `addWord` or `addSentence` with the selected text and
nothing else. Meaning is left empty and can be filled later or never. One press, no dialog, no
confirmation. The chip then shows one line saying what happened and goes; that is a readout, not a
confirmation, since the write already landed.

### Where the encounter lands

`entryId` is optional and it decides. Given one — entry detail passes the entry being read — the word
belongs to that entry, which is what makes "Words from this entry" true of a word pulled out of that
entry's own body. Omitted, as in workbook output where there is no entry, it falls to today's entry per
§5.

So the §11 promise holds where it was written about: pull three words out of an exercise and the journal
gains three words with today's encounter, the session is not marked as anything, and no entry is created
for it. This is the only capture path from inside a workbook that does not go through `saveMoment`.

### Not the composer

`window.getSelection()` returns no range inside a form control, so the composer's `<textarea>` would
need a `selectionStart` path plus a mirrored element to measure where the caret is. Deliberately not
built: the composer already carries `Add word` and `Add sentence` in its rail, and while you are writing
you are not mining. Highlight-to-capture is for saved prose.

### The details that make it behave

Both ends of the range must be inside the component, or a selection starting in an entry body and
running past the end of it would capture text the component does not own.

Selection is read on `pointerup` so a drag places the chip once at the end rather than chasing the
pointer, and on `selectionchange` after a short settle to catch what `pointerup` misses: keyboard
selection, double-click-to-word, and mobile long-press, which extends a selection with no matching
release. The chip is dismissed by a pointer going down outside it, by Escape, and by any scroll, since
its coordinates come from a rect taken once and scrolling makes them a lie.

The selected text is normalized to NFC here rather than in the write layer, because a DOM selection is
where decomposed Hangul enters the app. Verified: selecting a 14-code-point decomposed 치우겠습니다
stores one word whose `term` and `termKey` are both the 6-code-point composed form. One word, not two.

Mobile cannot extend the native selection menu, so the chip appears on long-press over the same
component, above the native menu. The pinned "Quick add a word…" field in the UI guide's mobile words
screen is the reliable fallback and should stay regardless.

---

## 12. Tauri, not being done

Decided against for now. The door is held open by two rules that were honoured throughout, so this stays
a packaging change rather than a rewrite if it is ever wanted.

1. All file I/O stays in `storage/files.ts` (§4). Still true: two functions, one module, no other file
   in the app touches a file.
2. Fonts are self-hosted (§2). Still true, and there is no CDN link anywhere.

If it happens, Dexie keeps working unchanged inside the webview, `files.ts` gains a Tauri
implementation, and the bundle can be written to a real folder the learner picked, which also ends
the eviction risk. The linked-folder option that was set aside for the web build becomes available at
that point without any change to the data model, because the bundle layout in §4 is already a folder.

One thing already in place for it: the Vite `base` is `./`, so a built bundle works from `file://` as
well as from a server. And the service worker in §4 registers only in a secure context, so it silently
stays out of the way in a webview that does not need it.

---

## 13. Tests

Only the pure logic, and only because these are the places where a silent bug corrupts data. 178 tests
across 8 files, all of which run without a browser.

| File | Tests | What it pins |
|---|---|---|
| `db/normalize.test.ts` | 14 | `normalizeTerm` across NFC and NFD Hangul, and word-in-sentence matching in Korean and English |
| `journal/derive.test.ts` | 13 | The derived signal functions against fixed fixtures |
| `journal/writes.test.ts` | 48 | The write-layer rules: today's-entry linking, one encounter per entry, cascade deletes, the settings spread that must not drop the API key, the word and sentence edits and deletes, and kept audio including the drop on a renamed term or edited sentence |
| `journal/proposals.test.ts` | 17 | The dedupe split in Extract, known versus new, and the re-extract merge |
| `storage/bundle.test.ts` | 37 | Zip round trip, the id remap for a new copy including the kept-audio pointers, slugs, deterministic filenames |
| `storage/transfer.test.ts` | 22 | Collect and apply against a database, including Replace |
| `workbooks/context.test.ts` | 17 | `buildContext` for each `BundleRequest` shape, and the pure selection rules |
| `workbooks/sessions.test.ts` | 10 | Session state surviving the round trip through IndexedDB, and "at most one expanded" |

Database-backed tests run against `fake-indexeddb` on a throwaway `JournalDb` name per test file, which
is the reason every write function takes an optional db argument (§5).

No component tests, no e2e. The UI is checked by using it — but checked, not assumed. The things only a
browser can show were verified by hand against the live API: the dock mechanic (§7), the missing-key
failure surface (§9), NFC on a real selection (§11), Extract and its writes (§10), Korean TTS actually
speaking, the drill end to end, and the app loading with its server killed (§4).

**`tsc` is not optional, and is not covered by the tests.** Vite's transform does not error on a missing
named export, so a wrong import path arrives as `undefined` at runtime. That is how `SETTINGS_ID`
imported from `db/db.ts` instead of `db/types.ts` passed every test and only surfaced as an IndexedDB
`DataError`. Run `npx tsc -b --force` alongside `npx vitest run`.

---

## 14. Build order

Ordered so that stopping early still leaves a real product. M1 alone is a complete language learning
journal, which is what concepts §13 demands.

| Milestone | Contents |
|---|---|
| M1 Journal ✅ | Dexie schema, notebooks, timeline with the `?q=` filter, entry detail, composer with autosave, attachments, words index, export and import. No AI, no workbooks |
| M2 Capture ✅ | Highlight to capture, quick add, today's-entry linking |
| M3 AI ✅ | `ai/` module, key in Settings, Extract with proposals, Reflect |
| M4 Workbooks ✅ | Session table, dock, sheet, SDK, context bundle, sandbox route, first workbook |
| M5 App-like ✅ | PWA install, `storage.persist()`, offline shell |
| M6 Tauri | Not being done. Left possible: file I/O is confined to `storage/files.ts` and the fonts are self-hosted (§12) |

Two things deferred rather than dropped. Notebook copying (concepts §4) is still unbuilt, though
`copiedFromId` is in the schema and `withFreshIds` already does the whole id remap, so it is now mostly
wiring that to a button. Spoken input in workbooks is blocked on the STT correction in §9.

One mock row deliberately not built. practice.html draws a **Reflect on an entry** row, and Reflect
shipped instead as a journal action at `/n/:nb/e/:id/reflect`, reachable from the entry, appending into
that entry's body. As a practice row it would need an entry chooser first, which means discussing an
entry without being able to see it while it edits a body off screen. Reflecting is *about* an entry, so
the entry is the right door. On this row the mock is stale rather than unbuilt.

**`Entry.topic` is a dead field.** Declared in `db/types.ts`, patchable through `saveEntry`, and
searched by the timeline filter, and nothing has ever written it because there is no UI that sets it.
It cost something: the story workbook was specified to draw on "focus and topics", and it draws on the
notebook focus plus the titles and bodies of the focused entries instead, which is strictly better
because the learner picks those. Left in place rather than removed, since the search would have to stop
looking at it and the field is harmless. `.wd-drill` in `word-drill/Workbook.tsx` is the same shape one
layer out: a class name with no rule behind it, in the CSS rather than the schema.

---

## 15. Accepted tradeoffs

Each of these is a cost of a §1 decision, not an oversight.

| Cost | Accepted because |
|---|---|
| Edits on two devices between exports lose one side | One device is home. Removes all sync code |
| The API key is readable in the browser | Personal use. A proxy is the answer if that changes |
| No live voice conversation, and no spoken input at all | Both need a server: realtime needs ephemeral tokens, and `/v1/stt` is a socket a browser cannot authenticate. TTS still works, and typing was always the fallback |
| Reopening a docked session loses its images | The story's pictures are mood, and its text survives. Describe the picture says so out loud and redraws, because there the picture is the question. Audio is kept on words and sentences, and held for the page load elsewhere (§9) |
| The export bundle grows with the vocabulary once clips are kept | Bounded by the word list rather than by usage, so it is predictable. Unlike a cache it needs no eviction policy |
| Browser can evict IndexedDB | `storage.persist()`, an export reminder, and Tauri would end it |
| CJK word-in-sentence links over-match | Cosmetic, and removable by hand |
| Words practised twice in a day count once | The count means days it came up, which is the useful reading |
| Generated images arrive ~30% larger as base64 | Removes an expiring URL and an unconfirmed second origin, with no server to proxy through (§9) |
| A dev-only route ships in the production bundle | `/sandbox` redirects rather than being absent, so the router does not differ between builds |

---

## 16. Not building

The contract against creep. Nothing here gets added without a reason that survives the concepts doc's
own test.

Spaced repetition scheduling. Streaks, points, levels, badges. Notifications and reminders. A review
inbox or pending-items badge. Automatic extraction on save. Suggestions while typing. Background sync.
Accounts, sharing, social. Analytics. A cloud media library. Cross-notebook merging. Automatic
difficulty adjustment. Anything that decides for the learner when they practice or what they should
see next.
