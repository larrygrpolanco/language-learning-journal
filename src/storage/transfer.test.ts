import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb, newId, nowIso } from '../db/db'
import { addAttachment, addSentence, addWord, createEntry, createNotebook } from '../journal/writes'
import { SETTINGS_ID, type Id } from '../db/types'
import {
  buildBundle,
  collectNotebook,
  applyImport,
  applyNotebook,
  noteExported,
  planImport,
} from './transfer'
import { readBundle } from './bundle'

let db: JournalDb

/** A notebook with something in every table, built through the real write layer. */
const seed = async (title = '시댁 한국어') => {
  const nb = await createNotebook({ title, language: 'Korean', focus: 'in-laws' }, db)
  const entry = await createEntry(nb, { title: 'Two hours', source: 'dinner', body: 'Learned 수고하셨습니다.' }, db)

  const word = await addWord(
    { notebookId: nb, term: '수고하셨습니다', meaning: 'thanks for your effort', entryId: entry.id },
    db,
  )
  const sentence = await addSentence(
    { notebookId: nb, text: '오늘 수고하셨습니다.', translation: 'you worked hard', entryId: entry.id },
    db,
  )

  await addAttachment(
    {
      notebookId: nb,
      entryId: entry.id,
      kind: 'image',
      bytes: new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
      filename: 'page.png',
    },
    db,
  )
  await addAttachment({ notebookId: nb, entryId: entry.id, kind: 'text', text: 'pasted' }, db)
  await db.practiceEvents.add({
    id: newId(),
    notebookId: nb,
    workbookId: 'word-drill',
    targetType: 'word',
    targetId: word.wordId,
    outcome: 'right',
    at: nowIso(),
  })

  return { nb, entryId: entry.id, wordId: word.wordId, sentenceId: sentence }
}

const counts = async (notebookId: Id) => ({
  entries: await db.entries.where('notebookId').equals(notebookId).count(),
  attachments: await db.attachments.where('notebookId').equals(notebookId).count(),
  media: await db.media.where('notebookId').equals(notebookId).count(),
  words: await db.words.where('notebookId').equals(notebookId).count(),
  sentences: await db.sentences.where('notebookId').equals(notebookId).count(),
  encounters: await db.encounters.where('notebookId').equals(notebookId).count(),
  wordInSentences: await db.wordInSentences.where('notebookId').equals(notebookId).count(),
  practiceEvents: await db.practiceEvents.where('notebookId').equals(notebookId).count(),
})

beforeEach(async () => {
  db = new JournalDb(`test-${newId()}`)
  await db.open()
})

describe('collectNotebook', () => {
  it('gathers every table and strips the blob out of the media record', async () => {
    const { nb } = await seed()
    const collected = await collectNotebook(nb, db)

    expect(collected).toBeDefined()
    expect(collected!.data.entries).toHaveLength(1)
    expect(collected!.data.words).toHaveLength(1)
    expect(collected!.data.attachments).toHaveLength(2)
    expect(collected!.data.media).toHaveLength(1)
    expect(collected!.data.practiceEvents).toHaveLength(1)

    // The bytes travel in `blobs`, not in the JSON.
    expect('bytes' in collected!.data.media[0]!).toBe(false)
    expect(collected!.data.media[0]!.file).toMatch(/^media\/.+\.png$/)
    expect(collected!.blobs.size).toBe(1)
  })

  it('returns nothing for a notebook that is not there', async () => {
    expect(await collectNotebook('nope', db)).toBeUndefined()
  })

  it('does not reach into another notebook', async () => {
    const a = await seed('Korean')
    await seed('Spanish')
    const collected = await collectNotebook(a.nb, db)
    expect(collected!.data.words).toHaveLength(1)
  })
})

describe('buildBundle', () => {
  it('writes one notebook when asked for one', async () => {
    const { nb } = await seed()
    await seed('Spanish')

    const built = await buildBundle(nb, db)
    expect(built).toBeDefined()
    expect(readBundle(built!.bytes).notebooks).toHaveLength(1)
    expect(built!.filename).toContain('시댁 한국어')
    expect(built!.filename.endsWith('.lljournal')).toBe(true)
  })

  it('writes the whole library when asked for nothing', async () => {
    await seed('Korean')
    await seed('Spanish')

    const built = await buildBundle(undefined, db)
    expect(readBundle(built!.bytes).notebooks).toHaveLength(2)
    expect(built!.filename).toContain('2 notebooks')
  })

  it('returns nothing when there is nothing to export', async () => {
    expect(await buildBundle(undefined, db)).toBeUndefined()
  })
})

describe('planImport', () => {
  it('reports what is in the file and what is already here', async () => {
    const { nb } = await seed()
    const built = await buildBundle(nb, db)

    const plan = await planImport(built!.bytes, db)
    expect(plan.notebooks).toHaveLength(1)
    expect(plan.notebooks[0]!.title).toBe('시댁 한국어')
    expect(plan.notebooks[0]!.entries).toBe(1)
    expect(plan.notebooks[0]!.words).toBe(1)
    // Exported from this very database, so of course it collides.
    expect(plan.notebooks[0]!.existing?.id).toBe(nb)
  })

  it('reports no collision against a database that has never seen it', async () => {
    const { nb } = await seed()
    const built = await buildBundle(nb, db)

    const fresh = new JournalDb(`test-${newId()}`)
    await fresh.open()
    const plan = await planImport(built!.bytes, fresh)
    expect(plan.notebooks[0]!.existing).toBeUndefined()
  })
})

describe('import into an empty database', () => {
  it('restores every record and the blob bytes', async () => {
    const { nb } = await seed()
    const before = await counts(nb)
    const built = await buildBundle(nb, db)

    const fresh = new JournalDb(`test-${newId()}`)
    await fresh.open()
    const plan = await planImport(built!.bytes, fresh)
    const [id] = await applyImport(plan, new Map([[nb, 'replace']]), fresh)

    expect(id).toBe(nb)
    expect((await fresh.notebooks.get(nb))?.title).toBe('시댁 한국어')

    const after = {
      entries: await fresh.entries.count(),
      attachments: await fresh.attachments.count(),
      media: await fresh.media.count(),
      words: await fresh.words.count(),
      sentences: await fresh.sentences.count(),
      encounters: await fresh.encounters.count(),
      wordInSentences: await fresh.wordInSentences.count(),
      practiceEvents: await fresh.practiceEvents.count(),
    }
    expect(after).toEqual(before)

    const media = await fresh.media.toCollection().first()
    expect(media!.bytes).toBeInstanceOf(Blob)
    expect([...new Uint8Array(await media!.bytes.arrayBuffer())]).toEqual([137, 80, 78, 71])
    expect(media!.mime).toBe('image/png')
  })
})

describe('new copy', () => {
  it('sits alongside the original with everything rewired', async () => {
    const original = await seed()
    const built = await buildBundle(original.nb, db)

    const plan = await planImport(built!.bytes, db)
    const [copyId] = await applyImport(plan, new Map([[original.nb, 'new copy']]), db)

    expect(copyId).toBeDefined()
    expect(copyId).not.toBe(original.nb)
    expect(await db.notebooks.count()).toBe(2)
    expect((await db.notebooks.get(copyId!))?.copiedFromId).toBe(original.nb)

    // Each notebook holds its own full set, and neither borrowed from the other.
    expect(await counts(copyId!)).toEqual(await counts(original.nb))

    // The copy's encounter points at the copy's word, not the original's.
    const copyWord = await db.words.where('notebookId').equals(copyId!).first()
    const copyEncounters = await db.encounters.where('notebookId').equals(copyId!).toArray()
    const wordEncounter = copyEncounters.find((e) => e.targetType === 'word')
    expect(wordEncounter!.targetId).toBe(copyWord!.id)
    expect(wordEncounter!.targetId).not.toBe(original.wordId)
  })

  it('duplicates the media bytes rather than sharing a row', async () => {
    const original = await seed()
    const built = await buildBundle(original.nb, db)
    const plan = await planImport(built!.bytes, db)
    const [copyId] = await applyImport(plan, new Map([[original.nb, 'new copy']]), db)

    expect(await db.media.count()).toBe(2)
    const copyMedia = await db.media.where('notebookId').equals(copyId!).first()
    expect([...new Uint8Array(await copyMedia!.bytes.arrayBuffer())]).toEqual([137, 80, 78, 71])

    const copyAttachment = await db.attachments
      .where('notebookId')
      .equals(copyId!)
      .and((a) => a.kind === 'image')
      .first()
    expect(copyAttachment!.mediaId).toBe(copyMedia!.id)
  })

  it('does not trip the one-encounter-per-entry index', async () => {
    // Both notebooks now hold an encounter for the same (entry, target) shape but different ids.
    const original = await seed()
    const built = await buildBundle(original.nb, db)
    const plan = await planImport(built!.bytes, db)
    await applyImport(plan, new Map([[original.nb, 'new copy']]), db)
    await applyImport(plan, new Map([[original.nb, 'new copy']]), db)

    expect(await db.notebooks.count()).toBe(3)
  })
})

describe('replace', () => {
  it('overwrites the local notebook rather than merging into it', async () => {
    const original = await seed()
    const built = await buildBundle(original.nb, db)

    // Diverge locally: a word the bundle has never heard of.
    await addWord({ notebookId: original.nb, term: '밑반찬', meaning: 'side dishes' }, db)
    expect(await db.words.where('notebookId').equals(original.nb).count()).toBe(2)

    const plan = await planImport(built!.bytes, db)
    await applyImport(plan, new Map([[original.nb, 'replace']]), db)

    // Back to one word. Replace is a whole-notebook overwrite, and the local edit is gone.
    const words = await db.words.where('notebookId').equals(original.nb).toArray()
    expect(words).toHaveLength(1)
    expect(words[0]!.term).toBe('수고하셨습니다')
    expect(await db.notebooks.count()).toBe(1)
  })

  it('leaves nothing behind from the notebook it replaced', async () => {
    const original = await seed()
    const built = await buildBundle(original.nb, db)

    const strayEntry = await createEntry(original.nb, { body: 'written after the export' }, db)
    const plan = await planImport(built!.bytes, db)
    await applyImport(plan, new Map([[original.nb, 'replace']]), db)

    expect(await db.entries.get(strayEntry.id)).toBeUndefined()
    expect(await db.media.count()).toBe(1)
  })

  it('does not touch another notebook', async () => {
    const a = await seed('Korean')
    const b = await seed('Spanish')
    const built = await buildBundle(a.nb, db)

    const plan = await planImport(built!.bytes, db)
    await applyImport(plan, new Map([[a.nb, 'replace']]), db)

    expect((await db.notebooks.get(b.nb))?.title).toBe('Spanish')
    expect(await db.words.where('notebookId').equals(b.nb).count()).toBe(1)
  })
})

describe('skip', () => {
  it('writes nothing', async () => {
    const original = await seed()
    const built = await buildBundle(original.nb, db)
    await addWord({ notebookId: original.nb, term: '밑반찬' }, db)

    const plan = await planImport(built!.bytes, db)
    const applied = await applyImport(plan, new Map([[original.nb, 'skip']]), db)

    expect(applied).toEqual([])
    expect(await db.words.where('notebookId').equals(original.nb).count()).toBe(2)
  })
})

describe('a whole library round trip', () => {
  it('carries two notebooks out and back independently', async () => {
    const a = await seed('Korean')
    const b = await seed('Spanish')
    const built = await buildBundle(undefined, db)

    const fresh = new JournalDb(`test-${newId()}`)
    await fresh.open()
    const plan = await planImport(built!.bytes, fresh)
    const applied = await applyImport(
      plan,
      new Map([
        [a.nb, 'replace'],
        [b.nb, 'replace'],
      ]),
      fresh,
    )

    expect(applied).toHaveLength(2)
    expect(await fresh.notebooks.count()).toBe(2)
    expect(await fresh.words.count()).toBe(2)
    expect(await fresh.media.count()).toBe(2)

    for (const t of ['Korean', 'Spanish']) {
      const nb = await fresh.notebooks.filter((n) => n.title === t).first()
      expect(nb).toBeDefined()
      expect(await fresh.words.where('notebookId').equals(nb!.id).count()).toBe(1)
    }
  })

  it('can mix resolutions in one file', async () => {
    const a = await seed('Korean')
    const b = await seed('Spanish')
    const built = await buildBundle(undefined, db)

    const plan = await planImport(built!.bytes, db)
    await applyImport(
      plan,
      new Map([
        [a.nb, 'new copy'],
        [b.nb, 'skip'],
      ]),
      db,
    )

    // Korean gained a copy, Spanish did not.
    expect(await db.notebooks.count()).toBe(3)
    expect(await db.notebooks.filter((n) => n.title === 'Korean').count()).toBe(2)
    expect(await db.notebooks.filter((n) => n.title === 'Spanish').count()).toBe(1)
  })
})

describe('applyNotebook defaults', () => {
  it('skips without a resolution rather than guessing', async () => {
    const { nb } = await seed()
    const collected = await collectNotebook(nb, db)
    expect(await applyNotebook(collected!, 'skip', db)).toBeUndefined()
  })
})

describe('noteExported', () => {
  it('records when the last export happened, which is what the eviction reminder reads', async () => {
    expect(await db.settings.get(SETTINGS_ID)).toBeUndefined()

    await noteExported(db)
    const settings = await db.settings.get(SETTINGS_ID)
    expect(settings?.lastExportedAt).toBeDefined()
    expect(Date.parse(settings!.lastExportedAt!)).not.toBeNaN()
  })

  it('does not take the API key with it', async () => {
    // `put` replaces the row outright, so this is the regression worth pinning down.
    await db.settings.put({ id: SETTINGS_ID, xaiKey: 'secret', meaningLanguage: 'English' })
    await noteExported(db)

    const settings = await db.settings.get(SETTINGS_ID)
    expect(settings?.xaiKey).toBe('secret')
    expect(settings?.meaningLanguage).toBe('English')
    expect(settings?.lastExportedAt).toBeDefined()
  })

  it('moves the timestamp forward on a second export', async () => {
    await noteExported(db)
    const first = (await db.settings.get(SETTINGS_ID))!.lastExportedAt!
    await new Promise((r) => setTimeout(r, 2))
    await noteExported(db)
    const second = (await db.settings.get(SETTINGS_ID))!.lastExportedAt!
    expect(second >= first).toBe(true)
  })
})
