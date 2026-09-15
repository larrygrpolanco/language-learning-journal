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
}

/**
 * Speaks one line. Generated on press, held in React state, never stored (§1).
 *
 * `language` is the notebook's own `language` field, which is free text. xAI accepts a BCP-47 subtag,
 * so this passes the leading token lowercased: 'ko-KR' and 'Korean' both need to become something the
 * API recognises, and 'ko' is what it wants.
 */
export const speak = async (
  text: string,
  language: string,
  opts: SpeakOptions = {},
): Promise<Blob> => {
  const line = text.trim()
  if (line === '') throw new AiError('unreadable', 'Nothing to speak.')

  const res = await post('/tts', {
    text: line,
    language: languageTag(language),
    voice: opts.voice ?? DEFAULT_VOICE,
  })

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
