import { useState } from 'react'
import { failureLine } from '../ai/client'

/**
 * Support that is not a crutch. Concepts §16.
 *
 * Three presses stand between being stuck and being told, and each one gives less help than the next:
 * what is going on, then the shape of an answer, then the answer. So the impatient path is to try,
 * which is the only reason the ladder exists.
 *
 * The third press records `'shown'`. That matters because `estimateFamiliarity` counts only `'right'`,
 * so taking the answer leaves the word exactly where it was on the words screen. Nothing is deducted
 * and nothing is said about it: credit is withheld rather than a penalty applied. No code branches on
 * `'shown'` anywhere, which is what keeps §16's ban on automatic difficulty adjustment true.
 *
 * The policy lives here and only here. A workbook supplies three reveals and gets told when the third
 * one is taken; it does not get to decide how many rungs there are, which one costs, or what the
 * button says. Four workbooks each re-deciding that is how a rule stops being a rule.
 *
 * Rungs stack and stay. Having read the nudge, you can still see it while you read the shape.
 *
 * Resetting is the caller's job, with a `key`. Keying this on the current word or scene remounts it,
 * which is both the shortest way to say "new item, ladder back to the bottom" and impossible to get
 * subtly wrong.
 */

/** One rung's text, fetched only if that rung is pressed. Usually a call, so usually a real cost. */
export type Reveal = () => Promise<string>

/**
 * Exactly three, in order: the nudge, the shape, the answer.
 *
 * A tuple rather than an array, so a workbook cannot ship a two-rung ladder that reaches the answer
 * in two presses, and the compiler is what says so.
 */
export type Ladder = readonly [Reveal, Reveal, Reveal]

/** What each press offers. The last one names what it is about to do, because it is the one that costs. */
const LABELS = ['Stuck?', 'A bit more', 'Just show me'] as const

export const Support = ({
  rungs,
  onSpend,
}: {
  rungs: Ladder
  /** Fired once, after the third rung has actually resolved. Where `'shown'` gets recorded. */
  onSpend?: () => void
}) => {
  const [taken, setTaken] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const next = taken.length
  const done = next >= rungs.length

  const climb = async () => {
    const rung = rungs[next]
    if (!rung) return

    setBusy(true)
    setError(undefined)
    try {
      const text = await rung()
      setTaken((prev) => [...prev, text])
      // After the reveal, not before. A rung that failed cost nothing and told the learner nothing,
      // so it must not be recorded as having shown them the answer.
      if (next === rungs.length - 1) onSpend?.()
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sup">
      {taken.map((text, i) => (
        // Index as key is right here: rungs only ever append, in a fixed order, and never reorder.
        <p key={i} className="sup-rung">
          {text}
        </p>
      ))}

      {error ? <p className="st-error">{error}</p> : null}

      {done ? null : (
        <button className="btn btn-ghost sup-btn" disabled={busy} onClick={() => void climb()}>
          {busy ? '…' : LABELS[next]}
        </button>
      )}
    </div>
  )
}
