/**
 * The records. Technical plan §3.
 *
 * Every record carries `notebookId` because the notebook is the boundary (concepts §6). Ids are
 * `crypto.randomUUID()`. Timestamps are ISO 8601 strings, stored as text so the export bundle stays
 * readable in a text editor.
 */

export type Id = string
export type Iso = string

export type Familiarity = 'new' | 'getting it' | 'got it'
export type SentenceOrigin = 'encountered' | 'mine' | 'corrected'

export interface Notebook {
  id: Id
  title: string
  language: string
  /** Free text. Doubles as the notebook's profile for the LLM. */
  focus?: string
  meaningLanguage?: string
  copiedFromId?: Id
  createdAt: Iso
  /** Drives the gold spine on the notebooks screen. */
  lastOpenedAt: Iso
}

export interface Entry {
  id: Id
  notebookId: Id
  /** Defaults to now, editable. */
  date: Iso
  /** '' is legal if an attachment exists. */
  body: string
  title?: string
  source?: string
  topic?: string
  origin: 'learner' | 'activity'
  createdAt: Iso
  updatedAt: Iso
}

export interface Attachment {
  id: Id
  notebookId: Id
  entryId: Id
  kind: 'text' | 'image' | 'pdf' | 'audio'
  /** Pasted text and transcripts live here. */
  text?: string
  /** Everything else points at a blob. */
  mediaId?: Id
  filename?: string
  createdAt: Iso
}

export interface Media {
  id: Id
  notebookId: Id
  mime: string
  /** IndexedDB stores Blobs natively. Never base64. */
  bytes: Blob
  width?: number
  height?: number
  durationMs?: number
}

export interface Word {
  id: Id
  notebookId: Id
  term: string
  /** Normalized, unique per notebook. See `normalizeTerm`. */
  termKey: string
  meaning?: string
  note?: string
  /** Unset means estimate it from signals. */
  familiarity?: Familiarity
  createdAt: Iso
  updatedAt: Iso
}

export interface Sentence {
  id: Id
  notebookId: Id
  text: string
  origin: SentenceOrigin
  translation?: string
  note?: string
  /** Set on a 'corrected' sentence, points at the 'mine' one it fixes. */
  correctsId?: Id
  createdAt: Iso
}

export type EncounterTarget = 'word' | 'sentence'

/**
 * Entry -> Word and Entry -> Sentence.
 *
 * `[entryId+targetId]` is unique. Adding the same word twice in one sitting, or reprocessing an entry
 * that already yielded it, is a no-op rather than a second encounter, so `timesEncountered` reads as
 * the number of distinct entries a word came up in.
 */
export interface Encounter {
  id: Id
  notebookId: Id
  entryId: Id
  targetType: EncounterTarget
  targetId: Id
  createdAt: Iso
}

/** Word -> Sentence. Derived on write, then editable, so the record carries where it came from. */
export interface WordInSentence {
  id: Id
  notebookId: Id
  wordId: Id
  sentenceId: Id
  source: 'derived' | 'manual'
}

export interface PracticeEvent {
  id: Id
  notebookId: Id
  workbookId: string
  targetType: EncounterTarget
  targetId: Id
  outcome: 'right' | 'wrong' | 'shown'
  at: Iso
}

/** Opaque to everything but the workbook that owns it. Technical plan §7. */
export interface WorkbookSession {
  id: Id
  notebookId: Id
  workbookId: string
  /** What the dock chip reads. Set by the workbook. */
  label: string
  state: unknown
  status: 'open' | 'docked'
  openedAt: Iso
  touchedAt: Iso
}

export interface ProposedWord {
  term: string
  meaning?: string
  note?: string
}

export interface ProposedSentence {
  text: string
  translation?: string
  origin: SentenceOrigin
  /** On a 'corrected' proposal, the 'mine' text it fixes. Resolved to ids on accept. */
  correctsText?: string
}

/** A draft set of words and sentences tied to its source entry. Technical plan §10. */
export interface Proposal {
  id: Id
  notebookId: Id
  entryId: Id
  words: ProposedWord[]
  sentences: ProposedSentence[]
  status: 'draft' | 'accepted' | 'discarded'
  createdAt: Iso
}

/**
 * What a proposal looks like before it is a record. Technical plan §10.
 *
 * Also the argument to `JournalWriter.propose`, so a workbook can put something in front of the
 * learner without writing to the journal itself.
 */
export interface ProposalDraft {
  entryId: Id
  words: ProposedWord[]
  sentences: ProposedSentence[]
}

/** Single row, id `SETTINGS_ID`. */
export interface Settings {
  id: 'me'
  /** Typed in Settings, never read from an env var, so it never enters the bundle. */
  xaiKey?: string
  meaningLanguage?: string
  lastExportedAt?: Iso
}

export const SETTINGS_ID = 'me' as const
