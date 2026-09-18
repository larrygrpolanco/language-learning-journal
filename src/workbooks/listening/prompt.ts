import { levelRules, materialLines } from '../level'
import type { ContextBundle } from '../sdk'
import type { Message } from '../../ai/text'

/**
 * The prompts for the listening dialog. Technical plan §8.
 *
 * One call makes the whole thing: the turns, and the questions that check whether it was understood.
 * Generating the questions with the dialog rather than after it means they are about what was actually
 * said, and it means listening costs one call rather than two.
 */

export interface DialogTurn {
  /** 0 or 1. Which of the two speakers, and therefore which voice. */
  speaker: number
  line: string
}

export interface Dialog {
  /** The two speakers' names, in the order the `speaker` index refers to. */
  speakers: string[]
  turns: DialogTurn[]
  /** Two or three questions about the dialog, in the meaning language. */
  questions: string[]
  used: string[]
}

export const DIALOG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['speakers', 'turns', 'questions', 'used'],
  properties: {
    speakers: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly two names, in the target language. The turns index into this.',
    },
    turns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['speaker', 'line'],
        properties: {
          speaker: { type: 'integer', description: '0 for the first speaker, 1 for the second.' },
          line: { type: 'string', description: 'What they say, in the target language.' },
        },
      },
    },
    questions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Two or three questions about what was said, in the meaning language. Answerable from the dialog alone.',
    },
    used: {
      type: 'array',
      items: { type: 'string' },
      description: 'The listed sentences and words this dialog used, copied as written.',
    },
  },
}

export const isDialog = (v: unknown): v is Dialog => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string')

  if (!strings(o.speakers) || (o.speakers as string[]).length < 2) return false
  if (!strings(o.questions) || (o.questions as string[]).length === 0) return false
  if (!strings(o.used)) return false
  if (!Array.isArray(o.turns) || o.turns.length === 0) return false

  return o.turns.every((t: unknown) => {
    if (typeof t !== 'object' || t === null) return false
    const turn = t as Record<string, unknown>
    return typeof turn.speaker === 'number' && typeof turn.line === 'string'
  })
}

/**
 * A dialog built out of the sentences the learner has collected.
 *
 * Sentence-led on purpose. The mock's line for this row says it uses your sentences, and it is right to:
 * a dialog assembled from words is a vocabulary list read aloud, where a dialog assembled from sentences
 * you have already written down is your own material coming back at conversational speed, which is the
 * thing that is actually hard.
 */
export const dialogPrompt = (bundle: ContextBundle): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You are writing a short two-person dialog in ${language} for someone learning it to listen to.`,
      bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
      '',
      '- Six to eight turns, alternating. Two speakers, named plausibly for this notebook.',
      '- Build it around the sentences listed below. Use them close to as written, in a situation where someone would say them.',
      '- Spoken register. Contractions, fragments, the way people actually talk. This is heard, not read.',
      '- One line per turn. Nothing anyone would need to read twice.',
      `- The questions are in ${meaning} and answerable from the dialog alone. Ask about what happened, not about grammar.`,
      '',
      levelRules(bundle),
      '',
      materialLines(bundle),
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: 'Write the dialog.' }],
  }
}

/* ── marking ──────────────────────────────────────────────────────────────── */

export interface Marks {
  marks: { right: boolean; comment: string }[]
}

export const MARKS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['marks'],
  properties: {
    marks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['right', 'comment'],
        properties: {
          right: { type: 'boolean' },
          comment: { type: 'string', description: 'One short line. What they got, or what they missed.' },
        },
      },
    },
  },
}

export const isMarks = (v: unknown): v is Marks => {
  if (typeof v !== 'object' || v === null) return false
  const marks = (v as Record<string, unknown>).marks
  if (!Array.isArray(marks)) return false
  return marks.every((m: unknown) => {
    if (typeof m !== 'object' || m === null) return false
    const o = m as Record<string, unknown>
    return typeof o.right === 'boolean' && typeof o.comment === 'string'
  })
}

/**
 * Marks the answers, all of them in one call.
 *
 * Generous in the same way word drill is: this tests whether they heard it, so an answer that shows
 * they followed what happened counts even if it is loosely worded. Nothing is recorded from this, which
 * is deliberate — getting a listening question right is one guess away from luck, and a journal that
 * counted it would be telling the learner something it does not know.
 */
export const markPrompt = (
  bundle: ContextBundle,
  dialog: Dialog,
  answers: readonly string[],
): { instructions: string; input: Message[] } => {
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You are marking listening comprehension answers for someone keeping a learning journal.`,
      '',
      '- One mark per question, in order. Every question gets one.',
      '- "right" is true when their answer shows they followed what happened. Loose wording is fine.',
      `- "comment" is one line in ${meaning}. What they got, or what they missed. Nothing else.`,
      '- No praise, no scores, no exclamation marks.',
      '- An empty answer is wrong, and the comment says what the answer was.',
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [
          'Dialog:',
          transcript(dialog),
          '',
          ...dialog.questions.map((q, i) => `Q: ${q}\nA: ${answers[i]?.trim() ?? ''}`),
        ].join('\n'),
      },
    ],
  }
}

/** The dialog as text. What marking reads, what the reveal shows, and what rung 3 hands over. */
export const transcript = (dialog: Dialog): string =>
  dialog.turns.map((t) => `${dialog.speakers[t.speaker === 1 ? 1 : 0]}: ${t.line}`).join('\n')

/* ── the ladder ───────────────────────────────────────────────────────────── */

/**
 * The first rung. The other two are free.
 *
 * Rungs two and three hand over text the app is already holding back, so they cost nothing and need no
 * prompt: withholding the transcript is the whole exercise, and giving it up is the whole help. Only
 * this one needs a model, because "who is asking for what" is a reading of the dialog rather than a
 * part of it.
 */
export const gistPrompt = (
  bundle: ContextBundle,
  dialog: Dialog,
): { instructions: string; input: Message[] } => {
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `Someone learning ${bundle.profile?.language ?? 'a language'} is listening to a dialog and is stuck.`,
      '',
      `- Say which speaker is asking for something and roughly what it is about, in ${meaning}.`,
      '- One sentence. Do not quote any of the dialog and do not translate any of it.',
    ].join('\n'),
    input: [{ role: 'user', content: transcript(dialog) }],
  }
}
