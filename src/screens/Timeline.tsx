import { useEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { createEntry, pruneEmptyEntries } from '../journal/writes'
import { LibraryBack, SectionRail, Shell } from '../ui/Shell'
import { Plate } from '../ui/Plate'
import { useMedia, useNotebook } from '../ui/hooks'
import { plural, shortDate } from '../ui/format'
import type { Attachment, Entry, Id, Media, Word } from '../db/types'

interface TimelineRow {
  entry: Entry
  words: Word[]
  sentences: number
  attachments: Attachment[]
}

/** Case- and accent-insensitive enough for a filter box. Not `normalizeTerm`: this is prose, not a key. */
const matches = (entry: Entry, q: string): boolean => {
  if (q === '') return true
  const needle = q.normalize('NFC').toLocaleLowerCase()
  return [entry.title, entry.body, entry.source, entry.topic].some((f) =>
    f ? f.normalize('NFC').toLocaleLowerCase().includes(needle) : false,
  )
}

/** Groups consecutive rows into local calendar days, preserving order. */
const byDay = (rows: readonly TimelineRow[]): { day: string; rows: TimelineRow[] }[] => {
  const out: { day: string; rows: TimelineRow[] }[] = []
  for (const row of rows) {
    const day = new Date(row.entry.date).toDateString()
    const last = out[out.length - 1]
    if (last && last.day === day) last.rows.push(row)
    else out.push({ day, rows: [row] })
  }
  return out
}

/**
 * The notebook's home. UI guide §2.
 *
 * One continuous column, newest first, opened by a dated hairline per day. The `?q=` filter is the
 * journal's search (technical plan §6): it narrows the column and a day with nothing left loses its
 * hairline. Living in the URL means back clears it and a filtered view survives a reload.
 *
 * The library's own icon sits at the head of the rail, over the hairline, and puts the notebook down.
 * The three icons under it are where you are inside it.
 */
export const Timeline = () => {
  const { nb } = useParams<{ nb: Id }>()
  const notebook = useNotebook(nb)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''

  // Sweeps any entry a composer was backed out of before it got a body. See `pruneEmptyEntries`.
  useEffect(() => {
    if (nb) void pruneEmptyEntries(nb)
  }, [nb])

  const rows = useLiveQuery(async () => {
    if (!nb) return []
    const entries = (await db.entries.where('notebookId').equals(nb).sortBy('date')).reverse()
    return Promise.all(
      entries.map(async (entry): Promise<TimelineRow> => {
        const encounters = await db.encounters.where('entryId').equals(entry.id).toArray()
        const wordIds = encounters.filter((e) => e.targetType === 'word').map((e) => e.targetId)
        return {
          entry,
          words: (await db.words.bulkGet(wordIds)).flatMap((w) => (w ? [w] : [])),
          sentences: encounters.filter((e) => e.targetType === 'sentence').length,
          attachments: await db.attachments.where('entryId').equals(entry.id).toArray(),
        }
      }),
    )
  }, [nb])

  const visible = (rows ?? []).filter((r) => matches(r.entry, q))
  const mediaIds = visible.flatMap((r) => r.attachments.flatMap((a) => (a.mediaId ? [a.mediaId] : [])))
  const media = useMedia(mediaIds)

  const startEntry = async () => {
    if (!nb) return
    const entry = await createEntry(nb)
    navigate(`/n/${nb}/e/${entry.id}/edit`)
  }

  const setQ = (next: string) => {
    if (next === '') setParams({}, { replace: true })
    else setParams({ q: next }, { replace: true })
  }

  if (!nb) return null

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo="/"
      detail="journal"
      actions={
        <>
          <input
            className="input filter"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="filter entries…"
            aria-label="Filter entries"
          />
          <Link to={`/n/${nb}/words`} className="btn btn-ghost">
            Words
          </Link>
          <Link to={`/n/${nb}/sentences`} className="btn btn-ghost">
            Sentences
          </Link>
          {/* Unhidden with the workbook layer. In M1 this led to an empty contents page, so it was
              not shown at all rather than shown and disappointing. */}
          <Link to={`/n/${nb}/practice`} className="btn btn-ghost">
            Practice
          </Link>
          <button className="btn btn-primary" onClick={() => void startEntry()}>
            New entry
          </button>
        </>
      }
      back={<LibraryBack />}
      rail={<SectionRail nb={nb} />}
    >
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="empty">Nothing written yet. An entry is one moment of learning.</p>
      ) : visible.length === 0 ? (
        <p className="empty">No entry matches “{q}”.</p>
      ) : (
        byDay(visible).map(({ day, rows: dayRows }) => (
          <section key={day}>
            <div className="dated">
              <span className="dated-date">{shortDate(dayRows[0]!.entry.date)}</span>
              <span className="dated-fill" />
              {dayRows[0]?.entry.source ? (
                <span className="dated-source">{dayRows[0].entry.source}</span>
              ) : null}
            </div>
            {dayRows.map((row) => (
              <TimelineEntry key={row.entry.id} nb={nb} row={row} media={media} />
            ))}
          </section>
        ))
      )}
    </Shell>
  )
}

/**
 * One entry in the column.
 *
 * An entry whose attachment is the point shows a plate beside the text instead of tags, per the UI
 * guide. Read here as an image with no words pulled out of it yet: a photographed page you have not
 * worked through is exactly that case, and once it yields vocabulary the tags are the better summary.
 */
const TimelineEntry = ({
  nb,
  row,
  media,
}: {
  nb: Id
  row: TimelineRow
  media: Map<Id, Media>
}) => {
  const image = row.attachments.find((a) => a.kind === 'image')
  const plateIsThePoint = image !== undefined && row.words.length === 0

  return (
    <article className="tl-entry">
      <Link to={`/n/${nb}/e/${row.entry.id}`} className="tl-link">
        <div className="tl-text">
          {row.entry.title ? <h4 className="tl-title">{row.entry.title}</h4> : null}
          <p className="tl-body">{row.entry.body}</p>
        </div>
        {plateIsThePoint && image ? (
          <Plate
            attachment={image}
            media={image.mediaId ? media.get(image.mediaId) : undefined}
            width={128}
            height={90}
          />
        ) : null}
      </Link>

      {plateIsThePoint ? null : (
        <div className="tl-tags">
          {row.words.map((w) => (
            <Link key={w.id} to={`/n/${nb}/words/${w.id}`} className="tag tag-outline">
              {w.term}
            </Link>
          ))}
          {row.sentences > 0 ? (
            // Scoped to this entry, so the count leads to the sentences it is counting.
            <Link to={`/n/${nb}/sentences?entry=${row.entry.id}`} className="tag tag-neutral">
              {plural(row.sentences, 'sentence')}
            </Link>
          ) : null}
        </div>
      )}
    </article>
  )
}
