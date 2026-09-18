import { BookOpen } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { Story, type StoryState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * The illustrated story's manifest.
 *
 * Entries with bodies, because the places and people it offers have to be somewhere the learner has
 * been and someone they know. `Entry.topic` would have been the obvious source and is a dead field:
 * declared, patchable, searched, and never written by anything.
 */
const manifest: WorkbookManifest<StoryState> = {
  id: 'story',
  name: 'Choose your own story',
  // An open book. The one exercise here that is just read, so the glyph is a book being read.
  icon: BookOpen,
  request: {
    notebookProfile: true,
    words: { limit: 20, order: 'recent' },
    sentences: { limit: 12 },
    entries: { limit: 10, includeBody: true },
  },
  describes: (b: ContextBundle) => {
    if (b.words.length === 0) return 'Nothing to draw on yet. Collect a few words first.'
    const focus = b.words.filter((w) => w.focus).length
    return focus > 0
      ? `A scene built around the ${plural(focus, 'word')} you picked.`
      : `A scene built from this notebook's focus and ${plural(b.words.length, 'word')}.`
  },
  Component: Story,
}

export const story = register(manifest)
