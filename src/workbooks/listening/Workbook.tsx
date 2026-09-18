import { useEffect, useState } from 'react'
import { failureLine } from '../../ai/client'
import { Capturable } from '../../ui/Capturable'
import { Speak } from '../../ui/Speak'
import { Support, type Ladder } from '../../ui/Support'
import { usedTargets } from '../level'
import {
  dialogPrompt,
  DIALOG_SCHEMA,
  gistPrompt,
  isDialog,
  isMarks,
  markPrompt,
  MARKS_SCHEMA,
  transcript,
  type Dialog,
  type Marks,
} from './prompt'
import type { WorkbookProps } from '../sdk'

/**
 * Listening dialog. Two speakers, generated audio, and the transcript withheld.
 *
 * Withholding it is the exercise. A dialog you can read while it plays is a reading exercise with a
 * soundtrack, and reading is the thing this learner can already do. So the lines are play buttons until
 * the questions are answered, and then they are text.
 *
 * Replay is free and always will be. Listening to a line for the fourth time is not help, it is the
 * work, which is why the support ladder is a separate affordance and pressing play is not on it. The
 * clip cache in `ai/speech.ts` is keyed on voice and text, so the fourth press costs nothing either.
 *
 * Two voices from `GET /v1/tts/voices`, which reports every voice as multilingual, so two ids is the
 * whole of what two speakers takes.
 */

/** One female, one male, so the two speakers are told apart by voice and not by a label. */
const VOICES = ['eve', 'atlas'] as const

export interface ListeningState {
  dialog?: Dialog
  answers: string[]
  marks?: { right: boolean; comment: string }[]
}

export const Listening = ({
  bundle,
  state,
  setState,
  setLabel,
  ai,
  journal,
  close,
}: WorkbookProps<ListeningState>) => {
  const [dialog, setDialog] = useState<Dialog | undefined>(state?.dialog)
  const [answers, setAnswers] = useState<string[]>(state?.answers ?? [])
  const [marks, setMarks] = useState(state?.marks)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const language = bundle.profile?.language ?? ''
  const revealed = marks !== undefined

  // One call for the dialog and its questions. Persisted, unlike word drill's cue: regenerating would
  // hand back a different conversation, and the learner may already have listened to this one.
  useEffect(() => {
    let live = true
    if (dialog) return

    const make = async () => {
      setBusy(true)
      setError(undefined)
      try {
        const p = dialogPrompt(bundle)
        const got = await ai.completeJson<Dialog>(p.input, {
          name: 'listening_dialog',
          schema: DIALOG_SCHEMA,
          guard: isDialog,
          instructions: p.instructions,
        })
        if (!live) return
        setDialog(got)
        setAnswers(got.questions.map(() => ''))
        setState({ dialog: got, answers: got.questions.map(() => '') })
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
  }, [dialog, bundle, ai, setState])

  useEffect(() => {
    if (!dialog) return
    setLabel(revealed ? 'answered' : `${dialog.turns.length} lines`)
  }, [dialog, revealed, setLabel])

  const answer = (at: number, text: string) => {
    const next = answers.map((a, i) => (i === at ? text : a))
    setAnswers(next)
    setState({ ...(dialog ? { dialog } : {}), answers: next, ...(marks ? { marks } : {}) })
  }

  /** Marks every answer at once, and revealing the transcript is what that press buys. */
  const submit = async () => {
    if (!dialog || revealed) return
    setBusy(true)
    setError(undefined)
    try {
      const p = markPrompt(bundle, dialog, answers)
      const got = await ai.completeJson<Marks>(p.input, {
        name: 'listening_marks',
        schema: MARKS_SCHEMA,
        guard: isMarks,
        instructions: p.instructions,
      })
      setMarks(got.marks)
      setState({ dialog, answers, marks: got.marks })
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * The three rungs. Only the first one is a call.
   *
   * The other two hand back text this component is already holding, which is the honest shape for an
   * exercise whose difficulty comes from withholding rather than from generating.
   */
  const ladder: Ladder = [
    async () => {
      if (!dialog) throw new Error('nothing to listen to yet')
      const p = gistPrompt(bundle, dialog)
      return ai.complete(p.input, { instructions: p.instructions, quick: true })
    },
    async () => {
      if (!dialog) throw new Error('nothing to listen to yet')
      const first = dialog.turns[0]
      return first ? `${dialog.speakers[first.speaker === 1 ? 1 : 0]}: ${first.line}` : ''
    },
    async () => (dialog ? transcript(dialog) : ''),
  ]

  /** Rung 3 taken. Recorded against the sentences the dialog was built from, and inert by design. */
  const spend = () => {
    if (!dialog) return
    for (const t of usedTargets(bundle, dialog.used)) {
      void journal.recordPractice({ workbookId: 'listening', ...t, outcome: 'shown' })
    }
  }

  const keep = async () => {
    if (!dialog) return
    const body = [
      transcript(dialog),
      '',
      ...dialog.questions.map((q, i) => `${q}\n${answers[i]?.trim() ?? ''}`),
    ].join('\n')

    await journal.saveMoment({ title: 'Listening', source: 'practice', body })
    setSaved(true)
  }

  if (!dialog) {
    return (
      <div className="ls">
        {error ? <p className="st-error">{error}</p> : null}
        {busy ? (
          <p className="rf-waiting">Writing it…</p>
        ) : (
          <div className="wb-actions">
            <button className="btn btn-primary" onClick={() => setDialog(undefined)}>
              Try again
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="ls">
      <p className="wb-prose">
        {revealed
          ? 'Here it is.'
          : `${dialog.speakers.slice(0, 2).join(' and ')}. Play each line as many times as you like.`}
      </p>

      <div className="ls-turns">
        {dialog.turns.map((t, i) => {
          const who = t.speaker === 1 ? 1 : 0
          return (
            // Index as key: the dialog is fixed once written.
            <div key={i} className={who === 1 ? 'ls-turn ls-second' : 'ls-turn'}>
              <span className="ls-who">{dialog.speakers[who]}</span>
              <Speak
                text={t.line}
                language={language}
                voice={VOICES[who]}
                size={28}
                title={`Play ${dialog.speakers[who] ?? 'this line'}`}
              />
              {revealed ? (
                <Capturable notebookId={bundle.notebookId} className="ls-line">
                  {t.line}
                </Capturable>
              ) : (
                // A rule the length of the line, so the shape of the dialog is visible and the words
                // are not. Reading how long a turn is does not give the turn away.
                <span className="ls-hidden" aria-label="not shown yet" />
              )}
            </div>
          )
        })}
      </div>

      <div className="ls-questions">
        {dialog.questions.map((q, i) => (
          <div key={i} className="ls-question">
            <p className="rf-question">{q}</p>
            {revealed ? (
              <>
                <p className="ruled rf-answer">{answers[i] ?? ''}</p>
                <p className={marks?.[i]?.right ? 'wb-verdict wb-verdict-right' : 'wb-verdict'}>
                  {marks?.[i]?.comment ?? ''}
                </p>
              </>
            ) : (
              <textarea
                className="ruled rf-input"
                value={answers[i] ?? ''}
                onChange={(e) => answer(i, e.target.value)}
                placeholder="What did you hear?"
                aria-label={q}
              />
            )}
          </div>
        ))}
      </div>

      {error ? <p className="st-error">{error}</p> : null}

      {revealed ? null : <Support rungs={ladder} onSpend={spend} />}

      <div className="wb-actions">
        {revealed ? (
          <>
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
          </>
        ) : (
          <button
            className="btn btn-primary"
            disabled={busy || answers.every((a) => a.trim() === '')}
            onClick={() => void submit()}
          >
            Answer
          </button>
        )}
      </div>
    </div>
  )
}
