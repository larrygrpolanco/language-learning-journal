import { productionRules } from '../pedagogy'
import type { BundledWord, ContextBundle, NotebookProfile } from '../sdk'
import { exchangeLines, type Built, type Round } from '../drill'
import { materialLines } from '../level'

/**
 * The prompts for word-drill. Technical plan §8 keeps teaching logic per workbook, so it lives here
 * rather than in `ai/`.
 *
 * Cues start from a concrete use supported by the notebook. Follow-ups keep the learning target
 * stable rather than choosing new grammar at random.
 */

const profileLine = (profile: NotebookProfile | undefined): string =>
  profile?.focus ? `This notebook is for: ${profile.focus}` : ''

/** The whole vocabulary, plus examples of how the learner has been using it. */
const learningContext = (bundle: ContextBundle): string =>
  [
    bundle.profile?.title ? `Notebook: ${bundle.profile.title}` : '',
    materialLines(bundle),
    ...bundle.words
      .filter((w) => w.word.note)
      .map((w) => `Note for ${w.word.term}: ${w.word.note}`),
    ...bundle.sentences
      .filter((s) => s.sentence.note)
      .map((s) => `Note for ${s.sentence.text}: ${s.sentence.note}`),
    bundle.entries.length > 0 ? 'Recent notebook entries (learning context):' : '',
    ...bundle.entries.map((e) =>
      [e.date, e.title, e.body].filter((line) => line !== undefined && line !== '').join('\n'),
    ),
  ]
    .filter(Boolean)
    .join('\n\n')

/** Apply the same limits to cues, follow-ups, corrections, and help. */
const beginnerRules = [
  '- The learner is a beginner practicing everyday speech. One short, simple sentence is a complete answer.',
  '- Build the expected answer from the notebook vocabulary below, plus basic everyday words, particles, pronouns, and endings. If that needs unfamiliar vocabulary, simplify the task.',
  '- Look across the other notebook words, saved sentences, notes, and recent entries to understand what they are learning. Prefer a familiar topic and a basic sentence pattern already in the notebook.',
  '- Naturally combine the target word with another familiar notebook word when they fit in one simple sentence. For example, a known person, place, or time word can support the target. Do not force unrelated words together or turn this into a vocabulary checklist.',
  '- Saved sentences and entries show learning context, not proof of mastery. Reuse their simplest patterns and do not copy their harder grammar or invent personal details.',
  '- Use basic grammar and ordinary polite speech. Do not require reasons, explanations, multiple clauses, or special politeness shifts.',
  '- Each prompt asks for just one thing in one short sentence, ideally 6–14 words in English or a similarly brief line in the requested language. No backstory or multi-step tasks.',
  '- For example, for a word meaning "to get married": "Ask your friend if they are married." or "Say you want to get married." Never ask for wedding plans, an offer of help, or several details.',
].join('\n')

/**
 * Asks for one cue for a word.
 *
 * Ask for an everyday use of the word, answerable with one basic sentence.
 */
export const cuePrompt = (word: BundledWord, bundle: ContextBundle): Built => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You write one drill prompt for someone learning ${language}.`,
      profileLine(bundle.profile),
      productionRules(bundle),
      beginnerRules,
      '',
      `- Write the prompt in ${meaning}. Never include the ${language} answer in it.`,
      '- First round: specify one concrete message to express using a simple pattern found in the notebook. Prefer a statement; require a question or negative only when the notebook provides that form.',
      '- A short textbook sentence is welcome. No preamble, no encouragement.',
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
          learningContext(bundle),
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
 * they wrote and this is the call that has read it. Follow-ups first support repair, then fade guidance while keeping the same pattern and level.
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
        `- "next" is the follow-up prompt, in ${meaning}. Keep practicing the same use of ${word.word.term}: first change one concrete fact in the same pattern, then ask for a fresh short use without a pattern hint. Keep grammar at the same beginner level; do not add reasons, consequences, or extra details.`,
        `- If they got ${word.word.term} wrong, "next" asks them to repair the same sentence with one specific cue about the target error, without giving the corrected answer. Do not switch to a new task before they can repair it.`,
        `- "next" is one short sentence and never contains the ${language} answer.`,
      ]

  return {
    instructions: [
      `You are running a short back-and-forth drill on one ${language} word, for someone keeping a learning journal.`,
      profileLine(bundle.profile),
      productionRules(bundle),
      beginnerRules,
      '',
      `- "right" is true only when the answer fulfills the last cue and uses ${word.word.term} with the intended meaning and form. A correct word in an unrelated sentence is not enough. Minor unrelated slips do not make it wrong.`,
      `- "comment" is one line in ${meaning}. If it went wrong, what went wrong. If it worked, briefly say that the usage is correct. Do not treat a simple answer as a problem.`,
      `- "better" is a natural ${language} version of what they were trying to say. Correct only what needs fixing and keep it short and beginner-friendly. If theirs was already natural, return it unchanged. Do not add connectors or details.`,
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
          learningContext(bundle),
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
 * unstick someone without being the answer with a word missing, so it describes the basic pattern
 * in plain language and forbids a filled-in example.
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
      `- Describe the basic pattern in plain language. Do not write a filled-in ${language} sentence, and do not use the drilled word in a sentence.`,
      '- One short sentence.',
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
      productionRules(bundle),
      beginnerRules,
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
          learningContext(bundle),
        ]
          .filter((l) => l !== '')
          .join('\n'),
      },
    ],
  }
}
