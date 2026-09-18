import { levelRules, materialLines } from '../level'
import type { ContextBundle } from '../sdk'
import type { Message } from '../../ai/text'

/**
 * The prompts for the text-message roleplay. Technical plan §8 keeps teaching logic per workbook.
 *
 * Two shapes: one setup call that proposes people to write to, and one call per turn. The turn call
 * carries the whole thread back, which is why `AI.complete` taking `Message[]` matters here in a way
 * it did not for word drill.
 */

/* ── the setup ────────────────────────────────────────────────────────────── */

export interface Person {
  /** What she is called, in the target language if that is how the entries name her. */
  name: string
  /** Who they are to you, in the meaning language. */
  who: string
  /** What the thread is about, in the meaning language. */
  situation: string
  /** What you are trying to get out of it, in the meaning language. */
  task: string
  /** True when this person was actually named in an entry, rather than invented to fit the notebook. */
  fromEntries: boolean
}

export interface Setup {
  people: Person[]
}

export const SETUP_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['people'],
  properties: {
    people: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'who', 'situation', 'task', 'fromEntries'],
        properties: {
          name: { type: 'string' },
          who: { type: 'string', description: 'Who they are to the learner. One short phrase.' },
          situation: {
            type: 'string',
            description: 'What the thread is about. One sentence, in the meaning language.',
          },
          task: {
            type: 'string',
            description:
              'One concrete thing to get out of the conversation, in the meaning language. Achievable in a handful of messages.',
          },
          fromEntries: {
            type: 'boolean',
            description: 'True only if this person is actually named or described in the entries.',
          },
        },
      },
    },
  },
}

export const isSetup = (v: unknown): v is Setup => {
  if (typeof v !== 'object' || v === null) return false
  const people = (v as Record<string, unknown>).people
  if (!Array.isArray(people) || people.length === 0) return false
  return people.every((p: unknown) => {
    if (typeof p !== 'object' || p === null) return false
    const o = p as Record<string, unknown>
    return (
      typeof o.name === 'string' &&
      typeof o.who === 'string' &&
      typeof o.situation === 'string' &&
      typeof o.task === 'string' &&
      typeof o.fromEntries === 'boolean'
    )
  })
}

/**
 * Asks who is worth writing to.
 *
 * Entry bodies are in the request for exactly this: the people in someone's life are named in what
 * they wrote, not in a field. `fromEntries` is the honest part — a notebook with no people in it still
 * gets plausible ones, and the flag is what lets the picker say which is which rather than implying a
 * real person the learner never mentioned.
 */
export const setupPrompt = (bundle: ContextBundle): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  return {
    instructions: [
      `Someone is learning ${language} and keeps a journal about it. You are setting up a text-message conversation for them to practise in.`,
      bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
      '',
      '- Propose three or four people, most plausible first.',
      '- Read the entries for people they actually mention. Set fromEntries true only for those.',
      '- If the entries name nobody, invent people who fit what this notebook is for, with fromEntries false.',
      `- "who", "situation" and "task" are all in ${meaning}. "name" is however the entries write it.`,
      '- A task is one concrete outcome: getting agreement on a time, getting someone to bring something, putting something off without offence. Not "have a chat".',
      '- Nothing generic. A thread with this person about this, not a language-textbook dialogue.',
    ]
      .filter((l) => l !== '')
      .join('\n'),
    input: [{ role: 'user', content: entriesBlock(bundle) }],
  }
}

/** The entries, titles and bodies, as the only place people's names live. */
const entriesBlock = (bundle: ContextBundle): string => {
  if (bundle.entries.length === 0) return 'There are no entries yet.'
  return bundle.entries
    .map((e) => [e.title ? `## ${e.title}` : `## ${e.date.slice(0, 10)}`, e.body ?? ''].join('\n'))
    .join('\n\n')
}

/* ── one turn ─────────────────────────────────────────────────────────────── */

export interface TurnReply {
  /** Her message, in the target language. */
  line: string
  /** True once the task has actually been achieved, not merely discussed. */
  done: boolean
  /** Which of the supplied words and sentences she used. */
  used: string[]
}

export const TURN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['line', 'done', 'used'],
  properties: {
    line: { type: 'string', description: 'Your next message. One or two sentences.' },
    done: {
      type: 'boolean',
      description:
        'True only when the task has actually been achieved in the conversation, in your message or theirs.',
    },
    used: {
      type: 'array',
      items: { type: 'string' },
      description: 'The listed words and sentences you used in this message, copied as written.',
    },
  },
}

export const isTurnReply = (v: unknown): v is TurnReply => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.line === 'string' &&
    typeof o.done === 'boolean' &&
    Array.isArray(o.used) &&
    o.used.every((u) => typeof u === 'string')
  )
}

/**
 * Her next message, given the whole thread.
 *
 * The character is instructed to answer a question about the language in the language, because that is
 * what asking "뭐라고요?" mid-thread actually gets you and it is the reason this workbook needs no help
 * button. Asking is genuine use, so nothing is recorded against it.
 *
 * `done` is the character's judgment on their own conversation, which is the only place it can live:
 * the app cannot tell whether "토요일 좋아요" settled the matter, and the character can.
 */
export const turnPrompt = (
  bundle: ContextBundle,
  person: Person,
  thread: readonly { mine: boolean; text: string }[],
): { instructions: string; input: Message[] } => {
  const language = bundle.profile?.language ?? 'the target language'
  const meaning = bundle.profile?.meaningLanguage ?? 'English'

  const instructions = [
    `You are ${person.name}, ${person.who}, texting someone who is learning ${language}.`,
    bundle.profile?.focus ? `This notebook is for: ${bundle.profile.focus}` : '',
    `The thread is about: ${person.situation}`,
    `They are trying to: ${person.task}`,
    '',
    '- Write as this person texting, not as a teacher. Short messages, the register this relationship would actually use.',
    '- Never correct their language and never comment on it. If a message is broken but clear, respond to what they meant.',
    `- If they ask you to repeat, slow down, or explain a word, do it in ${language}, in simpler ${language}. That is a normal thing to be asked and not a reason to switch to ${meaning}.`,
    '- Do not do their task for them. Make them ask.',
    '- Set done true only once the task has actually been settled. Then your message is the one that settles it.',
    '',
    levelRules(bundle),
    '',
    materialLines(bundle),
  ]
    .filter((l) => l !== '')
    .join('\n')

  // Her lines are the assistant's, so the model reads the thread as its own past messages rather than
  // as a transcript it has been handed. The opening turn has no history at all.
  const input: Message[] =
    thread.length === 0
      ? [{ role: 'user', content: 'Open the thread. Send the first message.' }]
      : thread.map((t) => ({ role: t.mine ? 'user' : 'assistant', content: t.text }))

  return { instructions, input }
}
