import type { Encounter, Familiarity, Iso, PracticeEvent, Word } from '../db/types'

/**
 * Derived signals. Technical plan §3, concepts §10.
 *
 * Computed on read, never stored, so there is nothing to invalidate and nothing to migrate. A heavy
 * notebook is a few thousand rows, which is nothing.
 *
 * These are pure on purpose. They take rows and return numbers, which is what makes them the only
 * part of the app worth testing.
 */

/** An encounter paired with the date of the entry it points at. */
export interface DatedEncounter {
  entryDate: Iso
}

export interface WordSignals {
  /** Distinct entries the word came up in. Encounters are unique per entry, so this is their count. */
  timesEncountered: number
  firstSeen?: Iso
  lastSeen?: Iso
  lastPracticed?: Iso
  familiarity: Familiarity
  /** False when the learner set it by hand. Drives nothing but honesty. */
  familiarityIsEstimate: boolean
}

const GOT_IT_ENCOUNTERS = 5
const GOT_IT_WINDOW_DAYS = 30
const NEW_ENCOUNTERS = 2

/**
 * Deliberately dumb. It renders as three dashes and nothing in the app branches on it, so a wrong
 * guess costs the learner nothing.
 *
 * | Estimate     | Rule                                                              |
 * |--------------|-------------------------------------------------------------------|
 * | new          | fewer than 2 encounters and no correct practice                   |
 * | got it       | 5+ encounters and a correct practice event in the last 30 days    |
 * | getting it   | anything in between                                               |
 */
export const estimateFamiliarity = (
  timesEncountered: number,
  practice: readonly Pick<PracticeEvent, 'outcome' | 'at'>[],
  now: Date,
): Familiarity => {
  const correct = practice.filter((p) => p.outcome === 'right')
  if (timesEncountered < NEW_ENCOUNTERS && correct.length === 0) return 'new'

  const cutoff = now.getTime() - GOT_IT_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const recentCorrect = correct.some((p) => Date.parse(p.at) >= cutoff)
  if (timesEncountered >= GOT_IT_ENCOUNTERS && recentCorrect) return 'got it'

  return 'getting it'
}

const minIso = (xs: readonly string[]): string | undefined =>
  xs.length === 0 ? undefined : xs.reduce((a, b) => (a < b ? a : b))

const maxIso = (xs: readonly string[]): string | undefined =>
  xs.length === 0 ? undefined : xs.reduce((a, b) => (a > b ? a : b))

export const signalsFor = (
  word: Pick<Word, 'familiarity'>,
  encounters: readonly DatedEncounter[],
  practice: readonly Pick<PracticeEvent, 'outcome' | 'at'>[],
  now: Date = new Date(),
): WordSignals => {
  const dates = encounters.map((e) => e.entryDate)
  const timesEncountered = encounters.length

  return compactSignals({
    timesEncountered,
    firstSeen: minIso(dates),
    lastSeen: maxIso(dates),
    lastPracticed: maxIso(practice.map((p) => p.at)),
    familiarity: word.familiarity ?? estimateFamiliarity(timesEncountered, practice, now),
    familiarityIsEstimate: word.familiarity === undefined,
  })
}

/** Local shim so an absent date is an absent key rather than an explicit undefined. */
const compactSignals = (s: {
  timesEncountered: number
  firstSeen: string | undefined
  lastSeen: string | undefined
  lastPracticed: string | undefined
  familiarity: Familiarity
  familiarityIsEstimate: boolean
}): WordSignals => {
  const out: WordSignals = {
    timesEncountered: s.timesEncountered,
    familiarity: s.familiarity,
    familiarityIsEstimate: s.familiarityIsEstimate,
  }
  if (s.firstSeen !== undefined) out.firstSeen = s.firstSeen
  if (s.lastSeen !== undefined) out.lastSeen = s.lastSeen
  if (s.lastPracticed !== undefined) out.lastPracticed = s.lastPracticed
  return out
}

/** How many of the three dashes are filled on the words screen. */
export const familiarityDashes = (f: Familiarity): 1 | 2 | 3 =>
  f === 'new' ? 1 : f === 'getting it' ? 2 : 3

/** Groups encounters by target so a whole word list can be scored in one pass. */
export const byTarget = <T extends Pick<Encounter, 'targetId'>>(rows: readonly T[]): Map<string, T[]> => {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const bucket = m.get(r.targetId)
    if (bucket) bucket.push(r)
    else m.set(r.targetId, [r])
  }
  return m
}
