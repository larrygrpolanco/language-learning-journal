import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  BundleError,
  bundleFilename,
  extForMime,
  FORMAT,
  FORMAT_VERSION,
  readBundle,
  slugify,
  slugsFor,
  withFreshIds,
  writeBundle,
  type NotebookBundle,
  type NotebookData,
} from './bundle'
import { renderReadable } from './readable'

const iso = '2026-09-15T12:00:00.000Z'

/** A notebook exercising every table and both polymorphic target types. */
const fixture = (): NotebookBundle => {
  const data: NotebookData = {
    notebook: {
      id: 'nb1',
      title: '시댁 한국어',
      language: 'Korean',
      focus: "Talking with my wife's parents",
      meaningLanguage: 'English',
      createdAt: iso,
      lastOpenedAt: iso,
    },
    entries: [
      {
        id: 'e1',
        notebookId: 'nb1',
        date: iso,
        body: 'Finally understood 수고하셨습니다.',
        title: 'Two hours at the kitchen table',
        source: 'dinner with in-laws',
        origin: 'learner',
        createdAt: iso,
        updatedAt: iso,
      },
      {
        id: 'e2',
        notebookId: 'nb1',
        date: '2026-08-29T12:00:00.000Z',
        body: 'Helping clear the table.',
        origin: 'learner',
        createdAt: iso,
        updatedAt: iso,
      },
    ],
    attachments: [
      {
        id: 'a1',
        notebookId: 'nb1',
        entryId: 'e1',
        kind: 'image',
        mediaId: 'm1',
        filename: 'page.png',
        createdAt: iso,
      },
      {
        id: 'a2',
        notebookId: 'nb1',
        entryId: 'e1',
        kind: 'text',
        text: 'pasted from the textbook',
        createdAt: iso,
      },
    ],
    media: [
      { id: 'm1', notebookId: 'nb1', mime: 'image/png', width: 4, height: 2, file: 'media/m1.png' },
      { id: 'm2', notebookId: 'nb1', mime: 'audio/mpeg', voice: 'eve', file: 'media/m2.mp3' },
      { id: 'm3', notebookId: 'nb1', mime: 'audio/mpeg', voice: 'eve', file: 'media/m3.mp3' },
    ],
    words: [
      { id: 'w1', notebookId: 'nb1', term: '수고하셨습니다', termKey: '수고하셨습니다', meaning: 'thanks for your effort', audioMediaId: 'm2', createdAt: iso, updatedAt: iso },
      { id: 'w2', notebookId: 'nb1', term: '밑반찬', termKey: '밑반찬', familiarity: 'got it', createdAt: iso, updatedAt: iso },
    ],
    sentences: [
      { id: 's1', notebookId: 'nb1', text: '오늘 수고하셨습니다.', translation: 'you worked hard today', audioMediaId: 'm3', createdAt: iso },
      { id: 's2', notebookId: 'nb1', text: '저는 매운 거 잘 먹어요', createdAt: iso },
      { id: 's3', notebookId: 'nb1', text: '저는 매운 것을 잘 먹어요', createdAt: iso },
    ],
    encounters: [
      { id: 'c1', notebookId: 'nb1', entryId: 'e1', targetType: 'word', targetId: 'w1', createdAt: iso },
      { id: 'c2', notebookId: 'nb1', entryId: 'e2', targetType: 'word', targetId: 'w1', createdAt: iso },
      { id: 'c3', notebookId: 'nb1', entryId: 'e1', targetType: 'sentence', targetId: 's1', createdAt: iso },
    ],
    wordInSentences: [{ id: 'l1', notebookId: 'nb1', wordId: 'w1', sentenceId: 's1', source: 'derived' }],
    practiceEvents: [
      { id: 'p1', notebookId: 'nb1', workbookId: 'word-drill', targetType: 'word', targetId: 'w1', outcome: 'right', at: iso },
      { id: 'p2', notebookId: 'nb1', workbookId: 'word-drill', targetType: 'sentence', targetId: 's1', outcome: 'shown', at: iso },
    ],
  }

  // Four PNG-ish bytes. Content is what matters, not validity.
  const blobs = new Map([
    ['m1', new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' })],
    ['m2', new Blob(['kept clip of the word'], { type: 'audio/mpeg' })],
    ['m3', new Blob(['kept clip of the sentence'], { type: 'audio/mpeg' })],
  ])
  return { data, blobs }
}

const write = (nb: NotebookBundle) =>
  writeBundle([nb], { app: 'test', exportedAt: iso, readable: (d) => renderReadable(d, new Date(iso)) })

describe('slugify', () => {
  it('keeps unicode so a Korean title does not slug to nothing', () => {
    expect(slugify('시댁 한국어')).toBe('시댁-한국어')
  })

  it('strips characters a filesystem will not take', () => {
    expect(slugify('Spanish: economics / travel?')).toBe('Spanish-economics-travel')
  })

  it('returns empty for a title with nothing usable, so the caller can fall back to the id', () => {
    expect(slugify('///')).toBe('')
    expect(slugify('   ')).toBe('')
  })
})

describe('slugsFor', () => {
  it('disambiguates two notebooks with the same title', () => {
    const slugs = slugsFor([
      { id: 'a', title: 'Korean' },
      { id: 'b', title: 'Korean' },
      { id: 'c', title: 'Korean' },
    ])
    expect([...slugs.values()]).toEqual(['Korean', 'Korean-2', 'Korean-3'])
  })

  it('falls back to the id when a title slugs to nothing', () => {
    const slugs = slugsFor([{ id: 'abc123', title: '???' }])
    expect(slugs.get('abc123')).toBe('abc123')
  })
})

describe('extForMime', () => {
  it('maps what the app can actually attach', () => {
    expect(extForMime('image/png')).toBe('png')
    expect(extForMime('image/jpeg')).toBe('jpg')
    expect(extForMime('application/pdf')).toBe('pdf')
    expect(extForMime('IMAGE/PNG')).toBe('png')
  })

  it('falls back rather than inventing an extension', () => {
    expect(extForMime('application/x-nonsense')).toBe('bin')
  })
})

describe('round trip', () => {
  it('survives write then read with every record intact', async () => {
    const original = fixture()
    const back = readBundle(await write(original))

    expect(back.manifest.format).toBe(FORMAT)
    expect(back.manifest.version).toBe(FORMAT_VERSION)
    expect(back.notebooks).toHaveLength(1)

    const { data } = back.notebooks[0]!
    expect(data).toEqual(original.data)
  })

  it('keeps the row count of every table', async () => {
    const original = fixture()
    const { data } = readBundle(await write(original)).notebooks[0]!

    for (const table of [
      'entries',
      'attachments',
      'media',
      'words',
      'sentences',
      'encounters',
      'wordInSentences',
      'practiceEvents',
    ] as const) {
      expect(data[table]).toHaveLength(original.data[table].length)
    }
  })

  it('returns the blob bytes unchanged', async () => {
    const original = fixture()
    const back = readBundle(await write(original))
    const blob = back.notebooks[0]!.blobs.get('m1')

    expect(blob).toBeDefined()
    expect(blob!.type).toBe('image/png')
    expect([...new Uint8Array(await blob!.arrayBuffer())]).toEqual([137, 80, 78, 71])
  })

  it('preserves an absent optional rather than turning it into null', async () => {
    const { data } = readBundle(await write(fixture())).notebooks[0]!
    const e2 = data.entries.find((e) => e.id === 'e2')!
    expect('title' in e2).toBe(false)
    expect('source' in e2).toBe(false)
  })

  it('keeps Hangul intact through the zip', async () => {
    const { data } = readBundle(await write(fixture())).notebooks[0]!
    expect(data.notebook.title).toBe('시댁 한국어')
    expect(data.words.find((w) => w.id === 'w1')!.term).toBe('수고하셨습니다')
  })

  it('writes a readable copy and ignores it on the way back in', async () => {
    const bytes = await write(fixture())
    const text = new TextDecoder().decode(bytes)
    expect(text).toContain('readable/')
    // The readable file is output only. Reading the bundle yields exactly one notebook, not two.
    expect(readBundle(bytes).notebooks).toHaveLength(1)
  })
})

describe('readBundle refusals', () => {
  it('refuses something that is not a zip', () => {
    expect(() => readBundle(new Uint8Array([1, 2, 3]))).toThrow(BundleError)
  })

  it('refuses a zip with no manifest', () => {
    const bytes = zipSync({ 'notes.txt': strToU8('hello') })
    expect(() => readBundle(bytes)).toThrow(/No manifest/)
  })

  it('refuses a bundle written by a different app', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: 'something-else', version: 1 })),
    })
    expect(() => readBundle(bytes)).toThrow(/different app/)
  })

  it('refuses a future format version rather than guessing', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: FORMAT, version: 99, exportedAt: iso, app: 'x' })),
    })
    expect(() => readBundle(bytes)).toThrow(/understands up to 1/)
  })

  it('accepts the current version', async () => {
    const bytes = await write(fixture())
    expect(() => readBundle(bytes)).not.toThrow()
  })

  it('refuses a bundle that holds no notebooks', () => {
    const bytes = zipSync({
      'manifest.json': strToU8(JSON.stringify({ format: FORMAT, version: 1, exportedAt: iso, app: 'x' })),
    })
    expect(() => readBundle(bytes)).toThrow(/no notebooks/)
  })
})

describe('withFreshIds', () => {
  const freshIds = () => {
    let n = 0
    return () => `new${++n}`
  }

  it('rewrites every id', () => {
    const copy = withFreshIds(fixture(), freshIds())
    const { data } = copy

    expect(data.notebook.id).not.toBe('nb1')
    for (const row of [
      ...data.entries,
      ...data.attachments,
      ...data.media,
      ...data.words,
      ...data.sentences,
      ...data.encounters,
      ...data.wordInSentences,
      ...data.practiceEvents,
    ]) {
      expect(row.id.startsWith('new')).toBe(true)
      expect(row.notebookId).toBe(data.notebook.id)
    }
  })

  it('rewires an encounter to the right table for its target type', () => {
    const { data } = withFreshIds(fixture(), freshIds())

    const wordId = data.words.find((w) => w.term === '수고하셨습니다')!.id
    const sentenceId = data.sentences.find((s) => s.text === '오늘 수고하셨습니다.')!.id

    const wordEncounters = data.encounters.filter((e) => e.targetType === 'word')
    expect(wordEncounters.every((e) => e.targetId === wordId)).toBe(true)

    const sentenceEncounters = data.encounters.filter((e) => e.targetType === 'sentence')
    expect(sentenceEncounters.every((e) => e.targetId === sentenceId)).toBe(true)
  })

  it('does the same for practice events, which are polymorphic too', () => {
    const { data } = withFreshIds(fixture(), freshIds())
    const wordId = data.words.find((w) => w.term === '수고하셨습니다')!.id
    const sentenceId = data.sentences.find((s) => s.text === '오늘 수고하셨습니다.')!.id

    expect(data.practiceEvents.find((p) => p.targetType === 'word')!.targetId).toBe(wordId)
    expect(data.practiceEvents.find((p) => p.targetType === 'sentence')!.targetId).toBe(sentenceId)
  })

  it('keeps an attachment pointing at its media, and the media at its bytes', () => {
    const original = fixture()
    const copy = withFreshIds(original, freshIds())

    const attachment = copy.data.attachments.find((a) => a.kind === 'image')!
    const media = copy.data.media.find((m) => m.id === attachment.mediaId)
    expect(media).toBeDefined()
    expect(copy.blobs.get(media!.id)).toBe(original.blobs.get('m1'))
    expect(media!.file).toBe(`media/${media!.id}.png`)
  })

  it('keeps the word to sentence link joined to both ends', () => {
    const { data } = withFreshIds(fixture(), freshIds())
    const link = data.wordInSentences[0]!
    expect(data.words.some((w) => w.id === link.wordId)).toBe(true)
    expect(data.sentences.some((s) => s.id === link.sentenceId)).toBe(true)
  })

  it('records where the copy came from', () => {
    const { data } = withFreshIds(fixture(), freshIds())
    expect(data.notebook.copiedFromId).toBe('nb1')
  })

  it('leaves no reference pointing at an id that is no longer there', () => {
    const { data } = withFreshIds(fixture(), freshIds())
    const known = new Set([
      data.notebook.id,
      ...data.entries.map((r) => r.id),
      ...data.attachments.map((r) => r.id),
      ...data.media.map((r) => r.id),
      ...data.words.map((r) => r.id),
      ...data.sentences.map((r) => r.id),
    ])

    for (const a of data.attachments) {
      expect(known.has(a.entryId)).toBe(true)
      if (a.mediaId) expect(known.has(a.mediaId)).toBe(true)
    }
    for (const e of data.encounters) {
      expect(known.has(e.entryId)).toBe(true)
      expect(known.has(e.targetId)).toBe(true)
    }
    for (const l of data.wordInSentences) {
      expect(known.has(l.wordId)).toBe(true)
      expect(known.has(l.sentenceId)).toBe(true)
    }
    for (const p of data.practiceEvents) expect(known.has(p.targetId)).toBe(true)
    for (const w of data.words) if (w.audioMediaId) expect(known.has(w.audioMediaId)).toBe(true)
    for (const s of data.sentences) if (s.audioMediaId) expect(known.has(s.audioMediaId)).toBe(true)
  })

  it('keeps a kept clip pointing at the copy media, not the original', () => {
    const original = fixture()
    const copy = withFreshIds(original, freshIds())

    const word = copy.data.words.find((w) => w.audioMediaId !== undefined)!
    const sentence = copy.data.sentences.find((s) => s.audioMediaId !== undefined)!

    // The tell for the bug this guards: an un-remapped pointer still reads 'm2' and would resolve in
    // the original notebook, so the copy would play the right audio off the wrong record.
    expect(word.audioMediaId).not.toBe('m2')
    expect(sentence.audioMediaId).not.toBe('m3')

    expect(copy.blobs.get(word.audioMediaId!)).toBe(original.blobs.get('m2'))
    expect(copy.blobs.get(sentence.audioMediaId!)).toBe(original.blobs.get('m3'))
  })
})

describe('renderReadable', () => {
  const md = () => renderReadable(fixture().data, new Date(iso))

  it('leads with the notebook and its profile', () => {
    expect(md()).toContain('# 시댁 한국어')
    expect(md()).toContain("Korean · Talking with my wife's parents")
  })

  it('puts entries newest first', () => {
    const text = md()
    expect(text.indexOf('Two hours at the kitchen table')).toBeLessThan(
      text.indexOf('Helping clear the table'),
    )
  })

  it('nests the words and sentences of each entry under it', () => {
    const text = md()
    expect(text).toContain('- 수고하셨습니다 — thanks for your effort')
    expect(text).toContain('- 오늘 수고하셨습니다. — *you worked hard today*')
  })

  it('marks a sentence that is not simply encountered', () => {
    expect(renderReadable(fixture().data, new Date(iso))).not.toContain('[encountered]')
  })

  it('names the media file so the bytes can be found by hand', () => {
    expect(md()).toContain('media/m1.png')
  })

  it('includes pasted text rather than only naming it', () => {
    expect(md()).toContain('pasted from the textbook')
  })

  it('lists a word that no entry ever mentioned, so nothing is lost', () => {
    // 밑반찬 has no encounter in the fixture.
    expect(md()).toContain('## Words with no entry')
    expect(md()).toContain('- 밑반찬')
  })

  it('escapes prose that would otherwise become Markdown syntax', () => {
    const data = fixture().data
    data.entries[0]!.body = '# not a heading\n- not a list'
    const text = renderReadable(data, new Date(iso))
    expect(text).toContain('\\# not a heading')
    expect(text).toContain('\\- not a list')
  })
})

describe('bundleFilename', () => {
  it('names the file after the notebook and the day', () => {
    expect(bundleFilename('시댁 한국어', new Date(iso))).toBe('시댁 한국어 · 15 Sep 2026.lljournal')
  })

  it('strips characters a filesystem will not take', () => {
    expect(bundleFilename('a/b:c', new Date(iso))).toBe('a b c · 15 Sep 2026.lljournal')
  })
})
