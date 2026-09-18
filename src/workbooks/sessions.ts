import { db, newId, nowIso, type JournalDb } from '../db/db'
import type { Id, WorkbookScope, WorkbookSession } from '../db/types'

/**
 * Workbook sessions. Technical plan §7.
 *
 * A session is app state rather than journal data, which is why it lives here and not in
 * `journal/writes.ts`. The rule that matters still holds: no component touches Dexie directly.
 *
 * The mechanic in one line: `state` is opaque JSON the workbook hands over and gets back. There is no
 * suspend path and no serialisation protocol. Because it lands in IndexedDB rather than memory, a
 * session survives a reload, a browser restart and closing the laptop, on the same code path.
 *
 * A notebook holds at most one session. Not one expanded and any number docked: one. That is what makes
 * the rail mark a single lit glyph rather than a shelf, and it is enforced here rather than in the UI so
 * it holds however a session was started, including from a link.
 */

/**
 * This notebook's session, whatever its status. What the practice page reads to know one is going.
 *
 * Singular because of the invariant above. Newest by `touchedAt` if a notebook somehow holds more than
 * one, which only rows written before the invariant existed can be: the next `openSession` in that
 * notebook clears them, so the app heals rather than needing a migration.
 */
export const notebookSession = async (
  notebookId: Id,
  d: JournalDb = db,
): Promise<WorkbookSession | undefined> => {
  const rows = await d.sessions.where('notebookId').equals(notebookId).toArray()
  return rows.sort((a, b) => (a.touchedAt > b.touchedAt ? -1 : 1))[0]
}

/** The same session, given it is waiting in the dock. What lights the rail mark. */
export const dockedSession = async (
  notebookId: Id,
  d: JournalDb = db,
): Promise<WorkbookSession | undefined> => {
  const s = await notebookSession(notebookId, d)
  return s?.status === 'docked' ? s : undefined
}

export const getSession = async (
  sessionId: Id,
  d: JournalDb = db,
): Promise<WorkbookSession | undefined> => d.sessions.get(sessionId)

export interface OpenSessionInput {
  notebookId: Id
  workbookId: string
  label: string
  /** What the learner focused on the practice row. Absent means the whole notebook. */
  scope?: WorkbookScope | undefined
}

/**
 * Starts a session, ending whatever this notebook was holding.
 *
 * One session per notebook, and this is what guarantees it: the clear and the add are one transaction,
 * so two presses in the same tick cannot leave two rows behind. The *decision* to end the previous one
 * belongs to the UI, which is where the dialog is. This only guarantees the shape.
 *
 * The scope is stored once, at open, and never revised. It carries resolved word and sentence ids, so
 * an exercise cannot silently gain material because one of its entries was edited while it sat docked.
 */
export const openSession = async (input: OpenSessionInput, d: JournalDb = db): Promise<Id> =>
  d.transaction('rw', [d.sessions], async () => {
    await clearAll(input.notebookId, d)

    const at = nowIso()
    const session: WorkbookSession = {
      id: newId(),
      notebookId: input.notebookId,
      workbookId: input.workbookId,
      label: input.label,
      state: undefined,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      status: 'open',
      openedAt: at,
      touchedAt: at,
    }
    await d.sessions.add(session)
    return session.id
  })

/**
 * Brings the docked session back.
 *
 * A status flip and nothing more. There is never another session in the notebook to dock first, which
 * is the point of the invariant above.
 */
export const expandSession = async (sessionId: Id, d: JournalDb = db): Promise<void> => {
  await d.sessions.update(sessionId, { status: 'open', touchedAt: nowIso() })
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
 * Ends every session in the notebook.
 *
 * Runs inside its caller's transaction, which is what makes the one-per-notebook invariant hold when
 * two presses land in the same tick. A delete rather than a status change, for the same reason closing
 * is: §7 says an ended session saves nothing, so there is nothing to keep a row for.
 */
const clearAll = async (notebookId: Id, d: JournalDb): Promise<void> => {
  const rows = await d.sessions.where('notebookId').equals(notebookId).toArray()
  for (const s of rows) await d.sessions.delete(s.id)
}
