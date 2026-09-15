import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type {
  Familiarity,
  Id,
  Notebook,
  PracticeEvent,
  ProposalDraft,
  Sentence,
  SentenceOrigin,
  Word,
} from '../db/types'
import type { WordSignals } from '../journal/derive'
import type { CompleteOptions, JsonOptions, Message } from '../ai/text'

/**
 * The workbook SDK. Technical plan §8. Types only, no implementation.
 *
 * A workbook is a folder and one line in the registry. What it gets is exactly what is below and
 * nothing else: no Dexie handle, no router, no direct `fetch`. That is what keeps concepts §7 true by
 * construction rather than by remembering to be careful.
 */

/* ── what a workbook asks the journal for ─────────────────────────────────── */

export interface BundleRequest {
  /** The notebook's title, language and focus. */
  notebookProfile?: boolean
  words?: {
    limit?: number
    familiarity?: Familiarity[]
    /** Only words encountered within this many days. */
    recentDays?: number
    order?: 'recent' | 'least-practiced' | 'random'
  }
  sentences?: { limit?: number; origin?: SentenceOrigin[] }
  entries?: { limit?: number; includeBody?: boolean }
}

/** A word with its derived signals already attached, so a workbook never computes them. */
export interface BundledWord {
  word: Word
  signals: WordSignals
}

export interface BundledEntry {
  id: Id
  date: string
  title?: string
  source?: string
  /** Present only when the request asked for it. */
  body?: string
}

export interface NotebookProfile {
  title: string
  language: string
  focus?: string
  meaningLanguage: string
}

/**
 * Everything a workbook was given. Built once when the session mounts.
 *
 * Workbooks never query. One function builds this for any `BundleRequest`, which is also where the
 * derived signals get attached, so an exercise receives words already carrying encounter counts and
 * familiarity rather than reaching for them.
 */
export interface ContextBundle {
  notebookId: Id
  profile?: NotebookProfile
  words: BundledWord[]
  sentences: Sentence[]
  entries: BundledEntry[]
}

/* ── what a workbook may do to the journal ────────────────────────────────── */

export interface Moment {
  title?: string
  body: string
  source?: string
  /** Generated audio or images the learner chose to keep. */
  media?: Blob[]
}

/**
 * The entire surface a workbook has on the journal.
 *
 * `saveMoment` is the only thing that turns a session into an entry, and only the learner triggers it.
 * A session nobody explicitly saves leaves nothing behind but practice events, which is what §8
 * promises. Everything here is already scoped to one notebook, so a workbook cannot name another.
 */
export interface JournalWriter {
  saveMoment: (m: Moment) => Promise<Id>
  addWord: (w: { term: string; meaning?: string; note?: string }) => Promise<Id>
  addSentence: (s: { text: string; translation?: string; origin?: SentenceOrigin }) => Promise<Id>
  propose: (p: ProposalDraft) => Promise<Id>
  recordPractice: (e: Omit<PracticeEvent, 'id' | 'notebookId' | 'at'>) => Promise<void>
}

/* ── what a workbook may ask xAI ──────────────────────────────────────────── */

/**
 * The AI surface, narrowed to the four capabilities.
 *
 * Deliberately not the `ai/` modules themselves. A workbook gets functions, so the key lookup, the
 * error normalisation and the model pinning all stay in one place it cannot route around.
 */
export interface AI {
  complete: (input: string | Message[], opts?: CompleteOptions) => Promise<string>
  completeJson: <T>(input: string | Message[], opts: JsonOptions<T>) => Promise<T>
  /** Speaks a line in the notebook's language. Held in state, never stored (§1). */
  speak: (text: string) => Promise<Blob>
  draw: (prompt: string) => Promise<Blob>
  /** Defined, and the one route in `ai/` that has not been verified against the live API. */
  animate: (prompt: string, signal?: AbortSignal) => Promise<Blob>
}

/* ── the workbook itself ──────────────────────────────────────────────────── */

export interface WorkbookProps<S = unknown> {
  bundle: ContextBundle
  /** Whatever was handed to `setState` last time, straight back. Undefined on a fresh session. */
  state: S | undefined
  /** Debounced write to the session record. Must be JSON-able. */
  setState: (next: S) => void
  /** What the dock chip reads. */
  setLabel: (s: string) => void
  ai: AI
  journal: JournalWriter
  /** Drops the sheet and leaves the session in the dock. */
  minimize: () => void
  /** Ends the session. Asks nothing and saves nothing (§7). */
  close: () => void
}

export interface WorkbookManifest<S = unknown> {
  id: string
  /** Cormorant 21px on the practice page. */
  name: string
  /**
   * The workbook's own glyph, on its practice row and its docked chip.
   *
   * Every exercise is a separate workbook, so each one is recognisable on sight rather than borrowing
   * the section's glyph. Keep these in Lucide's notebook family: the shared spiral binding is what
   * makes the practice page read as a shelf, and the variant is what names the activity.
   */
  icon: LucideIcon
  /** What it needs from the notebook. */
  request: BundleRequest
  /** "Draws on 14 recent words." Says what this exercise will actually work from. */
  describes: (b: ContextBundle) => string
  Component: ComponentType<WorkbookProps<S>>
}

/**
 * A manifest with its state type erased, which is what the registry holds.
 *
 * Each workbook is generic in its own state, and an array of differently-parameterised manifests has
 * no useful common type. The dock never inspects state, it only round-trips it, so `unknown` here
 * costs nothing and keeps the type inside the workbook where it means something.
 */
export type AnyWorkbook = WorkbookManifest<never> & { Component: ComponentType<WorkbookProps<never>> }

/** Narrows a typed manifest for the registry. The cast is contained to this one function. */
export const register = <S,>(m: WorkbookManifest<S>): AnyWorkbook => m as unknown as AnyWorkbook

export type { Notebook }
