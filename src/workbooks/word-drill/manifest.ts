import { NotebookPen } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { WordDrill, type DrillState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * Word drill's manifest. Technical plan §8.
 *
 * `request` is the whole of what this exercise can see. It asks for the notebook profile because the
 * cue has to be plausible for the notebook. All vocabulary is available as supporting context;
 * the workbook itself takes eight targets. Sentences and recent entries show familiar patterns.
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
    words: { order: 'random' },
    sentences: { limit: 20 },
    entries: { limit: 5, includeBody: true },
  },
  /**
   * The line under the name on the practice page. UI guide §8 asks it to state what this draws from
   * the notebook, so it counts the real bundle rather than describing the request in the abstract.
   *
   * Which is also why it reports a focus when there is one. The bundle it is handed is already built
   * with the scope, so this needs no extra plumbing to tell the truth about it.
   */
  describes: (b: ContextBundle) => {
    if (b.words.length === 0) return 'Nothing to draw on yet. Write a few entries first.'
    const targets = b.words.slice(0, 8)
    const focus = targets.filter((w) => w.focus).length
    return focus > 0
      ? `Drills the ${plural(focus, 'word')} you picked, then other notebook words in random order.`
      : `Practices ${plural(targets.length, 'word')} in random order, with your notebook as context.`
  },
  Component: WordDrill,
}

export const wordDrill = register(manifest)
