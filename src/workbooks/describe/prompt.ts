import { levelRules, materialLines } from '../level'
import type { ContextBundle } from '../sdk'
import type { Message } from '../../ai/text'

/**
 * The prompts for describe the picture. Technical plan §8.
 *
 * The one thing worth understanding here: every call after the first sends the picture back. The model
 * marks against an image it can actually see, which is what makes the picture load-bearing rather than
 * decorative and makes it its own answer key. Nothing has to remember what was drawn, because the
 * drawing is in the message.
 *
 * None of the image-reading calls go out `quick`. The non-reasoning model reads an `input_image` and
 * answered "rectangle" where the others read the glyph, measured 2026-09-18, so it is deliberately not
 * used anywhere an attachment is the point.
 */

/* ── the scene ────────────────────────────────────────────────────────────── */

export interface SceneBrief {
  /** What to draw, in English, for the image model. */
  imagePrompt: string
  /** The listed words whose referents are in the scene. */
  used: string[]
}

export const BRIEF_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['imagePrompt', 'used'],
  properties: {
    imagePrompt: {
      type: 'string',
      description:
        'What to draw, in English, for an illustrator who cannot see the word list. Two or three sentences of visible detail.',
    },
    used: {
      type: 'array',
      items: { type: 'string' },
      description: 'The listed words whose referents are actually visible in the scene, copied as written.',
    },
  },
}

export const isSceneBrief = (v: unknown): v is SceneBrief => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.imagePrompt === 'string' &&
    Array.isArray(o.used) &&
    o.used.every((u) => typeof u === 'string')
  )
}

/**
 * Turns the material into something to draw.
 *
 * Cheap, and worth the call rather than pasting the meanings together locally. "A bowl, side dishes, a
 * mother-in-law" gets an illustration of three objects on a white background; asking for a scene gets a
 * kitchen with those things in it, and only the second one can be described in sentences.
 */
export const briefPrompt = (bundle: ContextBundle): { instructions: string; input: Message[] } => ({
  instructions: [
    `You are briefing an illustrator for a language exercise. The learner will describe the picture in ${bundle.profile?.language ?? 'their target language'}.`,
    bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
    '',
    '- One everyday scene, with the things below visibly in it. Not a grid of objects on a white background.',
    '- Put in enough that there is something to say: people doing something, objects in places, a time of day.',
    '- Nothing that needs reading. No text, no signs, no labels, no writing of any kind in the picture.',
    '- The brief is in English. The words are not going to the illustrator, so describe the things rather than naming them.',
    '- "used" lists only the words whose referents are genuinely visible. Leave out anything abstract you could not draw.',
    '',
    materialLines(bundle),
  ]
    .filter((l) => l !== '')
    .join('\n'),
  input: [{ role: 'user', content: 'Brief the illustration.' }],
})

/* ── marking ──────────────────────────────────────────────────────────────── */

export interface Verdict {
  right: boolean
  comment: string
  /** Things in the picture they did not mention. In the meaning language. */
  missed: string[]
  /** A natural description at their level, in the target language. */
  better: string
}

export const VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['right', 'comment', 'missed', 'better'],
  properties: {
    right: { type: 'boolean' },
    comment: { type: 'string', description: 'One short line. What they got across.' },
    missed: {
      type: 'array',
      items: { type: 'string' },
      description: 'Things visible in the picture they did not mention, in the meaning language.',
    },
    better: {
      type: 'string',
      description: 'A natural description of the picture in the target language, at their level.',
    },
  },
}

export const isVerdict = (v: unknown): v is Verdict => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.right === 'boolean' &&
    typeof o.comment === 'string' &&
    typeof o.better === 'string' &&
    Array.isArray(o.missed) &&
    o.missed.every((m) => typeof m === 'string')
  )
}

/**
 * Marks a description against the picture it describes.
 *
 * `right` is generous, as everywhere else in this app: the question is whether someone who could not
 * see the picture would now know what is in it. `missed` is the part that earns the image being sent —
 * only a marker looking at the picture can say what was left out of it.
 */
export const markPrompt = (
  bundle: ContextBundle,
  imageDataUrl: string,
  description: string,
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You are marking a ${language} description of the attached picture, for someone keeping a learning journal.`,
      bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
      '',
      '- "right" is true when someone who could not see the picture would now know what is in it. Grammar slips do not make it wrong.',
      `- "comment" is one line in ${meaning}. What they got across.`,
      `- "missed" lists things visible in the picture they did not mention, in ${meaning}. Empty if they covered it.`,
      `- "better" is a natural ${language} description of the picture.`,
      '- No praise, no scores, no exclamation marks.',
      '',
      levelRules(bundle),
      '',
      materialLines(bundle),
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: imageDataUrl },
          { type: 'input_text', text: `They wrote:\n${description}` },
        ],
      },
    ],
  }
}

/* ── the ladder ───────────────────────────────────────────────────────────── */

/**
 * One rung of help, all three reading the picture.
 *
 * Rung 2 is the one this workbook exists for: the notebook's own words for things that are actually in
 * the picture. A dictionary can tell you a word; only the notebook can tell you which of the words you
 * already collected is the one on the table in front of you.
 */
export const hintPrompt = (
  bundle: ContextBundle,
  imageDataUrl: string,
  rung: 0 | 1 | 2,
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const rules: Record<0 | 1 | 2, string[]> = {
    0: [
      `- Name three things you can see in the picture, in ${meaning}.`,
      `- A comma-separated list and nothing else. No ${language} at all.`,
    ],
    1: [
      '- Pick two objects in the picture that are in the notebook list below, and give their words.',
      '- Two lines, each "word — meaning". Nothing else.',
      '- If fewer than two of the listed words are visible, give however many are.',
    ],
    2: [
      `- Write two or three sentences of natural ${language} describing the picture.`,
      '- The description and nothing else. No translation, no note.',
      '',
      levelRules(bundle),
      '',
      materialLines(bundle),
    ],
  }

  return {
    instructions: [
      `Someone learning ${language} is describing the attached picture and is stuck.`,
      '',
      ...rules[rung],
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_image', image_url: imageDataUrl },
          {
            type: 'input_text',
            text:
              rung === 1
                ? `Already in the notebook:\n${bundle.words.map((w) => (w.word.meaning ? `${w.word.term} — ${w.word.meaning}` : w.word.term)).join('\n')}`
                : 'Help them.',
          },
        ],
      },
    ],
  }
}
