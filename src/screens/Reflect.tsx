import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileText, Pencil } from 'lucide-react'
import { db } from '../db/db'
import { nextQuestion, type ReflectContext, type Turn } from '../ai/reflect'
import { failureLine } from '../ai/client'
import { appendReflection } from '../journal/writes'
import { RailLink, Shell } from '../ui/Shell'
import { Speak } from '../ui/Speak'
import { useNotebook } from '../ui/hooks'
import { shortDate } from '../ui/format'
import type { Id } from '../db/types'

/**
 * Reflect. UI guide §6, technical plan §10.
 *
 * A short conversation about one entry, in the entry's own shell rather than a modal, because the UI
 * guide gives it the full screen. Questions in Cormorant italic gold, answers on the ruled sheet.
 *
 * Each answered turn is written into the entry body under a hairline the moment it is submitted. That
 * is the whole reason this exists: the conversation is not a transcript kept somewhere, it becomes
 * part of the entry. A reload loses an unsent answer and keeps everything already submitted, which is
 * the right side of §1 to err on.
 *
 * No mic. The UI guide's rail has one, and §9 puts spoken input behind xAI's `/v1/stt`, which is a
 * WebSocket a browser cannot attach an Authorization header to. Typing is always available and was
 * always going to be the fallback, so it is the whole input here rather than a button that fails.
 *
 * The rail's Journal link is gone. This screen sits under one entry, so the head of the rail is that
 * entry, and the pencil under the hairline is the only other place to go.
 */
export const Reflect = () => {
  const { nb, id } = useParams<{ nb: Id; id: Id }>()
  const notebook = useNotebook(nb)
  const navigate = useNavigate()

  const entry = useLiveQuery(() => (id ? db.entries.get(id) : undefined), [id])

  const [turns, setTurns] = useState<Turn[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [ended, setEnded] = useState(false)

  const answerRef = useRef<HTMLTextAreaElement>(null)
  const asked = useRef(false)

  // The entry as the model sees it, captured on the first question and then held. Re-reading it each
  // turn would feed the conversation its own appended answers back as source material.
  const contextRef = useRef<ReflectContext | undefined>(undefined)

  useEffect(() => {
    if (asked.current || !entry || !notebook) return
    asked.current = true

    contextRef.current = {
      language: notebook.language,
      meaningLanguage: notebook.meaningLanguage ?? 'English',
      focus: notebook.focus,
      title: entry.title,
      source: entry.source,
      body: entry.body,
    }

    const open = async () => {
      setBusy(true)
      try {
        const question = await nextQuestion(contextRef.current!, [])
        if (question) setTurns([{ question }])
        else setEnded(true)
      } catch (e) {
        setError(failureLine(e))
      } finally {
        setBusy(false)
      }
    }
    void open()
  }, [entry, notebook])

  // Grow the answer sheet with the text. Same reason as the composer: the rules are drawn per line, so
  // an inner scrollbar would slide the text off its own ruling.
  useEffect(() => {
    const el = answerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 64)}px`
  }, [draft, turns.length])

  const send = async () => {
    const answer = draft.trim()
    const open = turns[turns.length - 1]
    if (answer === '' || !open || open.answer !== undefined || !id || !contextRef.current) return

    // Written into the entry first. If the next question fails, the turn is still in the journal.
    await appendReflection(id, open.question, answer)

    const answered: Turn[] = [...turns.slice(0, -1), { ...open, answer }]
    setTurns(answered)
    setDraft('')
    setBusy(true)
    setError(undefined)

    try {
      const question = await nextQuestion(contextRef.current, answered)
      if (question) setTurns([...answered, { question }])
      else setEnded(true)
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  if (!nb || !id) return null
  if (entry === undefined) return null
  if (entry === null) {
    return (
      <Shell context={notebook?.title ?? ''} contextTo={`/n/${nb}`} detail="journal">
        <p className="empty">That entry is gone.</p>
      </Shell>
    )
  }

  const open = turns[turns.length - 1]
  const waiting = open?.answer === undefined && open !== undefined

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo={`/n/${nb}`}
      detail={`${shortDate(entry.date)} · reflecting`}
      actions={
        <button className="btn btn-ghost" onClick={() => navigate(`/n/${nb}/e/${id}`)}>
          Stop
        </button>
      }
      back={
        <RailLink to={`/n/${nb}/e/${id}`} label="Back to the entry">
          <FileText size={17} />
        </RailLink>
      }
      rail={
        <RailLink to={`/n/${nb}/e/${id}/edit`} label="Edit the entry">
          <Pencil size={17} />
        </RailLink>
      }
    >
      <div className="rf-thread measure">
        {turns.map((turn, i) => (
          <div key={i} className="rf-turn">
            <div className="rf-question-row">
              <p className="rf-question">{turn.question}</p>
              <Speak
                text={turn.question}
                language={notebook?.language ?? ''}
                size={28}
                title="Speak this question"
              />
            </div>
            {turn.answer !== undefined ? <p className="ruled rf-answer">{turn.answer}</p> : null}
          </div>
        ))}

        {waiting && !ended ? (
          <textarea
            ref={answerRef}
            className="ruled rf-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // §5: never act on a keystroke mid-composition. Without this, Enter while a Hangul
              // syllable is still forming submits a half-built answer.
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder="Answer in your own words."
            aria-label="Your answer"
            autoFocus
          />
        ) : null}

        {busy ? <p className="rf-waiting">Thinking…</p> : null}
        {error ? <p className="st-error">{error}</p> : null}

        {ended ? (
          <p className="rf-ended">That is probably enough for one entry.</p>
        ) : null}
      </div>

      <div className="action-bar">
        <span className="action-note">
          This conversation is saved into {shortDate(entry.date)}&apos;s entry.
        </span>
        <div className="rf-actions">
          {waiting && !ended ? (
            <button
              className="btn btn-secondary"
              disabled={busy || draft.trim() === ''}
              onClick={() => void send()}
            >
              Answer
            </button>
          ) : null}
          <Link to={`/n/${nb}/e/${id}?extract=1`} className="btn btn-ghost">
            Extract
          </Link>
          <Link to={`/n/${nb}/e/${id}`} className="btn btn-primary">
            Back to entry
          </Link>
        </div>
      </div>
    </Shell>
  )
}
