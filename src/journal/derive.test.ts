import { describe, expect, it } from 'vitest'
import { estimateFamiliarity, familiarityDashes, signalsFor } from './derive'
import type { PracticeEvent } from '../db/types'

const NOW = new Date('2026-09-15T12:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString()

const right = (n: number): Pick<PracticeEvent, 'outcome' | 'at'> => ({ outcome: 'right', at: daysAgo(n) })
const wrong = (n: number): Pick<PracticeEvent, 'outcome' | 'at'> => ({ outcome: 'wrong', at: daysAgo(n) })
const shown = (n: number): Pick<PracticeEvent, 'outcome' | 'at'> => ({ outcome: 'shown', at: daysAgo(n) })

describe('estimateFamiliarity', () => {
  it('calls one encounter and no practice new', () => {
    expect(estimateFamiliarity(1, [], NOW)).toBe('new')
    expect(estimateFamiliarity(0, [], NOW)).toBe('new')
  })

  it('will not call something new once it has been practised correctly', () => {
    expect(estimateFamiliarity(1, [right(2)], NOW)).toBe('getting it')
  })

  it('does not count a wrong or shown outcome as practice', () => {
    expect(estimateFamiliarity(1, [wrong(2), shown(3)], NOW)).toBe('new')
  })

  it('calls five encounters with recent correct practice got it', () => {
    expect(estimateFamiliarity(5, [right(29)], NOW)).toBe('got it')
  })

  it('drops back to getting it once the correct practice ages out', () => {
    expect(estimateFamiliarity(9, [right(31)], NOW)).toBe('getting it')
  })

  it('needs the encounters as well as the practice', () => {
    expect(estimateFamiliarity(4, [right(1)], NOW)).toBe('getting it')
  })

  it('covers every case, so nothing falls through', () => {
    for (const n of [0, 1, 2, 4, 5, 20]) {
      for (const p of [[], [right(1)], [right(60)], [wrong(1)]]) {
        expect(['new', 'getting it', 'got it']).toContain(estimateFamiliarity(n, p, NOW))
      }
    }
  })
})

describe('signalsFor', () => {
  it('reads first and last seen off the entry dates, not the row order', () => {
    const s = signalsFor(
      {},
      [{ entryDate: daysAgo(3) }, { entryDate: daysAgo(40) }, { entryDate: daysAgo(10) }],
      [],
      NOW,
    )
    expect(s.firstSeen).toBe(daysAgo(40))
    expect(s.lastSeen).toBe(daysAgo(3))
    expect(s.timesEncountered).toBe(3)
  })

  it('omits the dates entirely when there are no encounters', () => {
    const s = signalsFor({}, [], [], NOW)
    expect(s.timesEncountered).toBe(0)
    expect('firstSeen' in s).toBe(false)
    expect('lastSeen' in s).toBe(false)
    expect('lastPracticed' in s).toBe(false)
  })

  it('takes the most recent practice event', () => {
    const s = signalsFor({}, [], [right(9), wrong(2), right(30)], NOW)
    expect(s.lastPracticed).toBe(daysAgo(2))
  })

  it('lets a learner-set familiarity win over the estimate', () => {
    const encounters = [{ entryDate: daysAgo(1) }]
    expect(signalsFor({}, encounters, [], NOW).familiarity).toBe('new')

    const set = signalsFor({ familiarity: 'got it' }, encounters, [], NOW)
    expect(set.familiarity).toBe('got it')
    expect(set.familiarityIsEstimate).toBe(false)
  })

  it('flags an estimate as an estimate', () => {
    expect(signalsFor({}, [], [], NOW).familiarityIsEstimate).toBe(true)
  })
})

describe('familiarityDashes', () => {
  it('fills one, two and three', () => {
    expect(familiarityDashes('new')).toBe(1)
    expect(familiarityDashes('getting it')).toBe(2)
    expect(familiarityDashes('got it')).toBe(3)
  })
})
