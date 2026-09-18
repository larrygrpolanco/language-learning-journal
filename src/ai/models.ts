/**
 * Pinned model ids. Technical plan §9.
 *
 * xAI retires slugs on a schedule and redirects old ones, so these will drift. This file exists so
 * that when they do, there is exactly one place to change. Nothing else in the app names a model,
 * which is why the fast path below is chosen with a `quick` flag rather than by a caller passing an id.
 */

export interface ModelSpec {
  id: string
  /**
   * Whether the model accepts `reasoning.effort`.
   *
   * Not cosmetic. A model without it rejects the parameter outright with
   * `400 does not support parameter reasoningEffort`, so this decides whether the key is sent at all
   * rather than what it is set to.
   */
  reasons: boolean
}

/**
 * Two text models, because the four text calls in this app are not one kind of work.
 *
 * `text` handles Extract and Reflect. Extract reads a photographed textbook page and writes records,
 * and Reflect has to ask a question that builds on the last answer. Those are the two calls where a
 * lazy answer is a wasted one.
 *
 * `quick` handles the drill cue and its marking. Measured against the same prompts, a JSON answer came
 * back in 973ms versus 4807ms, and an image read in 564ms versus 14055ms, because the model emits no
 * reasoning tokens at all rather than merely fewer. That trade is right for one short cue and one
 * verdict, and wrong for Extract: on the image probe it answered "rectangle" where `text` read the
 * glyph correctly, so it is deliberately not used anywhere that reads an attachment.
 *
 * Both confirmed live. All four candidates probed accept `input_image`; only these two are wired.
 */
export const MODELS = {
  text: { id: 'grok-4.6', reasons: true } as ModelSpec,
  quick: { id: 'grok-4.20-0309-non-reasoning', reasons: false } as ModelSpec,
  image: 'grok-imagine-image-2.0',
  video: 'grok-imagine-video-1.5',
} as const

/**
 * How hard a reasoning model thinks before answering.
 *
 * Worth a note, because the default is not free. `grok-4.6` reasons at `high` unless told otherwise,
 * and on a measured probe a two-word answer cost 1671 reasoning tokens against 34 real ones. The same
 * call at `low` cost 69. Every call here is a learner pressing a button on their own key, so `low` is
 * the default and only Reflect, which is a conversation, asks for more.
 *
 * `none` is rejected by this model, and `minimal` is silently treated as `low`. Ignored entirely for
 * `MODELS.quick`, which does not take the parameter.
 */
export type Effort = 'low' | 'medium' | 'high'
export const DEFAULT_EFFORT: Effort = 'low'
