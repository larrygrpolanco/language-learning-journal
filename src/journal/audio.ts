import { db, type JournalDb } from '../db/db'
import { DEFAULT_VOICE, speak } from '../ai/speech'
import { setItemAudio, type AudioTarget } from './writes'

/**
 * Speech that belongs to a word or a sentence. Technical plan §9.
 *
 * The one module in `journal/` that reaches for `ai/`, because the policy it holds is a journal
 * decision rather than an API one: a clip is kept the first time the learner plays it, and after that
 * the word owns it. Putting it in `writes.ts` would drag the API into the write layer, and leaving it
 * in `Speak` would duplicate it into both edit screens, which is where Regenerate lives.
 *
 * Why first play rather than on add. Persisting every added word would mean accepting five words out
 * of Extract fires five calls nobody pressed for, and §1 holds that every AI call follows a press.
 * Pressing play is already the whole gesture, so nothing is asked of the learner twice. The learner
 * cannot tell the difference either way, because the only way to notice a missing clip is to press
 * play, and pressing play is what creates it.
 */

/**
 * The clip for this item, generating and keeping it if this is the first play.
 *
 * A pointer with no media row behind it is treated as absent, so a bundle that arrived without its
 * mp3 costs one regeneration and then repairs itself rather than staying broken.
 */
export const audioFor = async (
  target: AudioTarget,
  text: string,
  language: string,
  d: JournalDb = db,
): Promise<Blob> => {
  const kept = await keptClip(target, d)
  if (kept) return kept

  const bytes = await speak(text, language)
  await setItemAudio(target, bytes, DEFAULT_VOICE, d)
  return bytes
}

/** Replaces the kept clip with a new reading. Bypasses the held one, which is the whole point. */
export const regenerateAudio = async (
  target: AudioTarget,
  text: string,
  language: string,
  d: JournalDb = db,
): Promise<Blob> => {
  const bytes = await speak(text, language, { fresh: true })
  await setItemAudio(target, bytes, DEFAULT_VOICE, d)
  return bytes
}

const keptClip = async (target: AudioTarget, d: JournalDb): Promise<Blob | undefined> => {
  const row =
    target.type === 'word' ? await d.words.get(target.id) : await d.sentences.get(target.id)
  if (!row?.audioMediaId) return undefined
  return (await d.media.get(row.audioMediaId))?.bytes
}
