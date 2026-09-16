import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type {
  Attachment,
  Encounter,
  Entry,
  Id,
  Media,
  Notebook,
  PracticeEvent,
  Sentence,
  Word,
  WordInSentence,
} from '../db/types'

/**
 * The `.lljournal` bundle. Technical plan §4.
 *
 * IndexedDB is the working store. This is the artifact, and it is the thing the learner actually owns.
 * A zip of plain JSON, so it survives this app being abandoned.
 *
 * ```
 * manifest.json                      { format, version, exportedAt, app }
 * notebooks/<slug>/notebook.json     every record for that notebook, media referenced by id
 * notebooks/<slug>/media/<id>.<ext>  the raw bytes
 * readable/<slug>.md                 generated on export, ignored on import
 * ```
 *
 * Everything here is pure: records in, bytes out, and back. That is what makes the round trip
 * testable without a database, which matters because a silent bug here loses the journal.
 */

export const FORMAT = 'lljournal'
export const FORMAT_VERSION = 1
export const FILE_EXTENSION = '.lljournal'

export interface Manifest {
  format: typeof FORMAT
  version: number
  exportedAt: string
  app: string
}

/** Media without its blob. The bytes live in their own file so the zip stays browsable. */
export interface MediaEntry extends Omit<Media, 'bytes'> {
  /** Path inside the notebook folder, e.g. `media/abc123.jpg`. */
  file: string
}

/** Every record belonging to one notebook. What `notebook.json` holds. */
export interface NotebookData {
  notebook: Notebook
  entries: Entry[]
  attachments: Attachment[]
  media: MediaEntry[]
  words: Word[]
  sentences: Sentence[]
  encounters: Encounter[]
  wordInSentences: WordInSentence[]
  practiceEvents: PracticeEvent[]
}

/** A notebook plus its actual bytes, keyed by media id. */
export interface NotebookBundle {
  data: NotebookData
  blobs: Map<Id, Blob>
}

export interface Bundle {
  manifest: Manifest
  notebooks: NotebookBundle[]
}

/* ── file naming ──────────────────────────────────────────────────────────── */

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
}

export const extForMime = (mime: string): string => MIME_EXT[mime.toLowerCase()] ?? 'bin'

/**
 * A folder name for a notebook.
 *
 * Keeps unicode letters rather than stripping to ASCII, because a Korean or Chinese title would
 * otherwise slug to nothing and every notebook would collide. Falls back to the id when a title is
 * all punctuation.
 */
export const slugify = (title: string): string => {
  const s = title
    .normalize('NFC')
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
  return s === '' ? '' : s
}

/** Slugs for a set of notebooks, disambiguated so no two share a folder. */
export const slugsFor = (notebooks: readonly Pick<Notebook, 'id' | 'title'>[]): Map<Id, string> => {
  const used = new Set<string>()
  const out = new Map<Id, string>()
  for (const n of notebooks) {
    const base = slugify(n.title) || n.id
    let slug = base
    let i = 2
    while (used.has(slug)) slug = `${base}-${i++}`
    used.add(slug)
    out.set(n.id, slug)
  }
  return out
}

/* ── writing ──────────────────────────────────────────────────────────────── */

export interface WriteOptions {
  app: string
  exportedAt: string
  /** Rendered per notebook and written to `readable/`. Ignored on import. */
  readable?: (n: NotebookData) => string
}

/**
 * Builds the zip.
 *
 * `zipSync` blocks, which is fine here. A personal journal with a few dozen photographed pages is a
 * handful of megabytes, and the alternative is a worker and a progress bar for something that takes
 * a moment.
 */
export const writeBundle = async (
  notebooks: readonly NotebookBundle[],
  opts: WriteOptions,
): Promise<Uint8Array> => {
  const manifest: Manifest = {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: opts.exportedAt,
    app: opts.app,
  }

  const files: Record<string, Uint8Array> = {
    'manifest.json': strToU8(JSON.stringify(manifest, null, 2)),
  }

  const slugs = slugsFor(notebooks.map((n) => n.data.notebook))

  for (const nb of notebooks) {
    const slug = slugs.get(nb.data.notebook.id)!
    files[`notebooks/${slug}/notebook.json`] = strToU8(JSON.stringify(nb.data, null, 2))

    for (const meta of nb.data.media) {
      const blob = nb.blobs.get(meta.id)
      if (!blob) continue
      files[`notebooks/${slug}/${meta.file}`] = new Uint8Array(await blob.arrayBuffer())
    }

    if (opts.readable) {
      files[`readable/${slug}.md`] = strToU8(opts.readable(nb.data))
    }
  }

  return zipSync(files, { level: 6 })
}

/* ── reading ──────────────────────────────────────────────────────────────── */

export class BundleError extends Error {}

/**
 * A Blob from bytes that may be a view onto a larger or shared buffer.
 *
 * The copy is not only for the types. Handing a view straight to `Blob` risks writing the whole
 * underlying buffer, which is the same trap `files.ts` guards against on the way out.
 */
const toBlob = (bytes: Uint8Array, type: string): Blob => {
  const exact = new Uint8Array(bytes.byteLength)
  exact.set(bytes)
  return new Blob([exact], { type })
}

/**
 * Parses a zip back into records and blobs.
 *
 * Refuses a format version it does not know rather than guessing, because a half-understood import is
 * worse than no import: it would write partial records over a working notebook.
 */
export const readBundle = (bytes: Uint8Array): Bundle => {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes)
  } catch {
    throw new BundleError('That file is not a journal bundle.')
  }

  const manifestRaw = files['manifest.json']
  if (!manifestRaw) throw new BundleError('That file is not a journal bundle. No manifest.')

  let manifest: Manifest
  try {
    manifest = JSON.parse(strFromU8(manifestRaw)) as Manifest
  } catch {
    throw new BundleError('The manifest in that bundle is unreadable.')
  }

  if (manifest.format !== FORMAT) {
    throw new BundleError('That bundle was written by a different app.')
  }
  if (typeof manifest.version !== 'number' || manifest.version > FORMAT_VERSION) {
    throw new BundleError(
      `That bundle is version ${String(manifest.version)}, and this app understands up to ${FORMAT_VERSION}.`,
    )
  }

  const notebooks: NotebookBundle[] = []
  for (const path of Object.keys(files)) {
    const match = /^notebooks\/(.+)\/notebook\.json$/.exec(path)
    if (!match) continue
    const folder = `notebooks/${match[1]}/`

    let data: NotebookData
    try {
      data = JSON.parse(strFromU8(files[path]!)) as NotebookData
    } catch {
      throw new BundleError(`Could not read ${path}.`)
    }
    if (!data.notebook?.id) throw new BundleError(`${path} has no notebook.`)

    const blobs = new Map<Id, Blob>()
    for (const meta of data.media ?? []) {
      const raw = files[`${folder}${meta.file}`]
      if (raw) blobs.set(meta.id, toBlob(raw, meta.mime))
    }

    notebooks.push({ data: withEmptyTables(data), blobs })
  }

  if (notebooks.length === 0) throw new BundleError('That bundle holds no notebooks.')
  return { manifest, notebooks }
}

/** A bundle written by an older build may lack a table this one expects. Absent means empty. */
const withEmptyTables = (d: NotebookData): NotebookData => ({
  notebook: d.notebook,
  entries: d.entries ?? [],
  attachments: d.attachments ?? [],
  media: d.media ?? [],
  words: d.words ?? [],
  sentences: d.sentences ?? [],
  encounters: d.encounters ?? [],
  wordInSentences: d.wordInSentences ?? [],
  practiceEvents: d.practiceEvents ?? [],
})

/* ── new copy ─────────────────────────────────────────────────────────────── */

/**
 * Rewrites every id in a notebook so it can sit alongside the original.
 *
 * The fiddly part is that ids are referenced from ten places and two of them are polymorphic:
 * `Encounter.targetId` and `PracticeEvent.targetId` point at either a word or a sentence depending on
 * their own `targetType`. Remapping those against the wrong table silently rewires the journal, which
 * is exactly the class of bug the round-trip test exists to catch. `Word.audioMediaId` and
 * `Sentence.audioMediaId` are the same hazard one step quieter, since a clip pointing into the original
 * notebook's media would play the right words and still be the wrong record.
 */
export const withFreshIds = (bundle: NotebookBundle, newId: () => Id): NotebookBundle => {
  const { data } = bundle

  const map = <T extends { id: Id }>(rows: readonly T[]): Map<Id, Id> =>
    new Map(rows.map((r) => [r.id, newId()]))

  const notebookId = newId()
  const entries = map(data.entries)
  const attachments = map(data.attachments)
  const media = map(data.media)
  const words = map(data.words)
  const sentences = map(data.sentences)
  const encounters = map(data.encounters)
  const links = map(data.wordInSentences)
  const practice = map(data.practiceEvents)

  const target = (type: 'word' | 'sentence', id: Id): Id =>
    (type === 'word' ? words.get(id) : sentences.get(id)) ?? id

  const next: NotebookData = {
    notebook: {
      ...data.notebook,
      id: notebookId,
      // It genuinely is a copy, and the field exists to say so.
      copiedFromId: data.notebook.id,
    },
    entries: data.entries.map((e) => ({ ...e, id: entries.get(e.id)!, notebookId })),
    attachments: data.attachments.map((a) => {
      const out: Attachment = {
        ...a,
        id: attachments.get(a.id)!,
        notebookId,
        entryId: entries.get(a.entryId) ?? a.entryId,
      }
      if (a.mediaId !== undefined) out.mediaId = media.get(a.mediaId) ?? a.mediaId
      return out
    }),
    media: data.media.map((m) => {
      const id = media.get(m.id)!
      return { ...m, id, notebookId, file: `media/${id}.${extForMime(m.mime)}` }
    }),
    words: data.words.map((w) => {
      const out: Word = { ...w, id: words.get(w.id)!, notebookId }
      if (w.audioMediaId !== undefined) out.audioMediaId = media.get(w.audioMediaId) ?? w.audioMediaId
      return out
    }),
    sentences: data.sentences.map((s) => {
      const out: Sentence = { ...s, id: sentences.get(s.id)!, notebookId }
      if (s.correctsId !== undefined) out.correctsId = sentences.get(s.correctsId) ?? s.correctsId
      if (s.audioMediaId !== undefined) out.audioMediaId = media.get(s.audioMediaId) ?? s.audioMediaId
      return out
    }),
    encounters: data.encounters.map((e) => ({
      ...e,
      id: encounters.get(e.id)!,
      notebookId,
      entryId: entries.get(e.entryId) ?? e.entryId,
      targetId: target(e.targetType, e.targetId),
    })),
    wordInSentences: data.wordInSentences.map((l) => ({
      ...l,
      id: links.get(l.id)!,
      notebookId,
      wordId: words.get(l.wordId) ?? l.wordId,
      sentenceId: sentences.get(l.sentenceId) ?? l.sentenceId,
    })),
    practiceEvents: data.practiceEvents.map((p) => ({
      ...p,
      id: practice.get(p.id)!,
      notebookId,
      targetId: target(p.targetType, p.targetId),
    })),
  }

  // Blobs move to the new media ids, so the bytes follow the records.
  const blobs = new Map<Id, Blob>()
  for (const [oldId, blob] of bundle.blobs) {
    blobs.set(media.get(oldId) ?? oldId, blob)
  }

  return { data: next, blobs }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * `시댁 한국어 · 15 Sep 2026.lljournal`, or `Journal · 3 notebooks · 15 Sep 2026.lljournal`.
 *
 * Months come from a fixed table rather than `toLocaleDateString`. A filename should be the same on
 * every machine, and ICU disagrees with itself across versions about whether September abbreviates to
 * Sep or Sept.
 */
export const bundleFilename = (label: string, at: Date = new Date()): string => {
  const date = `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`
  const safe = label.replace(/[/\\:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Journal'
  return `${safe} · ${date}${FILE_EXTENSION}`
}
