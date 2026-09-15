import { useEffect, useRef, useState } from 'react'
import { Volume2 } from 'lucide-react'
import { speak } from '../ai/speech'
import { failureLine } from '../ai/client'

/**
 * The play affordance on a word and on a sentence. UI guide §7, technical plan §9.
 *
 * Generated on press and never stored, per §1, so pressing it again regenerates it. It reads as a
 * player rather than an assistant, which is what keeps the no-AI-affordances rule intact.
 *
 * There is no local fallback and that is deliberate rather than lazy. `speechSynthesis` on the machine
 * this was built for carries three voices, all `en-US`. Falling back to it for Korean would either say
 * nothing or read Hangul in an American accent, and both are worse than a line saying why it failed.
 */
export const Speak = ({
  text,
  language,
  size = 36,
  title = 'Speak this',
}: {
  text: string
  language: string
  /** 36 beside a term, 28 on a sentence row, per the UI guide. */
  size?: number
  title?: string
}) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined)
  const urlRef = useRef<string | undefined>(undefined)

  // One object URL at a time, revoked on replacement and on unmount. Without this, a word screen
  // where several lines get played leaks a blob per press for the life of the document.
  useEffect(
    () => () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    },
    [],
  )

  const play = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const blob = await speak(text, language)
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(blob)
      audioRef.current?.pause()
      const audio = new Audio(urlRef.current)
      audioRef.current = audio
      await audio.play()
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
        className="btn btn-icon sp-btn"
        style={{ width: size, height: size }}
        title={title}
        aria-label={title}
        disabled={busy || text.trim() === ''}
        onClick={() => void play()}
      >
        <Volume2 size={Math.round(size * 0.47)} />
      </button>
      {error ? <span className="sp-error">{error}</span> : null}
    </>
  )
}
