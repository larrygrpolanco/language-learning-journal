import { useMemo } from 'react'
import { Drill, type DrillItem, type DrillPrompts, type DrillState } from '../drill'
import { cuePrompt, hintPrompt, markPrompt } from './prompt'
import type { BundledWord, WorkbookProps } from '../sdk'

/**
 * Word drill. The first workbook, and the shape every later one follows.
 *
 * One word at a time from the bundle. The cue asks for a use rather than a definition, the answer is
 * typed, and marking gives one line, a natural version, and a follow-up that takes the same word one
 * step further. Up to three rounds a word, and moving on is always one press. Practice events are
 * recorded per answer, so the familiarity estimate on the words screen has something to work from.
 *
 * The loop itself is `workbooks/drill.tsx`, shared with sentence drill. What is here is what makes it a
 * word drill: the items and the prompts.
 *
 * Typed input only. §9 puts spoken answers behind xAI's `/v1/stt`, which is a WebSocket a browser
 * cannot attach an Authorization header to, so there is no mic here rather than a mic that fails.
 */

export type { DrillState }

const view = (w: BundledWord): DrillItem => ({
  id: w.word.id,
  targetType: 'word',
  text: w.word.term,
  ...(w.word.meaning ? { gloss: w.word.meaning } : {}),
})

export const WordDrill = (props: WorkbookProps<DrillState>) => {
  const { bundle } = props

  const prompts = useMemo<DrillPrompts<BundledWord>>(
    () => ({
      cue: (w) => cuePrompt(w, bundle),
      mark: (w, rounds, last) => markPrompt(w, rounds, last, bundle),
      hint: (w, ask, rung) => hintPrompt(w, ask, bundle, rung),
    }),
    [bundle],
  )

  return (
    <Drill
      {...props}
      workbookId="word-drill"
      items={bundle.words}
      view={view}
      prompts={prompts}
      noun="word"
      title="Word drill"
      empty={
        <p className="empty">
          No words to drill yet. They build up on their own as you write, and this needs a few.
        </p>
      }
    />
  )
}
