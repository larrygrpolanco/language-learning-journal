import { db, JournalDb, newId, nowIso } from '../db/db'
import { deleteNotebook } from '../journal/writes'
import { SETTINGS_ID, type Id, type Media, type Notebook } from '../db/types'
import {
  bundleFilename,
  extForMime,
  readBundle,
  withFreshIds,
  writeBundle,
  type Bundle,
  type MediaEntry,
  type NotebookBundle,
} from './bundle'
import { renderReadable } from './readable'
import { saveBundle } from './files'

/**
 * Moving notebooks between the store and the file. Technical plan §4.
 *
 * The pure zip work lives in `bundle.ts` and the file I/O in `files.ts`. This is the layer that reads
 * and writes Dexie, kept separate so the round trip can be tested without either.
 */

const APP = 'language-learning-journal 0.1.0'

/* ── collecting ───────────────────────────────────────────────────────────── */

/** Every record carrying this notebook's id, plus the media bytes. */
export const collectNotebook = async (
  notebookId: Id,
  d: JournalDb = db,
): Promise<NotebookBundle | undefined> => {
  const notebook = await d.notebooks.get(notebookId)
  if (!notebook) return undefined

  const scoped = <T>(t: { where: (i: string) => { equals: (v: Id) => { toArray: () => Promise<T[]> } } }) =>
    t.where('notebookId').equals(notebookId).toArray()

  const mediaRows = await scoped<Media>(d.media)
  const media: MediaEntry[] = mediaRows.map((m) => {
    const { bytes: _bytes, ...rest } = m
    return { ...rest, file: `media/${m.id}.${extForMime(m.mime)}` }
  })

  return {
    data: {
      notebook,
      entries: await scoped(d.entries),
      attachments: await scoped(d.attachments),
      media,
      words: await scoped(d.words),
      sentences: await scoped(d.sentences),
      encounters: await scoped(d.encounters),
      wordInSentences: await scoped(d.wordInSentences),
      practiceEvents: await scoped(d.practiceEvents),
    },
    blobs: new Map(mediaRows.map((m) => [m.id, m.bytes])),
  }
}

/** Bytes for one notebook, or for the whole library when `notebookId` is omitted. */
export const buildBundle = async (
  notebookId?: Id,
  d: JournalDb = db,
): Promise<{ bytes: Uint8Array; filename: string } | undefined> => {
  const ids = notebookId
    ? [notebookId]
    : (await d.notebooks.orderBy('lastOpenedAt').toArray()).map((n) => n.id)
  if (ids.length === 0) return undefined

  const notebooks: NotebookBundle[] = []
  for (const id of ids) {
    const nb = await collectNotebook(id, d)
    if (nb) notebooks.push(nb)
  }
  if (notebooks.length === 0) return undefined

  const exportedAt = new Date()
  const bytes = await writeBundle(notebooks, {
    app: APP,
    exportedAt: exportedAt.toISOString(),
    readable: (data) => renderReadable(data, exportedAt),
  })

  const label =
    notebooks.length === 1 ? notebooks[0]!.data.notebook.title : `Journal · ${notebooks.length} notebooks`

  return { bytes, filename: bundleFilename(label, exportedAt) }
}

/**
 * Records that an export happened.
 *
 * `lastExportedAt` is the whole backstop against browser eviction, so it lives in one function that
 * every export path goes through. A `put` replaces the row outright, hence the spread: writing this
 * must not take the API key with it.
 */
export const noteExported = async (d: JournalDb = db): Promise<void> => {
  const current = await d.settings.get(SETTINGS_ID)
  await d.settings.put({ ...current, id: SETTINGS_ID, lastExportedAt: nowIso() })
}

/** Export. Writes the file and records that it happened. */
export const exportBundle = async (notebookId?: Id, d: JournalDb = db): Promise<string | undefined> => {
  const built = await buildBundle(notebookId, d)
  if (!built) return undefined
  await saveBundle(built.bytes, built.filename)
  await noteExported(d)
  return built.filename
}

/* ── importing ────────────────────────────────────────────────────────────── */

export type Resolution = 'new copy' | 'replace' | 'skip'

export interface ImportPlan {
  bundle: Bundle
  /** One row per notebook in the file, with what is already here under the same id. */
  notebooks: {
    id: Id
    title: string
    entries: number
    words: number
    /** The local notebook with this id, when there is one. */
    existing: Notebook | undefined
  }[]
}

/** Reads the file and reports what is in it, without writing anything. */
export const planImport = async (bytes: Uint8Array, d: JournalDb = db): Promise<ImportPlan> => {
  const bundle = readBundle(bytes)
  const notebooks = await Promise.all(
    bundle.notebooks.map(async (nb) => ({
      id: nb.data.notebook.id,
      title: nb.data.notebook.title,
      entries: nb.data.entries.length,
      words: nb.data.words.length,
      existing: await d.notebooks.get(nb.data.notebook.id),
    })),
  )
  return { bundle, notebooks }
}

/**
 * Applies one notebook from a bundle.
 *
 * Replace is a whole-notebook overwrite, not a merge, and that is deliberate: it is the entire reason
 * this design carries no sync machinery. `deleteNotebook` clears every table first, so nothing from
 * the old notebook survives to be confused with the new one.
 */
export const applyNotebook = async (
  nb: NotebookBundle,
  resolution: Resolution,
  d: JournalDb = db,
): Promise<Id | undefined> => {
  if (resolution === 'skip') return undefined

  const incoming = resolution === 'new copy' ? withFreshIds(nb, newId) : nb

  if (resolution === 'replace') {
    await deleteNotebook(nb.data.notebook.id, d)
  }

  const { data, blobs } = incoming
  const media: Media[] = data.media.flatMap((m) => {
    const bytes = blobs.get(m.id)
    if (!bytes) return []
    const { file: _file, ...rest } = m
    return [{ ...rest, bytes }]
  })

  await d.transaction(
    'rw',
    [
      d.notebooks,
      d.entries,
      d.attachments,
      d.media,
      d.words,
      d.sentences,
      d.encounters,
      d.wordInSentences,
      d.practiceEvents,
    ],
    async () => {
      await d.notebooks.put(data.notebook)
      await d.entries.bulkPut(data.entries)
      await d.attachments.bulkPut(data.attachments)
      await d.media.bulkPut(media)
      await d.words.bulkPut(data.words)
      await d.sentences.bulkPut(data.sentences)
      await d.encounters.bulkPut(data.encounters)
      await d.wordInSentences.bulkPut(data.wordInSentences)
      await d.practiceEvents.bulkPut(data.practiceEvents)
    },
  )

  return data.notebook.id
}

/** Applies a whole plan. `resolutions` is keyed by the notebook id as it appears in the file. */
export const applyImport = async (
  plan: ImportPlan,
  resolutions: Map<Id, Resolution>,
  d: JournalDb = db,
): Promise<Id[]> => {
  const applied: Id[] = []
  for (const nb of plan.bundle.notebooks) {
    const how = resolutions.get(nb.data.notebook.id) ?? 'new copy'
    const id = await applyNotebook(nb, how, d)
    if (id) applied.push(id)
  }
  return applied
}
