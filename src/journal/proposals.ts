import { normalizeTerm } from '../db/normalize'
import type { Id, ProposalDraft, ProposedSentence, ProposedWord, Word } from '../db/types'

/**
 * The dedupe split behind Extract. Technical plan §10, and §13 names it as owed a test.
 *
 * Everything here is pure: proposals in, a known/new split out. That is deliberate, because this is
 * the seam where a silent bug writes a duplicate word into the journal, and a duplicate word is
 * exactly what concepts §7 promises cannot happen.
 *
 * Nothing in this file touches Dexie. The caller hands it the notebook's existing words and gets back
 * rows that already know which of them are new.
 */

/** A proposed word, resolved against what the notebook already holds. */
export interface WordRow {
  proposed: ProposedWord
  /** Normalized key the term was matched on. */
  termKey: string
  /**
   * The word already in this notebook under the same key.
   *
   * Present means accepting this row writes an `Encounter` and nothing else, which is what produces
   * the "already in this notebook · 11th time" line. `addWord` already behaves this way, so the write
   * path is reuse rather than a second code path that could disagree.
   */
  existing?: Word
}

export interface SentenceRow {
  proposed: ProposedSentence
}

export interface Split {
  words: WordRow[]
  sentences: SentenceRow[]
}

/**
 * Collapses proposals that normalize to the same term.
 *
 * The model will occasionally propose a word twice, or propose two spellings that are one word after
 * NFC and case folding. Left alone those become two ticked rows that write one word, so the dialog
 * would claim to add five things and add four. First one wins, and a later duplicate only contributes
 * a field the first one left blank.
 */
export const dedupeProposedWords = (proposed: readonly ProposedWord[]): ProposedWord[] => {
  const byKey = new Map<string, ProposedWord>()

  for (const p of proposed) {
    const term = p.term.normalize('NFC').trim()
    if (term === '') continue
    const key = normalizeTerm(term)

    const held = byKey.get(key)
    if (!held) {
      byKey.set(key, { ...p, term })
      continue
    }
    // Fill blanks only, same rule the write layer uses on a re-encounter.
    if (held.meaning === undefined && p.meaning !== undefined) held.meaning = p.meaning
    if (held.note === undefined && p.note !== undefined) held.note = p.note
  }

  return [...byKey.values()]
}

/** Sentences are not deduplicated as records, but an identical line twice in one batch is noise. */
export const dedupeProposedSentences = (
  proposed: readonly ProposedSentence[],
): ProposedSentence[] => {
  const seen = new Set<string>()
  const out: ProposedSentence[] = []

  for (const p of proposed) {
    const text = p.text.normalize('NFC').trim()
    if (text === '') continue
    const key = normalizeTerm(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...p, text })
  }

  return out
}

/**
 * Resolves a draft against the notebook, marking every term already there.
 *
 * `existing` is every word in the notebook. Matching is on `termKey`, which is the same normalized
 * key the unique index uses, so a hit here is exactly a hit in `addWord` and the dialog cannot promise
 * something the write layer will then do differently.
 */
export const splitProposals = (draft: ProposalDraft, existing: readonly Word[]): Split => {
  const known = new Map(existing.map((w) => [w.termKey, w]))

  return {
    words: dedupeProposedWords(draft.words).map((proposed) => {
      const termKey = normalizeTerm(proposed.term)
      const hit = known.get(termKey)
      const row: WordRow = { proposed, termKey }
      if (hit) row.existing = hit
      return row
    }),
    sentences: dedupeProposedSentences(draft.sentences).map((proposed) => ({ proposed })),
  }
}

/**
 * Folds a fresh extraction into a draft that is already sitting on the entry.
 *
 * §10: re-extracting proposes only terms that are still absent and never touches a field the learner
 * edited. Both fall out of keeping every previous row verbatim and only appending keys that are new.
 * The learner's edits live in the stored draft, so "never touches" means literally never rewritten.
 */
export const mergeDrafts = (
  previous: ProposalDraft | undefined,
  incoming: ProposalDraft,
): ProposalDraft => {
  if (!previous) {
    return {
      entryId: incoming.entryId,
      words: dedupeProposedWords(incoming.words),
      sentences: dedupeProposedSentences(incoming.sentences),
    }
  }

  const heldWords = new Set(previous.words.map((w) => normalizeTerm(w.term)))
  const heldSentences = new Set(previous.sentences.map((s) => normalizeTerm(s.text)))

  return {
    entryId: previous.entryId,
    words: [
      ...previous.words,
      ...dedupeProposedWords(incoming.words).filter((w) => !heldWords.has(normalizeTerm(w.term))),
    ],
    sentences: [
      ...previous.sentences,
      ...dedupeProposedSentences(incoming.sentences).filter(
        (s) => !heldSentences.has(normalizeTerm(s.text)),
      ),
    ],
  }
}

/**
 * Which of a resolved split are worth showing.
 *
 * A term already in the notebook is still shown, because noticing a word for the eleventh time is
 * information the learner wants and accepting it is a real write. A row is dropped only when it would
 * do nothing at all, which is the case for a word whose encounter on this entry already exists.
 */
export const rowsWorthShowing = (split: Split, encounteredIds: ReadonlySet<Id>): Split => ({
  words: split.words.filter((r) => !r.existing || !encounteredIds.has(r.existing.id)),
  sentences: split.sentences,
})
