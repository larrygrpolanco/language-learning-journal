import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb } from '../db/db'
import { buildContext, focusCandidates, selectSentences, selectWords } from './context'
import type { BundledSentence, BundledWord } from './sdk'
import type { Familiarity, Word, WorkbookScope } from '../db/types'

/**
 * `buildContext` against fixed fixtures for each `BundleRequest` shape. Owed by the plan.
 *
 * The selection rules are the part worth testing: a workbook asking for "14 recent words" and quietly
 * getting the whole notebook, or getting them in a biased order, is wrong in a way nobody notices by
 * using the app. The pure functions are tested directly, then one pass through the database confirms
 * the wiring.
 */

const NOW = new Date('2026-09-15T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const bundled = (
  term: string,
  familiarity: Familiarity,
  lastSeen?: string,
  lastPracticed?: string,
  focus = false,
): BundledWord => ({
  word: {
    id: `w-${term}`,
    notebookId: 'nb',
    term,
    termKey: term,
    createdAt: daysAgo(90),
    updatedAt: daysAgo(90),
  },
  signals: {
    timesEncountered: 3,
    familiarity,
    familiarityIsEstimate: true,
    ...(lastSeen !== undefined ? { lastSeen, firstSeen: lastSeen } : {}),
    ...(lastPracticed !== undefined ? { lastPracticed } : {}),
  },
  focus,
})

describe('selectWords', () => {
  const rows = [
    bundled('old', 'new', daysAgo(40)),
    bundled('mid', 'getting it', daysAgo(10), daysAgo(9)),
    bundled('fresh', 'got it', daysAgo(1), daysAgo(30)),
    bundled('never', 'new'),
  ]

  it('orders most recently met first by default, with a never-met word last', () => {
    expect(selectWords(rows, {}, NOW).map((r) => r.word.term)).toEqual([
      'fresh',
      'mid',
      'old',
      'never',
    ])
  })

  it('honours a limit', () => {
    expect(selectWords(rows, { limit: 2 }, NOW).map((r) => r.word.term)).toEqual(['fresh', 'mid'])
  })

  it('treats a limit of zero as none, not as unlimited', () => {
    expect(selectWords(rows, { limit: 0 }, NOW)).toEqual([])
  })

  it('filters by familiarity', () => {
    const out = selectWords(rows, { familiarity: ['new'] }, NOW)
    expect(out.map((r) => r.word.term)).toEqual(['old', 'never'])
  })

  it('filters by recentDays and drops a word never met', () => {
    const out = selectWords(rows, { recentDays: 14 }, NOW)
    expect(out.map((r) => r.word.term)).toEqual(['fresh', 'mid'])
  })

  it('puts never-practised words first under least-practiced', () => {
    const out = selectWords(rows, { order: 'least-practiced' }, NOW)
    // 'never' and 'old' have no practice event, so they lead, then oldest practice first.
    expect(out.map((r) => r.word.term)).toEqual(['never', 'old', 'fresh', 'mid'])
  })

  it('shuffles without dropping or duplicating anything', () => {
    // A fixed generator, so this asserts a permutation rather than a particular order.
    let i = 0
    const rng = () => [0.9, 0.1, 0.7, 0.3][i++ % 4]!
    const out = selectWords(rows, { order: 'random' }, NOW, rng)
    expect(out).toHaveLength(rows.length)
    expect([...out.map((r) => r.word.term)].sort()).toEqual(['fresh', 'mid', 'never', 'old'])
  })

  it('does not mutate what it was given', () => {
    const before = rows.map((r) => r.word.term)
    selectWords(rows, { order: 'random' }, NOW, () => 0.5)
    selectWords(rows, { order: 'least-practiced' }, NOW)
    expect(rows.map((r) => r.word.term)).toEqual(before)
  })
})

/**
 * Focus. The rule that costs the most if it is wrong, because getting it wrong is silent: the words
 * the learner chose simply are not in the exercise and nothing says why.
 */
describe('selectWords with a focus', () => {
  it('puts focus first, whatever the order would otherwise have said', () => {
    const rows = [
      bundled('fresh', 'got it', daysAgo(1)),
      bundled('mid', 'getting it', daysAgo(10)),
      // Least recently met, so 'recent' would sort it last.
      bundled('picked', 'new', daysAgo(300), undefined, true),
    ]
    expect(selectWords(rows, { order: 'recent' }, NOW).map((r) => r.word.term)).toEqual([
      'picked',
      'fresh',
      'mid',
    ])
  })

  it('exempts focus from recentDays, which is what makes focusing an old entry work', () => {
    const rows = [
      bundled('fresh', 'got it', daysAgo(1)),
      bundled('ancient', 'new', daysAgo(240), undefined, true),
    ]
    // Word drill asks for the last 60 days. Without the exemption, focusing an entry from eight
    // months ago would filter the chosen word straight back out.
    const out = selectWords(rows, { recentDays: 60 }, NOW)
    expect(out.map((r) => r.word.term)).toEqual(['ancient', 'fresh'])
  })

  it('exempts focus from a familiarity filter too', () => {
    const rows = [
      bundled('newish', 'new', daysAgo(2)),
      bundled('known', 'got it', daysAgo(2), undefined, true),
    ]
    expect(selectWords(rows, { familiarity: ['new'] }, NOW).map((r) => r.word.term)).toEqual([
      'known',
      'newish',
    ])
  })

  it('spends the limit on focus before any background', () => {
    const focus = ['a', 'b', 'c'].map((t) => bundled(t, 'new', daysAgo(5), undefined, true))
    const background = ['x', 'y'].map((t) => bundled(t, 'new', daysAgo(1)))
    const out = selectWords([...background, ...focus], { limit: 3, order: 'recent' }, NOW)
    expect([...out.map((r) => r.word.term)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('fills the rest of the limit with background, since focus is a priority not a restriction', () => {
    const rows = [
      bundled('picked', 'new', daysAgo(200), undefined, true),
      bundled('fresh', 'got it', daysAgo(1)),
      bundled('mid', 'getting it', daysAgo(10)),
    ]
    expect(selectWords(rows, { limit: 2, order: 'recent' }, NOW).map((r) => r.word.term)).toEqual([
      'picked',
      'fresh',
    ])
  })

  it('shuffles inside each group rather than across them', () => {
    const rows = [
      bundled('x', 'new', daysAgo(1)),
      bundled('y', 'new', daysAgo(2)),
      bundled('picked', 'new', daysAgo(3), undefined, true),
    ]
    let i = 0
    const rng = () => [0.9, 0.1, 0.7, 0.3][i++ % 4]!
    expect(selectWords(rows, { order: 'random' }, NOW, rng)[0]?.word.term).toBe('picked')
  })
})

describe('selectSentences', () => {
  const sentence = (id: string, days: number, focus = false): BundledSentence => ({
    sentence: {
      id,
      notebookId: 'nb',
      text: `line ${id}`,
      createdAt: daysAgo(days),
    },
    focus,
  })

  const rows = [sentence('a', 30), sentence('b', 5), sentence('c', 1)]

  it('returns newest first', () => {
    expect(selectSentences(rows, {}).map((s) => s.sentence.id)).toEqual(['c', 'b', 'a'])
  })

  it('honours a limit after ordering', () => {
    expect(selectSentences(rows, { limit: 1 }).map((s) => s.sentence.id)).toEqual(['c'])
  })

  it('puts focus first and keeps it under a limit', () => {
    const withFocus = [sentence('a', 30, true), sentence('b', 5), sentence('c', 1)]
    expect(selectSentences(withFocus, { limit: 2 }).map((s) => s.sentence.id)).toEqual(['a', 'c'])
  })
})

/* ── through the database ─────────────────────────────────────────────────── */

let d: JournalDb
let counter = 0

const word = (id: string, term: string): Word => ({
  id,
  notebookId: 'nb',
  term,
  termKey: term,
  createdAt: daysAgo(20),
  updatedAt: daysAgo(20),
})

beforeEach(async () => {
  counter += 1
  d = new JournalDb(`context-test-${counter}`)
  await d.open()

  await d.notebooks.add({
    id: 'nb',
    title: '시댁 한국어',
    language: 'Korean',
    focus: 'dinner with in-laws',
    meaningLanguage: 'English',
    createdAt: daysAgo(90),
    lastOpenedAt: daysAgo(1),
  })
  await d.entries.bulkAdd([
    {
      id: 'e1',
      notebookId: 'nb',
      date: daysAgo(2),
      body: 'the older one',
      title: 'Older',
      origin: 'learner',
      createdAt: daysAgo(2),
      updatedAt: daysAgo(2),
    },
    {
      id: 'e2',
      notebookId: 'nb',
      date: daysAgo(1),
      body: 'the newer one',
      origin: 'learner',
      createdAt: daysAgo(1),
      updatedAt: daysAgo(1),
    },
  ])
  await d.words.bulkAdd([word('w1', '치우다'), word('w2', '얼른')])
  await d.sentences.add({
    id: 's1',
    notebookId: 'nb',
    text: '제가 치울게요',
    createdAt: daysAgo(1),
  })
  await d.encounters.bulkAdd([
    {
      id: 'en1',
      notebookId: 'nb',
      entryId: 'e1',
      targetType: 'word',
      targetId: 'w1',
      createdAt: daysAgo(2),
    },
    {
      id: 'en2',
      notebookId: 'nb',
      entryId: 'e2',
      targetType: 'word',
      targetId: 'w2',
      createdAt: daysAgo(1),
    },
    // The sentence hangs off the older entry, so the picker's two targets are separable.
    {
      id: 'en3',
      notebookId: 'nb',
      entryId: 'e1',
      targetType: 'sentence',
      targetId: 's1',
      createdAt: daysAgo(2),
    },
  ])
})

describe('buildContext', () => {
  /** The two test seams, in the bag the production call sites leave empty. */
  const deps = () => ({ d, now: NOW })

  it('returns nothing at all for an empty request', async () => {
    const bundle = await buildContext('nb', {}, undefined, deps())
    expect(bundle).toEqual({ notebookId: 'nb', words: [], sentences: [], entries: [] })
    // An absent key means none, not everything. A workbook that forgets to ask gets nothing.
    expect(bundle.profile).toBeUndefined()
    expect(bundle.scope).toBeUndefined()
  })

  it('includes the notebook profile when asked', async () => {
    const bundle = await buildContext('nb', { notebookProfile: true }, undefined, deps())
    expect(bundle.profile).toEqual({
      title: '시댁 한국어',
      language: 'Korean',
      focus: 'dinner with in-laws',
      meaningLanguage: 'English',
    })
  })

  it('attaches derived signals to every word, so a workbook never computes them', async () => {
    const bundle = await buildContext('nb', { words: {} }, undefined, deps())
    expect(bundle.words).toHaveLength(2)

    const drill = bundle.words.find((r) => r.word.id === 'w1')
    expect(drill?.signals.timesEncountered).toBe(1)
    // Signals come off the entry date, not the encounter's own createdAt.
    expect(drill?.signals.lastSeen).toBe(daysAgo(2))
    expect(drill?.signals.familiarity).toBe('new')
  })

  it('orders words by the entry they were last met in', async () => {
    const bundle = await buildContext('nb', { words: { order: 'recent' } }, undefined, deps())
    expect(bundle.words.map((r) => r.word.id)).toEqual(['w2', 'w1'])
  })

  it('returns entries newest first, with a body only when asked', async () => {
    const without = await buildContext('nb', { entries: { limit: 2 } }, undefined, deps())
    expect(without.entries.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(without.entries[0]!.body).toBeUndefined()
    expect(without.entries[1]!.title).toBe('Older')

    const withBody = await buildContext('nb', { entries: { includeBody: true } }, undefined, deps())
    expect(withBody.entries[0]!.body).toBe('the newer one')
  })

  it('reads sentences for the notebook', async () => {
    const bundle = await buildContext('nb', { sentences: {} }, undefined, deps())
    expect(bundle.sentences.map((s) => s.sentence.id)).toEqual(['s1'])
  })

  it('sees nothing from another notebook', async () => {
    const bundle = await buildContext(
      'other',
      { notebookProfile: true, words: {}, sentences: {}, entries: {} },
      undefined,
      deps(),
    )
    expect(bundle.profile).toBeUndefined()
    expect(bundle.words).toEqual([])
    expect(bundle.sentences).toEqual([])
    expect(bundle.entries).toEqual([])
  })
})

describe('buildContext with a scope', () => {
  const deps = () => ({ d, now: NOW })
  const scope = (over: Partial<WorkbookScope> = {}): WorkbookScope => ({
    entryIds: [],
    wordIds: [],
    sentenceIds: [],
    ...over,
  })

  it('flags the focused word and leaves the rest as background', async () => {
    const bundle = await buildContext(
      'nb',
      { words: { order: 'recent' } },
      scope({ wordIds: ['w1'] }),
      deps(),
    )
    // w2 was met more recently, so this is the focus sort winning over the request's own.
    expect(bundle.words.map((r) => [r.word.id, r.focus])).toEqual([
      ['w1', true],
      ['w2', false],
    ])
  })

  it('keeps a focused word a request would have filtered out', async () => {
    // w1 was met two days ago, so a one-day window excludes it and keeps w2.
    const request = { words: { recentDays: 1 } }
    expect((await buildContext('nb', request, undefined, deps())).words.map((r) => r.word.id)).toEqual([
      'w2',
    ])

    // Focusing it puts it back, and in front, without banning the background it was competing with.
    const focused = await buildContext('nb', request, scope({ wordIds: ['w1'] }), deps())
    expect(focused.words.map((r) => r.word.id)).toEqual(['w1', 'w2'])
  })

  it('flags the focused sentence', async () => {
    const bundle = await buildContext('nb', { sentences: {} }, scope({ sentenceIds: ['s1'] }), deps())
    expect(bundle.sentences[0]?.focus).toBe(true)
  })

  it('leads with the focused entry even though it is the older one', async () => {
    const bundle = await buildContext('nb', { entries: { limit: 1 } }, scope({ entryIds: ['e1'] }), deps())
    expect(bundle.entries.map((e) => e.id)).toEqual(['e1'])
  })

  it('hands the scope back on the bundle, so a workbook can say what it was built around', async () => {
    const s = scope({ entryIds: ['e1'], wordIds: ['w1'] })
    expect((await buildContext('nb', {}, s, deps())).scope).toEqual(s)
  })
})

describe('focusCandidates', () => {
  it('returns the words and sentences met in the given entries', async () => {
    const out = await focusCandidates('nb', ['e1'], d)
    expect(out.words.map((w) => w.id)).toEqual(['w1'])
    expect(out.sentences.map((s) => s.id)).toEqual(['s1'])
  })

  it('offers only what that entry actually holds', async () => {
    const out = await focusCandidates('nb', ['e2'], d)
    expect(out.words.map((w) => w.id)).toEqual(['w2'])
    expect(out.sentences).toEqual([])
  })

  it('accumulates across entries without duplicating', async () => {
    const out = await focusCandidates('nb', ['e1', 'e2'], d)
    expect(out.words.map((w) => w.id).sort()).toEqual(['w1', 'w2'])
    expect(out.sentences).toHaveLength(1)
  })

  it('returns nothing for no entries, rather than everything', async () => {
    expect(await focusCandidates('nb', [], d)).toEqual({ words: [], sentences: [] })
  })

  it('sees nothing from another notebook', async () => {
    expect(await focusCandidates('other', ['e1', 'e2'], d)).toEqual({ words: [], sentences: [] })
  })
})
