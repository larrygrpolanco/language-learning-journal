import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb, newId, nowIso } from '../db/db'
import type { Notebook } from '../db/types'
import {
  addSentence,
  addWord,
  deleteEntry,
  deleteEntryPreview,
  deleteNotebook,
  encounter,
  localDayRange,
  pruneEntryIfEmpty,
  todayEntry,
} from './writes'

let db: JournalDb
let nb: Notebook

const makeNotebook = (language: string): Notebook => ({
  id: newId(),
  title: 't',
  language,
  createdAt: nowIso(),
  lastOpenedAt: nowIso(),
})

beforeEach(async () => {
  db = new JournalDb(`test-${newId()}`)
  await db.open()
  nb = makeNotebook('Korean')
  await db.notebooks.add(nb)
})

describe('localDayRange', () => {
  it('brackets the local day and sorts as ISO', () => {
    const [start, end] = localDayRange(new Date(2026, 8, 15, 13, 30))
    expect(start < end).toBe(true)
    expect(new Date(end).getTime() - new Date(start).getTime()).toBe(86_400_000)
  })
})

describe('todayEntry', () => {
  it('creates one entry and reuses it', async () => {
    const a = await todayEntry(nb.id, db)
    const b = await todayEntry(nb.id, db)
    expect(b.id).toBe(a.id)
    expect(await db.entries.count()).toBe(1)
  })

  it('ignores an activity entry and makes its own', async () => {
    const at = nowIso()
    await db.entries.add({
      id: newId(),
      notebookId: nb.id,
      date: at,
      body: 'a workbook session',
      origin: 'activity',
      createdAt: at,
      updatedAt: at,
    })
    const e = await todayEntry(nb.id, db)
    expect(e.origin).toBe('learner')
    expect(await db.entries.count()).toBe(2)
  })

  it('does not reach into another notebook', async () => {
    const other = makeNotebook('Spanish')
    await db.notebooks.add(other)
    const a = await todayEntry(nb.id, db)
    const b = await todayEntry(other.id, db)
    expect(b.id).not.toBe(a.id)
  })
})

describe('encounter', () => {
  it('links once per entry per target', async () => {
    const e = await todayEntry(nb.id, db)
    const first = await encounter(nb.id, e.id, 'word', 'w1', db)
    const second = await encounter(nb.id, e.id, 'word', 'w1', db)
    expect(second.id).toBe(first.id)
    expect(await db.encounters.count()).toBe(1)
  })

  it('links the same target again from a different entry', async () => {
    const a = await todayEntry(nb.id, db)
    const b = await db.entries.add({
      id: newId(),
      notebookId: nb.id,
      date: new Date(2026, 0, 1).toISOString(),
      body: 'earlier',
      origin: 'learner',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    await encounter(nb.id, a.id, 'word', 'w1', db)
    await encounter(nb.id, b, 'word', 'w1', db)
    expect(await db.encounters.count()).toBe(2)
  })
})

describe('addWord', () => {
  it('creates the word and links it to today', async () => {
    const r = await addWord({ notebookId: nb.id, term: '수고', meaning: 'effort' }, db)
    expect(r.created).toBe(true)
    expect(r.timesEncountered).toBe(1)
    expect(await db.entries.count()).toBe(1)
  })

  it('notices the same term again instead of duplicating it', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    const again = await addWord({ notebookId: nb.id, term: ' 수고 ' }, db)
    expect(again.created).toBe(false)
    expect(await db.words.count()).toBe(1)
  })

  it('does not inflate the count when added twice on one day', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    const again = await addWord({ notebookId: nb.id, term: '수고' }, db)
    expect(again.timesEncountered).toBe(1)
  })

  it('counts a second day as a second encounter', async () => {
    const first = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const yesterday = newId()
    await db.entries.add({
      id: yesterday,
      notebookId: nb.id,
      date: new Date(2026, 0, 1).toISOString(),
      body: 'earlier',
      origin: 'learner',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    const again = await addWord({ notebookId: nb.id, term: '수고', entryId: yesterday }, db)
    expect(again.wordId).toBe(first.wordId)
    expect(again.timesEncountered).toBe(2)
  })

  it('treats decomposed and composed Hangul as one word', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    const again = await addWord({ notebookId: nb.id, term: '수고'.normalize('NFD') }, db)
    expect(again.created).toBe(false)
    expect(await db.words.count()).toBe(1)
  })

  it('lets the same term live in two notebooks with different meanings', async () => {
    const other = makeNotebook('Spanish')
    await db.notebooks.add(other)
    await addWord({ notebookId: nb.id, term: 'interés', meaning: 'interest rate' }, db)
    const second = await addWord({ notebookId: other.id, term: 'interés', meaning: 'curiosity' }, db)
    expect(second.created).toBe(true)
    expect(await db.words.count()).toBe(2)
  })

  it('never clobbers a meaning the learner wrote', async () => {
    const first = await addWord({ notebookId: nb.id, term: '수고', meaning: 'effort' }, db)
    await addWord({ notebookId: nb.id, term: '수고', meaning: 'something else' }, db)
    expect((await db.words.get(first.wordId))?.meaning).toBe('effort')
  })

  it('fills a blank meaning on a later capture', async () => {
    const first = await addWord({ notebookId: nb.id, term: '수고' }, db)
    await addWord({ notebookId: nb.id, term: '수고', meaning: 'effort' }, db)
    expect((await db.words.get(first.wordId))?.meaning).toBe('effort')
  })

  it('refuses an empty term', async () => {
    await expect(addWord({ notebookId: nb.id, term: '   ' }, db)).rejects.toThrow()
  })
})

describe('addSentence', () => {
  it('links it to today and derives its word links', async () => {
    const w = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const s = await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    const links = await db.wordInSentences.where('sentenceId').equals(s).toArray()
    expect(links.map((l) => l.wordId)).toEqual([w.wordId])
    expect(links[0]?.source).toBe('derived')
  })

  it('defaults origin to encountered', async () => {
    const s = await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    expect((await db.sentences.get(s))?.origin).toBe('encountered')
  })

  it('keeps two records for the same line said twice', async () => {
    await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    expect(await db.sentences.count()).toBe(2)
  })

  it('omits an absent translation rather than storing undefined', async () => {
    const s = await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    expect('translation' in (await db.sentences.get(s))!).toBe(false)
  })
})

describe('pruneEntryIfEmpty', () => {
  it('deletes an entry with nothing in it', async () => {
    const e = await todayEntry(nb.id, db)
    expect(await pruneEntryIfEmpty(e.id, db)).toBe(true)
    expect(await db.entries.count()).toBe(0)
  })

  it('keeps an entry with a body', async () => {
    const e = await todayEntry(nb.id, db)
    await db.entries.update(e.id, { body: 'something' })
    expect(await pruneEntryIfEmpty(e.id, db)).toBe(false)
  })

  it('keeps an entry that a quick-added word is hanging off', async () => {
    const before = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const e = await todayEntry(nb.id, db)
    expect(await pruneEntryIfEmpty(e.id, db)).toBe(false)
    expect(await db.encounters.where('targetId').equals(before.wordId).count()).toBe(1)
  })

  it('keeps an entry that only has an attachment', async () => {
    const e = await todayEntry(nb.id, db)
    await db.attachments.add({
      id: newId(),
      notebookId: nb.id,
      entryId: e.id,
      kind: 'text',
      text: 'pasted',
      createdAt: nowIso(),
    })
    expect(await pruneEntryIfEmpty(e.id, db)).toBe(false)
  })
})

describe('deleteEntry', () => {
  it('names the words that would go with it', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    const e = await todayEntry(nb.id, db)
    const preview = await deleteEntryPreview(e.id, db)
    expect(preview.orphanedWords.map((w) => w.term)).toEqual(['수고'])
  })

  it('leaves a word alone when another entry also has it', async () => {
    const w = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const older = newId()
    await db.entries.add({
      id: older,
      notebookId: nb.id,
      date: new Date(2026, 0, 1).toISOString(),
      body: 'earlier',
      origin: 'learner',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    })
    await addWord({ notebookId: nb.id, term: '수고', entryId: older }, db)

    const today = await todayEntry(nb.id, db)
    expect((await deleteEntryPreview(today.id, db)).orphanedWords).toEqual([])

    await deleteEntry(today.id, db)
    expect(await db.words.get(w.wordId)).toBeDefined()
    expect(await db.encounters.where('targetId').equals(w.wordId).count()).toBe(1)
  })

  it('takes attachments, media, encounters and orphans with it', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    const e = await todayEntry(nb.id, db)

    const mediaId = newId()
    await db.media.add({ id: mediaId, notebookId: nb.id, mime: 'image/png', bytes: new Blob(['x']) })
    await db.attachments.add({
      id: newId(),
      notebookId: nb.id,
      entryId: e.id,
      kind: 'image',
      mediaId,
      createdAt: nowIso(),
    })

    await deleteEntry(e.id, db)

    expect(await db.entries.count()).toBe(0)
    expect(await db.attachments.count()).toBe(0)
    expect(await db.media.count()).toBe(0)
    expect(await db.encounters.count()).toBe(0)
    expect(await db.words.count()).toBe(0)
    expect(await db.sentences.count()).toBe(0)
    expect(await db.wordInSentences.count()).toBe(0)
  })
})

describe('deleteNotebook', () => {
  it('leaves nothing behind, which is what import-Replace needs', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    await db.media.add({ id: newId(), notebookId: nb.id, mime: 'image/png', bytes: new Blob(['x']) })
    await db.practiceEvents.add({
      id: newId(),
      notebookId: nb.id,
      workbookId: 'word-drill',
      targetType: 'word',
      targetId: 'w1',
      outcome: 'right',
      at: nowIso(),
    })

    const other = makeNotebook('Spanish')
    await db.notebooks.add(other)
    await addWord({ notebookId: other.id, term: 'interés' }, db)

    await deleteNotebook(nb.id, db)

    for (const t of [
      db.entries,
      db.attachments,
      db.media,
      db.sentences,
      db.encounters,
      db.wordInSentences,
      db.practiceEvents,
      db.sessions,
      db.proposals,
    ]) {
      expect(await t.where('notebookId').equals(nb.id).count()).toBe(0)
    }
    expect(await db.notebooks.get(nb.id)).toBeUndefined()

    // The other notebook is untouched. The notebook is the boundary.
    expect(await db.words.count()).toBe(1)
    expect(await db.entries.where('notebookId').equals(other.id).count()).toBe(1)
  })
})
