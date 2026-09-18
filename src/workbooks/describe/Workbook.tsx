import { useEffect, useRef, useState } from 'react'
import { blobToDataUrl, failureLine } from '../../ai/client'
import { Capturable } from '../../ui/Capturable'
import { BlobPlate } from '../../ui/Plate'
import { Speak } from '../../ui/Speak'
import { Support, type Ladder } from '../../ui/Support'
import { usedTargets, wordsUsedIn } from '../level'
import {
  briefPrompt,
  BRIEF_SCHEMA,
  hintPrompt,
  isSceneBrief,
  isVerdict,
  markPrompt,
  VERDICT_SCHEMA,
  type SceneBrief,
  type Verdict,
} from './prompt'
import type { WorkbookProps } from '../sdk'

/**
 * Describe the picture. A scene drawn to hold your own words, and you say what is in it.
 *
 * Not from the mocks. The other four rows on the practice page are drawn there; this one is invented,
 * and it is here because it is the only exercise in the set where the answer key is not a model's
 * opinion. The picture goes back with the description, so marking is done by something looking at the
 * same image, and "you did not mention the bowl" is a fact rather than a judgment.
 *
 * That also makes the image load-bearing. In the story a picture is mood and losing it costs nothing;
 * here it is the question, which is why losing it on a restore has to be said out loud rather than
 * quietly redrawn under a description of the picture that used to be there.
 *
 * Drawing is behind a press, not on mount. An image is roughly a hundred cheap text calls, and opening
 * a workbook to see what it is should not cost that.
 */

export interface DescribeState {
  scene?: SceneBrief
  description: string
  verdict?: Verdict
}

const IMAGE_W = 420
const IMAGE_H = 300

export const Describe = ({
  bundle,
  state,
  setState,
  setLabel,
  ai,
  journal,
  close,
}: WorkbookProps<DescribeState>) => {
  const [scene, setScene] = useState<SceneBrief | undefined>(state?.scene)
  const [description, setDescription] = useState(state?.description ?? '')
  const [verdict, setVerdict] = useState<Verdict | undefined>(state?.verdict)

  // Never persisted. The picture is the one thing here that cannot survive the dock.
  const [image, setImage] = useState<Blob>()
  const [dataUrl, setDataUrl] = useState<string>()
  // Set when a restore had to draw a second picture, so the cleared description has a reason on screen.
  const [redrawn, setRedrawn] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const answerRef = useRef<HTMLTextAreaElement>(null)
  const language = bundle.profile?.language ?? ''

  useEffect(() => {
    setLabel(verdict ? 'marked' : image ? 'describing' : 'not drawn yet')
  }, [verdict, image, setLabel])

  useEffect(() => {
    const el = answerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 88)}px`
  }, [description, image])

  /**
   * The picture, as bytes and as a data URL.
   *
   * Both, because the two uses are genuinely different: the blob goes on screen through `BlobPlate` and
   * into a saved moment as media, and the data URL goes back to the model in every call after this one.
   * Converting once here beats converting on each of four possible calls.
   */
  const hold = async (blob: Blob) => {
    setImage(blob)
    setDataUrl(await blobToDataUrl(blob))
  }

  /** One text call for the brief, one image call for the picture. Both from this press. */
  const draw = async (brief?: SceneBrief) => {
    setBusy(true)
    setError(undefined)
    try {
      let next = brief
      if (!next) {
        const p = briefPrompt(bundle)
        next = await ai.completeJson<SceneBrief>(p.input, {
          name: 'describe_brief',
          schema: BRIEF_SCHEMA,
          guard: isSceneBrief,
          instructions: p.instructions,
        })
        setScene(next)
      }

      await hold(await ai.draw(next.imagePrompt))
      setState({ scene: next, description: brief ? '' : description })
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  /**
   * A restored session whose picture went with the sheet.
   *
   * The same brief draws a second picture of the same scene, and the differences in detail are exactly
   * the ones marking would have penalised, so the description starts again. Saying so is the point:
   * silently marking a description of a picture that no longer exists is the failure to avoid.
   */
  const redraw = () => {
    if (!scene) return
    setDescription('')
    setVerdict(undefined)
    setRedrawn(true)
    void draw(scene)
  }

  const submit = async () => {
    const text = description.trim()
    if (!dataUrl || text === '' || verdict) return

    setBusy(true)
    setError(undefined)
    try {
      const p = markPrompt(bundle, dataUrl, text)
      const marked = await ai.completeJson<Verdict>(p.input, {
        name: 'describe_verdict',
        schema: VERDICT_SCHEMA,
        guard: isVerdict,
        instructions: p.instructions,
      })
      setVerdict(marked)
      setState({ ...(scene ? { scene } : {}), description: text, verdict: marked })

      // The words they actually wrote, and only if the description worked. As in the roleplay, the
      // evidence has to be something they typed rather than something a model reports about them.
      if (marked.right) {
        for (const w of wordsUsedIn(bundle, text)) {
          await journal.recordPractice({
            workbookId: 'describe',
            targetType: 'word',
            targetId: w.word.id,
            outcome: 'right',
          })
        }
      }
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  const hint = (rung: 0 | 1 | 2) => async () => {
    if (!dataUrl) throw new Error('nothing drawn yet')
    const p = hintPrompt(bundle, dataUrl, rung)
    // No `quick` on any of these. The non-reasoning model reads an image poorly enough that it is not
    // used where an attachment is the point.
    return ai.complete(p.input, { instructions: p.instructions })
  }

  const ladder: Ladder = [hint(0), hint(1), hint(2)]

  /** Rung 3 taken. Recorded against the words the scene was drawn to hold, and inert by design. */
  const spend = () => {
    if (!scene) return
    for (const t of usedTargets(bundle, scene.used)) {
      void journal.recordPractice({ workbookId: 'describe', ...t, outcome: 'shown' })
    }
  }

  const keep = async () => {
    if (!verdict) return
    const body = [
      description.trim(),
      '',
      verdict.comment,
      verdict.missed.length > 0 ? `Missed: ${verdict.missed.join(', ')}` : '',
      '',
      verdict.better,
    ]
      .filter((l) => l !== '')
      .join('\n')

    await journal.saveMoment({
      title: 'Described a picture',
      source: 'practice',
      body,
      ...(image ? { media: [image] } : {}),
    })
    setSaved(true)
  }

  /* ── nothing drawn ──────────────────────────────────────────────────────── */

  if (!image) {
    return (
      <div className="ds">
        <p className="wb-prose">
          A scene with your own words in it, and you say what is in the scene. One picture, drawn when
          you press.
        </p>
        {error ? <p className="st-error">{error}</p> : null}
        {busy ? (
          <p className="rf-waiting">Drawing it…</p>
        ) : (
          <div className="wb-actions">
            <button className="btn btn-primary" onClick={() => void (scene ? redraw() : draw())}>
              {scene ? 'Draw it again' : 'Draw a scene'}
            </button>
          </div>
        )}
        {scene && !busy ? (
          <p className="text-muted ds-note">
            The picture went when you put this down. A new one of the same scene means starting the
            description again.
          </p>
        ) : null}
      </div>
    )
  }

  /* ── describing ─────────────────────────────────────────────────────────── */

  return (
    <div className="ds">
      <BlobPlate blob={image} width={IMAGE_W} height={IMAGE_H} alt="the scene to describe" />

      {redrawn ? (
        <p className="text-muted ds-note">Drawn again, so this is not quite the picture you had.</p>
      ) : null}

      {verdict ? (
        <>
          <p className="ruled rf-answer">{description}</p>
          <p className={verdict.right ? 'wb-verdict wb-verdict-right' : 'wb-verdict'}>
            {verdict.comment}
          </p>
          {verdict.missed.length > 0 ? (
            <p className="ds-missed">You did not mention: {verdict.missed.join(', ')}</p>
          ) : null}
          <div className="wb-better">
            <Capturable notebookId={bundle.notebookId} className="sentence">
              {verdict.better}
            </Capturable>
            <Speak text={verdict.better} language={language} size={28} />
          </div>
        </>
      ) : (
        <textarea
          ref={answerRef}
          className="ruled rf-input ds-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => {
            // §5. Enter mid-composition would submit a half-formed Hangul syllable.
            if (e.nativeEvent.isComposing) return
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
          placeholder="What is in it?"
          aria-label="Your description"
          autoFocus
        />
      )}

      {error ? <p className="st-error">{error}</p> : null}

      {verdict ? null : <Support rungs={ladder} onSpend={spend} />}

      <div className="wb-actions">
        {verdict ? (
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
            disabled={busy || description.trim() === ''}
            onClick={() => void submit()}
          >
            Mark it
          </button>
        )}
      </div>
    </div>
  )
}
