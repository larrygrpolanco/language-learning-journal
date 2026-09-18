# Handoff: Language Learning Journal — journal UI

## Overview

UI design for the journal half of the Language Learning Journal described in
`language-journal-architecture.md` (notebooks, entries, attachments, words, sentences,
plus the two processing actions **Reflect** and **Extract**, and an entry point to
activities). It covers desktop and mobile. Activity harnesses themselves are out of scope.

Reference language in all mocks is Korean; meaning language is English.

## About the design files

`ui-screens/*.html` are **design references created in HTML** — static prototypes showing
intended look, layout and copy. They are not production code and are not meant to be
dropped into the app. Recreate them in the target codebase's environment (React, Vue,
SwiftUI, native, whatever the project uses) with its established patterns and component
library. If no environment exists yet, pick an appropriate framework and implement there.

Nothing in these files is interactive: no state, no routing, no handlers. Behavior is
described in prose below and should be implemented from the description, not inferred
from the markup.

## Fidelity

**High fidelity.** Colors, type, spacing and copy are final-intent and come from the
`Classical` design system (`ui-screens/styles.css`, included). Recreate the visual result
faithfully, but express it through the codebase's own components rather than by copying
these class names. Layout dimensions given below are the design's intent, not a grid the
implementation must match to the pixel.

## Design language

Editorial / book-like, on a warm near-white ground. The notebook metaphor is carried by:

- **Ruled baselines** under long-form text (entry body, composer, reflect answers) — a
  repeating 1px horizontal rule every 32px (30px on mobile), drawn as a background
  gradient at `rgba(32,31,29,0.09)`, with `line-height` matching the rule spacing.
- **Hairline rules and margin rails** instead of boxes and fills. Dividers are
  `rgba(32,31,29,0.16)`.
- **Color as stroke** — gold (`#b68235`) appears as borders, underlines, a 2px left rule
  on sentences, a spine on the active notebook. Never as a filled block or a solid button.
- **Plates** — every image/attachment is matted: 6px `#eae9e9` border plus a 1px divider
  outline and a warm archival filter (`sepia(.22) saturate(.82) contrast(1.05)`). In the
  mocks they are striped grey placeholders; real thumbnails replace them.

### Shell (used on every desktop screen)

1. **Kicker strip**, 1px bottom divider, ~14×28px padding: left = uppercase 11.5px
   context label (`시댁 한국어 · Fri 12 Sep`), right = actions.
2. **Gutter rail**, 64px wide, 1px right divider: vertical stack of 36×36px ghost icon
   buttons (Lucide). Contents vary by screen — journal / words / practice on browse
   screens, prev / next / edit on entry detail.
3. **Content area**, generous padding (28–37px), max text measure `--measure` (56em, roughly 95 characters),
   body copy justified with hyphenation.
4. **Action bar** (composer and reflect only), 1px top divider on `#f8f4f4`: a muted
   italic status note on the left, buttons on the right.

Mobile uses the same kicker strip and content, moves the rail to a bottom bar of three
44px ghost icon buttons on `#f8f4f4`, and keeps a sticky action row where relevant.

### No AI affordances

There is no "AI" button, sparkle icon, or assistant surface anywhere. The two
LLM-backed actions are named for what they do — **Reflect** and **Extract** — and sit as
ordinary text buttons in the entry's own action bar. There is no review inbox, no badge
counting pending items, and nothing is proposed inline while the user writes.

## Screens

Each maps to one file in `ui-screens/`. The `ref` codes (`2a`…) match the ids in the
exploration document, so comments on those carry over.

### 1. Notebooks — `ui-screens/notebooks.html` (ref 2a)

Landing screen. A 2-column grid of notebook cards, 18px gap.

- Card: 1px divider border, `4px` radius, 18px padding, **3px left border** — gold
  `#b68235` for the most recently used notebook, `#bab6b6` for the rest.
- Card contents: language kicker (11px uppercase, gold-700 `#7d5411` on the active one,
  neutral-700 elsewhere) / title (Cormorant Garamond 22px semibold) / focus description
  (13px, 65% ink, max 2 lines) / meta row (11.5px tabular: entries · words · last used).
- Last cell is a dashed-border "Start a notebook" affordance.
- Rail: library, settings. Header action: `New notebook` (outlined primary). The exploration's search
  icon is dropped here. Searching across notebooks is a cross-notebook view and those are deferred;
  search lives inside a notebook, as the timeline filter.

Behavior: tapping a card opens that notebook's journal timeline. The dashed cell opens
notebook creation (title, language, focus, meaning language — fields per §4 of the plan).

### 2. Journal timeline — `ui-screens/journal-timeline.html` (ref 2b)

The notebook's home. One continuous column of entries, newest first.

- Each day opens with a **dated hairline**: Cormorant 15px tabular date on the left,
  1px rule filling the middle, italic 11px source on the right.
- Entry: title (21px heading), body preview (15px/1.75 justified, 2–3 lines), then a row
  of outlined tags — one per word, plus a neutral tag counting sentences.
- Entries whose attachment is the point (a photographed page) show a 128×90 plate to the
  right of the text instead of tags.
- Header actions: `Words`, `Sentences`, `Practice` (ghost), `New entry` (outlined primary). `Practice`
  is hidden until the workbook layer exists.
- Header also carries a borderless **filter input** with a 1px bottom divider, placeholder
  `filter entries…`. Typing narrows the column by substring over title, body and source, and a day
  with no surviving entry drops its dated hairline. Clearing restores the full timeline. This is the
  journal's search (plan §13); there is no separate search screen.

Behavior: infinite scroll back through time; clicking an entry opens entry detail;
clicking a word tag opens that word. Unprocessed entries look no different from processed
ones — there is no status chrome.

### 3. Entry detail — `ui-screens/entry-detail.html` (ref 2c)

Reading one day back.

- Head: source kicker in gold-700, a 44×1px gold rule under it, title (Cormorant 27px
  regular). Right-aligned in the same row: the entry number in Cormorant 46px on
  `--color-accent-300` `#facb8d`, with an 11px uppercase "entry" label.
- Body on the ruled sheet, justified.
- Attachments: row of 112×80 plates.
- Full-width hairline, then a 2-column footer: **Words from this entry** (term left,
  meaning right, dotted rule between rows) and **Sentences** (2px gold left rule, italic
  translation beneath).
- Header actions: `Reflect`, `Extract` (ghost), `Edit` (secondary).
- Rail: previous entry, next entry, edit.

### 4. Entry composer — `ui-screens/entry-composer.html` (ref 1c)

Capture. The whole sheet is for writing.

- Title input and a narrower italic `source` input, both borderless with a 1px bottom
  divider; title is Cormorant 24px.
- Body: ruled sheet, min-height 230px, 15px/32px. Korean phrases the learner types can be
  underlined 2px in `--color-accent-300`; that is decoration in the mock, not a feature.
- Attachment row: plates plus a `+ attach` secondary button.
- Rail: attach, add word, add sentence. No record button. Audio is playback on words and sentences,
  and spoken input inside workbooks, never capture into the journal (technical plan §9).
- Action bar: italic note "Entry saves as you write." on the left; `Reflect`, `Extract`
  (ghost) and `Done` (outlined primary) on the right.

Behavior: autosave — there is no explicit save. An entry needs a body or one attachment.
Quick-add of a single word or sentence from anywhere links to today's entry, creating it
if needed (plan §9).

### 5. Extract — `ui-screens/extract.html` (ref 2g)

A modal over the entry; the entry stays visible and dimmed behind it.

- Dialog 600px wide, `--shadow-lg`, 28px padding, on `#f3f2f2`.
- Title "Extract from this entry" (Cormorant 24px) + 13px muted line stating the count.
- Two sections, **Words** and **Sentences**, under 11.5px uppercase labels. Each row is a
  checkbox (14px square, gold border, `--color-accent-200` fill when checked, 2px radius),
  the term at 15px, and a right-aligned note: the proposed meaning on a word, the proposed
  translation on a sentence, or, for a term already in the notebook, an italic
  "already in this notebook · 11th time".
- **Everything is pre-ticked**; accepting is one press.
- Actions: `Not now` (ghost) left; `Edit each` (secondary) and `Add 5` (primary) right.

Right of the dialog, the **per-item field panel** shown when the user chooses Edit each:
320px card on `#f8f4f4` with "Editing 1 of 5", Term / Meaning / Note fields, a
`new · getting it · got it` segmented control, and `Skip` / `Next`.

Behavior (plan §11): proposals are a draft set tied to the source entry. A known term
becomes a new encounter, never a duplicate word. Nothing enters the notebook without this
confirmation, and re-extracting an entry only proposes items that are new and never
overwrites a field the learner has edited. Proposals may sit indefinitely; there is no
badge or inbox.

### 6. Reflect — `ui-screens/reflect.html` (ref 2h)

A short conversation about the entry, in the entry's own shell.

- Questions: Cormorant 20px italic in gold-700 `#7d5411`.
- Answers: on the ruled sheet, 15px/32px, same as the body.
- Rail: edit, mic. Header action: `Stop`.
- Action bar states "This conversation is saved into Friday's entry."; buttons `Extract`
  (ghost) and `Back to entry` (primary).

Behavior: the exchange is appended to the entry body, so the journal benefits even if the
learner never extracts anything. Reflect may optionally end by offering Extract.

### 7. Words and sentences — `ui-screens/words.html` (ref 2d)

Index left, detail right, split by a 1px rule; detail column 300px on `#f8f4f4`. One frame, used by
both sections. Only the mock for words exists.

**Words.**

- List rows: term 16px, meaning 12.5px muted beneath, hairline between rows. Right side of
  each row: **familiarity as three 14×2px dashes** (gold = filled, `#d7d3d3` = empty) and
  an encounter count in 11.5px tabular. Selected row carries a 7% gold wash.
- Section label is plain "All words"; filter input in the header.
- Detail: term in Cormorant 26px, meaning line, `Familiarity` segmented control,
  **Met in** (dated list of entries, dotted rules), **In sentences** (2px gold left rule),
  `Edit word` block button.
- A 36×36 ghost icon button (`volume-2`) sits beside the term, and each sentence row under
  **In sentences** carries one at 28px. Pressing it speaks that line. The first press keeps the clip on
  that word or sentence, so every press after it is instant and it still works offline. It reads as a
  player rather than an assistant, which is what keeps the no-AI-affordances rule intact.

Behavior: familiarity is learner-settable; when unset it is estimated from encounters and
practice events and should read as the same three dashes. Clicking a "met in" date opens
that entry. Each row under **In sentences** opens that sentence. Editing gives `Regenerate audio`
above the delete, present only once a clip exists, since with none the play button is already the way
to get one. Renaming the term drops the clip, which spoke the old one.

**Sentences.** Added after M5, no mock. Same frame, different rows, because a sentence is long where a
term is short and has no useful alphabetical order.

- Newest first, not alphabetical.
- List rows: the sentence clamped to two lines in the target face at 14.5px, translation 12.5px muted
  beneath, and nothing on the right. A word row's familiarity dashes and encounter count are worth
  scanning down a column; a sentence has nothing of that shape. The 2px gold rule is saved for the
  detail pane, where there is one sentence rather than forty.
- Section label is "All sentences", or "N matching" under a filter, or "N from Fri 12 Sep" when scoped
  to an entry, in which case a small `show all` sits on the same line.
- Detail: the sentence on its 2px left rule with a `volume-2` beside it, italic translation, the note,
  **Met in**, **Words in it** as outlined tags, `Edit sentence` block button.
- Editing gives Sentence, Translation and Note fields, then `Regenerate audio` and `Delete this
  sentence` below the actions in the same muted 12px as the words screen's delete.

Behavior: editing the text re-derives which words appear in it, and drops the kept clip, which spoke
the old wording.

### 8. Practice — `ui-screens/practice.html` (ref 2e)

A contents page, not a dashboard. Four rows separated by hairlines; each row is a
Cormorant 21px activity name, a 13px muted line **stating what it draws from the
notebook** ("Draws on 14 recent words"), and a `Start` button — the first one outlined
primary, the rest secondary. Header right: "last practiced 3 days ago".

Not in M1. The rail icon and the timeline's `Practice` action stay hidden until the workbook layer
exists, rather than leading to an empty contents page.

### 9. Mobile — `ui-screens/mobile.html` (ref 2f)

Four 360×660 frames: notebooks, entry detail, words, practice. Same type and rules;
the rail becomes a bottom bar of 44px tap targets, four section icons after the way back;
the words screen keeps a
"Quick add a word…" field pinned above the bottom bar. The composer sheet (ref 1d in the
exploration) slides up over the timeline with the ruled sheet, an attach/camera row and
`Done`. Not `Save` — the entry autosaves, and there is no save button anywhere in the app.

## Design tokens

From `ui-screens/styles.css`; use the CSS variables rather than the literals where possible.

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#f3f2f2` | page and card ground |
| `--color-surface` | `#eae9e9` | plate mat |
| `--color-text` | `#201f1d` | ink |
| `--color-accent` | `#b68235` | strokes, rules, outlined buttons |
| `--color-accent-700` | `#7d5411` | accent-colored text at body size |
| `--color-accent-300` | `#facb8d` | ghost numerals, soft underlines |
| `--color-accent-200` | `#ffe3bf` | checked checkbox fill |
| `--color-neutral-100` | `#f8f4f4` | action bars, detail panel ground |
| `--color-neutral-300` | `#d7d3d3` | empty familiarity dash |
| `--color-neutral-700` | `#605d5d` | small labels, meta (contrast-safe) |
| `--color-divider` | `rgba(32,31,29,.16)` | every hairline |
| `--font-heading` | Cormorant Garamond, 600 for UI, 400 for display | titles, buttons, dates |
| `--font-body` | Lora 400 | all running text |
| spacing | 4.6 / 9.2 / 13.8 / 18.4 / 27.6 / 36.8 px | `--space-1…8` |
| radius | 2 / 4 / 7 px | `--radius-sm/md/lg` |
| shadows | `--shadow-sm/md/lg` | cards / sheets / dialogs |

Type sizes in use: 46 display numeral · 27 entry title · 24 composer title · 22 notebook
title · 21 timeline title · 20 reflect question · 16 term · 15 body · 13 meta ·
12.5 secondary · 11.5 uppercase label (letter-spacing .08–.1em).

Contrast note: small labels use `--color-neutral-700`, not a transparent ink mix — keep
that when re-implementing. Gold is not used for body-size text; use `--color-accent-700`.

## Components to build

Button (primary outlined / secondary / ghost / icon / block), tag (outline, neutral),
text input, textarea, segmented control, checkbox row, dialog + backdrop, card, hairline
rule, plate image wrapper, ruled-sheet text container, familiarity dashes, dated
section rule. All except the last three exist as classes in `styles.css`.

## Assets

- Icons: **Lucide** (`library, search, settings, book-open, type, notebook-tabs, pencil,
  chevron-up, chevron-down, paperclip, camera, mic, quote`), 17px in rails, 19px mobile.
  `notebook-tabs` means the practice section; each workbook then carries its own glyph from the
  notebook family (`notebook-pen` for word drill), 19px on its practice row and 15px on its dock
  chip. The mock used `dumbbell` for practice, which read as a gym rather than a shelf of workbooks.
- No photography or illustration is used. Every image is a striped placeholder inside a
  `.plate`; replace with real attachment thumbnails.
- Fonts: Cormorant Garamond and Lora, **self-hosted**. `styles.css` currently `@import`s them from
  Google Fonts, which breaks both offline use and Tauri, so that line goes when the tokens are
  ported. Its fallbacks are also `system-ui, sans-serif`, which degrades a serif design to sans;
  they become Georgia. Neither face carries Hangul or Han, so target-language text needs its own
  `--font-target` stack. See the technical plan §2.

## Files

```
ui-screens/styles.css            Classical design system — tokens + component classes
ui-screens/notebooks.html        2a
ui-screens/journal-timeline.html 2b
ui-screens/entry-detail.html     2c
ui-screens/entry-composer.html   1c
ui-screens/Extract.html          2g  (capital E on disk; a bundler export, hence the size)
ui-screens/reflect.html          2h
ui-screens/words.html            2d
ui-screens/practice.html         2e
ui-screens/mobile.html           2f
```

The full exploration, including earlier alternatives for the timeline and composer, lives
in `Language Journal UI.dc.html` in the design project.

## Not covered here

The attachment viewer, notebook creation, the Settings screen, notebook copying, the
activity harnesses themselves, and any cross-notebook view. Search is no longer open;
it is the timeline filter specified above. Notebook creation and Settings are built
straight from the token set, since M1 needs both to be usable.
