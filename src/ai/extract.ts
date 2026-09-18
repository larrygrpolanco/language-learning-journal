import { attachmentPart, completeJson, type Message, type Part } from './text'
import type { ProposalDraft, ProposedSentence, ProposedWord } from '../db/types'

/**
 * Extract. Technical plan §10.
 *
 * Sends the entry body, its text attachments, its images and PDFs, and the notebook's `focus` as a
 * profile. Asks for structured JSON matching `ProposalDraft`.
 *
 * Nothing here writes. The result is a draft that gets resolved against the notebook by
 * `journal/proposals.ts` and only becomes records when the learner presses Add.
 */

export interface ExtractInput {
  entryId: string
  /** The target language, as the learner typed it on the notebook. */
  language: string
  /** What meanings and translations should be written in. */
  meaningLanguage: string
  /** The notebook's `focus`, which doubles as its profile for the model. */
  focus?: string | undefined
  title?: string | undefined
  source?: string | undefined
  body: string
  /** Pasted text attachments, verbatim. */
  pasted: readonly string[]
  /** Images and PDFs. Audio is skipped, since nothing here transcribes. */
  files: readonly { kind: 'image' | 'pdf' | 'audio' | 'text'; blob: Blob; filename?: string }[]
}

/* ── the schema ───────────────────────────────────────────────────────────── */

/**
 * JSON Schema for the answer.
 *
 * `strict: true` requires every property to appear in `required` and forbids extra keys, so an
 * optional field cannot simply be left out. The way through is a nullable type, and the nulls are
 * turned back into absent keys in `clean` below. Writing `undefined` into an optional field would
 * otherwise break `exactOptionalPropertyTypes` and put a null in the export bundle.
 */
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['words', 'sentences'],
  properties: {
    words: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'meaning', 'note'],
        properties: {
          term: { type: 'string', description: 'The word or phrase, in the target language.' },
          meaning: { type: ['string', 'null'], description: 'Short gloss in the meaning language.' },
          note: {
            type: ['string', 'null'],
            description: 'Only when the entry says something about usage worth keeping.',
          },
        },
      },
    },
    sentences: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'translation'],
        properties: {
          text: { type: 'string', description: 'The sentence, in the target language.' },
          translation: { type: ['string', 'null'] },
        },
      },
    },
  },
}

/** What comes back, before nulls are folded away. */
interface RawDraft {
  words: { term: string; meaning: string | null; note: string | null }[]
  sentences: {
    text: string
    translation: string | null
  }[]
}

const isRawDraft = (v: unknown): v is RawDraft => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.words) || !Array.isArray(o.sentences)) return false

  const wordsOk = o.words.every(
    (w) => typeof w === 'object' && w !== null && typeof (w as { term?: unknown }).term === 'string',
  )
  const sentencesOk = o.sentences.every(
    (s) => typeof s === 'object' && s !== null && typeof (s as { text?: unknown }).text === 'string',
  )

  return wordsOk && sentencesOk
}

/** Nulls to absent keys, and everything trimmed. */
const clean = (raw: RawDraft, entryId: string): ProposalDraft => {
  const words: ProposedWord[] = []
  for (const w of raw.words) {
    const term = w.term.trim()
    if (term === '') continue
    const out: ProposedWord = { term }
    if (w.meaning?.trim()) out.meaning = w.meaning.trim()
    if (w.note?.trim()) out.note = w.note.trim()
    words.push(out)
  }

  const sentences: ProposedSentence[] = []
  for (const s of raw.sentences) {
    const text = s.text.trim()
    if (text === '') continue
    const out: ProposedSentence = { text }
    if (s.translation?.trim()) out.translation = s.translation.trim()
    sentences.push(out)
  }

  return { entryId, words, sentences }
}

/* ── the prompt ───────────────────────────────────────────────────────────── */

const instructions = (input: ExtractInput): string =>
  [
    `You read one entry from someone's ${input.language} learning journal and pull out what is worth keeping.`,
    input.focus ? `What this notebook is for: ${input.focus}` : '',
    '',
    'Rules:',
    `- Words and sentences must be in ${input.language}. Never propose a ${input.meaningLanguage} word as vocabulary.`,
    `- Write every meaning and translation in ${input.meaningLanguage}.`,
    '- Take only what is actually in the material. Do not add related vocabulary the entry does not contain.',
    '- The entry is mostly notes, often in another language, with the target language embedded in it. Those embedded words and lines are the material.',
    '- Give a word in the form worth learning: a verb as its dictionary form, a noun bare.',
    '- Write a note only where the entry says something about how a word is used. Otherwise leave it null.',
    '- Propose a sentence only when the whole line is in the target language.',
    '- Prefer a handful of good items over a long list. An entry with nothing in it should return empty arrays.',
  ]
    .filter((line) => line !== '')
    .join('\n')

const material = (input: ExtractInput): string => {
  const lines: string[] = []
  if (input.title) lines.push(`Title: ${input.title}`)
  if (input.source) lines.push(`Source: ${input.source}`)
  if (lines.length > 0) lines.push('')

  lines.push(input.body.trim() === '' ? '(the entry has no written body)' : input.body)

  for (const text of input.pasted) {
    lines.push('', '--- pasted into the entry ---', text)
  }
  if (input.files.length > 0) {
    lines.push('', `(${input.files.length} attachment(s) follow this message)`)
  }

  return lines.join('\n')
}

/* ── the call ─────────────────────────────────────────────────────────────── */

/**
 * One call, however many attachments.
 *
 * Images and PDFs ride along as message parts on the same request, which `grok-4.6` handles: it
 * reports `input_modalities: [text, image]` and reads an inline PDF through the file part. So a
 * photographed textbook page and the note written beside it are read together, which is the point.
 */
export const extractFromEntry = async (input: ExtractInput): Promise<ProposalDraft> => {
  const content: Part[] = [{ type: 'input_text', text: material(input) }]

  for (const file of input.files) {
    const part = await attachmentPart(file.kind, file.blob, file.filename)
    if (part) content.push(part)
  }

  const messages: Message[] = [{ role: 'user', content }]

  const raw = await completeJson<RawDraft>(messages, {
    name: 'proposal_draft',
    schema: SCHEMA,
    guard: isRawDraft,
    instructions: instructions(input),
  })

  return clean(raw, input.entryId)
}
