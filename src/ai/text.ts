import { AiError, blobToDataUrl, postJson } from './client'
import { DEFAULT_EFFORT, MODELS, type Effort } from './models'

/**
 * Text. Technical plan §9.
 *
 * `POST /v1/responses`, which is xAI's current recommendation with chat completions marked legacy.
 * Two entry points: `complete` for prose and `completeJson` for a structured answer.
 */

/* ── what goes in ─────────────────────────────────────────────────────────── */

export interface TextPart {
  type: 'input_text'
  text: string
}

/** An image as a `data:` URL. Confirmed working against `grok-4.6`. */
export interface ImagePart {
  type: 'input_image'
  image_url: string
}

/** A PDF as a `data:` URL. Needs `filename`, and the PDF has to be structurally valid. */
export interface FilePart {
  type: 'input_file'
  file_data: string
  filename: string
}

export type Part = TextPart | ImagePart | FilePart

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string | Part[]
}

export interface CompleteOptions {
  /** Prepended as a `system` message. */
  instructions?: string
  effort?: Effort
  /**
   * Route to `MODELS.quick` instead of `MODELS.text`.
   *
   * A flag rather than a model id, so `ai/models.ts` stays the only file that names one and a workbook
   * says what kind of call it is making rather than picking a slug it would then have to maintain.
   * Set it for a call whose answer is one line and whose quality does not turn on deliberation.
   */
  quick?: boolean
}

/* ── what comes back ──────────────────────────────────────────────────────── */

/**
 * The response envelope, narrowed to what this app reads.
 *
 * The trap is `output`. It is an array, and on every call observed the **first element is a
 * `reasoning` item**, not the answer. Taking `output[0]` yields the model's private summary of the
 * prompt, which for a JSON call is prose that will not parse and for a prose call is the wrong text
 * entirely. The answer is the element whose `type` is `message`.
 */
interface ResponsesBody {
  output?: {
    type?: string
    content?: { type?: string; text?: string }[]
  }[]
  status?: string
  incomplete_details?: { reason?: string } | null
}

/** The assistant's text, joined across however many `output_text` parts it arrived in. */
const readText = (body: ResponsesBody): string => {
  const message = body.output?.find((o) => o.type === 'message')
  const text = (message?.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text ?? '')
    .join('')
    .trim()

  if (text === '') {
    // A 200 with no message. Truncation against a token ceiling is the realistic cause, and a
    // refusal reads the same way, so say what is true rather than guessing which.
    throw new AiError('unreadable', 'xAI returned nothing to show.')
  }
  return text
}

const request = (input: string | Message[], opts: CompleteOptions) => {
  const messages: Message[] =
    typeof input === 'string' ? [{ role: 'user', content: input }] : [...input]
  if (opts.instructions) messages.unshift({ role: 'system', content: opts.instructions })

  const model = opts.quick ? MODELS.quick : MODELS.text

  // The key is omitted rather than nulled for a model that does not reason. Sending it anyway is a
  // 400, not a silent ignore, so this is what makes the fast path usable at all.
  return {
    model: model.id,
    input: messages,
    ...(model.reasons ? { reasoning: { effort: opts.effort ?? DEFAULT_EFFORT } } : {}),
  }
}

/** Prose in, prose out. Used by Reflect. */
export const complete = async (
  input: string | Message[],
  opts: CompleteOptions = {},
): Promise<string> => readText(await postJson<ResponsesBody>('/responses', request(input, opts)))

/* ── structured ───────────────────────────────────────────────────────────── */

export interface JsonOptions<T> extends CompleteOptions {
  /** A name for the schema. Required by the API, and it shows up in nothing the learner sees. */
  name: string
  /** A JSON Schema object. `additionalProperties: false` and a full `required` list, per `strict`. */
  schema: Record<string, unknown>
  /**
   * Narrows the parsed value before it is trusted.
   *
   * `strict` makes the shape very likely but not certain, and everything downstream of Extract writes
   * to the journal. A guard here is cheaper than a bad record.
   */
  guard: (value: unknown) => value is T
}

/**
 * A structured answer, validated twice.
 *
 * `text.format` with `type: 'json_schema'` and `strict: true` is honoured — a probe returned exactly
 * the requested shape with no prose around it. The guard is still applied, because a schema the API
 * enforces is a promise about the JSON, not about this app's types.
 */
export const completeJson = async <T>(
  input: string | Message[],
  opts: JsonOptions<T>,
): Promise<T> => {
  const body = await postJson<ResponsesBody>('/responses', {
    ...request(input, opts),
    text: {
      format: { type: 'json_schema', name: opts.name, strict: true, schema: opts.schema },
    },
  })

  const raw = readText(body)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new AiError('unreadable', 'xAI sent back something that was not the expected shape.')
  }
  if (!opts.guard(parsed)) {
    throw new AiError('unreadable', 'xAI sent back something that was not the expected shape.')
  }
  return parsed
}

/* ── attachments ──────────────────────────────────────────────────────────── */

/**
 * A stored attachment as a message part, or `undefined` when the model cannot read it.
 *
 * Images and PDFs are both confirmed to work. Audio is not sent: there is no transcription in this
 * path, and an unprocessed attachment stays valid forever, so skipping one changes nothing (§10).
 */
export const attachmentPart = async (
  kind: 'image' | 'pdf' | 'audio' | 'text',
  blob: Blob,
  filename = 'attachment',
): Promise<Part | undefined> => {
  if (kind === 'image') return { type: 'input_image', image_url: await blobToDataUrl(blob) }
  if (kind === 'pdf') {
    return {
      type: 'input_file',
      file_data: await blobToDataUrl(blob),
      filename: filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
    }
  }
  return undefined
}
