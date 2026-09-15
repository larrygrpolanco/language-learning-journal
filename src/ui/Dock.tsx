import { useLiveQuery } from 'dexie-react-hooks'
import { useParams, useSearchParams } from 'react-router-dom'
import { db } from '../db/db'
import { workbookById } from '../workbooks'
import type { Id } from '../db/types'

/**
 * The dock, at the foot of the rail. Technical plan §7.
 *
 * One chip per docked session, reading the workbook's glyph, its name and whatever label it set. No
 * progress bar, no timer, no unread count, and nothing that expires: a half-finished exercise looks
 * exactly the same on day 90 as on day 1. A book left face down on the desk.
 *
 * The glyph is what survives the mobile layout, where the chip is 44px and the label is hidden.
 *
 * Pressing a chip sets `?workbook=<id>`, which is all it takes. The layer over the route picks that up
 * and mounts the sheet, and because it is a search param rather than a route, the journal underneath
 * never unmounts and browser back means minimize.
 */
export const Dock = () => {
  // The notebook is the boundary (concepts §6), so the dock only shows this notebook's sessions. On
  // the library and Settings there is no `:nb`, and the dock is empty rather than global.
  const { nb } = useParams<{ nb?: Id }>()
  const [, setParams] = useSearchParams()

  const sessions = useLiveQuery(async () => {
    if (!nb) return []
    const rows = await db.sessions.where('notebookId').equals(nb).toArray()
    return rows
      .filter((s) => s.status === 'docked')
      .sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
  }, [nb])

  if (!sessions || sessions.length === 0) return null

  return (
    <div className="rail-dock">
      {sessions.map((s) => {
        const wb = workbookById(s.workbookId)
        const name = wb?.name ?? 'Exercise'
        // A session whose workbook has left the registry still has to be resumable, so the glyph is
        // optional here even though the manifest requires one.
        const Icon = wb?.icon
        return (
          <button
            key={s.id}
            type="button"
            className="dock-chip"
            title={`${name} · ${s.label}`}
            aria-label={`Resume ${name}, ${s.label}`}
            onClick={() => setParams({ workbook: s.id })}
          >
            {Icon ? (
              <span className="dock-chip-icon" aria-hidden="true">
                <Icon size={15} />
              </span>
            ) : null}
            <span className="dock-chip-name">{name}</span>
            <span className="dock-chip-label">{s.label}</span>
          </button>
        )
      })}
    </div>
  )
}
