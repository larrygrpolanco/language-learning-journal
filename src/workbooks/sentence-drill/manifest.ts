import { NotebookText } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { SentenceDrill, type DrillState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * Sentence drill's manifest.
 *
 * Eight sentence targets, newest first with focus ahead. Recent words supply familiar substitutions.
 */
const manifest: WorkbookManifest<DrillState> = {
  id: 'sentence-drill',
  name: 'Sentence drill',
  // Word drill's notebook, with lines of text in it rather than a pen. The pair reads as a pair.
  icon: NotebookText,
  request: {
    notebookProfile: true,
    sentences: { limit: 8 },
    words: { limit: 24, order: 'recent' },
  },
  describes: (b: ContextBundle) => {
    if (b.sentences.length === 0) return 'Nothing to draw on yet. Keep a few sentences first.'
    const focus = b.sentences.filter((s) => s.focus).length
    return focus > 0
      ? `Reworks the ${plural(focus, 'sentence')} you picked into new situations.`
      : `Reworks ${plural(b.sentences.length, 'sentence')} you have kept into new situations.`
  },
  Component: SentenceDrill,
}

export const sentenceDrill = register(manifest)
