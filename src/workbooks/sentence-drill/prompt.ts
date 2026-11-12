import { productionRules } from '../pedagogy'
import type { BundledSentence, ContextBundle, NotebookProfile } from '../sdk'
import { exchangeLines, type Built, type Round } from '../drill'
import { materialLines } from '../level'

/**
 * The prompts for sentence-drill. Technical plan §8.
 *
 * A collected sentence is a pattern with some words in it. Saying it back proves nothing, so every cue
 * here asks for the pattern bent to a new situation: a different thing, a different time, a different
 * listener. That is the difference between knowing a sentence and being able to use it.
 *
 * The first cue changes one fact; follow-ups keep that pattern and fade explicit guidance.
 */

const profileLine = (profile: NotebookProfile | undefined): string =>
  profile?.focus ? `This notebook is for: ${profile.focus}` : ''

/** The source pattern and its meaning, supplied to every generation and feedback call. */
const itemLines = (s: BundledSentence): string[] =>
  [
    `Sentence: ${s.sentence.text}`,
    s.sentence.translation ? `Translation: ${s.sentence.translation}` : '',
    s.sentence.note ? `Note: ${s.sentence.note}` : '',
  ].filter((l) => l !== '')

/** One cue: a situation that needs this sentence's pattern, changed in one way. */
export const cuePrompt = (sentence: BundledSentence, bundle: ContextBundle): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You write one drill prompt for someone learning ${language}. They can see the sentence below and its translation.`,
      profileLine(bundle.profile),
      productionRules(bundle),
      '',
      `- Write the prompt in ${meaning}. Never include the ${language} answer in it, and do not repeat the sentence.`,
      '- The answer should reuse the sentence\'s pattern, its grammar and its key phrase, in a new situation. Not repeat it.',
      '- First round: keep the original grammar and register. Change exactly one concrete fact (person, object, or place), and specify its replacement. Give an incidental replacement word with a gloss if it is not in the notebook.',
      '- Give a specific situation: who they are talking to and what is going on. Then ask what they would say.',
      '- One or two sentences. No preamble, no "Try to", no encouragement.',
      '- Keep it plausible for this notebook rather than generic.',
      '- Reply with the prompt itself and nothing else.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: [...itemLines(sentence), materialLines(bundle)].join('\n') }],
  }
}

/**
 * Marks one answer and writes the next round unless this was the last.
 *
 * "Right" is about the pattern surviving the change. A slip elsewhere does not make it wrong, and the
 * better version carries the correction, as in word drill.
 */
export const markPrompt = (
  sentence: BundledSentence,
  rounds: readonly Round[],
  last: boolean,
  bundle: ContextBundle,
): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const next = last
    ? ['- "next" is an empty string. This was the last round.']
    : [
        `- "next" is the follow-up prompt, in ${meaning}. Stay with the same grammar and register. After the first successful use, change one concrete fact again with less pattern guidance. After another success, ask for the same pattern in a fresh specific situation. Do not introduce a new tense, negation, connector, or politeness shift unless it is already demonstrated in the supplied material.`,
        '- If they lost the pattern, "next" asks them to repair their last answer, naming one target issue without supplying the correction. Keep the same facts and grammar.',
        `- "next" is one or two sentences and never contains the ${language} answer.`,
      ]

  return {
    instructions: [
      `You are running a short back-and-forth drill on one ${language} sentence pattern, for someone keeping a learning journal.`,
      profileLine(bundle.profile),
      productionRules(bundle),
      '',
      '- "right" is true when their answer reuses the pattern of the sentence correctly for what was asked. Something else being slightly off does not make it wrong.',
      `- "comment" is one line in ${meaning}. If it went wrong, what happened to the pattern. If it worked, briefly name what they used correctly. A simple complete answer needs no embellishment.`,
      `- "better" is a natural ${language} version of what they were trying to say. Correct only what needs fixing. If theirs was already natural, return it unchanged. Preserve its meaning and length.`,
      ...next,
      '- No praise, no scores, no exclamation marks.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [...itemLines(sentence), materialLines(bundle), '', exchangeLines(rounds), '', 'Mark the last answer.'].join(
          '\n',
        ),
      },
    ],
  }
}

/** One rung of help, by height. Concepts §16, and the same three heights as word drill. */
export const hintPrompt = (
  sentence: BundledSentence,
  ask: string,
  bundle: ContextBundle,
  rung: 0 | 1 | 2,
): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const rules: Record<0 | 1 | 2, string[]> = {
    0: [
      `- Say what the situation is actually asking for, in ${meaning}. What is going on and what they want to say.`,
      `- Do not say what to write. No ${language} at all.`,
      '- One sentence.',
    ],
    1: [
      `- Say, in ${meaning}, which part of the sentence stays and which part has to change, and name the ending or construction the change needs.`,
      `- Do not write a filled-in ${language} sentence.`,
      '- Two sentences at most.',
    ],
    2: [
      `- Write one natural ${language} sentence that answers the prompt using the pattern of the sentence.`,
      '- The sentence and nothing else. No translation, no note, no preamble.',
    ],
  }

  return {
    instructions: [
      `Someone learning ${language} is stuck on a drill prompt and has asked for help.`,
      profileLine(bundle.profile),
      productionRules(bundle),
      '',
      ...rules[rung],
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: [...itemLines(sentence), materialLines(bundle), `They were asked: ${ask}`].join('\n') }],
  }
}
