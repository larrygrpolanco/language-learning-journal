import { db, type JournalDb } from '../db/db'
import { signalsFor } from '../journal/derive'
import type { Id, Sentence, Word, WorkbookScope } from '../db/types'
import type {
  BundledEntry,
  BundledSentence,
  BundledWord,
  BundleRequest,
  ContextBundle,
  NotebookProfile,
} from './sdk'

/**
 * The context bundle. Technical plan §8.
 *
 * One function serves any `BundleRequest`, and workbooks never query. This is also where the derived
 * signals get attached, so an exercise receives words already carrying encounter counts and
 * familiarity rather than reaching into the database for them.
 *
 * Named `buildContext` rather than `buildBundle`, which is already taken by `storage/transfer.ts` for
 * the export zip. Two different things called the same name in one codebase is a bug waiting for a
 * tired afternoon.
 *
 * The selection rules below are pure and exported on purpose. They are the part worth testing, and
 * they test against fixtures with no database.
 */

/* ── pure selection ───────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000

/** Deterministic in tests, shuffled in the app. */
export type Rng = () => number

/**
 * Fisher-Yates, so `order: 'random'` is actually uniform.
 *
 * `sort(() => Math.random() - 0.5)` is the usual shortcut and it is biased, which for a drill means
 * the same few words keep coming up first and the learner notices before the code does.
 */
const shuffled = <T>(xs: readonly T[], rng: Rng): T[] => {
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1))
    const a = out[i]!
    const b = out[j]!
    out[i] = b
    out[j] = a
  }
  return out
}

/** The request's own filters. Applied to background material only. */
const passing = (
  rows: readonly BundledWord[],
  spec: NonNullable<BundleRequest['words']>,
  now: Date,
): BundledWord[] => {
  let out = [...rows]

  if (spec.familiarity && spec.familiarity.length > 0) {
    const wanted = new Set(spec.familiarity)
    out = out.filter((r) => wanted.has(r.signals.familiarity))
  }

  if (spec.recentDays !== undefined) {
    const cutoff = now.getTime() - spec.recentDays * DAY_MS
    out = out.filter(
      (r) => r.signals.lastSeen !== undefined && Date.parse(r.signals.lastSeen) >= cutoff,
    )
  }

  return out
}

/**
 * The request's order, within one group.
 *
 * `least-practiced` puts words never practised at all first, because a word with no practice event is
 * the least practised thing in the notebook and a workbook asking for that order wants those.
 */
const ordered = (
  rows: readonly BundledWord[],
  spec: NonNullable<BundleRequest['words']>,
  rng: Rng,
): BundledWord[] => {
  if (spec.order === 'random') return shuffled(rows, rng)

  const out = [...rows]
  if (spec.order === 'least-practiced') {
    // Never practised sorts first. Otherwise oldest practice first.
    out.sort((a, b) => {
      const x = a.signals.lastPracticed
      const y = b.signals.lastPracticed
      if (x === undefined && y === undefined) return a.word.term < b.word.term ? -1 : 1
      if (x === undefined) return -1
      if (y === undefined) return 1
      return x < y ? -1 : x > y ? 1 : 0
    })
  } else {
    // 'recent' and the default: most recently met first, and a word never met sorts last.
    out.sort((a, b) => (b.signals.lastSeen ?? '').localeCompare(a.signals.lastSeen ?? ''))
  }
  return out
}

/**
 * Filters and orders candidate words for a request, focus first.
 *
 * **An explicit focus bypasses `familiarity` and `recentDays`.** Without that exemption, focusing an
 * entry from eight months ago against word drill's `recentDays: 60` would filter the chosen words
 * straight back out, and the exercise would look broken for doing exactly what it was told.
 *
 * The limit applies after the two groups are joined, so twelve focus words against `limit: 8` yield
 * eight focus words and no background. That is the point of focusing rather than a flaw in it.
 */
export const selectWords = (
  candidates: readonly BundledWord[],
  spec: NonNullable<BundleRequest['words']>,
  now: Date = new Date(),
  rng: Rng = Math.random,
): BundledWord[] => {
  const focus = ordered(
    candidates.filter((r) => r.focus),
    spec,
    rng,
  )
  const background = ordered(
    passing(
      candidates.filter((r) => !r.focus),
      spec,
      now,
    ),
    spec,
    rng,
  )

  const rows = [...focus, ...background]
  return spec.limit !== undefined ? rows.slice(0, Math.max(0, spec.limit)) : rows
}

export const selectSentences = (
  candidates: readonly BundledSentence[],
  spec: NonNullable<BundleRequest['sentences']>,
): BundledSentence[] => {
  // Newest first, matching everything else in the app, and focus ahead of the rest.
  const newest = (a: BundledSentence, b: BundledSentence) =>
    a.sentence.createdAt < b.sentence.createdAt ? 1 : -1

  const rows = [
    ...candidates.filter((r) => r.focus).sort(newest),
    ...candidates.filter((r) => !r.focus).sort(newest),
  ]

  return spec.limit !== undefined ? rows.slice(0, Math.max(0, spec.limit)) : rows
}

/* ── the read ─────────────────────────────────────────────────────────────── */

/**
 * The database handle and the two sources of nondeterminism, in one bag.
 *
 * Collected rather than trailing, so `scope` can sit in the argument position that reads like part of
 * the request while the test seams stay out of the way of the production call sites.
 */
export interface ContextDeps {
  d?: JournalDb
  now?: Date
  rng?: Rng
}

/**
 * Everything the request asked for, and nothing it did not.
 *
 * An absent key means an empty array rather than everything, so a workbook that forgets to ask for
 * sentences gets none instead of the whole notebook.
 *
 * `scope` marks material rather than restricting it. Focused rows are flagged, exempted from the
 * request's filters and sorted first; the rest of the notebook still arrives behind them, because
 * focusing an entry is a statement about what to build around and not a statement about what to
 * forget.
 */
export const buildContext = async (
  notebookId: Id,
  request: BundleRequest,
  scope?: WorkbookScope,
  deps: ContextDeps = {},
): Promise<ContextBundle> => {
  const d = deps.d ?? db
  const now = deps.now ?? new Date()
  const rng = deps.rng ?? Math.random

  const bundle: ContextBundle = { notebookId, words: [], sentences: [], entries: [] }
  if (scope) bundle.scope = scope

  const focusWords = new Set(scope?.wordIds ?? [])
  const focusSentences = new Set(scope?.sentenceIds ?? [])

  if (request.notebookProfile) {
    const notebook = await d.notebooks.get(notebookId)
    if (notebook) {
      const profile: NotebookProfile = {
        title: notebook.title,
        language: notebook.language,
        meaningLanguage: notebook.meaningLanguage ?? 'English',
      }
      if (notebook.focus !== undefined) profile.focus = notebook.focus
      bundle.profile = profile
    }
  }

  if (request.words) {
    const words = await d.words.where('notebookId').equals(notebookId).toArray()
    const encounters = await d.encounters.where('notebookId').equals(notebookId).toArray()
    const practice = await d.practiceEvents.where('notebookId').equals(notebookId).toArray()

    // Entry dates once, rather than per word. A word met in twelve entries would otherwise be twelve
    // reads of records already in hand.
    const entries = await d.entries.where('notebookId').equals(notebookId).toArray()
    const dateOf = new Map(entries.map((e) => [e.id, e.date]))

    const candidates: BundledWord[] = words.map((word) => {
      const mine = encounters.filter((e) => e.targetId === word.id)
      return {
        word,
        signals: signalsFor(
          word,
          mine.map((e) => ({ entryDate: dateOf.get(e.entryId) ?? e.createdAt })),
          practice.filter((p) => p.targetId === word.id),
          now,
        ),
        focus: focusWords.has(word.id),
      }
    })

    bundle.words = selectWords(candidates, request.words, now, rng)
  }

  if (request.sentences) {
    const sentences = await d.sentences.where('notebookId').equals(notebookId).toArray()
    bundle.sentences = selectSentences(
      sentences.map((sentence) => ({ sentence, focus: focusSentences.has(sentence.id) })),
      request.sentences,
    )
  }

  if (request.entries) {
    const rows = (await d.entries.where('notebookId').equals(notebookId).sortBy('date')).reverse()

    // A focused entry is the one the exercise is being built around, so it leads regardless of date
    // and survives a limit that would otherwise have cut it.
    const focused = scope?.entryIds !== undefined ? new Set(scope.entryIds) : undefined
    const sorted = focused
      ? [...rows.filter((e) => focused.has(e.id)), ...rows.filter((e) => !focused.has(e.id))]
      : rows

    const limited =
      request.entries.limit !== undefined
        ? sorted.slice(0, Math.max(0, request.entries.limit))
        : sorted

    bundle.entries = limited.map((e): BundledEntry => {
      const out: BundledEntry = { id: e.id, date: e.date }
      if (e.title !== undefined) out.title = e.title
      if (e.source !== undefined) out.source = e.source
      if (request.entries?.includeBody) out.body = e.body
      return out
    })
  }

  return bundle
}

/* ── what the focus picker offers ─────────────────────────────────────────── */

export interface FocusCandidates {
  words: Word[]
  sentences: Sentence[]
}

/**
 * The words and sentences reachable from a set of entries.
 *
 * What the picker shows underneath the entries as they are ticked. Read through `Encounter`, which is
 * the record that says a word came up in an entry, so this is the same relationship the entry footer
 * and "Words from this entry" already display rather than a second definition of belonging.
 */
export const focusCandidates = async (
  notebookId: Id,
  entryIds: readonly Id[],
  d: JournalDb = db,
): Promise<FocusCandidates> => {
  if (entryIds.length === 0) return { words: [], sentences: [] }

  const encounters = (
    await d.encounters
      .where('entryId')
      .anyOf([...entryIds])
      .toArray()
  ).filter((e) => e.notebookId === notebookId)

  const wordIds = [...new Set(encounters.filter((e) => e.targetType === 'word').map((e) => e.targetId))]
  const sentenceIds = [
    ...new Set(encounters.filter((e) => e.targetType === 'sentence').map((e) => e.targetId)),
  ]

  const words = (await d.words.bulkGet(wordIds)).flatMap((w) => (w ? [w] : []))
  const sentences = (await d.sentences.bulkGet(sentenceIds)).flatMap((s) => (s ? [s] : []))

  words.sort((a, b) => a.term.localeCompare(b.term))
  sentences.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  return { words, sentences }
}
