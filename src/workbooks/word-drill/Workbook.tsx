import { useEffect, useRef, useState } from 'react'
import { failureLine } from '../../ai/client'
import { Capturable } from '../../ui/Capturable'
import { Speak } from '../../ui/Speak'
import { plural } from '../../ui/format'
import { cuePrompt, isVerdict, markPrompt, VERDICT_SCHEMA, type Verdict } from './prompt'
import type { WorkbookProps } from '../sdk'

/**
 * Word drill. The first workbook, and the shape every later one follows.
 *
 * One word at a time from the bundle. The cue asks for a use rather than a definition, the answer is
 * typed, and marking gives one line plus a natural version. Practice events are recorded per word, so
 * the familiarity estimate on the words screen has something to work from.
 *
 * Typed input only. §9 puts spoken answers behind xAI's `/v1/stt`, which is a WebSocket a browser
 * cannot attach an Authorization header to, so there is no mic here rather than a mic that fails.
 *
 * Everything generated lives in React state and dies with the sheet (§7). Minimizing and restoring
 * loses the audio and keeps the progress, which is exactly the accepted tradeoff in §15.
 */

/** What survives a minimize. Must be JSON-able: it goes straight into the session record. */
export interface DrillState {
  /** Index into the bundle's words. */
  at: number
  /** Answers so far, keyed by word id, so restoring shows what was already done. */
  done: Record<string, { answer: string; right: boolean }>
}

const empty: DrillState = { at: 0, done: {} }

export const WordDrill = ({
  bundle,
  state,
  setState,
  setLabel,
  ai,
  journal,
  close,
}: WorkbookProps<DrillState>) => {
  const words = bundle.words
  const [at, setAt] = useState(state?.at ?? empty.at)
  const [done, setDone] = useState<DrillState['done']>(state?.done ?? empty.done)

  const [ask, setAsk] = useState<string>()
  const [answer, setAnswer] = useState('')
  const [verdict, setVerdict] = useState<Verdict>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const answerRef = useRef<HTMLTextAreaElement>(null)
  const current = words[at]

  // The cue is regenerated whenever the word changes, including after a restore, because generated
  // content is not stored. That is a real API call on reopening, and §15 accepts it.
  useEffect(() => {
    let live = true
    if (!current) return

    const make = async () => {
      setAsk(undefined)
      setVerdict(undefined)
      setAnswer('')
      setError(undefined)
      setBusy(true)
      try {
        const p = cuePrompt(current, bundle)
        const text = await ai.complete(p.input, { instructions: p.instructions, quick: true })
        if (live) setAsk(text)
      } catch (e) {
        if (live) setError(failureLine(e))
      } finally {
        if (live) setBusy(false)
      }
    }

    void make()
    return () => {
      live = false
    }
  }, [current, bundle, ai])

  // The chip reads the workbook's own progress. No progress bar, per §7, just where you were.
  useEffect(() => {
    if (words.length > 0) setLabel(`${Math.min(at + 1, words.length)} of ${words.length}`)
  }, [at, words.length, setLabel])

  useEffect(() => {
    const el = answerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 64)}px`
  }, [answer, ask])

  const persist = (next: Partial<DrillState>) => {
    setState({ at, done, ...next })
  }

  const submit = async () => {
    const text = answer.trim()
    if (!current || !ask || text === '' || verdict) return

    setBusy(true)
    setError(undefined)
    try {
      const p = markPrompt(current, ask, text, bundle)
      const marked = await ai.completeJson<Verdict>(p.input, {
        name: 'verdict',
        schema: VERDICT_SCHEMA,
        guard: isVerdict,
        instructions: p.instructions,
        quick: true,
      })
      setVerdict(marked)

      await journal.recordPractice({
        workbookId: 'word-drill',
        targetType: 'word',
        targetId: current.word.id,
        outcome: marked.right ? 'right' : 'wrong',
      })

      const nextDone = { ...done, [current.word.id]: { answer: text, right: marked.right } }
      setDone(nextDone)
      persist({ done: nextDone })
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  const advance = () => {
    const next = at + 1
    setAt(next)
    persist({ at: next })
  }

  /** The only thing that turns this session into an entry, and only from this press. */
  const keep = async () => {
    const lines: string[] = []
    for (const [id, row] of Object.entries(done)) {
      const term = words.find((w) => w.word.id === id)?.word.term ?? id
      lines.push(`${term} — ${row.answer}`)
    }
    if (lines.length === 0) return

    const right = Object.values(done).filter((r) => r.right).length
    await journal.saveMoment({
      title: 'Word drill',
      source: 'practice',
      body: `${plural(Object.keys(done).length, 'word')} drilled, ${right} right.\n\n${lines.join('\n')}`,
    })
    setSaved(true)
  }

  if (words.length === 0) {
    return (
      <p className="empty">
        No words to drill yet. They build up on their own as you write, and this needs a few.
      </p>
    )
  }

  const answered = Object.keys(done).length

  if (!current) {
    // Ran off the end. The only thing left worth offering is keeping it.
    return (
      <div className="wd-drill">
        <p className="wb-prose">
          That is all {words.length} of them. {answered > 0 ? `You answered ${answered}.` : ''}
        </p>
        <div className="wb-actions">
          {saved ? (
            <span className="text-muted">Saved into today&apos;s entry.</span>
          ) : (
            <button className="btn btn-secondary" disabled={answered === 0} onClick={() => void keep()}>
              Keep this as an entry
            </button>
          )}
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="wd-drill">
      <div className="wb-term-row">
        <Capturable notebookId={bundle.notebookId} className="wb-term">
          {current.word.term}
        </Capturable>
        <Speak text={current.word.term} language={bundle.profile?.language ?? ''} size={28} />
        {current.word.meaning ? (
          <span className="text-muted wb-term-meaning">{current.word.meaning}</span>
        ) : null}
      </div>

      {ask ? <p className="rf-question">{ask}</p> : busy ? <p className="rf-waiting">…</p> : null}

      {verdict ? (
        <>
          <p className="ruled rf-answer">{answer}</p>
          <p className={verdict.right ? 'wb-verdict wb-verdict-right' : 'wb-verdict'}>
            {verdict.comment}
          </p>
          <div className="wb-better">
            <Capturable notebookId={bundle.notebookId} className="sentence">
              {verdict.better}
            </Capturable>
            <Speak text={verdict.better} language={bundle.profile?.language ?? ''} size={28} />
          </div>
        </>
      ) : ask ? (
        <textarea
          ref={answerRef}
          className="ruled rf-input"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => {
            // §5. Enter mid-composition would submit a half-formed Hangul syllable.
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="Say it in your own words."
          aria-label="Your answer"
          autoFocus
        />
      ) : null}

      {error ? <p className="st-error">{error}</p> : null}

      <div className="wb-actions">
        <span className="text-muted wb-count">
          {at + 1} of {words.length}
          {answered > 0 ? ` · ${answered} answered` : ''}
        </span>
        {verdict ? (
          <button className="btn btn-primary" onClick={advance}>
            {at + 1 < words.length ? 'Next word' : 'Finish'}
          </button>
        ) : (
          <>
            <button className="btn btn-ghost" disabled={busy} onClick={advance}>
              Skip
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || !ask || answer.trim() === ''}
              onClick={() => void submit()}
            >
              Answer
            </button>
          </>
        )}
      </div>
    </div>
  )
}
