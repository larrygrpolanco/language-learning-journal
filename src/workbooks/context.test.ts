import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb } from '../db/db'
import { buildContext, selectSentences, selectWords } from './context'
import type { BundledWord } from './sdk'
import type { Familiarity, Sentence, Word } from '../db/types'

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

describe('selectSentences', () => {
  const sentence = (id: string, days: number): Sentence => ({
    id,
    notebookId: 'nb',
    text: `line ${id}`,
    createdAt: daysAgo(days),
  })

  const rows = [sentence('a', 30), sentence('b', 5), sentence('c', 1)]

  it('returns newest first', () => {
    expect(selectSentences(rows, {}).map((s) => s.id)).toEqual(['c', 'b', 'a'])
  })

  it('honours a limit after ordering', () => {
    expect(selectSentences(rows, { limit: 1 }).map((s) => s.id)).toEqual(['c'])
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
  ])
})

describe('buildContext', () => {
  it('returns nothing at all for an empty request', async () => {
    const bundle = await buildContext('nb', {}, d, NOW)
    expect(bundle).toEqual({ notebookId: 'nb', words: [], sentences: [], entries: [] })
    // An absent key means none, not everything. A workbook that forgets to ask gets nothing.
    expect(bundle.profile).toBeUndefined()
  })

  it('includes the notebook profile when asked', async () => {
    const bundle = await buildContext('nb', { notebookProfile: true }, d, NOW)
    expect(bundle.profile).toEqual({
      title: '시댁 한국어',
      language: 'Korean',
      focus: 'dinner with in-laws',
      meaningLanguage: 'English',
    })
  })

  it('attaches derived signals to every word, so a workbook never computes them', async () => {
    const bundle = await buildContext('nb', { words: {} }, d, NOW)
    expect(bundle.words).toHaveLength(2)

    const drill = bundle.words.find((r) => r.word.id === 'w1')
    expect(drill?.signals.timesEncountered).toBe(1)
    // Signals come off the entry date, not the encounter's own createdAt.
    expect(drill?.signals.lastSeen).toBe(daysAgo(2))
    expect(drill?.signals.familiarity).toBe('new')
  })

  it('orders words by the entry they were last met in', async () => {
    const bundle = await buildContext('nb', { words: { order: 'recent' } }, d, NOW)
    expect(bundle.words.map((r) => r.word.id)).toEqual(['w2', 'w1'])
  })

  it('returns entries newest first, with a body only when asked', async () => {
    const without = await buildContext('nb', { entries: { limit: 2 } }, d, NOW)
    expect(without.entries.map((e) => e.id)).toEqual(['e2', 'e1'])
    expect(without.entries[0]!.body).toBeUndefined()
    expect(without.entries[1]!.title).toBe('Older')

    const withBody = await buildContext('nb', { entries: { includeBody: true } }, d, NOW)
    expect(withBody.entries[0]!.body).toBe('the newer one')
  })

  it('reads sentences for the notebook', async () => {
    const bundle = await buildContext('nb', { sentences: {} }, d, NOW)
    expect(bundle.sentences.map((s) => s.id)).toEqual(['s1'])
  })

  it('sees nothing from another notebook', async () => {
    const bundle = await buildContext(
      'other',
      { notebookProfile: true, words: {}, sentences: {}, entries: {} },
      d,
      NOW,
    )
    expect(bundle.profile).toBeUndefined()
    expect(bundle.words).toEqual([])
    expect(bundle.sentences).toEqual([])
    expect(bundle.entries).toEqual([])
  })
})
