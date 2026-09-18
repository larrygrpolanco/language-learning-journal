import { levelRules, materialLines } from '../level'
import type { ContextBundle } from '../sdk'
import type { Message } from '../../ai/text'

/**
 * The prompts for the illustrated story. Technical plan §8.
 *
 * Two shapes again: one setup call that offers places and companions, then one call per scene. The
 * scene call carries the story so far as prose, not as messages, because what matters is what happened
 * rather than who said it — this is narration, not a conversation.
 */

/* ── the setup ────────────────────────────────────────────────────────────── */

export interface StorySetup {
  places: string[]
  companions: string[]
}

export const SETUP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['places', 'companions'],
  properties: {
    places: {
      type: 'array',
      items: { type: 'string' },
      description: 'Three places, in the meaning language. Short phrases.',
    },
    companions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Three people to go with, in the meaning language. Short phrases.',
    },
  },
}

export const isStorySetup = (v: unknown): v is StorySetup => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string')
  return strings(o.places) && strings(o.companions)
}

/**
 * Asks where this could go and who with.
 *
 * Drawn from the notebook's focus and the titles and bodies of its entries, because those are places
 * and people the learner has actually been and met. `Entry.topic` exists in the schema and would have
 * been the obvious source; nothing has ever written it and there is no UI to set it, so the entries
 * themselves are both the only source and the better one.
 */
export const setupPrompt = (bundle: ContextBundle): { instructions: string; input: Message[] } => {
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `You are setting up a short choose-your-own story for someone learning ${bundle.profile?.language ?? 'a language'}.`,
      bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
      '',
      `- Offer three places and three companions, all in ${meaning}.`,
      '- Draw them from what this notebook is for and from the entries below. Somewhere they have been, someone they know.',
      '- Short. Two or three words each, the way you would tap it rather than read it.',
      '- No adventure-fiction settings unless the notebook is about that. A kitchen is a fine place for a story.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: entriesBlock(bundle) }],
  }
}

const entriesBlock = (bundle: ContextBundle): string => {
  if (bundle.entries.length === 0) return 'There are no entries yet.'
  return bundle.entries
    .map((e) => [e.title ? `## ${e.title}` : `## ${e.date.slice(0, 10)}`, e.body ?? ''].join('\n'))
    .join('\n\n')
}

/* ── one scene ────────────────────────────────────────────────────────────── */

export interface Scene {
  /** Two to four sentences of narration, in the target language. */
  prose: string
  /** What to do next, in the target language. Empty when the story has ended. */
  choices: string[]
  /** A visual description of this scene, in English, for the image model. */
  imagePrompt: string
  used: string[]
}

export const SCENE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['prose', 'choices', 'imagePrompt', 'used'],
  properties: {
    prose: { type: 'string', description: 'Two to four sentences of narration, in the target language.' },
    choices: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Two or three things they could do next, in the target language. An empty array ends the story.',
    },
    imagePrompt: {
      type: 'string',
      description:
        'What this scene looks like, in English, for an illustrator who has not read the story. One or two sentences of visible detail.',
    },
    used: {
      type: 'array',
      items: { type: 'string' },
      description: 'The listed words and sentences this scene used, copied as written.',
    },
  },
}

export const isScene = (v: unknown): v is Scene => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === 'string')
  return (
    typeof o.prose === 'string' &&
    typeof o.imagePrompt === 'string' &&
    strings(o.choices) &&
    strings(o.used)
  )
}

/** How many scenes before it has to end. Bounded because each one is a call and often an image too. */
export const LAST_SCENE = 6

export interface StoryChoice {
  prose: string
  chose: string
}

/**
 * The next scene, given where the story has been.
 *
 * The scene number and the cap go in the prompt so the story closes rather than running until the
 * learner gets bored. An unbounded story is also an unbounded bill once pictures are on, and §1 puts
 * every call behind a press precisely so the learner can see what they are spending.
 */
export const scenePrompt = (
  bundle: ContextBundle,
  setup: { place: string; companion: string },
  history: readonly StoryChoice[],
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const scene = history.length + 1

  const instructions = [
    `You are writing a short illustrated story in ${language}, one scene at a time, for someone learning it.`,
    bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
    `It is set at: ${setup.place}. They are with: ${setup.companion}.`,
    '',
    '- Write the narration in second person, as things happening to the reader.',
    '- Two to four sentences. Then two or three things they could do next.',
    `- This is scene ${scene} of at most ${LAST_SCENE}.`,
    scene >= LAST_SCENE
      ? '- End the story here. Return an empty choices array.'
      : `- If the story has reached a natural ending, end it and return an empty choices array. Otherwise keep going.`,
    '- The choices are actions, not answers to a question. Each one should lead somewhere different.',
    '- imagePrompt is in English and describes only what is visible. No text in the picture, no words on signs.',
    '',
    levelRules(bundle),
    '',
    materialLines(bundle),
  ]
    .filter((l) => l !== '')
    .join('\n')

  const content =
    history.length === 0
      ? 'Begin the story.'
      : history.map((h) => `${h.prose}\n\n> ${h.chose}`).join('\n\n')

  return { instructions, input: [{ role: 'user', content }] }
}

/* ── the ladder ───────────────────────────────────────────────────────────── */

/**
 * One rung of help on a scene. Concepts §16.
 *
 * Rung 2 is the one worth noting: the app knows every word in the notebook but cannot segment Korean
 * to work out which words in the scene are not among them, so it hands the model the list and asks for
 * the difference. That is the notebook doing something a dictionary cannot.
 */
export const hintPrompt = (
  bundle: ContextBundle,
  prose: string,
  rung: 0 | 1 | 2,
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const rules: Record<0 | 1 | 2, string[]> = {
    0: [
      `- Say what is happening in the scene, in ${meaning}. One sentence, the gist and no more.`,
      `- Do not translate it and do not quote any ${language}.`,
    ],
    1: [
      `- List the words in the scene that are NOT in the notebook list below, with a short ${meaning} gloss each.`,
      '- One per line, as "word — meaning". Nothing else, no preamble.',
      '- Skip particles and endings. Only words worth knowing.',
    ],
    2: [`- Translate the scene into natural ${meaning}.`, '- The translation and nothing else.'],
  }

  const input: Message[] = [
    {
      role: 'user',
      content: [
        `Scene:\n${prose}`,
        rung === 1
          ? `\nAlready in the notebook:\n${bundle.words.map((w) => w.word.term).join(', ')}`
          : '',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    },
  ]

  return {
    instructions: [
      `Someone learning ${language} is reading a scene from a story and has asked for help.`,
      '',
      ...rules[rung],
    ].join('\n'),
    input,
  }
}
