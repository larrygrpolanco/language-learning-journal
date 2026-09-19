import { normalizeTerm, termAppearsIn } from '../db/normalize'
import type { EncounterTarget, Id } from '../db/types'
import type { BundledSentence, BundledWord, ContextBundle } from './sdk'

/**
 * The one copy of the level rule. Technical plan §8, concepts §16.
 *
 * Every generative workbook has the same problem: a model asked for a conversation in Korean writes
 * the Korean it would write for anyone, which is several years ahead of a notebook holding sixty
 * words. Left to each workbook, five folders would each arrive at their own slightly different answer
 * and they would drift apart on the day one of them was tuned.
 *
 * So the rules live here and the workbooks paste them in. Note what is not here: no difficulty
 * setting, no level estimate, nothing that adapts. §16 bans automatic difficulty adjustment, and the
 * material the learner has collected is already the level. Saying "use these words" is the whole
 * mechanism.
 */

/**
 * How tightly to hold to the material.
 *
 * `strict` is for a text the learner reads cold, a story scene or a dialog, where one unknown word
 * too many and the exercise stops being readable. `stretch` is for a conversation. There the material
 * is the anchor rather than the fence: a person who only ever texts back in the learner's own
 * sentences is a mirror, and the learner stops having anything to answer.
 */
export type Reach = 'strict' | 'stretch'

/**
 * The instruction block, in the notebook's own languages.
 *
 * Deliberately about the material rather than about a level. "Write at A2" asks the model to guess at
 * a scale it has no reason to share with anyone; "use these words and nothing harder" is checkable,
 * and `used` is what checks it.
 */
export const levelRules = (bundle: ContextBundle, reach: Reach = 'strict'): string => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const scope =
    reach === 'strict'
      ? [
          `- Build what you write out of the material listed below, plus the everyday connective language it takes to join it up: particles, endings, pronouns, numbers, and the ordinary verbs of getting through a sentence.`,
          `- If you find you need a word that is not listed, choose a simpler idea rather than a harder word. Say less rather than reaching further.`,
        ]
      : [
          `- The material listed below is your anchor, not your limit. Lean on it, and reach past it the way a real person would: everyday words someone at this stage could work out from context.`,
          `- Nothing rare, literary or technical. If a message only makes sense with a word they could not guess, say it more simply.`,
        ]

  const shape =
    reach === 'strict'
      ? `- Keep to the length and the shape of the listed sentences. If they are short, yours are short.`
      : `- Do not copy the listed sentences back. Vary them, recombine them, put them in new situations.`

  return [
    ...scope,
    `- Do not teach. No glosses, no explanations, no "this means", no new vocabulary offered on the side.`,
    shape,
    `- Stay in ${language} unless the field being asked for says otherwise. ${meaning} appears only where it is asked for by name.`,
    `- List in "used" exactly the listed words and sentences you actually used, copied as they are written above. Nothing you did not use, and nothing that was not on the list.`,
  ].join('\n')
}

/**
 * The material itself, as two headed lists.
 *
 * Focus goes under "build around these" and the rest under "you may also use these", which is the
 * prompt-side half of focus being a priority rather than a restriction. A model given one heading
 * would treat the whole bundle as equally wanted and the learner's choice would evaporate here rather
 * than in the query.
 */
export const materialLines = (bundle: ContextBundle): string => {
  const focusWords = bundle.words.filter((w) => w.focus)
  const focusSentences = bundle.sentences.filter((s) => s.focus)
  const restWords = bundle.words.filter((w) => !w.focus)
  const restSentences = bundle.sentences.filter((s) => !s.focus)

  const blocks: string[] = []
  // With nothing focused there is no priority to state, so the single heading says only what is
  // allowed. Two headings where one is empty would read as a rule the learner never asked for.
  if (focusWords.length > 0 || focusSentences.length > 0) {
    blocks.push(block('Build around these', focusWords, focusSentences))
    if (restWords.length > 0 || restSentences.length > 0) {
      blocks.push(block('You may also use these', restWords, restSentences))
    }
  } else if (restWords.length > 0 || restSentences.length > 0) {
    blocks.push(block('Use these', restWords, restSentences))
  }

  return blocks.join('\n\n')
}

const block = (
  heading: string,
  words: readonly BundledWord[],
  sentences: readonly BundledSentence[],
): string => {
  const lines = [`${heading}:`]
  for (const w of words) {
    lines.push(`  ${w.word.meaning ? `${w.word.term} — ${w.word.meaning}` : w.word.term}`)
  }
  for (const s of sentences) {
    lines.push(
      `  ${s.sentence.translation ? `${s.sentence.text} — ${s.sentence.translation}` : s.sentence.text}`,
    )
  }
  return lines.join('\n')
}

/**
 * Which of the notebook's words appear in something the learner wrote.
 *
 * Reuses `termAppearsIn`, which is what derives the Word to Sentence links, so a word counts as used
 * here on exactly the same terms it counts as appearing in a sentence. That brings NFC normalisation
 * with it, which matters because macOS hands over decomposed Hangul and an unnormalised comparison
 * would silently find nothing.
 *
 * What this is for is evidence. A word the learner actually typed while getting something done is the
 * strongest signal a journal can honestly collect, and it is theirs rather than a model's opinion of
 * what they know.
 */
export const wordsUsedIn = (bundle: ContextBundle, text: string): BundledWord[] => {
  const language = bundle.profile?.language ?? ''
  return bundle.words.filter((w) => termAppearsIn(w.word.term, text, language))
}

/**
 * The model's `used` list, resolved back to journal records.
 *
 * `used` does three jobs and this is the one that needs code: `targetType` is `'word' | 'sentence'`, so
 * a generated scene is not a thing a practice event can name, and the supplied items it was built from
 * are. Without this there is nothing for the support ladder's third rung to record against.
 *
 * Anything unmatched is dropped rather than guessed at. The model was told to copy items as written,
 * and a string that is not in the notebook is either an invention or a paraphrase; recording against
 * either would put a practice event on the wrong word.
 */
export const usedTargets = (
  bundle: ContextBundle,
  used: readonly string[],
): { targetType: EncounterTarget; targetId: Id }[] => {
  const words = new Map(bundle.words.map((w) => [normalizeTerm(w.word.term), w.word.id]))
  const sentences = new Map(
    bundle.sentences.map((s) => [normalizeTerm(s.sentence.text), s.sentence.id]),
  )

  const out: { targetType: EncounterTarget; targetId: Id }[] = []
  const seen = new Set<Id>()

  for (const raw of used) {
    // The material list writes each item as "term — meaning", and a model copying "as written"
    // sometimes takes the whole line. Cutting at the dash costs nothing when it took just the term.
    const key = normalizeTerm(raw.split('—')[0] ?? raw)
    if (key === '') continue

    const wordId = words.get(key)
    if (wordId !== undefined) {
      if (!seen.has(wordId)) {
        seen.add(wordId)
        out.push({ targetType: 'word', targetId: wordId })
      }
      continue
    }

    const sentenceId = sentences.get(key)
    if (sentenceId !== undefined && !seen.has(sentenceId)) {
      seen.add(sentenceId)
      out.push({ targetType: 'sentence', targetId: sentenceId })
    }
  }

  return out
}
