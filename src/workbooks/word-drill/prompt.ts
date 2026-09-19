import type { BundledWord, ContextBundle, NotebookProfile } from '../sdk'
import { exchangeLines, type Built, type Round } from '../drill'

/**
 * The prompts for word-drill. Technical plan §8 keeps teaching logic per workbook, so it lives here
 * rather than in `ai/`.
 *
 * All of these go to the quick model, which does not deliberate. So anything that needs a decision
 * the model would otherwise have to reason its way to is made here in code instead: which angle a cue
 * takes is picked at random below, rather than asking the model to be varied and getting the same
 * "how would you say you did X" eight times.
 */

const profileLine = (profile: NotebookProfile | undefined): string =>
  profile?.focus ? `This notebook is for: ${profile.focus}` : ''

/**
 * The ways a cue can come at a word. Each forces something a bare "I X" does not supply: a form of
 * the word, a second clause, a listener, or a second word.
 */
const ANGLES: readonly ((other: BundledWord | undefined) => string)[] = [
  () =>
    'Someone has just said something to them. Give that person\'s line, and ask how they would reply using the word.',
  () => 'They need to give a reason or an excuse, so the answer needs a "because" or a "so".',
  () => 'Something that already happened. They are telling someone about it, so the answer is in the past.',
  () => 'They need to ask someone something, so the answer is a question with the word in it.',
  () =>
    'They need to turn something down, disagree, or say something has not happened yet, so the answer is negative.',
  () => 'They are offering to do something for someone, or saying what they are about to do.',
  (other) =>
    other
      ? `The situation needs both this word and "${other.word.term}"${other.word.meaning ? ` (${other.word.meaning})` : ''}. Name that second word in the prompt as written.`
      : 'They are telling someone what someone else did, so the answer is about a third person.',
]

const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)]

/**
 * Asks for one cue for a word.
 *
 * The cue is a use, not a definition. "How would you tell your mother-in-law you will clear the table"
 * is a prompt worth answering; "what does 치우다 mean" is a flashcard, and the learner already has the
 * meaning written next to the word on the words screen.
 */
export const cuePrompt = (word: BundledWord, bundle: ContextBundle): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'
  const other = pick(bundle.words.filter((w) => w.word.id !== word.word.id))
  const angle = pick(ANGLES)?.(other) ?? ''

  return {
    instructions: [
      `You write one drill prompt for someone learning ${language}.`,
      profileLine(bundle.profile),
      '',
      `- Write the prompt in ${meaning}. Never include the ${language} answer in it.`,
      '- Give a specific situation: who they are talking to and what just happened or what they want. Then ask what they would say.',
      `- The angle for this one: ${angle}`,
      '- It must not be answerable with a bare textbook sentence. If three words would do, make the situation ask for more.',
      '- One or two sentences. No preamble, no "Try to", no encouragement.',
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
        ]
          .filter((l) => l !== '')
          .join('\n'),
      },
    ],
  }
}

/**
 * Marks one answer, and asks for the next round unless this was the last.
 *
 * Generous on purpose. This is a journal, not an exam: an answer that uses the word correctly counts
 * even if something else in the sentence is off, and the better version carries the correction instead.
 *
 * The follow-up is written by the same call rather than a second one, because it has to react to what
 * they wrote and this is the call that has read it. It carries the situation on and asks for something
 * the last answer did not need, which is what stops a right answer from being the end of the word.
 */
export const markPrompt = (
  word: BundledWord,
  rounds: readonly Round[],
  last: boolean,
  bundle: ContextBundle,
): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const next = last
    ? ['- "next" is an empty string. This was the last round.']
    : [
        `- "next" is the follow-up prompt, in ${meaning}. Carry the situation on: react to what they said the way the other person would, then ask for something their last answer did not need. A different form of ${word.word.term} (past, negative, a question, more or less polite), a reason, a consequence, or a detail.`,
        `- If they got ${word.word.term} wrong, "next" gives them another go at the same kind of use in a slightly different situation.`,
        `- "next" is one or two sentences and never contains the ${language} answer.`,
      ]

  return {
    instructions: [
      `You are running a short back-and-forth drill on one ${language} word, for someone keeping a learning journal.`,
      profileLine(bundle.profile),
      '',
      `- "right" is true when they used ${word.word.term} in a way that works. Something else being slightly off does not make it wrong.`,
      `- "comment" is one line in ${meaning}. If it went wrong, what went wrong. If it worked but was plain, the one thing that would make it sound more natural. Nothing else.`,
      `- "better" is a natural ${language} version of what they were trying to say. If theirs was already natural, add one natural touch: a connector, an ending, a small detail. Keep it close enough to theirs to compare.`,
      ...next,
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
          '',
          exchangeLines(rounds),
          '',
          'Mark the last answer.',
        ].join('\n'),
      },
    ],
  }
}

/* ── the ladder ───────────────────────────────────────────────────────────── */

/**
 * One rung of help, by height. Concepts §16.
 *
 * Three separate prompts rather than one call returning all three, because only the rungs actually
 * pressed should be paid for and most of the time that is none of them. That also keeps §1 true: each
 * rung is its own press.
 *
 * Rung 2 is deliberately the harder one to write. "The shape of the answer" has to be enough to
 * unstick someone without being the answer with a word missing, which is why it asks for the grammar
 * by name and forbids a filled-in example.
 */
export const hintPrompt = (
  word: BundledWord,
  ask: string,
  bundle: ContextBundle,
  rung: 0 | 1 | 2,
): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const rules: Record<0 | 1 | 2, string[]> = {
    0: [
      `- Say what the situation is actually asking for, in ${meaning}. What is going on and what they want to achieve.`,
      `- Do not say what to write. No ${language} at all, not even the word being drilled.`,
      '- One sentence.',
    ],
    1: [
      `- Give the shape of an answer, in ${meaning}: which ending or construction it wants, and roughly how long.`,
      `- Name the grammar. Do not write a filled-in ${language} sentence, and do not use the drilled word in a sentence.`,
      '- Two sentences at most.',
    ],
    2: [
      `- Write one natural ${language} sentence that answers the prompt using ${word.word.term}.`,
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
    input: [
      {
        role: 'user',
        content: [
          `Word being drilled: ${word.word.term}`,
          word.word.meaning ? `Meaning: ${word.word.meaning}` : '',
          `They were asked: ${ask}`,
        ]
          .filter((l) => l !== '')
          .join('\n'),
      },
    ],
  }
}
