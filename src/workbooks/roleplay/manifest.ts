import { BookUser } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { Roleplay, type RoleplayState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * Text-message roleplay's manifest.
 *
 * Entry bodies are the expensive part of this request and the reason it is here: people's names live
 * in what the learner wrote, not in a field, so finding someone worth writing to means reading the
 * entries. Nothing else in the app asks for bodies.
 */
const manifest: WorkbookManifest<RoleplayState> = {
  id: 'roleplay',
  name: 'Text-message roleplay',
  // A book with a person in it. The exercise is a thread with someone, and the glyph says so more
  // plainly than any notebook variant could.
  icon: BookUser,
  request: {
    notebookProfile: true,
    words: { limit: 24, order: 'recent' },
    sentences: { limit: 20 },
    entries: { limit: 12, includeBody: true },
  },
  describes: (b: ContextBundle) => {
    if (b.entries.length === 0) return 'Nothing to draw on yet. Write an entry or two first.'
    const focus = b.words.filter((w) => w.focus).length
    const material = focus > 0 ? `${plural(focus, 'word')} you picked` : plural(b.words.length, 'word')
    return `A thread with someone from your entries. Draws on ${material}.`
  },
  Component: Roleplay,
}

export const roleplay = register(manifest)
