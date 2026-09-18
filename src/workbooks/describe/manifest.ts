import { BookImage } from 'lucide-react'
import { register, type ContextBundle, type WorkbookManifest } from '../sdk'
import { Describe, type DescribeState } from './Workbook'
import { plural } from '../../ui/format'

/**
 * Describe the picture's manifest.
 *
 * Words only. There is no conversation to have and no narrative to continue, so entries and sentences
 * would be context the exercise never reads, and the request is what a workbook can see.
 */
const manifest: WorkbookManifest<DescribeState> = {
  id: 'describe',
  name: 'Describe the picture',
  // A book with a picture in it. As with the headphones, the glyph names the modality outright.
  icon: BookImage,
  request: {
    notebookProfile: true,
    words: { limit: 12, order: 'recent' },
  },
  describes: (b: ContextBundle) => {
    if (b.words.length === 0) return 'Nothing to draw on yet. Collect a few words first.'
    const focus = b.words.filter((w) => w.focus).length
    const material = focus > 0 ? `the ${plural(focus, 'word')} you picked` : plural(b.words.length, 'word')
    return `A scene drawn to hold ${material}. One picture per press.`
  },
  Component: Describe,
}

export const describe = register(manifest)
