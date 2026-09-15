/**
 * Pinned model ids. Technical plan §9.
 *
 * xAI retires slugs on a schedule and redirects old ones, so these will drift. This file exists so
 * that when they do, there is exactly one place to change. Nothing else in the app names a model.
 *
 * All three confirmed live against `GET /v1/models`. `grok-4.6` reports
 * `input_modalities: [text, image]`, which is what lets Extract read a photographed textbook page in
 * the same call as the entry body.
 */
export const MODELS = {
  text: 'grok-4.6',
  image: 'grok-imagine-image-2.0',
  video: 'grok-imagine-video-1.5',
} as const

/**
 * How hard the text model thinks before answering.
 *
 * Worth a note, because the default is not free. `grok-4.6` reasons at `high` unless told otherwise,
 * and on a measured probe a two-word answer cost 1671 reasoning tokens against 34 real ones. The same
 * call at `low` cost 69. Every call here is a learner pressing a button on their own key, so `low` is
 * the default and only Reflect, which is a conversation, asks for more.
 *
 * `none` is rejected by this model, and `minimal` is silently treated as `low`.
 */
export type Effort = 'low' | 'medium' | 'high'
export const DEFAULT_EFFORT: Effort = 'low'
