import { useEffect, useRef, useState } from 'react'
import { failureLine } from '../../ai/client'
import { Capturable } from '../../ui/Capturable'
import { BlobPlate } from '../../ui/Plate'
import { Speak } from '../../ui/Speak'
import { Support, type Ladder } from '../../ui/Support'
import { usedTargets } from '../level'
import {
  hintPrompt,
  isScene,
  isStorySetup,
  LAST_SCENE,
  SCENE_SCHEMA,
  scenePrompt,
  SETUP_SCHEMA,
  setupPrompt,
  type Scene,
  type StorySetup,
} from './prompt'
import type { WorkbookProps } from '../sdk'

/**
 * Choose your own story. An illustrated scene built out of the notebook, and a press to go on.
 *
 * Because choosing is a press, the next illustration draws on the same press rather than behind a
 * second button. That is what makes this a storybook instead of a gallery with a Draw control, and it
 * keeps §1 true without asking the learner to press twice for one step.
 *
 * The pictures toggle sits in the setup rather than in settings, so the cost is visible before it is
 * spent: one image is roughly a hundred cheap text calls, and the learner deciding that up front is
 * better than the app deciding it for them.
 *
 * Images live in React state and die with the sheet (§7). Restoring a docked story keeps every word and
 * loses every picture, which §15 accepts: the text is the exercise and the pictures are the mood.
 */

interface Told {
  prose: string
  choices: string[]
  imagePrompt: string
  used: string[]
  /** What the learner picked here. Absent on the scene they are looking at now. */
  chose?: string
}

export interface StoryState {
  setup?: { place: string; companion: string; pictures: boolean }
  scenes: Told[]
}

const IMAGE_W = 420
const IMAGE_H = 280

export const Story = ({
  bundle,
  state,
  setState,
  setLabel,
  ai,
  journal,
  close,
}: WorkbookProps<StoryState>) => {
  const [setup, setSetup] = useState(state?.setup)
  const [scenes, setScenes] = useState<Told[]>(state?.scenes ?? [])

  const [offer, setOffer] = useState<StorySetup>()
  const [place, setPlace] = useState('')
  const [companion, setCompanion] = useState('')
  const [pictures, setPictures] = useState(false)

  // Not in state, and not written anywhere. Keyed by scene index so a picture stays with its scene.
  const [images, setImages] = useState<ReadonlyMap<number, Blob>>(new Map())

  const [busy, setBusy] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [error, setError] = useState<string>()
  const [saved, setSaved] = useState(false)

  const foot = useRef<HTMLDivElement>(null)
  const begun = useRef(false)

  const language = bundle.profile?.language ?? ''
  const current = scenes[scenes.length - 1]
  const ended = current !== undefined && current.choices.length === 0

  // Where and who with. One call, skipped entirely for a restored story, which is past choosing.
  useEffect(() => {
    let live = true
    if (setup || offer) return

    const ask = async () => {
      setBusy(true)
      setError(undefined)
      try {
        const p = setupPrompt(bundle)
        const got = await ai.completeJson<StorySetup>(p.input, {
          name: 'story_setup',
          schema: SETUP_SCHEMA,
          guard: isStorySetup,
          instructions: p.instructions,
        })
        if (!live) return
        setOffer(got)
        setPlace(got.places[0] ?? '')
        setCompanion(got.companions[0] ?? '')
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
  }, [setup, offer, bundle, ai])

  useEffect(() => {
    setLabel(setup ? `scene ${Math.max(scenes.length, 1)} of ${LAST_SCENE}` : 'setting up')
  }, [setup, scenes.length, setLabel])

  useEffect(() => {
    foot.current?.scrollIntoView({ block: 'nearest' })
  }, [scenes.length, busy])

  /**
   * Draws one scene, if pictures are on.
   *
   * Its own state flag rather than the shared one, so the prose appears as soon as it arrives and the
   * picture fills in under it. Making the reader wait on the image for text that is already here would
   * be paying for the picture twice.
   */
  const illustrate = async (at: number, prompt: string) => {
    setDrawing(true)
    try {
      const blob = await ai.draw(prompt)
      setImages((prev) => new Map(prev).set(at, blob))
    } catch (e) {
      // A failed picture is not a failed scene. Say so and leave the story readable.
      setError(failureLine(e))
    } finally {
      setDrawing(false)
    }
  }

  /**
   * The next scene, and its picture on the same press.
   *
   * `told` is passed in because it holds the choice just made, which is the only thing that decides
   * what happens next.
   */
  const advance = async (
    chosen: { place: string; companion: string; pictures: boolean },
    told: Told[],
  ) => {
    setBusy(true)
    setError(undefined)

    let drew: string | undefined
    try {
      const p = scenePrompt(
        bundle,
        chosen,
        told.map((t) => ({ prose: t.prose, chose: t.chose ?? '' })),
      )
      const scene = await ai.completeJson<Scene>(p.input, {
        name: 'story_scene',
        schema: SCENE_SCHEMA,
        guard: isScene,
        instructions: p.instructions,
      })

      const next: Told[] = [
        ...told,
        {
          prose: scene.prose,
          choices: scene.choices,
          imagePrompt: scene.imagePrompt,
          used: scene.used,
        },
      ]
      setScenes(next)
      setState({ setup: chosen, scenes: next })
      drew = scene.imagePrompt
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }

    // Outside the block that clears `busy`, so the prose is readable while the picture is still coming.
    // The new scene's index is the length of what came before it.
    if (drew !== undefined && chosen.pictures) await illustrate(told.length, drew)
  }

  const begin = () => {
    const chosen = {
      place: place.trim() || (offer?.places[0] ?? 'somewhere familiar'),
      companion: companion.trim() || (offer?.companions[0] ?? 'someone you know'),
      pictures,
    }
    setSetup(chosen)
    setOffer(undefined)
    begun.current = true
    setState({ setup: chosen, scenes: [] })
    void advance(chosen, [])
  }

  // A restored story that never got its first scene. Rare, and a set-up story with nothing in it looks
  // broken rather than unstarted.
  useEffect(() => {
    if (!setup || begun.current || scenes.length > 0 || busy) return
    begun.current = true
    void advance(setup, [])
    // Fires once, from a render where the closed-over state is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup])

  const choose = (chose: string) => {
    if (!setup || busy) return
    const told = scenes.map((s, i) => (i === scenes.length - 1 ? { ...s, chose } : s))
    setScenes(told)
    void advance(setup, told)
  }

  /** The three rungs for the scene on screen. Only the pressed ones cost anything. */
  const hint = (rung: 0 | 1 | 2) => async () => {
    if (!current) throw new Error('nothing to read yet')
    const p = hintPrompt(bundle, current.prose, rung)
    return ai.complete(p.input, { instructions: p.instructions, quick: rung !== 1 })
  }

  const ladder: Ladder = [hint(0), hint(1), hint(2)]

  /** Rung 3 taken. Recorded against the material the scene was built from, and inert by design. */
  const spend = () => {
    if (!current) return
    for (const t of usedTargets(bundle, current.used)) {
      void journal.recordPractice({ workbookId: 'story', ...t, outcome: 'shown' })
    }
  }

  /** The story as an entry, with whichever pictures are still in memory. */
  const keep = async () => {
    if (scenes.length === 0) return

    const body = scenes
      .map((s) => (s.chose !== undefined ? `${s.prose}\n\n> ${s.chose}` : s.prose))
      .join('\n\n')

    const media = scenes.flatMap((_, i) => {
      const blob = images.get(i)
      return blob ? [blob] : []
    })

    await journal.saveMoment({
      title: setup ? `A story at ${setup.place}` : 'A story',
      source: 'practice',
      body,
      ...(media.length > 0 ? { media } : {}),
    })
    setSaved(true)
  }

  /* ── setting up ─────────────────────────────────────────────────────────── */

  if (!setup) {
    return (
      <div className="sy">
        {error ? <p className="st-error">{error}</p> : null}
        {busy && !offer ? <p className="rf-waiting">Looking through your notebook…</p> : null}

        {offer ? (
          <>
            <Chips label="Where" options={offer.places} value={place} onChange={setPlace} />
            <Chips
              label="Who with"
              options={offer.companions}
              value={companion}
              onChange={setCompanion}
            />

            <label className="sy-pictures">
              <input
                type="checkbox"
                className="pick-box"
                checked={pictures}
                onChange={() => setPictures(!pictures)}
              />
              <span className={pictures ? 'pick-tick pick-tick-on' : 'pick-tick'} />
              <span>one picture per scene</span>
            </label>

            <div className="wb-actions">
              <button className="btn btn-primary" onClick={begin}>
                Begin
              </button>
            </div>
          </>
        ) : null}
      </div>
    )
  }

  /* ── the story ──────────────────────────────────────────────────────────── */

  return (
    <div className="sy">
      {scenes.map((s, i) => (
        // Index as key: scenes only ever append.
        <div key={i} className="sy-scene">
          {images.get(i) ? (
            <BlobPlate blob={images.get(i)!} width={IMAGE_W} height={IMAGE_H} />
          ) : null}

          <div className="sy-prose-row">
            <Capturable notebookId={bundle.notebookId} className="sy-prose">
              {s.prose}
            </Capturable>
            <Speak text={s.prose} language={language} size={28} />
          </div>

          {s.chose !== undefined ? <p className="sy-chose">{s.chose}</p> : null}
        </div>
      ))}

      {busy ? <p className="rf-waiting">…</p> : drawing ? <p className="rf-waiting">drawing…</p> : null}
      {error ? <p className="st-error">{error}</p> : null}

      {/* The first scene is the one failure with nothing left on screen to press. Later on, the
          choices are still there and pressing one again is the retry. */}
      {scenes.length === 0 && !busy ? (
        <div className="wb-actions">
          <button className="btn btn-primary" onClick={() => void advance(setup, [])}>
            Try again
          </button>
        </div>
      ) : null}

      {current && !busy ? (
        ended ? (
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
            <div className="sy-choices">
              {current.choices.map((c) => (
                <button key={c} className="sy-choice" onClick={() => choose(c)}>
                  {c}
                </button>
              ))}
            </div>
            {/* Keyed on the scene, so the ladder starts at the bottom for each new one. */}
            <Support key={scenes.length} rungs={ladder} onSpend={spend} />
          </>
        )
      ) : null}

      <div ref={foot} />
    </div>
  )
}

/**
 * A row of taps with a field beside it.
 *
 * The chips are what makes the setup two taps, and the field is what stops them being a menu: the
 * notebook cannot know everywhere the learner has been, and a suggestion they have to accept is worse
 * than one they can overwrite.
 */
const Chips = ({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly string[]
  value: string
  onChange: (next: string) => void
}) => (
  <div className="sy-pick">
    <span className="sy-label">{label}</span>
    <div className="sy-chips">
      {options.map((o) => (
        <button
          key={o}
          className={o === value ? 'tag tag-outline sy-chip sy-chip-on' : 'tag sy-chip'}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
    <input
      className="input sy-free"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
    />
  </div>
)
