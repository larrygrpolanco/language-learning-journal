import { useState } from 'react'
import { regenerateAudio } from '../journal/audio'
import { failureLine } from '../ai/client'
import type { AudioTarget } from '../journal/writes'

/**
 * Replaces the kept clip on a word or a sentence. On both edit blocks, above Delete.
 *
 * Absent until there is a clip to replace, because with none the play button is already the way to get
 * one and a second control saying the same thing would only be noise. So this reads as "that reading
 * was wrong, try again" rather than as a way to generate audio.
 *
 * It does not need to say it succeeded. The next press of play is the confirmation, and a line claiming
 * success that the learner has not heard yet would be the app talking about itself.
 */
export const Regenerate = ({
  target,
  text,
  language,
  has,
}: {
  target: AudioTarget
  text: string
  language: string
  /** Whether a clip is currently kept. */
  has: boolean
}) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  if (!has) return null

  const run = async () => {
    setBusy(true)
    setError(undefined)
    try {
      await regenerateAudio(target, text, language)
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost ix-regen"
        disabled={busy}
        onClick={() => void run()}
      >
        {busy ? 'Speaking it again…' : 'Regenerate audio'}
      </button>
      {error ? <p className="sp-error">{error}</p> : null}
    </>
  )
}
