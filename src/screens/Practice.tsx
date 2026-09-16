import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { WORKBOOKS } from '../workbooks'
import { buildContext } from '../workbooks/context'
import { openSession } from '../workbooks/sessions'
import { LibraryBack, SectionRail, Shell } from '../ui/Shell'
import { useNotebook } from '../ui/hooks'
import { relativeDay } from '../ui/format'
import type { ContextBundle } from '../workbooks/sdk'
import type { Id } from '../db/types'

/**
 * The practice page. UI guide §8.
 *
 * A contents page, not a dashboard. One row per workbook: its own glyph, its name, a line stating what
 * it actually draws from this notebook, and a Start button. Nothing here counts streaks, nothing
 * suggests what to do next, and there is no progress anywhere on the screen.
 *
 * The glyph is the workbook's, from its manifest, not the section's. Each exercise is a separate
 * workbook and the shelf should look like one.
 *
 * The lines are real. Each row builds that workbook's own bundle and asks the manifest to describe it,
 * so "Draws on 14 words" is fourteen words that exist rather than a number from the request.
 */
export const Practice = () => {
  const { nb } = useParams<{ nb: Id }>()
  const notebook = useNotebook(nb)
  const navigate = useNavigate()

  const lastPracticed = useLiveQuery(async () => {
    if (!nb) return undefined
    const rows = await db.practiceEvents.where('notebookId').equals(nb).toArray()
    if (rows.length === 0) return undefined
    return rows.reduce((a, b) => (a.at > b.at ? a : b)).at
  }, [nb])

  const start = async (workbookId: string, label: string) => {
    if (!nb) return
    const id = await openSession(nb, workbookId, label)
    // A search param rather than a route, so the practice page stays mounted underneath and
    // minimizing puts the learner back here without a reload.
    navigate(`/n/${nb}/practice?workbook=${id}`)
  }

  if (!nb) return null

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo={`/n/${nb}`}
      detail="practice"
      actions={
        lastPracticed ? (
          <span className="text-muted pr-last">last practiced {relativeDay(lastPracticed)}</span>
        ) : null
      }
      back={<LibraryBack />}
      rail={<SectionRail nb={nb} />}
    >
      <div className="pr-list">
        {WORKBOOKS.map((w, i) => (
          <Row
            key={w.id}
            notebookId={nb}
            workbook={w}
            first={i === 0}
            onStart={(label) => void start(w.id, label)}
          />
        ))}
      </div>
    </Shell>
  )
}

/**
 * One row. Builds its own bundle so its line is true.
 *
 * Not a shared query: each workbook asks for something different, and a row claiming to draw on words
 * a different workbook requested would be worse than no line at all.
 */
const Row = ({
  notebookId,
  workbook,
  first,
  onStart,
}: {
  notebookId: Id
  workbook: (typeof WORKBOOKS)[number]
  first: boolean
  onStart: (label: string) => void
}) => {
  const [bundle, setBundle] = useState<ContextBundle>()

  useEffect(() => {
    let live = true
    void buildContext(notebookId, workbook.request).then((b) => {
      if (live) setBundle(b)
    })
    return () => {
      live = false
    }
  }, [notebookId, workbook])

  const ready = bundle !== undefined && bundle.words.length > 0
  const Icon = workbook.icon

  return (
    <div className="pr-row">
      <div className="pr-lead">
        {/* Decorative: the name is right beside it and says the same thing out loud. */}
        <span className="pr-icon" aria-hidden="true">
          <Icon size={19} />
        </span>
        <div className="pr-text">
          <div className="pr-name">{workbook.name}</div>
          <div className="text-muted pr-draws">
            {bundle ? workbook.describes(bundle) : '\u00a0'}
          </div>
        </div>
      </div>
      <button
        className={first ? 'btn btn-primary' : 'btn btn-secondary'}
        disabled={!ready}
        onClick={() => onStart(bundle ? `1 of ${bundle.words.length}` : 'starting')}
      >
        Start
      </button>
    </div>
  )
}
