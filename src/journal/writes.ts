import { compact, db, JournalDb, newId, nowIso } from '../db/db'
import { normalizeTerm, termAppearsIn } from '../db/normalize'
import type {
  Attachment,
  Encounter,
  EncounterTarget,
  Entry,
  Familiarity,
  Id,
  Iso,
  Media,
  PracticeEvent,
  Proposal,
  ProposalDraft,
  ProposedSentence,
  ProposedWord,
  Sentence,
  SentenceOrigin,
  Word,
} from '../db/types'

/**
 * The write layer. Technical plan §5.
 *
 * Nothing outside this module writes to Dexie. The rules from concepts §9 live here so no caller can
 * forget them:
 *
 *  - A word or sentence added anywhere links to today's entry, creating that entry if needed.
 *  - Re-encountering an existing word adds an encounter, never a second word.
 *  - One encounter per entry per target.
 *  - An entry with no body, no attachments and no encounters is not a record and gets pruned.
 *
 * Note on the input types below. Their optional fields are written `?: T | undefined` rather than
 * `?: T`. Under `exactOptionalPropertyTypes` those differ: the second refuses an explicit `undefined`,
 * which is exactly what a caller passes for a field the learner left blank. The strictness earns its
 * keep on the stored records, where a stray `undefined` key ends up in the export bundle. On argument
 * objects it is only friction.
 */

export interface CreateNotebookInput {
  title: string
  language: string
  focus?: string | undefined
  meaningLanguage?: string | undefined
}

/**
 * A notebook is a self-contained learning space with one language and an optional focus.
 *
 * `focus` doubles as the notebook's profile for the LLM, which is why it is free text rather than a
 * picklist. Nothing is shared across notebooks, so this is the only place a boundary gets drawn.
 */
export const createNotebook = async (
  input: CreateNotebookInput,
  d: JournalDb = db,
): Promise<Id> => {
  const title = input.title.trim()
  const language = input.language.trim()
  if (title === '') throw new Error('a notebook needs a title')
  if (language === '') throw new Error('a notebook needs a language')

  const at = nowIso()
  const notebook = compact({
    id: newId(),
    title,
    language,
    focus: input.focus?.trim() || undefined,
    meaningLanguage: input.meaningLanguage?.trim() || undefined,
    createdAt: at,
    lastOpenedAt: at,
  })
  await d.notebooks.add(notebook)
  return notebook.id
}

/** Moves the gold spine on the notebooks screen. Called on open, nowhere else. */
export const touchNotebook = async (notebookId: Id, d: JournalDb = db): Promise<void> => {
  await d.notebooks.update(notebookId, { lastOpenedAt: nowIso() })
}

/**
 * A fresh entry, always. Distinct from `todayEntry`, which reuses.
 *
 * "New entry" means a new moment of learning, and two moments can happen on one day, so this never
 * merges into an existing record. It is created eagerly rather than on first keystroke, because
 * autosave needs an id to write into. `pruneEntryIfEmpty` is what stops that leaving litter.
 */
export const createEntry = async (
  notebookId: Id,
  patch: Partial<Pick<Entry, 'body' | 'title' | 'source' | 'date' | 'origin'>> = {},
  d: JournalDb = db,
): Promise<Entry> => {
  const at = nowIso()
  const entry: Entry = compact({
    id: newId(),
    notebookId,
    date: patch.date ?? at,
    body: patch.body ?? '',
    title: patch.title,
    source: patch.source,
    origin: patch.origin ?? 'learner',
    createdAt: at,
    updatedAt: at,
  })
  await d.entries.add(entry)
  return entry
}

/** Its position in the notebook, counting from the first entry. The big numeral on entry detail. */
export const entryOrdinal = async (entry: Entry, d: JournalDb = db): Promise<number> =>
  d.entries
    .where('[notebookId+date]')
    .between([entry.notebookId, ''], [entry.notebookId, entry.date], true, true)
    .count()

/**
 * The entry either side of this one by date. `newer` is up, `older` is down, matching a timeline that
 * runs newest first.
 */
export const neighbourEntries = async (
  entry: Entry,
  d: JournalDb = db,
): Promise<{ newer?: Entry; older?: Entry }> => {
  const [newer] = await d.entries
    .where('[notebookId+date]')
    .above([entry.notebookId, entry.date])
    .limit(1)
    .toArray()
  const [older] = await d.entries
    .where('[notebookId+date]')
    .below([entry.notebookId, entry.date])
    .reverse()
    .limit(1)
    .toArray()
  return compact({ newer, older })
}

export const updateWord = async (
  wordId: Id,
  patch: { term?: string; meaning?: string; note?: string },
  d: JournalDb = db,
): Promise<void> => {
  await d.transaction('rw', [d.words, d.sentences, d.wordInSentences, d.notebooks, d.media], async () => {
    const word = await d.words.get(wordId)
    if (!word) return

    const next: Word = { ...word, updatedAt: nowIso() }
    if (patch.term !== undefined && patch.term.trim() !== '') {
      next.term = patch.term.trim()
      next.termKey = normalizeTerm(next.term)
    }
    if (patch.meaning !== undefined) {
      if (patch.meaning.trim() === '') delete next.meaning
      else next.meaning = patch.meaning.trim()
    }
    if (patch.note !== undefined) {
      if (patch.note.trim() === '') delete next.note
      else next.note = patch.note.trim()
    }

    // A renamed term makes the kept clip speak the old one. Compared on `term` rather than `termKey`
    // because the clip is of what is written, so a change of case alone is still a different reading.
    if (next.term !== word.term && next.audioMediaId !== undefined) {
      await d.media.delete(next.audioMediaId)
      delete next.audioMediaId
    }

    await d.words.put(next)

    // A renamed term appears in a different set of sentences, so its derived links are now wrong.
    if (next.termKey !== word.termKey) {
      const sentences = await d.sentences.where('notebookId').equals(word.notebookId).toArray()
      for (const s of sentences) await deriveWordLinks(s, d)
    }
  })
}

/**
 * Sets familiarity, or clears it to hand the word back to the estimate.
 *
 * Read-modify-`put` rather than an update spec, because clearing means the key is absent. Writing
 * `undefined` into it would store the key and make `word.familiarity === undefined` indistinguishable
 * from unset in some paths while breaking `exactOptionalPropertyTypes` in others.
 */
export const setFamiliarity = async (
  wordId: Id,
  familiarity: Familiarity | undefined,
  d: JournalDb = db,
): Promise<void> => {
  const word = await d.words.get(wordId)
  if (!word) return
  const next: Word = { ...word, updatedAt: nowIso() }
  if (familiarity === undefined) delete next.familiarity
  else next.familiarity = familiarity
  await d.words.put(next)
}

/**
 * Deletes a word, its encounters, and its sentence links.
 *
 * The entries it was met in survive one encounter lighter, unless an entry has nothing else in it, in
 * which case it was only ever a home for this word and `pruneEntryIfEmpty` takes it. That is the same
 * rule the composer runs on close, applied from the other direction.
 */
export const deleteWord = async (wordId: Id, d: JournalDb = db): Promise<void> => {
  await d.transaction(
    'rw',
    [d.words, d.entries, d.attachments, d.encounters, d.wordInSentences, d.media],
    async () => {
      const word = await d.words.get(wordId)
      if (!word) return

      const encounters = await d.encounters.where('targetId').equals(wordId).toArray()
      const links = await d.wordInSentences.where('wordId').equals(wordId).toArray()
      await d.wordInSentences.bulkDelete(links.map((l) => l.id))
      await d.encounters.bulkDelete(encounters.map((e) => e.id))
      if (word.audioMediaId) await d.media.delete(word.audioMediaId)
      await d.words.delete(wordId)

      for (const entryId of new Set(encounters.map((e) => e.entryId))) {
        await pruneEntryIfEmpty(entryId, d)
      }
    },
  )
}

export interface AddAttachmentInput {
  notebookId: Id
  entryId: Id
  kind: Attachment['kind']
  /** Bytes for image, pdf and audio. */
  bytes?: Blob | undefined
  /** Pasted text and transcripts. */
  text?: string | undefined
  filename?: string | undefined
  width?: number | undefined
  height?: number | undefined
  durationMs?: number | undefined
}

/**
 * Attaches raw material to an entry, stored exactly as provided.
 *
 * Blobs go in `media` natively, never base64, so the bytes survive round-tripping through the export
 * bundle without a size penalty. Concepts §6 promises the original is always kept, which is what
 * makes reprocessing with better tools possible later.
 */
export const addAttachment = async (input: AddAttachmentInput, d: JournalDb = db): Promise<Id> =>
  d.transaction('rw', [d.media, d.attachments], async () => {
    let mediaId: Id | undefined
    if (input.bytes) {
      const media: Media = compact({
        id: newId(),
        notebookId: input.notebookId,
        mime: input.bytes.type || 'application/octet-stream',
        bytes: input.bytes,
        width: input.width,
        height: input.height,
        durationMs: input.durationMs,
      })
      await d.media.add(media)
      mediaId = media.id
    }

    const attachment: Attachment = compact({
      id: newId(),
      notebookId: input.notebookId,
      entryId: input.entryId,
      kind: input.kind,
      text: input.text,
      mediaId,
      filename: input.filename,
      createdAt: nowIso(),
    })
    await d.attachments.add(attachment)
    return attachment.id
  })

/** A word or a sentence, as the owner of a kept clip. Same polymorphism as an encounter's target. */
export type AudioTarget = { type: EncounterTarget; id: Id }

/**
 * Keeps generated speech against a word or a sentence, replacing whatever was there.
 *
 * Words and sentences are the curated set, so audio kept here grows with the notebook's vocabulary
 * rather than with how much the app gets used. That is what separates it from the clip cache in
 * `ai/speech.ts`, which is memory only and bounded, and it is why this needs no eviction policy.
 *
 * The media row deliberately has no `Attachment`. An attachment says raw material belongs to an entry
 * (§5), and this clip belongs to the term. `deleteNotebook` walks `media` by notebook, so the cascade
 * already covers it, and the export already writes it as `media/<id>.mp3`.
 */
export const setItemAudio = async (
  target: AudioTarget,
  bytes: Blob,
  voice: string,
  d: JournalDb = db,
): Promise<void> => {
  await d.transaction('rw', [d.media, d.words, d.sentences], async () => {
    if (target.type === 'word') {
      const row = await d.words.get(target.id)
      if (!row) return
      await d.words.put({ ...row, audioMediaId: await putClip(row, bytes, voice, d) })
    } else {
      const row = await d.sentences.get(target.id)
      if (!row) return
      await d.sentences.put({ ...row, audioMediaId: await putClip(row, bytes, voice, d) })
    }
  })
}

/** Writes the new clip and drops the one it supersedes. Returns the new media id. */
const putClip = async (
  owner: { notebookId: Id; audioMediaId?: Id },
  bytes: Blob,
  voice: string,
  d: JournalDb,
): Promise<Id> => {
  const media: Media = compact({
    id: newId(),
    notebookId: owner.notebookId,
    mime: bytes.type || 'audio/mpeg',
    bytes,
    voice,
  })
  await d.media.add(media)
  if (owner.audioMediaId) await d.media.delete(owner.audioMediaId)
  return media.id
}

export const deleteAttachment = async (attachmentId: Id, d: JournalDb = db): Promise<void> => {
  await d.transaction('rw', [d.attachments, d.media], async () => {
    const a = await d.attachments.get(attachmentId)
    if (!a) return
    if (a.mediaId) await d.media.delete(a.mediaId)
    await d.attachments.delete(attachmentId)
  })
}

/** Removes a Word -> Sentence link by hand, and remembers that the learner meant it. */
export const unlinkWordFromSentence = async (
  wordId: Id,
  sentenceId: Id,
  d: JournalDb = db,
): Promise<void> => {
  const link = await d.wordInSentences.where('sentenceId').equals(sentenceId).toArray()
  const hit = link.find((l) => l.wordId === wordId)
  if (hit) await d.wordInSentences.delete(hit.id)
}

/** UTC ISO bounds of the local calendar day containing `d`. ISO strings sort, so these range-query. */
export const localDayRange = (d: Date = new Date()): [Iso, Iso] => {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)
  return [start.toISOString(), end.toISOString()]
}

/**
 * Today's entry, created if it does not exist.
 *
 * Prefers a `learner` entry. A workbook's saved moment is its own record, and a word quick-added from
 * the words screen has nothing to do with it, so quick-adds never land inside someone else's session.
 * This is what makes §11 literally true: pulling three words out of an exercise gains three words on
 * today's entry and leaves the session itself untouched.
 */
export const todayEntry = async (notebookId: Id, d: JournalDb = db): Promise<Entry> => {
  const [start, end] = localDayRange()
  const existing = await d.entries
    .where('[notebookId+date]')
    .between([notebookId, start], [notebookId, end])
    .filter((e) => e.origin === 'learner')
    .last()
  if (existing) return existing

  const at = nowIso()
  const entry: Entry = {
    id: newId(),
    notebookId,
    date: at,
    body: '',
    origin: 'learner',
    createdAt: at,
    updatedAt: at,
  }
  await d.entries.add(entry)
  return entry
}

/**
 * Links an entry to a word or sentence, once.
 *
 * The `[entryId+targetId]` index is unique, so this reads first and returns the existing row rather
 * than relying on a thrown ConstraintError for control flow. Both are correct; the read is clearer.
 */
export const encounter = async (
  notebookId: Id,
  entryId: Id,
  targetType: EncounterTarget,
  targetId: Id,
  d: JournalDb = db,
): Promise<Encounter> => {
  const existing = await d.encounters.where('[entryId+targetId]').equals([entryId, targetId]).first()
  if (existing) return existing

  const row: Encounter = {
    id: newId(),
    notebookId,
    entryId,
    targetType,
    targetId,
    createdAt: nowIso(),
  }
  await d.encounters.add(row)
  return row
}

export interface AddWordInput {
  notebookId: Id
  term: string
  meaning?: string | undefined
  note?: string | undefined
  /** Defaults to today's entry. */
  entryId?: Id | undefined
}

export interface AddWordResult {
  wordId: Id
  /** False when the term was already in this notebook, which is the "11th time" case. */
  created: boolean
  timesEncountered: number
}

/**
 * Adds a word, or notices an existing one again.
 *
 * Uniqueness is per notebook after normalization, so the same term can live in two notebooks with
 * different meanings, which concepts §4 wants. On a hit, nothing about the existing word is
 * overwritten. A meaning the learner wrote is never clobbered by a later capture that has none.
 */
export const addWord = async (input: AddWordInput, d: JournalDb = db): Promise<AddWordResult> => {
  const term = input.term.trim()
  if (term === '') throw new Error('a word needs a term')
  const termKey = normalizeTerm(term)

  return d.transaction('rw', [d.entries, d.words, d.encounters], async () => {
    const entryId = input.entryId ?? (await todayEntry(input.notebookId, d)).id
    const hit = await d.words.where('[notebookId+termKey]').equals([input.notebookId, termKey]).first()

    let wordId: Id
    let created: boolean
    if (hit) {
      wordId = hit.id
      created = false
      // Fill blanks only. A meaning the learner wrote is never clobbered by a later capture.
      const patch: { meaning?: string; note?: string } = {}
      if (hit.meaning === undefined && input.meaning !== undefined) patch.meaning = input.meaning
      if (hit.note === undefined && input.note !== undefined) patch.note = input.note
      if (Object.keys(patch).length > 0) {
        await d.words.update(wordId, { ...patch, updatedAt: nowIso() })
      }
    } else {
      const at = nowIso()
      const word: Word = compact({
        id: newId(),
        notebookId: input.notebookId,
        term,
        termKey,
        meaning: input.meaning,
        note: input.note,
        createdAt: at,
        updatedAt: at,
      })
      await d.words.add(word)
      wordId = word.id
      created = true
    }

    await encounter(input.notebookId, entryId, 'word', wordId, d)
    const timesEncountered = await d.encounters.where('targetId').equals(wordId).count()
    return { wordId, created, timesEncountered }
  })
}

export interface AddSentenceInput {
  notebookId: Id
  text: string
  translation?: string | undefined
  note?: string | undefined
  origin?: SentenceOrigin | undefined
  /** On a `corrected` sentence, the `mine` one it fixes. */
  correctsId?: Id | undefined
  entryId?: Id | undefined
}

/**
 * Adds a sentence and derives its Word links.
 *
 * Sentences are not deduplicated. The same line said on two days is two records, because origin and
 * note differ and the pair matters. Words are the deduplicated unit; sentences are evidence.
 */
export const addSentence = async (input: AddSentenceInput, d: JournalDb = db): Promise<Id> => {
  const text = input.text.trim()
  if (text === '') throw new Error('a sentence needs text')

  return d.transaction(
    'rw',
    [d.entries, d.notebooks, d.words, d.sentences, d.encounters, d.wordInSentences],
    async () => {
      const entryId = input.entryId ?? (await todayEntry(input.notebookId, d)).id
      const sentence: Sentence = compact({
        id: newId(),
        notebookId: input.notebookId,
        text,
        origin: input.origin ?? 'encountered',
        translation: input.translation,
        note: input.note,
        correctsId: input.correctsId,
        createdAt: nowIso(),
      })
      await d.sentences.add(sentence)
      await encounter(input.notebookId, entryId, 'sentence', sentence.id, d)
      await deriveWordLinks(sentence, d)
      return sentence.id
    },
  )
}

/**
 * Recomputes Word -> Sentence links for one sentence.
 *
 * Only touches rows it owns. A link the learner added or removed by hand carries `source: 'manual'`
 * and survives a recompute, which is what makes concepts §9's "can be manually adjusted" hold.
 */
export const deriveWordLinks = async (
  sentence: Pick<Sentence, 'id' | 'notebookId' | 'text'>,
  d: JournalDb = db,
): Promise<void> => {
  const notebook = await d.notebooks.get(sentence.notebookId)
  const language = notebook?.language ?? ''
  const words = await d.words.where('notebookId').equals(sentence.notebookId).toArray()
  const existing = await d.wordInSentences.where('sentenceId').equals(sentence.id).toArray()

  const manual = new Set(existing.filter((l) => l.source === 'manual').map((l) => l.wordId))
  const derived = new Map(existing.filter((l) => l.source === 'derived').map((l) => [l.wordId, l]))

  for (const w of words) {
    if (manual.has(w.id)) continue
    const should = termAppearsIn(w.term, sentence.text, language)
    const have = derived.get(w.id)
    if (should && !have) {
      await d.wordInSentences.add({
        id: newId(),
        notebookId: sentence.notebookId,
        wordId: w.id,
        sentenceId: sentence.id,
        source: 'derived',
      })
    } else if (!should && have) {
      await d.wordInSentences.delete(have.id)
    }
  }
}

/**
 * Edits a sentence in place.
 *
 * Read-modify-`put` for the same reason `setFamiliarity` is: clearing a translation means the key is
 * absent, and writing `undefined` into it would put the key in the record and then in the export
 * bundle as a null nobody meant to write.
 */
export const updateSentence = async (
  sentenceId: Id,
  patch: { text?: string; translation?: string; note?: string; origin?: SentenceOrigin },
  d: JournalDb = db,
): Promise<void> => {
  await d.transaction('rw', [d.sentences, d.words, d.wordInSentences, d.notebooks, d.media], async () => {
    const sentence = await d.sentences.get(sentenceId)
    if (!sentence) return

    const next: Sentence = { ...sentence }
    if (patch.text !== undefined && patch.text.trim() !== '') next.text = patch.text.trim()
    if (patch.translation !== undefined) {
      if (patch.translation.trim() === '') delete next.translation
      else next.translation = patch.translation.trim()
    }
    if (patch.note !== undefined) {
      if (patch.note.trim() === '') delete next.note
      else next.note = patch.note.trim()
    }
    if (patch.origin !== undefined) {
      next.origin = patch.origin
      // Only a correction corrects something. Moving off that origin drops the pointer rather than
      // leaving a sentence that claims to fix another one while calling itself the learner's own.
      if (patch.origin !== 'corrected') delete next.correctsId
    }

    // Edited text makes the kept clip speak the old wording.
    if (next.text !== sentence.text && next.audioMediaId !== undefined) {
      await d.media.delete(next.audioMediaId)
      delete next.audioMediaId
    }

    await d.sentences.put(next)

    // Edited text holds a different set of words, so the derived links are now wrong.
    if (next.text !== sentence.text) await deriveWordLinks(next, d)
  })
}

/**
 * Deletes a sentence, its encounters, and its word links.
 *
 * Two things go with it that are easy to miss. Any correction pointing at this sentence loses its
 * `correctsId`, because a dangling id would survive into the export bundle and `readable/` with
 * nothing on the other end. And an entry left with nothing in it gets pruned, same as `deleteWord`.
 */
export const deleteSentence = async (sentenceId: Id, d: JournalDb = db): Promise<void> => {
  await d.transaction(
    'rw',
    [d.sentences, d.entries, d.attachments, d.encounters, d.wordInSentences, d.media],
    async () => {
      const sentence = await d.sentences.get(sentenceId)
      if (!sentence) return

      const encounters = await d.encounters.where('targetId').equals(sentenceId).toArray()
      const links = await d.wordInSentences.where('sentenceId').equals(sentenceId).toArray()
      await d.wordInSentences.bulkDelete(links.map((l) => l.id))
      await d.encounters.bulkDelete(encounters.map((e) => e.id))
      if (sentence.audioMediaId) await d.media.delete(sentence.audioMediaId)

      const siblings = await d.sentences.where('notebookId').equals(sentence.notebookId).toArray()
      for (const s of siblings) {
        if (s.correctsId !== sentenceId) continue
        const orphan: Sentence = { ...s }
        delete orphan.correctsId
        await d.sentences.put(orphan)
      }

      await d.sentences.delete(sentenceId)

      for (const entryId of new Set(encounters.map((e) => e.entryId))) {
        await pruneEntryIfEmpty(entryId, d)
      }
    },
  )
}

/** Autosave target. Writes the whole entry record, debounced by the composer. */
export const saveEntry = async (
  entryId: Id,
  patch: Partial<Pick<Entry, 'body' | 'title' | 'source' | 'topic' | 'date'>>,
  d: JournalDb = db,
): Promise<void> => {
  await d.entries.update(entryId, { ...compact(patch), updatedAt: nowIso() })
}

/**
 * Appends one Reflect turn to the entry body, under a hairline. Technical plan §10.
 *
 * This is what makes Reflect worth having to someone who never extracts anything: the exchange lands
 * in the journal itself rather than in a conversation log nobody reads again.
 *
 * `---` is the separator because it is a real Markdown thematic break, so it survives into
 * `readable/` as a rule. It also passes through `escapeLine` untouched, since that only escapes a
 * marker followed by whitespace.
 */
export const appendReflection = async (
  entryId: Id,
  question: string,
  answer: string,
  d: JournalDb = db,
): Promise<void> => {
  const entry = await d.entries.get(entryId)
  if (!entry) return

  const block = `${question.trim()}\n\n${answer.trim()}`
  const body = entry.body.trim() === '' ? block : `${entry.body.trimEnd()}\n\n---\n\n${block}`
  await d.entries.update(entryId, { body, updatedAt: nowIso() })
}

/**
 * Deletes an entry that never became a record. Called when the composer closes.
 *
 * Encounters count as content. A word quick-added while the composer sat empty is real, and pruning
 * the entry underneath it would orphan the encounter and break concepts §9's invariant.
 */
export const pruneEntryIfEmpty = async (entryId: Id, d: JournalDb = db): Promise<boolean> => {
  return d.transaction('rw', [d.entries, d.attachments, d.encounters], async () => {
    const entry = await d.entries.get(entryId)
    if (!entry) return false
    if (entry.body.trim() !== '') return false
    if ((await d.attachments.where('entryId').equals(entryId).count()) > 0) return false
    if ((await d.encounters.where('entryId').equals(entryId).count()) > 0) return false
    await d.entries.delete(entryId)
    return true
  })
}

/**
 * Sweeps empty entries in a notebook. Called when the timeline loads.
 *
 * The composer creates its entry eagerly, because autosave needs an id to write into, so backing out
 * of a composer without typing would otherwise leave a blank record on the timeline. Pruning here
 * rather than in the composer's unmount is deliberate: unmount fires twice under React's strict
 * double-invoke in development, and the first pass would delete the entry the second pass reloads.
 *
 * This is not background work. It runs because the learner just navigated to the timeline.
 */
export const pruneEmptyEntries = async (notebookId: Id, d: JournalDb = db): Promise<number> => {
  const candidates = (await d.entries.where('notebookId').equals(notebookId).toArray()).filter(
    (e) => e.body.trim() === '',
  )
  let removed = 0
  for (const e of candidates) if (await pruneEntryIfEmpty(e.id, d)) removed += 1
  return removed
}

export interface DeleteEntryPreview {
  /** Words that appear in no other entry and would go with it. */
  orphanedWords: Word[]
  orphanedSentences: Sentence[]
  attachments: number
}

/**
 * What deleting this entry would take with it.
 *
 * Concepts §9 requires every word and sentence to have at least one encounter, so a word whose only
 * encounter was this entry cannot survive it. Rather than silently dropping vocabulary or quietly
 * re-dating it to today, the count goes in front of the learner and the delete stays their press.
 */
export const deleteEntryPreview = async (
  entryId: Id,
  d: JournalDb = db,
): Promise<DeleteEntryPreview> => {
  const encounters = await d.encounters.where('entryId').equals(entryId).toArray()
  const orphanedWords: Word[] = []
  const orphanedSentences: Sentence[] = []

  for (const e of encounters) {
    const total = await d.encounters.where('targetId').equals(e.targetId).count()
    if (total > 1) continue
    if (e.targetType === 'word') {
      const w = await d.words.get(e.targetId)
      if (w) orphanedWords.push(w)
    } else {
      const s = await d.sentences.get(e.targetId)
      if (s) orphanedSentences.push(s)
    }
  }

  return {
    orphanedWords,
    orphanedSentences,
    attachments: await d.attachments.where('entryId').equals(entryId).count(),
  }
}

/** Deletes an entry, its attachments and their media, its encounters, and anything orphaned by it. */
export const deleteEntry = async (entryId: Id, d: JournalDb = db): Promise<void> => {
  await d.transaction(
    'rw',
    [d.entries, d.attachments, d.media, d.words, d.sentences, d.encounters, d.wordInSentences],
    async () => {
      const preview = await deleteEntryPreview(entryId, d)

      const attachments = await d.attachments.where('entryId').equals(entryId).toArray()
      const mediaIds = attachments.flatMap((a) => (a.mediaId ? [a.mediaId] : []))
      await d.media.bulkDelete(mediaIds)
      await d.attachments.bulkDelete(attachments.map((a) => a.id))

      for (const s of preview.orphanedSentences) {
        const links = await d.wordInSentences.where('sentenceId').equals(s.id).toArray()
        await d.wordInSentences.bulkDelete(links.map((l) => l.id))
      }
      for (const w of preview.orphanedWords) {
        const links = await d.wordInSentences.where('wordId').equals(w.id).toArray()
        await d.wordInSentences.bulkDelete(links.map((l) => l.id))
      }
      await d.words.bulkDelete(preview.orphanedWords.map((w) => w.id))
      await d.sentences.bulkDelete(preview.orphanedSentences.map((s) => s.id))

      const encounters = await d.encounters.where('entryId').equals(entryId).toArray()
      await d.encounters.bulkDelete(encounters.map((e) => e.id))
      await d.entries.delete(entryId)
    },
  )
}

/**
 * Deletes a notebook and every record carrying its id.
 *
 * Import-Replace depends on this being complete, since Replace is a whole-notebook overwrite rather
 * than a merge. Anything missed here would survive as a fragment of a notebook that no longer exists.
 */
export const deleteNotebook = async (notebookId: Id, d: JournalDb = db): Promise<void> => {
  const scoped = [
    d.entries,
    d.attachments,
    d.media,
    d.words,
    d.sentences,
    d.encounters,
    d.wordInSentences,
    d.practiceEvents,
    d.sessions,
    d.proposals,
  ]
  await d.transaction('rw', [d.notebooks, ...scoped], async () => {
    for (const table of scoped) {
      await table.where('notebookId').equals(notebookId).delete()
    }
    await d.notebooks.delete(notebookId)
  })
}

export const recordPractice = async (
  e: Omit<PracticeEvent, 'id' | 'at'>,
  d: JournalDb = db,
): Promise<void> => {
  await d.practiceEvents.add({ ...e, id: newId(), at: nowIso() })
}

export interface SaveMomentInput {
  notebookId: Id
  title?: string | undefined
  body: string
  source?: string | undefined
  /** Generated audio or images the learner chose to keep. */
  media?: readonly Blob[] | undefined
}

/**
 * An entry from a workbook session. Technical plan §8.
 *
 * The only thing that turns a session into an entry, and only the learner triggers it. A session
 * nobody saves leaves nothing in the journal beyond practice events.
 *
 * `origin: 'activity'` is what keeps it out of `todayEntry`, so a word quick-added later in the day
 * never lands inside someone else's saved exercise.
 *
 * Media arrives as a Blob because generated media lives in session state, not in IndexedDB (§7).
 * Saving a moment is the moment it becomes real, and `addAttachment` is what makes it so.
 */
export const saveMoment = async (input: SaveMomentInput, d: JournalDb = db): Promise<Id> => {
  const entry = await createEntry(
    input.notebookId,
    compact({
      body: input.body,
      title: input.title,
      source: input.source,
      origin: 'activity' as const,
    }),
    d,
  )

  for (const blob of input.media ?? []) {
    await addAttachment(
      { notebookId: input.notebookId, entryId: entry.id, kind: attachmentKind(blob.type), bytes: blob },
      d,
    )
  }

  return entry.id
}

/**
 * Which `Attachment.kind` a generated blob is.
 *
 * There is no video kind in the schema and nothing in v1 generates video, so a video blob would land
 * as an image. Left as is rather than adding a kind no record uses: §9 keeps video defined and unused,
 * and the day a workbook actually animates something, the schema is the right place to fix it.
 */
const attachmentKind = (mime: string): Attachment['kind'] => {
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'pdf'
  return 'image'
}

/* ── proposals ────────────────────────────────────────────────────────────── */

/**
 * The draft proposal sitting on an entry, if there is one. Technical plan §10.
 *
 * One draft per entry at most. A second Extract merges into it rather than stacking, which is what
 * makes "re-extracting proposes only terms that are still absent" a property of the record rather
 * than of the dialog.
 */
export const draftProposal = async (
  entryId: Id,
  d: JournalDb = db,
): Promise<Proposal | undefined> =>
  d.proposals
    .where('entryId')
    .equals(entryId)
    .filter((p) => p.status === 'draft')
    .first()

/**
 * Writes or updates the draft for an entry.
 *
 * Survives a reload and sits forever. There is deliberately nothing that counts it, badges it, or
 * sweeps it: §1 rules out background work, and §10 rules out an inbox.
 */
export const saveProposal = async (
  notebookId: Id,
  draft: ProposalDraft,
  d: JournalDb = db,
): Promise<Id> =>
  d.transaction('rw', [d.proposals], async () => {
    const held = await draftProposal(draft.entryId, d)
    if (held) {
      await d.proposals.update(held.id, { words: draft.words, sentences: draft.sentences })
      return held.id
    }

    const row: Proposal = {
      id: newId(),
      notebookId,
      entryId: draft.entryId,
      words: draft.words,
      sentences: draft.sentences,
      status: 'draft',
      createdAt: nowIso(),
    }
    await d.proposals.add(row)
    return row.id
  })

export interface AcceptProposalInput {
  notebookId: Id
  entryId: Id
  words: readonly ProposedWord[]
  sentences: readonly ProposedSentence[]
  /** Familiarity the learner set in the per-item panel, keyed by term. */
  familiarity?: ReadonlyMap<string, Familiarity>
}

export interface AcceptProposalResult {
  wordsAdded: number
  /** Terms that were already in the notebook, so they gained an encounter and nothing else. */
  wordsNoticedAgain: number
  sentencesAdded: number
}

/**
 * Turns the ticked rows into records against their source entry.
 *
 * `addWord` and `addSentence` do the work, which matters: a known term writes an `Encounter` only,
 * and that behaviour lives in one place rather than being reimplemented here where it could drift.
 *
 * Everything lands on the entry Extract ran against, not on today's, so a word pulled out of a
 * three-week-old entry shows under that entry's "Words from this entry" where it belongs.
 *
 * `correctsText` is resolved to an id after the pass that creates sentences, because a corrected
 * sentence can point at one proposed in the same batch.
 */
export const acceptProposal = async (
  input: AcceptProposalInput,
  d: JournalDb = db,
): Promise<AcceptProposalResult> => {
  let wordsAdded = 0
  let wordsNoticedAgain = 0

  for (const w of input.words) {
    const r = await addWord(
      {
        notebookId: input.notebookId,
        entryId: input.entryId,
        term: w.term,
        meaning: w.meaning,
        note: w.note,
      },
      d,
    )
    if (r.created) wordsAdded += 1
    else wordsNoticedAgain += 1

    const chosen = input.familiarity?.get(w.term)
    if (chosen) await setFamiliarity(r.wordId, chosen, d)
  }

  // First pass creates every sentence and remembers the text each one came from.
  const byText = new Map<string, Id>()
  for (const s of input.sentences) {
    const id = await addSentence(
      {
        notebookId: input.notebookId,
        entryId: input.entryId,
        text: s.text,
        translation: s.translation,
        origin: s.origin,
      },
      d,
    )
    byText.set(normalizeTerm(s.text), id)
  }

  // Second pass wires up the corrections, now that every id exists.
  for (const s of input.sentences) {
    if (!s.correctsText) continue
    const self = byText.get(normalizeTerm(s.text))
    const corrects = byText.get(normalizeTerm(s.correctsText))
    if (self && corrects && self !== corrects) await d.sentences.update(self, { correctsId: corrects })
  }

  const held = await draftProposal(input.entryId, d)
  if (held) await d.proposals.update(held.id, { status: 'accepted' })

  return { wordsAdded, wordsNoticedAgain, sentencesAdded: input.sentences.length }
}

/** Throws the draft away. Only reachable from a press, and it asks nothing. */
export const discardProposal = async (entryId: Id, d: JournalDb = db): Promise<void> => {
  const held = await draftProposal(entryId, d)
  if (held) await d.proposals.update(held.id, { status: 'discarded' })
}
