import type { BundledWord, ContextBundle, NotebookProfile } from '../sdk'
import type { Message } from '../../ai/text'

/**
 * The prompts for word-drill. Technical plan §8 keeps teaching logic per workbook, so it lives here
 * rather than in `ai/`.
 *
 * Two calls, and both are cheap on purpose. Making a question is one short answer, and marking is one
 * verdict. Neither is worth `high` reasoning effort on someone's own key.
 */

export interface Prompt {
  /** What the learner is asked, in the meaning language. */
  ask: string
}

const profileLine = (profile: NotebookProfile | undefined): string =>
  profile?.focus ? `This notebook is for: ${profile.focus}` : ''

/**
 * Asks for one cue for a word.
 *
 * The cue is a use, not a definition. "How would you tell your mother-in-law you will clear the table"
 * is a prompt worth answering; "what does 치우다 mean" is a flashcard, and the learner already has the
 * meaning written next to the word on the words screen.
 */
export const cuePrompt = (
  word: BundledWord,
  bundle: ContextBundle,
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You write one drill prompt for someone learning ${language}.`,
      profileLine(bundle.profile),
      '',
      `- Write the prompt in ${meaning}. Never include the ${language} answer in it.`,
      '- Ask for a real use, not a definition. Give a situation and ask what they would say.',
      '- One sentence. No preamble, no "Try to", no encouragement.',
      '- Keep it plausible for this notebook rather than generic.',
      '- Reply with the prompt itself and nothing else.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [
          `Word: ${word.word.term}`,
          word.word.meaning ? `Meaning: ${word.word.meaning}` : '',
          word.word.note ? `Note: ${word.word.note}` : '',
          `They have met it ${word.signals.timesEncountered} time(s) and it reads as "${word.signals.familiarity}".`,
        ]
          .filter((l) => l !== '')
          .join('\n'),
      },
    ],
  }
}

/** What marking comes back as. Kept small because everything here is shown verbatim. */
export interface Verdict {
  /** Did they use the word acceptably? */
  right: boolean
  /** One line, shown under the answer. */
  comment: string
  /** A natural way to say it, in the target language. Always given, right or wrong. */
  better: string
}

export const VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['right', 'comment', 'better'],
  properties: {
    right: { type: 'boolean' },
    comment: { type: 'string', description: 'One short line. What worked or what did not.' },
    better: { type: 'string', description: 'A natural version, in the target language.' },
  },
}

export const isVerdict = (v: unknown): v is Verdict => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.right === 'boolean' && typeof o.comment === 'string' && typeof o.better === 'string'
  )
}

/**
 * Marks one answer.
 *
 * Generous on purpose. This is a journal, not an exam: an answer that uses the word correctly counts
 * even if something else in the sentence is off, and the better version carries the correction instead.
 */
export const markPrompt = (
  word: BundledWord,
  ask: string,
  answer: string,
  bundle: ContextBundle,
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You are marking one short ${language} answer for someone keeping a learning journal.`,
      profileLine(bundle.profile),
      '',
      `- "right" is true when they used ${word.word.term} in a way that works. Something else being slightly off does not make it wrong.`,
      `- "comment" is one line in ${meaning}. Say what worked, or what went wrong, and nothing else.`,
      `- "better" is a natural ${language} version of what they were trying to say. Give it whether they were right or not.`,
      '- No praise, no scores, no exclamation marks.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [
          `Word being drilled: ${word.word.term}`,
          word.word.meaning ? `Meaning: ${word.word.meaning}` : '',
          `They were asked: ${ask}`,
          `They answered: ${answer}`,
        ]
          .filter((l) => l !== '')
          .join('\n'),
      },
    ],
  }
}
