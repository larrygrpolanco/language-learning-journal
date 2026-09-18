import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb, newId, nowIso } from '../db/db'
import type { Notebook } from '../db/types'
import {
  addSentence,
  addWord,
  deleteEntry,
  deleteEntryPreview,
  deleteNotebook,
  deleteSentence,
  deleteWord,
  encounter,
  localDayRange,
  pruneEntryIfEmpty,
  setItemAudio,
  todayEntry,
  updateSentence,
  updateWord,
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

describe('updateSentence', () => {
  it('rewrites the text and re-derives the word links', async () => {
    const kept = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const gone = await addWord({ notebookId: nb.id, term: '그릇' }, db)
    const s = await addSentence({ notebookId: nb.id, text: '그릇 좀 주세요.' }, db)
    expect((await db.wordInSentences.where('sentenceId').equals(s).toArray()).length).toBe(1)

    await updateSentence(s, { text: '오늘 수고하셨습니다.' }, db)

    const links = await db.wordInSentences.where('sentenceId').equals(s).toArray()
    expect(links.map((l) => l.wordId)).toEqual([kept.wordId])
    expect(links.some((l) => l.wordId === gone.wordId)).toBe(false)
  })

  it('leaves a manual link alone when the text changes', async () => {
    const w = await addWord({ notebookId: nb.id, term: '그릇' }, db)
    const s = await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    await db.wordInSentences.add({
      id: newId(),
      notebookId: nb.id,
      wordId: w.wordId,
      sentenceId: s,
      source: 'manual',
    })
    await updateSentence(s, { text: '내일' }, db)
    expect(await db.wordInSentences.where('sentenceId').equals(s).count()).toBe(1)
  })

  it('clears a translation rather than storing an empty string', async () => {
    const s = await addSentence({ notebookId: nb.id, text: '오늘', translation: 'today' }, db)
    await updateSentence(s, { translation: '  ' }, db)
    expect('translation' in (await db.sentences.get(s))!).toBe(false)
  })

  it('refuses to blank the text', async () => {
    const s = await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    await updateSentence(s, { text: '   ' }, db)
    expect((await db.sentences.get(s))?.text).toBe('오늘')
  })
})

describe('deleteSentence', () => {
  it('takes its encounters and word links with it', async () => {
    await addWord({ notebookId: nb.id, term: '수고' }, db)
    const s = await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    await deleteSentence(s, db)
    expect(await db.sentences.get(s)).toBeUndefined()
    expect(await db.encounters.where('targetId').equals(s).count()).toBe(0)
    expect(await db.wordInSentences.where('sentenceId').equals(s).count()).toBe(0)
  })

  it('leaves the words it mentioned alone', async () => {
    const w = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const s = await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    await deleteSentence(s, db)
    expect(await db.words.get(w.wordId)).toBeDefined()
  })

  it('prunes an entry it was the only thing in', async () => {
    const s = await addSentence({ notebookId: nb.id, text: '오늘' }, db)
    expect(await db.entries.count()).toBe(1)
    await deleteSentence(s, db)
    expect(await db.entries.count()).toBe(0)
  })

  it('keeps an entry that still has a body', async () => {
    const e = await todayEntry(nb.id, db)
    await db.entries.update(e.id, { body: 'a real entry' })
    const s = await addSentence({ notebookId: nb.id, text: '오늘', entryId: e.id }, db)
    await deleteSentence(s, db)
    expect(await db.entries.get(e.id)).toBeDefined()
  })
})

describe('deleteWord', () => {
  it('takes its encounters and sentence links with it', async () => {
    const w = await addWord({ notebookId: nb.id, term: '수고' }, db)
    await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    await deleteWord(w.wordId, db)
    expect(await db.words.get(w.wordId)).toBeUndefined()
    expect(await db.encounters.where('targetId').equals(w.wordId).count()).toBe(0)
    expect(await db.wordInSentences.where('wordId').equals(w.wordId).count()).toBe(0)
  })

  it('leaves the sentences it appeared in alone', async () => {
    const w = await addWord({ notebookId: nb.id, term: '수고' }, db)
    const s = await addSentence({ notebookId: nb.id, text: '오늘 수고하셨습니다.' }, db)
    await deleteWord(w.wordId, db)
    expect(await db.sentences.get(s)).toBeDefined()
  })

  it('prunes an entry it was the only thing in', async () => {
    const w = await addWord({ notebookId: nb.id, term: '수고' }, db)
    expect(await db.entries.count()).toBe(1)
    await deleteWord(w.wordId, db)
    expect(await db.entries.count()).toBe(0)
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

describe('kept audio', () => {
  const clip = (tag = 'mp3') => new Blob([tag], { type: 'audio/mpeg' })

  const wordWithClip = async (term = '그릇') => {
    const { wordId } = await addWord({ notebookId: nb.id, term }, db)
    await setItemAudio({ type: 'word', id: wordId }, clip(), 'eve', db)
    return wordId
  }

  const sentenceWithClip = async (text = '그릇을 치웠어요.') => {
    const sentenceId = await addSentence({ notebookId: nb.id, text }, db)
    await setItemAudio({ type: 'sentence', id: sentenceId }, clip(), 'eve', db)
    return sentenceId
  }

  it('links the clip to the word and records the voice it was spoken in', async () => {
    const wordId = await wordWithClip()

    const word = await db.words.get(wordId)
    expect(word?.audioMediaId).toBeDefined()

    const media = await db.media.get(word!.audioMediaId!)
    expect(media?.voice).toBe('eve')
    expect(media?.mime).toBe('audio/mpeg')
    // Scoped to the notebook, which is what makes the cascade and the export walk find it.
    expect(media?.notebookId).toBe(nb.id)
  })

  it('carries no attachment, because the clip belongs to the term and not to an entry', async () => {
    await wordWithClip()
    expect(await db.attachments.count()).toBe(0)
  })

  it('replacing drops the clip it supersedes rather than leaving it orphaned', async () => {
    const wordId = await wordWithClip()
    const first = (await db.words.get(wordId))!.audioMediaId

    await setItemAudio({ type: 'word', id: wordId }, clip('again'), 'eve', db)
    const second = (await db.words.get(wordId))!.audioMediaId

    expect(second).not.toBe(first)
    expect(await db.media.get(first!)).toBeUndefined()
    expect(await db.media.count()).toBe(1)
  })

  it('renaming a term drops its clip, which spoke the old one', async () => {
    const wordId = await wordWithClip('그릇')
    await updateWord(wordId, { term: '접시' }, db)

    expect((await db.words.get(wordId))?.audioMediaId).toBeUndefined()
    expect(await db.media.count()).toBe(0)
  })

  it('a change of case alone still drops it, since the clip is of what is written', async () => {
    const { wordId } = await addWord({ notebookId: nb.id, term: 'seoul' }, db)
    await setItemAudio({ type: 'word', id: wordId }, clip(), 'eve', db)

    await updateWord(wordId, { term: 'Seoul' }, db)

    // termKey is unchanged here, so comparing on that would have kept a clip saying the old thing.
    expect((await db.words.get(wordId))?.audioMediaId).toBeUndefined()
    expect(await db.media.count()).toBe(0)
  })

  it('editing a meaning leaves the clip alone, because the term still sounds the same', async () => {
    const wordId = await wordWithClip()
    await updateWord(wordId, { meaning: 'a bowl' }, db)

    expect((await db.words.get(wordId))?.audioMediaId).toBeDefined()
    expect(await db.media.count()).toBe(1)
  })

  it('editing a sentence drops its clip', async () => {
    const sentenceId = await sentenceWithClip()
    await updateSentence(sentenceId, { text: '그릇을 치웠습니다.' }, db)

    expect((await db.sentences.get(sentenceId))?.audioMediaId).toBeUndefined()
    expect(await db.media.count()).toBe(0)
  })

  it('changing only a sentence translation leaves the clip alone', async () => {
    const sentenceId = await sentenceWithClip()
    await updateSentence(sentenceId, { translation: 'I cleared the dishes' }, db)

    expect((await db.sentences.get(sentenceId))?.audioMediaId).toBeDefined()
    expect(await db.media.count()).toBe(1)
  })

  it('deleting a word takes its clip', async () => {
    await wordWithClip()
    await deleteWord((await db.words.toCollection().first())!.id, db)
    expect(await db.media.count()).toBe(0)
  })

  it('deleting a sentence takes its clip', async () => {
    const sentenceId = await sentenceWithClip()
    await deleteSentence(sentenceId, db)
    expect(await db.media.count()).toBe(0)
  })

  it('deleting the notebook takes every clip, which import-Replace depends on', async () => {
    await wordWithClip()
    await sentenceWithClip()
    expect(await db.media.count()).toBe(2)

    await deleteNotebook(nb.id, db)
    expect(await db.media.count()).toBe(0)
  })
})
