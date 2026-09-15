import Dexie, { type Table } from 'dexie'
import type {
  Attachment,
  Encounter,
  Entry,
  Id,
  Media,
  Notebook,
  PracticeEvent,
  Proposal,
  Sentence,
  Settings,
  Word,
  WordInSentence,
  WorkbookSession,
} from './types'

/**
 * The working store. Technical plan §3 and §4.
 *
 * IndexedDB is where the app reads and writes. It is not the artifact. The artifact is the
 * `.lljournal` bundle in `storage/`, which is what the learner actually owns.
 */
export class JournalDb extends Dexie {
  notebooks!: Table<Notebook, Id>
  entries!: Table<Entry, Id>
  attachments!: Table<Attachment, Id>
  media!: Table<Media, Id>
  words!: Table<Word, Id>
  sentences!: Table<Sentence, Id>
  encounters!: Table<Encounter, Id>
  wordInSentences!: Table<WordInSentence, Id>
  practiceEvents!: Table<PracticeEvent, Id>
  sessions!: Table<WorkbookSession, Id>
  proposals!: Table<Proposal, Id>
  settings!: Table<Settings, string>

  constructor(name = 'llj') {
    super(name)
    this.version(1).stores({
      notebooks: 'id, lastOpenedAt',
      entries: 'id, notebookId, [notebookId+date]',
      attachments: 'id, notebookId, entryId',
      media: 'id, notebookId',
      words: 'id, notebookId, [notebookId+termKey], [notebookId+term]',
      sentences: 'id, notebookId',
      // The & makes [entryId+targetId] unique, which is what enforces one encounter per entry.
      encounters: 'id, notebookId, entryId, targetId, &[entryId+targetId], [notebookId+targetType]',
      wordInSentences: 'id, notebookId, wordId, sentenceId',
      practiceEvents: 'id, notebookId, targetId, at',
      sessions: 'id, notebookId, status',
      proposals: 'id, notebookId, entryId, status',
      settings: 'id',
    })
  }
}

export const db = new JournalDb()

/** Every table, in a fixed order, for the cascade deletes and the export walk. */
export const notebookScopedTables = (d: JournalDb) =>
  [
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
  ] as const

export const newId = (): Id => crypto.randomUUID()
export const nowIso = (): string => new Date().toISOString()

/**
 * Keys whose type admits `undefined` become optional and lose it. Everything else is untouched.
 * This is what `compact` actually does to a type, and saying so is what lets a compacted object
 * literal satisfy a record type under `exactOptionalPropertyTypes`.
 */
export type Compacted<T> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
}

/**
 * Strips keys whose value is `undefined`.
 *
 * Earns its place twice. `exactOptionalPropertyTypes` refuses an explicit `undefined` on an optional
 * field, which is exactly what you get when building a record from form input. And IndexedDB would
 * otherwise persist the key, which then surfaces in the export bundle as a null nobody meant to write.
 */
export const compact = <T extends object>(o: T): Compacted<T> => {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as Compacted<T>
}
