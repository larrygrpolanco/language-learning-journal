import { NotebookPen } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { WordDrill, type DrillState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * Word drill's manifest. Technical plan §8.
 *
 * `request` is the whole of what this exercise can see. It asks for the notebook profile because the
 * cue has to be plausible for the notebook, and for words it has met but not drilled much, which is
 * the set a drill is actually for.
 */
const manifest: WorkbookManifest<DrillState> = {
  id: 'word-drill',
  name: 'Word drill',
  // A workbook you write the answer into, which is exactly the shape of this exercise: a cue on the
  // page and a blank under it. Leaves the plain and ruled notebooks free for exercises that only ask
  // you to read.
  icon: NotebookPen,
  request: {
    notebookProfile: true,
    words: { limit: 8, order: 'least-practiced', recentDays: 60 },
  },
  /**
   * The line under the name on the practice page. UI guide §8 asks it to state what this draws from
   * the notebook, so it counts the real bundle rather than describing the request in the abstract.
   */
  describes: (b: ContextBundle) =>
    b.words.length === 0
      ? 'Nothing to draw on yet. Write a few entries first.'
      : `Draws on ${plural(b.words.length, 'word')} you have met and barely practiced.`,
  Component: WordDrill,
}

export const wordDrill = register(manifest)
