import { useMemo } from 'react'
import { Drill, type DrillItem, type DrillPrompts, type DrillState } from '../drill'
import { cuePrompt, hintPrompt, markPrompt } from './prompt'
import type { BundledSentence, WorkbookProps } from '../sdk'

/**
 * Sentence drill. Word drill's twin, over the sentences the learner has collected.
 *
 * The sentence is shown with its translation, and each cue asks for its pattern in a new situation:
 * another time, another listener, the negative, a reply. Same loop as word drill (`workbooks/drill.tsx`),
 * same three rounds and the same ladder, with practice recorded against the sentence.
 */

export type { DrillState }

const view = (s: BundledSentence): DrillItem => ({
  id: s.sentence.id,
  targetType: 'sentence',
  text: s.sentence.text,
  ...(s.sentence.translation ? { gloss: s.sentence.translation } : {}),
})

export const SentenceDrill = (props: WorkbookProps<DrillState>) => {
  const { bundle } = props

  const prompts = useMemo<DrillPrompts<BundledSentence>>(
    () => ({
      cue: (s) => cuePrompt(s, bundle),
      mark: (s, rounds, last) => markPrompt(s, rounds, last, bundle),
      hint: (s, ask, rung) => hintPrompt(s, ask, bundle, rung),
    }),
    [bundle],
  )

  return (
    <Drill
      {...props}
      workbookId="sentence-drill"
      items={bundle.sentences}
      view={view}
      prompts={prompts}
      noun="sentence"
      title="Sentence drill"
      empty={
        <p className="empty">
          No sentences to drill yet. Keep a few from your entries or a lesson, and they will show up here.
        </p>
      }
    />
  )
}
