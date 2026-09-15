import type { Entry } from '../db/types'
import type { NotebookData } from './bundle'

/**
 * The notebook as plain Markdown. Technical plan §4.
 *
 * This is the reason the bundle bothers with a folder structure. It costs about fifty lines and it
 * means the journal is readable in any text editor forever, with no app and no import step. Given how
 * much of this design is about a journal that just works, the data should be readable the same way.
 *
 * Ignored on import. It is output, never input, so it can be regenerated or thrown away freely.
 */

const longDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })

/** Markdown treats these as syntax at the start of a line. Journal prose should not become a heading. */
const escapeLine = (s: string): string => s.replace(/^([#>\-*+]|\d+\.)\s/gm, '\\$1 ')

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

export const renderReadable = (d: NotebookData, exportedAt = new Date()): string => {
  const { notebook } = d
  const out: string[] = []

  out.push(`# ${notebook.title}`, '')

  const heading = [notebook.language, notebook.focus].filter(Boolean).join(' · ')
  if (heading) out.push(heading, '')

  out.push(
    [
      count(d.entries.length, 'entry', 'entries'),
      count(d.words.length, 'word'),
      count(d.sentences.length, 'sentence'),
    ].join(' · '),
    '',
    `Exported ${longDate(exportedAt.toISOString())}.`,
    '',
  )

  // Newest first, matching the timeline.
  const entries = [...d.entries].sort((a, b) => (a.date < b.date ? 1 : -1))

  for (const entry of entries) {
    out.push('---', '')
    out.push(`## ${longDate(entry.date)}${entry.title ? ` — ${entry.title}` : ''}`, '')
    if (entry.source) out.push(`*${entry.source}*`, '')
    if (entry.body.trim()) out.push(escapeLine(entry.body.trim()), '')

    const words = wordsFor(d, entry)
    if (words.length > 0) {
      out.push('**Words**', '')
      for (const w of words) {
        out.push(`- ${w.term}${w.meaning ? ` — ${w.meaning}` : ''}${w.note ? ` (${w.note})` : ''}`)
      }
      out.push('')
    }

    const sentences = sentencesFor(d, entry)
    if (sentences.length > 0) {
      out.push('**Sentences**', '')
      for (const s of sentences) {
        const origin = s.origin === 'encountered' ? '' : ` [${s.origin}]`
        out.push(`- ${s.text}${origin}${s.translation ? ` — *${s.translation}*` : ''}`)
      }
      out.push('')
    }

    const attachments = d.attachments.filter((a) => a.entryId === entry.id)
    if (attachments.length > 0) {
      out.push('**Attached**', '')
      for (const a of attachments) {
        if (a.kind === 'text' && a.text) {
          out.push(`- pasted text:`, '', indent(escapeLine(a.text.trim())), '')
        } else {
          const file = d.media.find((m) => m.id === a.mediaId)?.file
          out.push(`- ${a.filename ?? a.kind}${file ? ` (${file})` : ''}`)
        }
      }
      out.push('')
    }
  }

  // A word that was never tied to an entry should not vanish from the readable copy.
  const loose = d.words.filter((w) => !d.encounters.some((e) => e.targetId === w.id))
  if (loose.length > 0) {
    out.push('---', '', '## Words with no entry', '')
    for (const w of loose) out.push(`- ${w.term}${w.meaning ? ` — ${w.meaning}` : ''}`)
    out.push('')
  }

  return out.join('\n')
}

const wordsFor = (d: NotebookData, entry: Entry) => {
  const ids = new Set(
    d.encounters.filter((e) => e.entryId === entry.id && e.targetType === 'word').map((e) => e.targetId),
  )
  return d.words.filter((w) => ids.has(w.id))
}

const sentencesFor = (d: NotebookData, entry: Entry) => {
  const ids = new Set(
    d.encounters
      .filter((e) => e.entryId === entry.id && e.targetType === 'sentence')
      .map((e) => e.targetId),
  )
  return d.sentences.filter((s) => ids.has(s.id))
}

const indent = (s: string): string =>
  s
    .split('\n')
    .map((l) => `  > ${l}`)
    .join('\n')
