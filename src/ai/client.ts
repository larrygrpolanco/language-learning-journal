import { db, type JournalDb } from '../db/db'
import { SETTINGS_ID } from '../db/types'

/**
 * The one place that talks to xAI. Technical plan §9.
 *
 * Base URL, the auth header, and error normalisation. Nothing else in the app calls `fetch` against
 * an API, so if xAI ever tightens CORS and this needs to go through a proxy, this is the only file
 * that changes.
 *
 * The key comes from the settings row and nowhere else. There is deliberately no env-var path, in dev
 * or anywhere, so a checkout of this repo carries no secret and the key never enters the bundle.
 */

export const BASE_URL = 'https://api.x.ai/v1'

export type AiFailure =
  /** No key in Settings. The one failure with a specific thing to do about it. */
  | 'no-key'
  /** The request reached xAI and it refused. */
  | 'refused'
  /** Never reached xAI. Offline, DNS, a blocked request. */
  | 'offline'
  /** A 200 whose body was not the shape this app expects. */
  | 'unreadable'

/**
 * A failure with a line that can go straight on screen.
 *
 * §9: every call is something the learner just pressed, so on failure the app says what went wrong
 * and leaves the button. There is no retry, no queue and no offline buffer, which means this carries
 * no error codes for machinery to branch on beyond `kind`.
 */
export class AiError extends Error {
  readonly kind: AiFailure
  /** HTTP status, when there was one. Not shown, but worth having in a console. */
  readonly status?: number

  constructor(kind: AiFailure, message: string, status?: number) {
    super(message)
    this.name = 'AiError'
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

export const NO_KEY_MESSAGE = 'No key yet. Add an xAI key in Settings and this will work.'

/** The key, or `undefined`. Read per call, so saving one in Settings takes effect immediately. */
export const apiKey = async (d: JournalDb = db): Promise<string | undefined> => {
  const settings = await d.settings.get(SETTINGS_ID)
  const key = settings?.xaiKey?.trim()
  return key === '' ? undefined : key
}

export const hasKey = async (d: JournalDb = db): Promise<boolean> =>
  (await apiKey(d)) !== undefined

/** What xAI puts in a failure body. Both shapes seen in practice. */
interface ErrorBody {
  error?: string | { message?: string }
  code?: string
}

/**
 * Turns a failed response into one readable line.
 *
 * xAI is inconsistent here: `/v1/responses` returns `{"code":"invalid-argument","error":"…"}`,
 * `/v1/tts` returns `{"error":"TTS synthesis failed: …"}`, and a malformed body comes back as bare
 * `text/plain`. All three end up as a sentence rather than a stack.
 */
const readError = async (res: Response): Promise<string> => {
  const raw = await res.text().catch(() => '')
  if (raw !== '') {
    try {
      const body = JSON.parse(raw) as ErrorBody
      const message = typeof body.error === 'string' ? body.error : body.error?.message
      if (message) return message
    } catch {
      // Not JSON. The plain text is still the most useful thing available.
      if (raw.length < 300) return raw
    }
  }
  if (res.status === 401 || res.status === 403) return 'xAI refused that key.'
  if (res.status === 429) return 'xAI is rate limiting. Try again in a moment.'
  return `xAI returned ${res.status}.`
}

/**
 * A POST to xAI with the key attached, returning the raw `Response`.
 *
 * Left raw because the three capabilities want different things out of it: text wants JSON, speech
 * wants bytes. Both go through this so the auth header and the error normalisation are written once.
 */
export const post = async (path: string, body: unknown): Promise<Response> => {
  const key = await apiKey()
  if (!key) throw new AiError('no-key', NO_KEY_MESSAGE)

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    })
  } catch {
    // A network-level throw. Offline is much the likeliest cause, and there is nothing to retry
    // against because §1 rules out a queue.
    throw new AiError('offline', 'Could not reach xAI. Check the connection.')
  }

  if (!res.ok) throw new AiError('refused', await readError(res), res.status)
  return res
}

export const postJson = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await post(path, body)
  try {
    return (await res.json()) as T
  } catch {
    throw new AiError('unreadable', 'xAI sent back something this app could not read.')
  }
}

/** A GET with the key attached. Only the video poll needs it, but it needs it to be a real GET. */
export const getJson = async <T>(path: string): Promise<T> => {
  const key = await apiKey()
  if (!key) throw new AiError('no-key', NO_KEY_MESSAGE)

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, { headers: { Authorization: `Bearer ${key}` } })
  } catch {
    throw new AiError('offline', 'Could not reach xAI. Check the connection.')
  }
  if (!res.ok) throw new AiError('refused', await readError(res), res.status)

  try {
    return (await res.json()) as T
  } catch {
    throw new AiError('unreadable', 'xAI sent back something this app could not read.')
  }
}

/**
 * Bytes that may be a view onto a larger buffer, as an exact-size Blob.
 *
 * The same guard `storage/bundle.ts` applies on the way in. Handing a view straight to `Blob` risks
 * writing the whole underlying buffer, and it also satisfies TS 5.7's `Uint8Array<ArrayBuffer>`
 * requirement on `BlobPart`.
 */
export const bytesToBlob = (bytes: Uint8Array, type: string): Blob => {
  const exact = new Uint8Array(bytes.byteLength)
  exact.set(bytes)
  return new Blob([exact], { type })
}

/** Base64 to a Blob, for the image route, which returns its bytes inline rather than as a URL. */
export const base64ToBlob = (b64: string, type: string): Blob => {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type })
}

/**
 * A stored Blob as a `data:` URL, which is how attachments reach the model.
 *
 * `FileReader` rather than a manual base64 walk, because a photographed page is a few megabytes and
 * the browser's own implementation is both faster and correct about chunking.
 */
export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new AiError('unreadable', 'Could not read that attachment.'))
    reader.readAsDataURL(blob)
  })

/** Anything thrown, as one line fit to put on screen. */
export const failureLine = (e: unknown): string =>
  e instanceof AiError ? e.message : 'Something went wrong talking to xAI.'
