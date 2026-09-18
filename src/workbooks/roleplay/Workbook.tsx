import { useEffect, useRef, useState } from 'react'
import { failureLine } from '../../ai/client'
import { Capturable } from '../../ui/Capturable'
import { Speak } from '../../ui/Speak'
import { wordsUsedIn } from '../level'
import {
  isSetup,
  isTurnReply,
  setupPrompt,
  SETUP_SCHEMA,
  turnPrompt,
  TURN_SCHEMA,
  type Person,
  type Setup,
  type TurnReply,
} from './prompt'
import type { WorkbookProps } from '../sdk'

/**
 * Text-message roleplay. A thread with someone from your own entries, and something to get out of it.
 *
 * The medium is the exercise. A thread is asynchronous, so there is no time pressure and no moment
 * where the learner is expected to have something ready; it is the most realistic situation this
 * notebook has; and it is the natural home for asking for help in the language, because asking
 * "뭐라고요?" mid-thread is what people actually do.
 *
 * Which is why there is no support ladder here. Support is asking the character, and asking is genuine
 * use, so nothing is recorded against it. The placeholder says so rather than a button announcing it.
 *
 * The task is what makes this more than a chat. Without one, a conversation ends when the learner gets
 * bored; with one, it ends when they have achieved something, and achieving it is the evidence that
 * gets recorded.
 */

interface Line {
  /** True for what the learner typed, false for hers. */
  mine: boolean
  text: string
}

/** What survives a minimize. The whole conversation, so restoring is not starting again. */
export interface RoleplayState {
  person?: Person
  thread: Line[]
  done: boolean
  /** What she declared using, accumulated across turns. Only read by the Keep summary. */
  hers: string[]
}

const empty: RoleplayState = { thread: [], done: false, hers: [] }

export const Roleplay = ({
  bundle,
  state,
  setState,
  setLabel,
  ai,
  journal,
  close,
}: WorkbookProps<RoleplayState>) => {
  const [person, setPerson] = useState<Person | undefined>(state?.person)
  const [thread, setThread] = useState<Line[]>(state?.thread ?? empty.thread)
  const [done, setDone] = useState(state?.done ?? empty.done)
  const [hers, setHers] = useState<string[]>(state?.hers ?? empty.hers)

  const [people, setPeople] = useState<Person[]>()
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)
  // Bumped by Try again, which is what lets the setup effect run a second time.
  const [attempt, setAttempt] = useState(0)

  const draftRef = useRef<HTMLTextAreaElement>(null)
  const foot = useRef<HTMLDivElement>(null)
  // Set once the opening message has been asked for, so a re-render cannot ask twice.
  const opened = useRef(false)

  const language = bundle.profile?.language ?? ''

  // Who to write to. One call, and only when there is nobody chosen yet, so a restored session goes
  // straight back to its thread rather than paying to re-propose people it is past choosing between.
  useEffect(() => {
    let live = true
    if (person || people) return

    const ask = async () => {
      setBusy(true)
      setError(undefined)
      try {
        const p = setupPrompt(bundle)
        const setup = await ai.completeJson<Setup>(p.input, {
          name: 'roleplay_setup',
          schema: SETUP_SCHEMA,
          guard: isSetup,
          instructions: p.instructions,
        })
        if (live) setPeople(setup.people)
      } catch (e) {
        if (live) setError(failureLine(e))
      } finally {
        if (live) setBusy(false)
      }
    }

    void ask()
    return () => {
      live = false
    }
  }, [person, people, attempt, bundle, ai])

  useEffect(() => {
    setLabel(person ? `${person.name}${thread.length > 0 ? ` · ${thread.length}` : ''}` : 'choosing')
  }, [person, thread.length, setLabel])

  // The newest message, in view. A thread whose latest line is below the fold is broken as a thread.
  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'nearest' })
  }, [thread.length, busy])

  useEffect(() => {
    const el = draftRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 44)}px`
  }, [draft])

  /**
   * One turn: her reply to whatever the thread now holds.
   *
   * Both the person and the thread are passed in rather than read from state. The thread because the
   * learner's message has just been appended and reading it back would send her the conversation
   * without it; the person because the very first turn runs in the same tick as `setPerson`, where the
   * state still says nobody has been chosen.
   */
  const turn = async (chosen: Person, next: Line[]) => {
    setBusy(true)
    setError(undefined)
    try {
      const p = turnPrompt(bundle, chosen, next)
      const reply = await ai.completeJson<TurnReply>(p.input, {
        name: 'roleplay_turn',
        schema: TURN_SCHEMA,
        guard: isTurnReply,
        instructions: p.instructions,
      })

      const withHers = [...next, { mine: false, text: reply.line }]
      const usedByHer = [...new Set([...hers, ...reply.used])]
      const settled = done || reply.done

      setThread(withHers)
      setHers(usedByHer)
      if (settled && !done) {
        setDone(true)
        await record(withHers)
      }
      setState({ person: chosen, thread: withHers, done: settled, hers: usedByHer })
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The task achieved, so the words that got it done are recorded as right.
   *
   * Only the learner's own messages are scanned. Her using a word proves nothing about them, and this
   * is the one place in the app where a practice event is inferred rather than pressed for, which is
   * why the evidence has to be something they typed.
   */
  const record = async (lines: readonly Line[]) => {
    const mine = lines
      .filter((l) => l.mine)
      .map((l) => l.text)
      .join('\n')
    for (const w of wordsUsedIn(bundle, mine)) {
      await journal.recordPractice({
        workbookId: 'roleplay',
        targetType: 'word',
        targetId: w.word.id,
        outcome: 'right',
      })
    }
  }

  const pick = (chosen: Person) => {
    setPerson(chosen)
    setPeople(undefined)
    opened.current = true
    setState({ person: chosen, thread: [], done: false, hers: [] })
    void turn(chosen, [])
  }

  // A restored session whose thread never got its opening message. Rare, and it looks like a broken
  // exercise if it is not covered: a chosen person and an empty thread with nothing to reply to.
  useEffect(() => {
    if (!person || opened.current || thread.length > 0 || busy) return
    opened.current = true
    void turn(person, [])
    // `turn` closes over state that is current on the render this fires from, and it fires once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person])

  const send = () => {
    const text = draft.trim()
    if (!person || text === '' || busy) return
    const next = [...thread, { mine: true, text }]
    setThread(next)
    setDraft('')
    setState({ person, thread: next, done, hers })
    void turn(person, next)
  }

  /** The thread as an entry. The transcript itself, since a summary of a conversation is not the thing. */
  const keep = async () => {
    if (!person || thread.length === 0) return

    const body = [
      `${person.who} · ${person.situation}`,
      `Trying to: ${person.task}${done ? ' — done' : ''}`,
      '',
      ...thread.map((l) => `${l.mine ? 'Me' : person.name}: ${l.text}`),
    ].join('\n')

    await journal.saveMoment({ title: `Thread with ${person.name}`, source: 'practice', body })
    setSaved(true)
  }

  /* ── choosing ───────────────────────────────────────────────────────────── */

  if (!person) {
    return (
      <div className="rp">
        <p className="wb-prose">Who are you writing to?</p>
        {error ? <p className="st-error">{error}</p> : null}
        {busy && !people ? <p className="rf-waiting">Looking through your entries…</p> : null}

        {people?.map((p) => (
          <button key={p.name} className="rp-person" onClick={() => pick(p)}>
            <span className="rp-person-head">
              <span className="rp-name">{p.name}</span>
              <span className="text-muted rp-who">{p.who}</span>
              {p.fromEntries ? <span className="tag tag-outline rp-tag">from your entries</span> : null}
            </span>
            <span className="rp-situation">{p.situation}</span>
            <span className="rp-task">{p.task}</span>
          </button>
        ))}

        {people && people.length === 0 ? (
          <p className="text-muted pick-empty">Nobody to write to yet. Write an entry or two first.</p>
        ) : null}

        {!busy && !people ? (
          <div className="wb-actions">
            <button
              className="btn btn-primary"
              onClick={() => {
                setError(undefined)
                setAttempt((a) => a + 1)
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  /* ── the thread ─────────────────────────────────────────────────────────── */

  return (
    <div className="rp">
      <p className="rp-brief">
        <span className="rp-task">{person.task}</span>
        {done ? <span className="rp-done"> · done</span> : null}
      </p>

      <div className="rp-thread">
        {thread.map((l, i) => (
          // Index as key: the thread only ever appends and never reorders.
          <div key={i} className={l.mine ? 'rp-turn rp-mine' : 'rp-turn rp-hers'}>
            {l.mine ? (
              <div className="rp-line">{l.text}</div>
            ) : (
              <>
                <Capturable notebookId={bundle.notebookId} className="rp-line">
                  {l.text}
                </Capturable>
                <Speak text={l.text} language={language} size={28} />
              </>
            )}
          </div>
        ))}
        {busy ? <p className="rf-waiting">…</p> : null}
        <div ref={foot} />
      </div>

      {error ? <p className="st-error">{error}</p> : null}

      {done ? (
        <div className="wb-actions">
          {saved ? (
            <span className="text-muted">Saved into today&apos;s entry.</span>
          ) : (
            <button className="btn btn-secondary" onClick={() => void keep()}>
              Keep this as an entry
            </button>
          )}
          <button className="btn btn-primary" onClick={close}>
            Done
          </button>
        </div>
      ) : (
        <>
          <textarea
            ref={draftRef}
            className="ruled rp-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // §5. Enter mid-composition would send a half-formed Hangul syllable.
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Reply, or ask her to say it again"
            aria-label="Your message"
          />
          <div className="wb-actions">
            <span className="text-muted wb-count">{thread.length} messages</span>
            <button className="btn btn-primary" disabled={busy || draft.trim() === ''} onClick={send}>
              Send
            </button>
          </div>
        </>
      )}
    </div>
  )
}
