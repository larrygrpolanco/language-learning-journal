import { describe, expect, it } from 'vitest'
import {
  dedupeProposedSentences,
  dedupeProposedWords,
  mergeDrafts,
  rowsWorthShowing,
  splitProposals,
} from './proposals'
import type { ProposalDraft, Word } from '../db/types'

/**
 * Technical plan §13 names "the dedupe check in Extract" as owed a test, and this is it.
 *
 * The reason it is worth testing and the rest of the dialog is not: this is the seam where a wrong
 * answer writes a duplicate word into the journal, and concepts §7 promises that cannot happen. It is
 * also pure, so the whole thing tests without a database.
 */

const word = (term: string, termKey: string, extra: Partial<Word> = {}): Word => ({
  id: `id-${termKey}`,
  notebookId: 'nb',
  term,
  termKey,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  ...extra,
})

const draft = (over: Partial<ProposalDraft> = {}): ProposalDraft => ({
  entryId: 'e1',
  words: [],
  sentences: [],
  ...over,
})

describe('dedupeProposedWords', () => {
  it('collapses two proposals that normalize to one term', () => {
    const out = dedupeProposedWords([
      { term: '치우다' },
      { term: '  치우다  ' },
      { term: '얼른' },
    ])
    expect(out.map((w) => w.term)).toEqual(['치우다', '얼른'])
  })

  it('collapses NFD against NFC, which is the macOS case', () => {
    const nfc = '한'
    const nfd = '한'.normalize('NFD')
    expect(nfc).not.toBe(nfd)

    const out = dedupeProposedWords([{ term: nfd }, { term: nfc }])
    expect(out).toHaveLength(1)
    // The survivor is stored composed, so the record never carries a decomposed term.
    expect(out[0]!.term).toBe(nfc)
  })

  it('folds case for a latin term', () => {
    expect(dedupeProposedWords([{ term: 'Gracias' }, { term: 'gracias' }])).toHaveLength(1)
  })

  it('fills a blank field from a later duplicate but never overwrites one', () => {
    const out = dedupeProposedWords([
      { term: '치우다', meaning: 'to tidy up' },
      { term: '치우다', meaning: 'to clear away', note: 'said at the end of a meal' },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.meaning).toBe('to tidy up')
    expect(out[0]!.note).toBe('said at the end of a meal')
  })

  it('drops a term that is only whitespace', () => {
    expect(dedupeProposedWords([{ term: '   ' }, { term: '\n' }])).toEqual([])
  })
})

describe('dedupeProposedSentences', () => {
  it('drops an identical line proposed twice in one batch', () => {
    const out = dedupeProposedSentences([
      { text: '제가 치울게요' },
      { text: '제가 치울게요  ' },
    ])
    expect(out).toHaveLength(1)
  })

  it('keeps two genuinely different lines', () => {
    const out = dedupeProposedSentences([
      { text: '제가 치울게요' },
      { text: '얼른 오세요' },
    ])
    expect(out).toHaveLength(2)
  })
})

describe('splitProposals', () => {
  it('marks a term already in the notebook as known and leaves a new one alone', () => {
    const split = splitProposals(
      draft({ words: [{ term: '치우다' }, { term: '얼른' }] }),
      [word('치우다', '치우다')],
    )

    expect(split.words).toHaveLength(2)
    expect(split.words[0]!.existing?.id).toBe('id-치우다')
    expect(split.words[1]!.existing).toBeUndefined()
  })

  it('matches on the normalized key, not the raw term', () => {
    // The notebook holds the composed form; the model proposes the decomposed one.
    const split = splitProposals(
      draft({ words: [{ term: '한국'.normalize('NFD') }] }),
      [word('한국', '한국')],
    )
    expect(split.words[0]!.existing?.id).toBe('id-한국')
  })

  it('does not match a term that merely contains an existing one', () => {
    const split = splitProposals(draft({ words: [{ term: '치우다가' }] }), [word('치우다', '치우다')])
    expect(split.words[0]!.existing).toBeUndefined()
  })

  it('carries sentences through without deduplicating against the notebook', () => {
    // Sentences are evidence, not the deduplicated unit. The same line on two days is two records.
    const split = splitProposals(draft({ sentences: [{ text: '제가 치울게요' }] }), [])
    expect(split.sentences).toHaveLength(1)
  })
})

describe('mergeDrafts', () => {
  it('returns the incoming draft when nothing is held', () => {
    const merged = mergeDrafts(undefined, draft({ words: [{ term: '치우다' }] }))
    expect(merged.words.map((w) => w.term)).toEqual(['치우다'])
  })

  it('appends only terms the held draft does not already carry', () => {
    const previous = draft({ words: [{ term: '치우다', meaning: 'to tidy up' }] })
    const merged = mergeDrafts(
      previous,
      draft({ words: [{ term: '치우다', meaning: 'WRONG' }, { term: '얼른' }] }),
    )

    expect(merged.words).toHaveLength(2)
    // §10: re-extracting never touches a field the learner edited.
    expect(merged.words[0]!.meaning).toBe('to tidy up')
    expect(merged.words[1]!.term).toBe('얼른')
  })

  it('keeps the held entry id, so a merge cannot move a draft to another entry', () => {
    const merged = mergeDrafts(draft({ entryId: 'held' }), draft({ entryId: 'other' }))
    expect(merged.entryId).toBe('held')
  })

  it('deduplicates the incoming batch against itself as well as against the held draft', () => {
    const merged = mergeDrafts(
      draft({ words: [{ term: '치우다' }] }),
      draft({ words: [{ term: '얼른' }, { term: '  얼른 ' }] }),
    )
    expect(merged.words.map((w) => w.term)).toEqual(['치우다', '얼른'])
  })
})

describe('rowsWorthShowing', () => {
  it('drops a known word this entry has already encountered', () => {
    // Accepting it would write nothing: the encounter is unique per entry and already exists.
    const split = splitProposals(draft({ words: [{ term: '치우다' }] }), [word('치우다', '치우다')])
    const shown = rowsWorthShowing(split, new Set(['id-치우다']))
    expect(shown.words).toEqual([])
  })

  it('keeps a known word encountered only in other entries', () => {
    const split = splitProposals(draft({ words: [{ term: '치우다' }] }), [word('치우다', '치우다')])
    const shown = rowsWorthShowing(split, new Set(['id-something-else']))
    expect(shown.words).toHaveLength(1)
    expect(shown.words[0]!.existing?.id).toBe('id-치우다')
  })
})
