# Language Learning Journal: Core Architecture Plan

> Scope: core concepts, data layers, and mechanics. The tech stack and implementation details are covered in a separate document. Data structures here are described abstractly (concepts, fields, relationships), not as a database schema.

---

## 1. What this is

A language learning journal that works fully as a plain journal, and also serves as the **source of truth** for AI-powered learning activities (generated dialogs, audio, text-message roleplays, choose-your-own-adventure stories with images, and so on).

The journal is general-purpose and stays simple. Each activity is its own separate module, with its own carefully designed teaching logic (its "harness"). Activities read from the journal and report back to it. The journal does not know how any activity works.

The design is built for **emergence**: a few small, clear units that, collected over time, become a detailed picture of what the learner knows and struggles with. That picture is rich enough for an LLM to build activities from, without a complicated data structure.

---

## 2. Design principles

1. **Capturing is cheap; practice is where the effort goes.** Recording learning should feel like writing in a journal. The learner's effort belongs in activities.
2. **Only text is required.** Every unit needs at most one required field. Everything else is optional and can be filled in later or never.
3. **Raw input is always kept.** Uploads and pasted material are stored exactly as provided. They never have to be converted into learning material.
4. **Derive instead of asking.** If something can be inferred from existing data (grammar patterns, topics, active vs. passive vocabulary, recency), infer it rather than asking the learner or adding a type.
5. **The learner reviews AI output, and manual control is always available.** AI-extracted content is proposed, then confirmed by the learner. Everything is manually editable. Manual editing is possible but never required.
6. **The notebook is the boundary.** All knowledge lives inside a notebook. Nothing is shared between notebooks.
7. **The journal and activities stay separate.** Activities receive a context bundle and return results. They never modify journal data directly.
8. **No catch-all types.** Anything that isn't clearly a word or a sentence stays in the entry text, where LLMs can still read it.
9. **Add new units only when needed.** A new unit is added only when a kind of knowledge keeps coming up that the existing units can't represent.

---

## 3. Core concepts at a glance

```
Notebook
 ├── Entry (a moment of learning)
 │    └── Attachment (raw material, stored as-is)
 ├── Word (vocabulary, including set phrases)
 ├── Sentence (a real line of language in use)
 └── Practice Event (reported by activities)

Links:
 Entry ──encounters──▶ Word
 Entry ──encounters──▶ Sentence
 Word  ──appears in──▶ Sentence
```

The three learning units:

| Unit | What it represents | In one sentence |
|---|---|---|
| **Entry** | a moment | When and where learning happened. |
| **Word** | a piece of vocabulary | A term the learner wants to know and use. |
| **Sentence** | language in use | One real line of the language. |

---

## 4. Notebook

A notebook is a self-contained learning space with one language and an optional focus. Examples: "Spanish for economics," "Spanish for travel," "Korean with the in-laws," "Chinese class – Fall."

| Field | Required | Notes |
|---|---|---|
| title | yes | |
| language | yes | Target language. |
| focus | no | Free text describing the notebook's purpose. Also serves as the notebook's profile for LLMs. |
| meaning language | no | Language used for word meanings and translations (e.g. Spanish-only for a heritage learner, English for a beginner). Defaults to the learner's preference. |
| copied from | auto | Set when the notebook is a copy. |

**Scoping rules**
- Every entry, attachment, word, sentence, and practice event belongs to exactly one notebook.
- The same term can exist in two notebooks with different meanings (e.g. *interés* in economics vs. travel). This is intended.
- Cross-notebook views (e.g. "all my Spanish words") are optional, read-only, and can come later. They never change ownership.

**Copying a notebook** (deferred, see the technical plan's build order)
- Copies all entries, attachments, words, sentences, and links.
- The learner chooses whether to **keep or reset practice history**.
- The copy is fully independent after copying (so it can be refined or trimmed freely).

---

## 5. Entry

The journal itself. An entry records a moment of learning: a class, a conversation, a textbook chapter, homework, a reflection, or an activity session.

| Field | Required | Notes |
|---|---|---|
| date | auto | Defaults to now. Editable. |
| body | no* | Free text of any length ("what did you learn?"). |
| attachments | no* | See §6. |
| title | no | |
| source | no | Short free text: "class," "dinner with in-laws," "KLEAR ch. 6," "TV drama." |
| topic | no | Written by the learner or inferred. Describes the entry, not a piece of knowledge. |
| origin | auto | `learner` or `activity` (see §11). |

\* An entry needs a body or at least one attachment.

The entry body is the **catch-all** for things that aren't words or sentences: pronunciation rules, cultural notes, a teacher's comments, how a session felt. LLMs read it when building context.

---

## 6. Attachment

Raw material attached to an entry, stored exactly as provided.

- Types: pasted text (including transcripts), PDF, image (textbook pages, worksheets). Multiple attachments per entry.
- Attachments are **never required to be processed**. An unprocessed attachment is still a valid, complete record.
- The original is always kept, so material can be reprocessed later with better tools.

---

## 7. Word

A piece of vocabulary. This can be a single word or a fixed multi-word expression (打招呼, 수고하셨습니다, *echar de menos*). Multi-word expressions are treated exactly like single words.

| Field | Required | Notes |
|---|---|---|
| term | yes | Unique within the notebook (after normalization). |
| meaning | no | In the notebook's meaning language. Can hold multiple senses. |
| note | no | Short free text. |
| familiarity | no | Optional learner-set value: `new`, `getting it`, `got it`. If unset, it's estimated from signals (§10). |

Words build up naturally and are the base material every activity draws from.

---

## 8. Sentence

One real line of the target language.

| Field | Required | Notes |
|---|---|---|
| text | yes | |
| translation | no | In the notebook's meaning language. |
| note | no | e.g. why a correction was needed. |

---

## 9. Links

| Link | Meaning | How it's created |
|---|---|---|
| Entry → Word | "this word came up in this moment" | When a word is added from or extracted from an entry; also when an existing word is noticed again. |
| Entry → Sentence | "this sentence came up in this moment" | Same as above. |
| Word → Sentence | "this word appears in this sentence" | **Derived** automatically (requires word segmentation for Chinese and Korean). Can be recomputed and manually adjusted. |

**Rule:** every word and sentence has at least one encounter. If one is added outside an entry (e.g. from a notebook's word list), it's linked to **today's entry**, which is created if needed. This keeps every piece of knowledge tied to a point in time and means the journal grows even from quick additions.

Re-encountering an existing word creates a new link, not a duplicate word. Within a single entry,
though, a word is encountered once. Adding the same term twice in one sitting, or reprocessing an
entry that already yielded it, does not add a second link. "Times encountered" therefore means the
number of distinct entries a word came up in, which is what makes it comparable to first seen and
last seen.

---

## 10. Derived signals

These are computed from the units and links above. The learner never enters them, and they can always be recomputed.

| Signal | Derived from |
|---|---|
| first seen / last seen / times encountered | Entry → Word/Sentence links and entry dates |
| grammar patterns | Recurring structures across sentences (LLM-inferred on demand) |
| topic clusters | Words and sentences that tend to appear in the same entries; entry topics |
| last practiced / practice outcomes | Practice events (§12) |
| estimated familiarity | Encounters plus practice events, unless the learner has set familiarity |
| new vs. old mix | first seen plus last practiced |

Derived signals are **not stored as core data**. Caching them is an implementation choice.

---

## 11. Capture and processing

### Capture (always low effort)
1. Open a notebook and start an entry.
2. Write "what did you learn?" (any length) and/or attach material.
3. Save. Done.

Quick adds (a single word or sentence) are also available from anywhere in the notebook and link to today's entry.

### Processing (optional, whenever the learner chooses)

| Mode | What it does | Output |
|---|---|---|
| **Extract** | An LLM reads an entry and/or its attachments and proposes words and sentences. | Proposals |
| **Reflect** | A short reflective conversation with an LLM about the entry ("what was hard?", "how would you say…?"). | The conversation is saved into the entry (the journal benefits even without the other layers), plus optional proposals. |
| **Manual** | Add or edit words, sentences, and links directly. | Direct changes |

### Proposals (the review step)
- A proposal is a draft set of words, sentences, and links tied to its source entry.
- Proposals are pre-selected, so **accept all takes one action**. The learner can uncheck, edit, or discard items.
- Proposals are checked against existing notebook content. A known word becomes a new encounter, not a duplicate.
- Nothing becomes notebook knowledge without confirmation.
- Unreviewed proposals can wait indefinitely. A draft is surfaced on its own entry when the learner
  next opens it, and nowhere else. There is no inbox, no badge, and nothing that counts them.
- Reprocessing an entry only proposes **new** content and never overwrites learner-edited fields.

---

## 12. Journal ↔ Activity contract

Activities are separate modules with their own teaching logic. They interact with the journal only through this contract.

### 12.1 Context bundle (journal → activity)
An activity requests a context bundle for one notebook, optionally filtered. The bundle may include:

- **Notebook profile:** language, focus, meaning language, language settings.
- **Recent entries:** dates, topics, body text or summaries, sources.
- **Words:** with meanings, readings, and derived signals (first/last seen, encounter count, active/passive, familiarity, practice history summary).
- **Sentences:** with translations and notes.

How an activity uses the bundle, including asking the learner questions or taking feedback to shape the session, is entirely up to that activity.

The journal applies these results. Learner output and new items go through the normal proposal review (§11).

---

## 13. Journal-only mode

The app must be fully useful to someone who never processes anything or runs any activities:
- Notebooks, entries, and attachments work without the other layers.
- "Reflect" still adds value by enriching the entry.
- Browsing, searching, and reading back over time (a timeline of learning) are core journal features, not add-ons.
- The knowledge and activity layers appear as options, not requirements.

---

## 14. Extending the model

- **New activities** plug in through the contract in §12. They require no changes to journal units.
- **New derived signals** can be added at any time, since they're computed from existing data.
- **A new learning unit** is added only if a kind of knowledge keeps appearing that words and sentences can't express, and it passes the same test: it comes up often, activities clearly need it, and it can be described in one sentence.
- **Cross-notebook views** can be added later as read-only views.

---

## 15. Out of scope for this document

- Tech stack, storage engine, sync, and platform choices
- Activity harness designs and their teaching logic
- LLM prompts, models, and providers
- Media generation pipelines
- UI design

---

## Glossary

- **Notebook:** a self-contained learning space with one language and an optional focus.
- **Entry:** a dated moment of learning; the journal itself.
- **Attachment:** raw material on an entry, stored as-is.
- **Word:** a vocabulary item, single-word or multi-word.
- **Sentence:** a real line of the target language, with an optional translation.
- **Encounter:** a link recording that a word or sentence came up in an entry.
- **Proposal:** AI-suggested content awaiting learner review.
- **Harness:** an activity module's teaching logic and generation pipeline.
- **Context bundle:** the notebook data an activity requests to build a session.
- **Practice event:** an activity's record of which items were practiced and how it went.
