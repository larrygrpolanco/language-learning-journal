import { BookHeadphones } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { Listening, type ListeningState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * The listening dialog's manifest.
 *
 * Sentence-led, which is the one request in the app that leads with sentences. A dialog assembled from
 * words is a vocabulary list read aloud; a dialog assembled from sentences the learner wrote down is
 * their own material coming back at speaking speed, which is the part that is actually hard.
 */
const manifest: WorkbookManifest<ListeningState> = {
  id: 'listening',
  name: 'Listening dialog',
  // A book with headphones. Names the modality outright, which no notebook variant can.
  icon: BookHeadphones,
  request: {
    notebookProfile: true,
    sentences: { limit: 30 },
    words: { limit: 16, order: 'recent' },
  },
  describes: (b: ContextBundle) => {
    if (b.sentences.length === 0) return 'Nothing to draw on yet. Collect a few sentences first.'
    const focus = b.sentences.filter((s) => s.focus).length
    const material =
      focus > 0 ? `${plural(focus, 'sentence')} you picked` : plural(b.sentences.length, 'sentence')
    return `Two speakers, spoken aloud. Uses ${material}.`
  },
  Component: Listening,
}

export const listening = register(manifest)
