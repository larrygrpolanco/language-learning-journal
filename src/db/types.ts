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
  /**
   * On generated speech, the voice it was spoken in.
   *
   * Recorded because it is not derivable from anywhere else. The language is, from the notebook the
   * clip's word belongs to, so that is not stored twice. Without this a clip in the export bundle is
   * unprovenanced binary, and changing `DEFAULT_VOICE` in a later build would silently leave a
   * notebook half in one voice and half in another with no way to tell which.
   */
  voice?: string
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
  /**
   * The kept clip of this term being spoken, once the learner has played it once.
   *
   * Un-indexed on purpose. It is only ever followed forwards, by id, from a word already in hand.
   * Renaming the term drops it, because the clip speaks the old one.
   */
  audioMediaId?: Id
  createdAt: Iso
  updatedAt: Iso
}

export interface Sentence {
  id: Id
  notebookId: Id
  text: string
  translation?: string
  note?: string
  /** As `Word.audioMediaId`. Editing the text drops it. */
  audioMediaId?: Id
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

/**
 * Material a session was told to build around. Technical plan §8.
 *
 * A marking, not a filter. Focused items sort first and are exempt from the request's own filters;
 * everything else in the notebook still comes in behind them as background.
 *
 * Resolved ids rather than entry ids alone, so a running session cannot silently gain a word because
 * one of its entries was edited after it started. Un-indexed, like `Word.audioMediaId`, because it is
 * only ever read forwards off a session already in hand.
 */
export interface WorkbookScope {
  entryIds: Id[]
  wordIds: Id[]
  sentenceIds: Id[]
}

/** Opaque to everything but the workbook that owns it. Technical plan §7. */
export interface WorkbookSession {
  id: Id
  notebookId: Id
  workbookId: string
  /** What the dock chip reads. Set by the workbook. */
  label: string
  state: unknown
  /** Absent means the whole notebook. */
  scope?: WorkbookScope
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
