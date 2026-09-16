import { AiError, bytesToBlob, post } from './client'

/**
 * Speech. Technical plan §9, and a correction to it.
 *
 * The plan wrote this route as `POST /v1/tts?language=ko` with `language` as a query field. It is not:
 * `language` is a **body** field alongside `text`, and both are required. Probed 2026-09-15, where
 * omitting it from the body returns 422 `missing field \`language\`` regardless of the query string.
 *
 * The response is raw `audio/mpeg`. There is no `response_format` control and no `model` field —
 * both are accepted and silently ignored — so there is nothing else to pin.
 *
 * Why this matters more than it looks: `speechSynthesis` on the machine this was built on carries
 * three voices, all `en-US`, with no Korean voice pack. There is no local fallback for Korean audio,
 * so this route is the only way to hear a Korean word spoken.
 */

/** Every voice xAI lists reports `language: multilingual`, so one default covers any notebook. The
 *  full set is a `GET /v1/tts/voices` away if picking one ever becomes worth a control. */
export const DEFAULT_VOICE = 'eve'

export interface SpeakOptions {
  /** A `voice_id` from `GET /v1/tts/voices`. An unknown one is a 404, not a fallback. */
  voice?: string
  /**
   * Ignores the held clip and generates again. What Regenerate presses.
   *
   * Needed because the text and voice are unchanged in that case, so the key would hit and hand back
   * the very reading the learner is asking to replace.
   */
  fresh?: boolean
}

/**
 * Clips already generated this page load, keyed by exactly what determines the audio.
 *
 * Memory only, so §1 still holds: nothing is written, storage stays flat and the export bundle never
 * sees a clip. A reload empties it. What it removes is paying the round trip again for a word the
 * learner just played, which on the words and sentences screens is the normal way to use the button.
 *
 * Promises rather than blobs, so two rows carrying the same line share one request instead of racing.
 */
const cache = new Map<string, Promise<Blob>>()

/** Enough for a long session on one screen. Bounded so a session cannot grow it without limit. */
const LIMIT = 150

/**
 * Speaks one line, reusing the clip if it has already been generated (§9).
 *
 * `language` is the notebook's own `language` field, which is free text. xAI accepts a BCP-47 subtag,
 * so this passes the leading token lowercased: 'ko-KR' and 'Korean' both need to become something the
 * API recognises, and 'ko' is what it wants.
 */
export const speak = (text: string, language: string, opts: SpeakOptions = {}): Promise<Blob> => {
  const line = text.trim()
  if (line === '') return Promise.reject(new AiError('unreadable', 'Nothing to speak.'))

  const tag = languageTag(language)
  const voice = opts.voice ?? DEFAULT_VOICE
  // NUL joins the parts because none of them can contain it, so no combination of values can collide.
  // Voice is in the key so adding a voice control later cannot serve audio in the previous one.
  const key = `${tag}\u0000${voice}\u0000${line}`

  const hit = opts.fresh ? undefined : cache.get(key)
  if (hit) return hit

  const pending = generate(line, tag, voice)
  cache.set(key, pending)
  // A refusal or a dropped connection must not become this line's permanent answer. Dropping the key
  // leaves the button working, which is what §9 promises on failure.
  pending.catch(() => cache.delete(key))

  if (cache.size > LIMIT) {
    // Map iterates in insertion order, so this drops the oldest. Not true LRU, and it does not need to
    // be: the cap exists to bound memory, not to predict what gets pressed next.
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }

  return pending
}

const generate = async (line: string, tag: string, voice: string): Promise<Blob> => {
  const res = await post('/tts', { text: line, language: tag, voice })

  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength === 0) throw new AiError('unreadable', 'xAI returned no audio.')
  return bytesToBlob(bytes, res.headers.get('content-type') ?? 'audio/mpeg')
}

/**
 * A notebook's free-text language as something the API takes.
 *
 * `Notebook.language` is whatever the learner typed, which is the right call for a journal and the
 * wrong shape for an API. A few common names are mapped by hand; anything else falls through as its
 * own leading token, which covers 'ko', 'ko-KR' and 'es' already being correct.
 */
const NAMED: Record<string, string> = {
  korean: 'ko',
  japanese: 'ja',
  chinese: 'zh',
  mandarin: 'zh',
  cantonese: 'yue',
  spanish: 'es',
  french: 'fr',
  german: 'de',
  italian: 'it',
  portuguese: 'pt',
  russian: 'ru',
  arabic: 'ar',
  hindi: 'hi',
  english: 'en',
  dutch: 'nl',
  polish: 'pl',
  turkish: 'tr',
  vietnamese: 'vi',
  thai: 'th',
  indonesian: 'id',
}

export const languageTag = (language: string): string => {
  const s = language.trim().toLowerCase()
  if (s === '') return 'en'
  const named = NAMED[s]
  if (named) return named
  // 'ko-KR' keeps its region, which the API accepts. A bare word that is not in the table above is
  // passed through as-is rather than guessed at.
  return s.split(/[\s(,]/)[0] ?? 'en'
}
