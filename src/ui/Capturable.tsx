import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { addSentence, addWord } from '../journal/writes'
import { ordinalWord } from './format'
import type { Id } from '../db/types'

/**
 * Highlight to capture. Technical plan §11.
 *
 * Wraps any prose a word might get pulled out of. Select some of it and a chip floats over the
 * selection with two text buttons, `word` and `sentence`. Pressing one writes it and nothing else
 * happens: no dialog, no confirmation, meaning left empty to fill in later or never.
 *
 * Render sites are entry bodies, pasted text attachments, and workbook output. Deliberately not the
 * composer, whose body is a `<textarea>`: `window.getSelection()` returns no range inside a form
 * control, so that would need a `selectionStart` path and a mirrored element to measure the caret.
 * The composer already carries `Add word` and `Add sentence` in its rail, and while you are writing
 * you are not mining.
 *
 * `entryId` is where the encounter lands. Given one, the word belongs to the entry being read, which
 * is what makes entry detail's "Words from this entry" true of a word pulled out of that entry's own
 * body. Omitted — workbook output, which has no entry — it falls to today's entry per §5.
 */
export interface CapturableProps {
  notebookId: Id
  /** The entry this prose belongs to. Omitted, the capture lands on today's entry. */
  entryId?: Id
  className?: string
  children: ReactNode
}

/** The chip's position, in viewport coordinates, because it is `position: fixed`. */
interface Chip {
  text: string
  left: number
  top: number
  /** Set when the selection sits too near the top of the viewport to float the chip above it. */
  below: boolean
}

/** Chip height plus a little air. Also the threshold for flipping it below the selection. */
const CHIP_CLEARANCE = 42

/** How long the chip holds its result before it goes. Long enough to read, short enough to ignore. */
const NOTE_MS = 1600

export const Capturable = ({ notebookId, entryId, className, children }: CapturableProps) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const chipRef = useRef<HTMLDivElement>(null)
  const [chip, setChip] = useState<Chip>()
  const [note, setNote] = useState<string>()

  const hide = useCallback(() => {
    setChip(undefined)
    setNote(undefined)
  }, [])

  /**
   * Reads the live selection and places the chip, or hides it.
   *
   * Both ends of the range have to be inside this component. A selection that starts in an entry body
   * and runs on past the end of it would otherwise capture text this component does not own.
   */
  const read = useCallback(() => {
    const host = hostRef.current
    if (!host) return

    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      hide()
      return
    }

    const range = selection.getRangeAt(0)
    if (!host.contains(range.startContainer) || !host.contains(range.endContainer)) {
      hide()
      return
    }

    // NFC here rather than in the write layer. A DOM selection on macOS hands back decomposed
    // Hangul, and this is where that text enters the app.
    const text = selection.toString().normalize('NFC').trim()
    if (text === '') {
      hide()
      return
    }

    const rect = range.getBoundingClientRect()
    const below = rect.top < CHIP_CLEARANCE
    setNote(undefined)
    setChip({
      text,
      left: rect.left + rect.width / 2,
      top: below ? rect.bottom + 8 : rect.top - 8,
      below,
    })
  }, [hide])

  useEffect(() => {
    let settle: number | undefined

    // A pointer going down is either the start of a new drag or a dismissal. Either way the chip
    // that is up describes a selection about to be replaced, so it goes. Presses on the chip itself
    // are the exception: they are what it is for.
    const onPointerDown = (e: PointerEvent) => {
      if (chipRef.current?.contains(e.target as Node)) return
      hide()
    }

    // Read on release rather than on selectionchange alone, so a drag places the chip once at the
    // end instead of chasing the pointer. The timeout lets the browser settle the selection first.
    const onPointerUp = () => {
      window.clearTimeout(settle)
      settle = window.setTimeout(read, 0)
    }

    // Covers what pointerup does not: keyboard selection, double-click-to-word, and mobile
    // long-press, which extends the selection without a matching release.
    const onSelectionChange = () => {
      window.clearTimeout(settle)
      settle = window.setTimeout(read, 180)
    }

    // The chip's coordinates are the range's, taken once. Scrolling makes them a lie.
    const onScroll = () => hide()

    // §5: never act on a keystroke mid-composition, or a half-formed Hangul syllable gets treated
    // as input. Escape is the only key this component listens for, and it still gets the guard.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') hide()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)

    return () => {
      window.clearTimeout(settle)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [read, hide])

  /**
   * Writes the capture, then says what happened and goes.
   *
   * The line is a readout, not a confirmation: the write already happened. It exists because a word
   * you have met ten times before is worth knowing about, and it is the same line quick add shows.
   */
  const capture = async (kind: 'word' | 'sentence') => {
    if (!chip) return
    if (kind === 'word') {
      const r = await addWord({ notebookId, term: chip.text, entryId })
      setNote(r.created ? 'word added' : `already here · ${ordinalWord(r.timesEncountered)} time`)
    } else {
      await addSentence({ notebookId, text: chip.text, entryId })
      setNote('sentence added')
    }
    window.getSelection()?.removeAllRanges()
    window.setTimeout(hide, NOTE_MS)
  }

  return (
    <>
      <div ref={hostRef} className={className}>
        {children}
      </div>

      {chip ? (
        <div
          ref={chipRef}
          className={chip.below ? 'cap-chip cap-chip-below' : 'cap-chip'}
          style={{ left: chip.left, top: chip.top }}
          role="group"
          aria-label="Capture the selected text"
        >
          {note ? (
            <span className="cap-note">{note}</span>
          ) : (
            <>
              <button type="button" className="btn btn-ghost cap-btn" onClick={() => void capture('word')}>
                word
              </button>
              <span className="cap-sep" />
              <button
                type="button"
                className="btn btn-ghost cap-btn"
                onClick={() => void capture('sentence')}
              >
                sentence
              </button>
            </>
          )}
        </div>
      ) : null}
    </>
  )
}
