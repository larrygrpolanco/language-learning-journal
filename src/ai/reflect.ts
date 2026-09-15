import { complete, type Message } from './text'

/**
 * Reflect. Technical plan §10, UI guide §6.
 *
 * A short exchange about one entry. One question at a time, and the whole point is that each completed
 * turn goes into the entry body, so the journal gains something even if the learner never extracts.
 */

export interface ReflectContext {
  language: string
  meaningLanguage: string
  /** The notebook's `focus`, doubling as its profile. */
  focus?: string | undefined
  title?: string | undefined
  source?: string | undefined
  body: string
}

export interface Turn {
  question: string
  /** Absent while the question is still open. */
  answer?: string
}

/** After this many answered turns the model is told to wind it up rather than run on. */
const WIND_DOWN_AFTER = 4

const instructions = (ctx: ReflectContext, answered: number): string =>
  [
    `You are talking with someone about one entry from their ${ctx.language} learning journal.`,
    ctx.focus ? `What this notebook is for: ${ctx.focus}` : '',
    '',
    'How to do this:',
    '- Ask exactly one question. Never two, and never a question with an "or also" tacked on.',
    '- Keep it to a sentence or two.',
    `- Write in ${ctx.meaningLanguage}, except where you are quoting or asking for ${ctx.language}.`,
    `- Good questions ask what was hard, what they were unsure of, or ask them to actually say something in ${ctx.language}.`,
    '- Build on what they just said. Do not restate it back to them first.',
    '- No praise, no encouragement, no preamble. Ask the question and stop.',
    '- Never correct their grammar unasked. This is a conversation, not marking.',
    answered >= WIND_DOWN_AFTER
      ? '- This has run long enough. Ask one last question that ties it off, or if there is nothing left worth asking, reply with exactly: ENOUGH'
      : '',
  ]
    .filter((line) => line !== '')
    .join('\n')

const entryText = (ctx: ReflectContext): string => {
  const lines: string[] = []
  if (ctx.title) lines.push(`Title: ${ctx.title}`)
  if (ctx.source) lines.push(`Source: ${ctx.source}`)
  if (lines.length > 0) lines.push('')
  lines.push(ctx.body.trim() === '' ? '(no written body)' : ctx.body)
  return lines.join('\n')
}

/** The model's way of saying there is nothing left to ask. Turned into an ending, not shown. */
export const ENOUGH = 'ENOUGH'

/**
 * The next question, given everything said so far.
 *
 * Returns `undefined` when the exchange has run its course. The caller then offers Extract and stops,
 * which is what §10 means by "ends by offering Extract, which the learner can ignore".
 *
 * `medium` effort rather than the `low` default. A question that builds on the last answer is the one
 * place in this app where the model actually has to think, and a lazy question here is a wasted turn.
 */
export const nextQuestion = async (
  ctx: ReflectContext,
  turns: readonly Turn[],
): Promise<string | undefined> => {
  const answered = turns.filter((t) => t.answer !== undefined).length

  const messages: Message[] = [
    { role: 'user', content: `Here is the entry.\n\n${entryText(ctx)}` },
  ]
  for (const turn of turns) {
    if (turn.answer === undefined) continue
    messages.push({ role: 'assistant', content: turn.question })
    messages.push({ role: 'user', content: turn.answer })
  }

  const reply = await complete(messages, {
    instructions: instructions(ctx, answered),
    effort: 'medium',
  })

  const text = reply.trim()
  if (text === '' || text.toUpperCase().startsWith(ENOUGH)) return undefined
  return text
}
