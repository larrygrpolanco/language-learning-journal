import { db, newId, nowIso, type JournalDb } from '../db/db'
import type { Id, WorkbookSession } from '../db/types'

/**
 * Workbook sessions. Technical plan §7.
 *
 * A session is app state rather than journal data, which is why it lives here and not in
 * `journal/writes.ts`. The rule that matters still holds: no component touches Dexie directly.
 *
 * The mechanic in one line: `state` is opaque JSON the workbook hands over and gets back. There is no
 * suspend path and no serialisation protocol. Because it lands in IndexedDB rather than memory, a
 * session survives a reload, a browser restart and closing the laptop, on the same code path.
 */

/** Sessions in this notebook that are waiting in the dock, oldest first so chips do not reshuffle. */
export const dockedSessions = async (
  notebookId: Id,
  d: JournalDb = db,
): Promise<WorkbookSession[]> => {
  const rows = await d.sessions.where('notebookId').equals(notebookId).toArray()
  return rows.filter((s) => s.status === 'docked').sort((a, b) => (a.openedAt < b.openedAt ? -1 : 1))
}

export const getSession = async (
  sessionId: Id,
  d: JournalDb = db,
): Promise<WorkbookSession | undefined> => d.sessions.get(sessionId)

/**
 * Starts a session, docking any that was expanded.
 *
 * §7: opening a second workbook while one is expanded docks the first, with no prompt. Doing that here
 * rather than in the UI means it holds however the session was started, including from a link.
 */
export const openSession = async (
  notebookId: Id,
  workbookId: string,
  label: string,
  d: JournalDb = db,
): Promise<Id> =>
  d.transaction('rw', [d.sessions], async () => {
    await dockOthers(notebookId, undefined, d)

    const at = nowIso()
    const session: WorkbookSession = {
      id: newId(),
      notebookId,
      workbookId,
      label,
      state: undefined,
      status: 'open',
      openedAt: at,
      touchedAt: at,
    }
    await d.sessions.add(session)
    return session.id
  })

/** Brings a docked session back, docking whatever was expanded. */
export const expandSession = async (sessionId: Id, d: JournalDb = db): Promise<void> => {
  await d.transaction('rw', [d.sessions], async () => {
    const session = await d.sessions.get(sessionId)
    if (!session) return
    await dockOthers(session.notebookId, sessionId, d)
    await d.sessions.update(sessionId, { status: 'open', touchedAt: nowIso() })
  })
}

/**
 * Writes the workbook's state and drops it to the dock.
 *
 * The state write and the status change are one update, so a session can never end up docked with a
 * stale state or open with a state it has already handed over.
 */
export const dockSession = async (
  sessionId: Id,
  state?: unknown,
  d: JournalDb = db,
): Promise<void> => {
  const patch: Partial<WorkbookSession> = { status: 'docked', touchedAt: nowIso() }
  if (state !== undefined) patch.state = state
  await d.sessions.update(sessionId, patch)
}

/** Just the state, without changing status. What the debounced `setState` calls. */
export const saveSessionState = async (
  sessionId: Id,
  state: unknown,
  d: JournalDb = db,
): Promise<void> => {
  await d.sessions.update(sessionId, { state, touchedAt: nowIso() })
}

export const setSessionLabel = async (
  sessionId: Id,
  label: string,
  d: JournalDb = db,
): Promise<void> => {
  await d.sessions.update(sessionId, { label })
}

/**
 * Ends a session for good.
 *
 * §7: closing asks nothing and saves nothing to the journal. Whatever the learner wanted kept, they
 * already saved. So this is a delete, not a status.
 */
export const closeSession = async (sessionId: Id, d: JournalDb = db): Promise<void> => {
  await d.sessions.delete(sessionId)
}

/**
 * Docks every open session in the notebook except one.
 *
 * At most one session is expanded (§7). This is what enforces it, and it runs inside its caller's
 * transaction so two presses in the same tick cannot leave two open.
 */
const dockOthers = async (notebookId: Id, keep: Id | undefined, d: JournalDb): Promise<void> => {
  const open = (await d.sessions.where('notebookId').equals(notebookId).toArray()).filter(
    (s) => s.status === 'open' && s.id !== keep,
  )
  for (const s of open) await d.sessions.update(s.id, { status: 'docked', touchedAt: nowIso() })
}
