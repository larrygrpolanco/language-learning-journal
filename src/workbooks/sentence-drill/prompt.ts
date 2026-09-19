import type { BundledSentence, ContextBundle, NotebookProfile } from '../sdk'
import { exchangeLines, type Built, type Round } from '../drill'

/**
 * The prompts for sentence-drill. Technical plan §8.
 *
 * A collected sentence is a pattern with some words in it. Saying it back proves nothing, so every cue
 * here asks for the pattern bent to a new situation: a different thing, a different time, a different
 * listener. That is the difference between knowing a sentence and being able to use it.
 *
 * All quick-model calls, like word drill's, and for the same reason the angle is picked in code.
 */

const profileLine = (profile: NotebookProfile | undefined): string =>
  profile?.focus ? `This notebook is for: ${profile.focus}` : ''

/** The ways a cue can bend a sentence. Each changes one thing and keeps the rest of the pattern. */
const ANGLES: readonly string[] = [
  'Same pattern, different content: a different thing, person or place in a new situation.',
  'Change the time: the same kind of thing, but something that already happened or is going to happen.',
  'Someone says this sentence, or one like it, to them. They reply.',
  'They are saying it to someone of a different standing (a close friend rather than an elder, or the reverse), so the politeness level changes.',
  'The opposite situation: they need the negative, or to turn it down.',
  'They need to turn it into a question to ask someone, or, if it is a question, to answer it.',
  'Extend it: the same sentence with a reason, a time or a condition added.',
]

const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)]

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
      '',
      `- Write the prompt in ${meaning}. Never include the ${language} answer in it, and do not repeat the sentence.`,
      '- The answer should reuse the sentence\'s pattern, its grammar and its key phrase, in a new situation. Not repeat it.',
      `- The angle for this one: ${pick(ANGLES) ?? ''}`,
      '- Give a specific situation: who they are talking to and what is going on. Then ask what they would say.',
      '- One or two sentences. No preamble, no "Try to", no encouragement.',
      '- Keep it plausible for this notebook rather than generic.',
      '- Reply with the prompt itself and nothing else.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: itemLines(sentence).join('\n') }],
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
        `- "next" is the follow-up prompt, in ${meaning}. Carry the situation on: react to what they said the way the other person would, then ask them to bend the pattern a different way than last time: another time, another listener, the negative, a question, or a reason added.`,
        '- If they lost the pattern, "next" gives them another go at the same change in a slightly different situation.',
        `- "next" is one or two sentences and never contains the ${language} answer.`,
      ]

  return {
    instructions: [
      `You are running a short back-and-forth drill on one ${language} sentence pattern, for someone keeping a learning journal.`,
      profileLine(bundle.profile),
      '',
      '- "right" is true when their answer reuses the pattern of the sentence correctly for what was asked. Something else being slightly off does not make it wrong.',
      `- "comment" is one line in ${meaning}. If it went wrong, what happened to the pattern. If it worked but was plain, the one thing that would make it sound more natural. Nothing else.`,
      `- "better" is a natural ${language} version of what they were trying to say. If theirs was already natural, add one natural touch. Keep it close enough to theirs to compare.`,
      ...next,
      '- No praise, no scores, no exclamation marks.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [...itemLines(sentence), '', exchangeLines(rounds), '', 'Mark the last answer.'].join(
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
      '',
      ...rules[rung],
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: [...itemLines(sentence), `They were asked: ${ask}`].join('\n') }],
  }
}
