import { db, type JournalDb } from '../db/db'
import { signalsFor } from '../journal/derive'
import type { Id, Sentence } from '../db/types'
import type {
  BundledEntry,
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

/**
 * Filters and orders candidate words for a request.
 *
 * `least-practiced` puts words never practised at all first, because a word with no practice event is
 * the least practised thing in the notebook and a workbook asking for that order wants those.
 */
export const selectWords = (
  candidates: readonly BundledWord[],
  spec: NonNullable<BundleRequest['words']>,
  now: Date = new Date(),
  rng: Rng = Math.random,
): BundledWord[] => {
  let rows = [...candidates]

  if (spec.familiarity && spec.familiarity.length > 0) {
    const wanted = new Set(spec.familiarity)
    rows = rows.filter((r) => wanted.has(r.signals.familiarity))
  }

  if (spec.recentDays !== undefined) {
    const cutoff = now.getTime() - spec.recentDays * DAY_MS
    rows = rows.filter((r) => r.signals.lastSeen !== undefined && Date.parse(r.signals.lastSeen) >= cutoff)
  }

  if (spec.order === 'random') {
    rows = shuffled(rows, rng)
  } else if (spec.order === 'least-practiced') {
    // Never practised sorts first. Otherwise oldest practice first.
    rows.sort((a, b) => {
      const x = a.signals.lastPracticed
      const y = b.signals.lastPracticed
      if (x === undefined && y === undefined) return a.word.term < b.word.term ? -1 : 1
      if (x === undefined) return -1
      if (y === undefined) return 1
      return x < y ? -1 : x > y ? 1 : 0
    })
  } else {
    // 'recent' and the default: most recently met first, and a word never met sorts last.
    rows.sort((a, b) => (b.signals.lastSeen ?? '').localeCompare(a.signals.lastSeen ?? ''))
  }

  return spec.limit !== undefined ? rows.slice(0, Math.max(0, spec.limit)) : rows
}

export const selectSentences = (
  candidates: readonly Sentence[],
  spec: NonNullable<BundleRequest['sentences']>,
): Sentence[] => {
  let rows = [...candidates]

  if (spec.origin && spec.origin.length > 0) {
    const wanted = new Set(spec.origin)
    rows = rows.filter((s) => wanted.has(s.origin))
  }
  // Newest first, matching everything else in the app.
  rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))

  return spec.limit !== undefined ? rows.slice(0, Math.max(0, spec.limit)) : rows
}

/* ── the read ─────────────────────────────────────────────────────────────── */

/**
 * Everything the request asked for, and nothing it did not.
 *
 * An absent key means an empty array rather than everything, so a workbook that forgets to ask for
 * sentences gets none instead of the whole notebook.
 */
export const buildContext = async (
  notebookId: Id,
  request: BundleRequest,
  d: JournalDb = db,
  now: Date = new Date(),
  rng: Rng = Math.random,
): Promise<ContextBundle> => {
  const bundle: ContextBundle = { notebookId, words: [], sentences: [], entries: [] }

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
      }
    })

    bundle.words = selectWords(candidates, request.words, now, rng)
  }

  if (request.sentences) {
    const sentences = await d.sentences.where('notebookId').equals(notebookId).toArray()
    bundle.sentences = selectSentences(sentences, request.sentences)
  }

  if (request.entries) {
    const rows = (await d.entries.where('notebookId').equals(notebookId).sortBy('date')).reverse()
    const limited =
      request.entries.limit !== undefined ? rows.slice(0, Math.max(0, request.entries.limit)) : rows

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
