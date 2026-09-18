import { useLiveQuery } from 'dexie-react-hooks'
import { useParams, useSearchParams } from 'react-router-dom'
import { dockedSession } from '../workbooks/sessions'
import { workbookById } from '../workbooks'
import { NotebookTabsPlain } from './icons'
import type { Id } from '../db/types'

/**
 * The dock, at the foot of the rail. Technical plan §7.
 *
 * One glyph in accent gold under a hairline, and nothing else. No name, no label, no progress bar, no
 * timer, no unread count, and nothing that expires: a half-finished exercise looks exactly the same on
 * day 90 as on day 1. A book left face down on the desk.
 *
 * It used to carry the name and the live label too, which broke that promise in the plainest way
 * possible — `3 of 14` in the gutter of every screen in the notebook is a progress meter. The label is
 * still true and still worth reading, so it moved to the practice row, which has room for a sentence.
 *
 * Singular because a notebook holds one session, enforced in `sessions.ts`. Filtered to `docked`, so the
 * mark is never lit beside its own expanded sheet.
 *
 * Pressing it sets `?workbook=<id>`, which is all it takes. The layer over the route picks that up and
 * mounts the sheet, and because it is a search param rather than a route, the journal underneath never
 * unmounts and browser back means minimize.
 */
export const Dock = () => {
  // The notebook is the boundary (concepts §6), so the dock only shows this notebook's session. On the
  // library and Settings there is no `:nb`, and the dock is empty rather than global.
  const { nb } = useParams<{ nb?: Id }>()
  const [, setParams] = useSearchParams()

  const session = useLiveQuery(async () => (nb ? dockedSession(nb) : undefined), [nb])

  if (!session) return null

  const wb = workbookById(session.workbookId)
  const name = wb?.name ?? 'Exercise'
  // A session whose workbook has left the registry still has to be resumable, and a glyph-only mark
  // with no glyph is nothing to press. Falls back to the practice section's own icon, which is at least
  // true: what is waiting is an exercise.
  const Icon = wb?.icon ?? NotebookTabsPlain

  return (
    <div className="rail-dock">
      {/* The rail's own hairline, the same one that marks the way back off from the screen's tools. It
          already turns on its side in the mobile bar, which a new border would not. */}
      <div className="rail-sep" />
      <button
        type="button"
        className="btn btn-icon dock-mark"
        title={`${name} · ${session.label}`}
        aria-label={`Resume ${name}, ${session.label}`}
        onClick={() => setParams({ workbook: session.id })}
      >
        <Icon size={17} />
      </button>
    </div>
  )
}
