import { useEffect, useRef, useState, type ReactNode } from 'react'
import { failureLine } from '../ai/client'
import type { Message } from '../ai/text'
import type { EncounterTarget, Id } from '../db/types'
import { Capturable } from '../ui/Capturable'
import { Speak } from '../ui/Speak'
import { Support, type Ladder } from '../ui/Support'
import { plural } from '../ui/format'
import type { WorkbookProps } from './sdk'

/**
 * The drill, shared. Word drill and sentence drill are the same exercise over different material:
 * a cue, a typed answer, a verdict, and a follow-up that pushes one step further. So the loop lives
 * here once and each workbook brings only its items and its prompts, which is where the teaching
 * logic is (§8).
 *
 * The follow-up is the point. One cue and one answer lets a learner write the plainest sentence that
 * contains the word and move on, which proves they can spell it. A second and third round that react
 * to what they wrote and ask for something the last answer did not need — the past, a reason, a
 * question, a different person — is where the word gets used rather than placed.
 *
 * Every call here goes to the quick model. Each is one short answer, and the wait between rounds is
 * the difference between an exchange and a form.
 */

/** One built prompt, as every `prompt.ts` hands it over. */
export interface Built {
  instructions: string
  input: Message[]
}

/** What marking comes back as. Kept small because everything here is shown verbatim. */
export interface Verdict {
  right: boolean
  /** One line, shown under the answer. */
  comment: string
  /** A natural way to say it, in the target language. Always given, right or wrong. */
  better: string
  /** The follow-up cue, in the meaning language. Empty when the item is finished. */
  next: string
}

export const VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['right', 'comment', 'better', 'next'],
  properties: {
    right: { type: 'boolean' },
    comment: { type: 'string', description: 'One short line. What worked or what did not.' },
    better: { type: 'string', description: 'A natural version, in the target language.' },
    next: {
      type: 'string',
      description: 'The follow-up prompt, in the meaning language. An empty string when asked for none.',
    },
  },
}

export const isVerdict = (v: unknown): v is Verdict => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return (
    typeof o.right === 'boolean' &&
    typeof o.comment === 'string' &&
    typeof o.better === 'string' &&
    typeof o.next === 'string'
  )
}

/** One exchange on an item. `answer` and `verdict` are absent while it is still open. */
export interface Round {
  ask: string
  answer?: string
  verdict?: Verdict
}

/**
 * How many rounds one item gets. Three is a cue and two pushes, which is enough to take a word
 * somewhere and short enough that eight of them is still one sitting.
 */
export const MAX_ROUNDS = 3

/** The past rounds as prompt text, so a follow-up builds on the exchange rather than restarting it. */
export const exchangeLines = (rounds: readonly Round[]): string =>
  rounds
    .map((r, i) =>
      [
        `Round ${i + 1}`,
        `  Asked: ${r.ask}`,
        r.answer !== undefined ? `  Answered: ${r.answer}` : '',
        r.verdict ? `  Your comment: ${r.verdict.comment}` : '',
      ]
        .filter((l) => l !== '')
        .join('\n'),
    )
    .join('\n')

/** How the engine sees an item, whatever it is. */
export interface DrillItem {
  id: Id
  targetType: EncounterTarget
  /** Shown large: the term, or the sentence. */
  text: string
  /** Its meaning or translation, shown muted beside it. */
  gloss?: string
}

export interface DrillPrompts<T> {
  cue: (item: T) => Built
  /** `rounds` ends with the one just answered, verdict not yet set. `last` asks for no follow-up. */
  mark: (item: T, rounds: readonly Round[], last: boolean) => Built
  hint: (item: T, ask: string, rung: 0 | 1 | 2) => Built
}

/** What survives a minimize. Must be JSON-able: it goes straight into the session record. */
export interface DrillState {
  /** Index into the items. */
  at: number
  /**
   * The exchange on the current item. Kept, unlike a single cue: a different cue for the same word is
   * still that word's drill, but a follow-up is a reply to what they wrote, and losing it mid-exchange
   * would lose the exercise rather than repeat it (§8).
   */
  rounds: Round[]
  /** Answers so far, keyed by item id, so restoring shows what was already done. */
  done: Record<Id, { answers: string[]; right: boolean }>
}

/**
 * A session record, whatever shape it was written in.
 *
 * Word drill sessions docked before follow-ups existed stored one `answer` per item and no rounds.
 */
const restore = (s: DrillState | undefined): DrillState => {
  const done: DrillState['done'] = {}
  for (const [id, row] of Object.entries(s?.done ?? {})) {
    const r = row as { answers?: string[]; answer?: string; right: boolean }
    done[id] = { answers: r.answers ?? (r.answer !== undefined ? [r.answer] : []), right: r.right }
  }
  return { at: s?.at ?? 0, rounds: s?.rounds ?? [], done }
}

type Props<T> = Omit<WorkbookProps<DrillState>, 'minimize'> & {
  workbookId: string
  items: readonly T[]
  view: (item: T) => DrillItem
  prompts: DrillPrompts<T>
  /** "word" or "sentence", for the buttons. */
  noun: string
  /** The title of the entry Keep writes. */
  title: string
  /** Shown when there is nothing to drill. */
  empty: ReactNode
}

export const Drill = <T,>({
  bundle,
  state,
  setState,
  setLabel,
  ai,
  journal,
  close,
  workbookId,
  items,
  view,
  prompts,
  noun,
  title,
  empty,
}: Props<T>) => {
  const [start] = useState(() => restore(state))
  const [at, setAt] = useState(start.at)
  const [rounds, setRounds] = useState<Round[]>(start.rounds)
  const [done, setDone] = useState(start.done)

  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const answerRef = useRef<HTMLTextAreaElement>(null)
  const item = items[at]
  const shown = item === undefined ? undefined : view(item)
  const language = bundle.profile?.language ?? ''

  const last = rounds[rounds.length - 1]
  const open = last && last.answer === undefined ? last : undefined

  // A fresh cue whenever the item changes and there is no exchange to resume. A restore mid-exchange
  // has its rounds already and goes straight back to them.
  useEffect(() => {
    let live = true
    if (item === undefined || rounds.length > 0) return

    const make = async () => {
      setError(undefined)
      setBusy(true)
      try {
        const p = prompts.cue(item)
        const text = await ai.complete(p.input, { instructions: p.instructions, quick: true })
        if (!live) return
        const next = [{ ask: text.trim() }]
        setRounds(next)
        setState({ at, rounds: next, done })
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
    // Keyed on the item alone. `rounds` is read to decide whether to ask, not as a reason to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  // The chip reads the workbook's own progress. No progress bar, per §7, just where you were.
  useEffect(() => {
    if (items.length > 0) setLabel(`${Math.min(at + 1, items.length)} of ${items.length}`)
  }, [at, items.length, setLabel])

  useEffect(() => {
    const el = answerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 64)}px`
  }, [answer, open])

  const submit = async () => {
    const text = answer.trim()
    if (item === undefined || shown === undefined || !open || text === '' || busy) return

    setBusy(true)
    setError(undefined)
    try {
      const before = rounds.slice(0, -1)
      const answered: Round[] = [...before, { ask: open.ask, answer: text }]
      const final = answered.length >= MAX_ROUNDS

      const p = prompts.mark(item, answered, final)
      const verdict = await ai.completeJson<Verdict>(p.input, {
        name: 'verdict',
        schema: VERDICT_SCHEMA,
        guard: isVerdict,
        instructions: p.instructions,
        quick: true,
      })

      await journal.recordPractice({
        workbookId,
        targetType: shown.targetType,
        targetId: shown.id,
        outcome: verdict.right ? 'right' : 'wrong',
      })

      const marked: Round[] = [...before, { ask: open.ask, answer: text, verdict }]
      const follow = verdict.next.trim()
      const nextRounds = !final && follow !== '' ? [...marked, { ask: follow }] : marked

      const prev = done[shown.id]
      const nextDone = {
        ...done,
        [shown.id]: { answers: [...(prev?.answers ?? []), text], right: verdict.right },
      }

      setRounds(nextRounds)
      setDone(nextDone)
      setAnswer('')
      setState({ at, rounds: nextRounds, done: nextDone })
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  const advance = () => {
    const next = at + 1
    setAt(next)
    setRounds([])
    setAnswer('')
    setError(undefined)
    setState({ at: next, rounds: [], done })
  }

  /**
   * The three rungs, on whichever question is open. Only the pressed ones cost anything.
   *
   * Plain closures rather than memoized ones: `Support` holds its own state and reads a rung only when
   * that rung is pressed, so a fresh array per render costs nothing.
   */
  const hint = (rung: 0 | 1 | 2) => async () => {
    if (item === undefined || !open) throw new Error('nothing to help with yet')
    const p = prompts.hint(item, open.ask, rung)
    return ai.complete(p.input, { instructions: p.instructions, quick: true })
  }

  const ladder: Ladder = [hint(0), hint(1), hint(2)]

  /** Rung 3 taken. Recorded, and deliberately inert: nothing counts `'shown'` toward "got it". */
  const spend = () => {
    if (shown === undefined) return
    void journal.recordPractice({
      workbookId,
      targetType: shown.targetType,
      targetId: shown.id,
      outcome: 'shown',
    })
  }

  /** The only thing that turns this session into an entry, and only from this press. */
  const keep = async () => {
    const lines: string[] = []
    for (const [id, row] of Object.entries(done)) {
      const text = items.map(view).find((v) => v.id === id)?.text ?? id
      lines.push(`${text} — ${row.answers.join(' / ')}`)
    }
    if (lines.length === 0) return

    const right = Object.values(done).filter((r) => r.right).length
    await journal.saveMoment({
      title,
      source: 'practice',
      body: `${plural(Object.keys(done).length, noun)} drilled, ${right} right.\n\n${lines.join('\n')}`,
    })
    setSaved(true)
  }

  if (items.length === 0) return <>{empty}</>

  const answeredCount = Object.keys(done).length

  if (shown === undefined) {
    // Ran off the end. The only thing left worth offering is keeping it.
    return (
      <div className="wd-drill">
        <p className="wb-prose">
          That is all {items.length} of them. {answeredCount > 0 ? `You answered ${answeredCount}.` : ''}
        </p>
        <div className="wb-actions">
          {saved ? (
            <span className="text-muted">Saved into today&apos;s entry.</span>
          ) : (
            <button
              className="btn btn-secondary"
              disabled={answeredCount === 0}
              onClick={() => void keep()}
            >
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

  const nextLabel = at + 1 < items.length ? `Next ${noun}` : 'Finish'

  return (
    <div className="wd-drill">
      <div className="wb-term-row">
        <Capturable
          notebookId={bundle.notebookId}
          className={shown.targetType === 'sentence' ? 'wb-term wb-term-sentence' : 'wb-term'}
        >
          {shown.text}
        </Capturable>
        <Speak text={shown.text} language={language} size={28} />
        {shown.gloss ? <span className="text-muted wb-term-meaning">{shown.gloss}</span> : null}
      </div>

      {rounds.length === 0 && busy ? <p className="rf-waiting">…</p> : null}

      {rounds.map((r, i) => (
        // Index as key: rounds only ever append.
        <div key={i} className="dr-round">
          <p className="rf-question">{r.ask}</p>
          {r.answer === undefined ? (
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
          ) : (
            <p className="ruled rf-answer">{r.answer}</p>
          )}
          {r.verdict ? (
            <>
              <p className={r.verdict.right ? 'wb-verdict wb-verdict-right' : 'wb-verdict'}>
                {r.verdict.comment}
              </p>
              <div className="wb-better">
                <Capturable notebookId={bundle.notebookId} className="sentence">
                  {r.verdict.better}
                </Capturable>
                <Speak text={r.verdict.better} language={language} size={28} />
              </div>
            </>
          ) : null}
        </div>
      ))}

      {error ? <p className="st-error">{error}</p> : null}

      {/* Keyed on the item and the round, so the ladder resets per question. */}
      {open ? <Support key={`${shown.id}:${rounds.length}`} rungs={ladder} onSpend={spend} /> : null}

      <div className="wb-actions">
        <span className="text-muted wb-count">
          {at + 1} of {items.length}
          {answeredCount > 0 ? ` · ${answeredCount} answered` : ''}
        </span>
        {open ? (
          <>
            {/* Past the first round, moving on is finishing rather than skipping. */}
            <button className="btn btn-ghost" disabled={busy} onClick={advance}>
              {rounds.length > 1 ? nextLabel : 'Skip'}
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || answer.trim() === ''}
              onClick={() => void submit()}
            >
              Answer
            </button>
          </>
        ) : (
          <button className="btn btn-primary" disabled={busy} onClick={advance}>
            {nextLabel}
          </button>
        )}
      </div>
    </div>
  )
}
