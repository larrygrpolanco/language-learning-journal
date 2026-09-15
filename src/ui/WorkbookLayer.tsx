import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Minus, X } from 'lucide-react'
import { db } from '../db/db'
import { workbookById } from '../workbooks'
import { buildContext } from '../workbooks/context'
import { closeSession, dockSession, expandSession, saveSessionState, setSessionLabel } from '../workbooks/sessions'
import { aiFor, journalWriterFor } from '../workbooks/writer'
import { failureLine } from '../ai/client'
import type { ContextBundle } from '../workbooks/sdk'
import type { WorkbookSession } from '../db/types'

/**
 * The workbook sheet. Technical plan §7, and the interaction the app is judged on.
 *
 * Rendered as a sibling of the routes rather than inside a screen, which is the whole trick. The sheet
 * appears over whatever route is showing without that route unmounting, so minimizing leaves the
 * journal exactly where it was: same scroll position, same open entry, cursor still in the composer if
 * it was there. Nothing is restored, because nothing was ever torn down.
 *
 * `?workbook=<sessionId>` is authoritative. Removing the param docks the session, which means browser
 * back is minimize and following any link out also docks rather than losing the exercise.
 */
const STATE_DEBOUNCE_MS = 400

/** Everything loaded for one session, set in one go so no render sees a half-ready sheet. */
interface Loaded {
  session: WorkbookSession
  bundle: ContextBundle
  /** The notebook's language, read directly rather than off the bundle. */
  language: string
  /** The state as it was when this session mounted. Stable for the session's life. */
  initialState: unknown
}

export const WorkbookLayer = () => {
  const [params, setParams] = useSearchParams()
  const sessionId = params.get('workbook') ?? undefined

  const [loaded, setLoaded] = useState<Loaded>()
  const [label, setLabelText] = useState('')
  const [error, setError] = useState<string>()

  // The state the workbook last handed over. Held in a ref so docking writes what the workbook
  // currently has rather than whatever last survived the debounce.
  const stateRef = useRef<unknown>(undefined)
  const timerRef = useRef<number | undefined>(undefined)
  // Set when the learner closes the session, so the unmount cleanup does not then dock a deleted row.
  const closedRef = useRef(false)

  useEffect(() => {
    let live = true
    closedRef.current = false

    if (!sessionId) {
      setLoaded(undefined)
      setError(undefined)
      return
    }

    const load = async () => {
      setError(undefined)
      try {
        const session = await db.sessions.get(sessionId)
        if (!live) return
        if (!session) {
          // The session is gone. Drop the param rather than showing an empty sheet.
          setParams({}, { replace: true })
          return
        }

        stateRef.current = session.state
        setLabelText(session.label)

        // The param is what puts the sheet on screen, so this is where the record is brought into
        // line with it. Doing it here rather than in the dock covers every way in: pressing a chip,
        // following a link, and reloading with the param still in the URL. It also docks any other
        // open session, which is the §7 rule that at most one is expanded.
        //
        // Without this the chip stayed in the rail while its own session was on screen, and the
        // status in the record disagreed with what the learner could see.
        await expandSession(sessionId)

        const manifest = workbookById(session.workbookId)
        if (!manifest) {
          setError(
            `This session was made by "${session.workbookId}", which this build does not have.`,
          )
          return
        }

        // The language comes off the notebook, not the bundle. A workbook that never asked for
        // `notebookProfile` would otherwise get an AI surface that speaks in no language at all.
        const notebook = await db.notebooks.get(session.notebookId)
        const bundle = await buildContext(session.notebookId, manifest.request)
        if (!live) return

        setLoaded({
          session,
          bundle,
          language: notebook?.language ?? '',
          initialState: session.state,
        })
      } catch (e) {
        if (live) setError(failureLine(e))
      }
    }

    void load()
    return () => {
      live = false
    }
  }, [sessionId, setParams])

  // Docking on unmount is what makes browser back, and any navigation, mean minimize. Bound to the id
  // captured at mount, so switching quickly between two sessions cannot dock the wrong one.
  useEffect(() => {
    if (!sessionId) return
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      if (closedRef.current) return
      void dockSession(sessionId, stateRef.current)
    }
  }, [sessionId])

  const minimize = useCallback(() => {
    setParams({}, { replace: true })
  }, [setParams])

  const close = useCallback(async () => {
    if (!sessionId) return
    // Closing saves nothing (§7), so a pending state write is dropped rather than flushed.
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    closedRef.current = true
    stateRef.current = undefined
    await closeSession(sessionId)
    setParams({}, { replace: true })
  }, [sessionId, setParams])

  const setState = useCallback(
    (next: unknown) => {
      stateRef.current = next
      if (!sessionId) return
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = undefined
        void saveSessionState(sessionId, next)
      }, STATE_DEBOUNCE_MS)
    },
    [sessionId],
  )

  const setLabel = useCallback(
    (next: string) => {
      if (!sessionId) return
      setLabelText(next)
      void setSessionLabel(sessionId, next)
    },
    [sessionId],
  )

  const journal = useMemo(
    () =>
      loaded ? journalWriterFor(loaded.session.notebookId, loaded.session.workbookId) : undefined,
    [loaded],
  )
  const ai = useMemo(() => aiFor(loaded?.language ?? ''), [loaded?.language])

  // Escape minimizes. The IME guard matters as much here as anywhere: Escape during Hangul composition
  // cancels the syllable, and it must not also drop the sheet.
  useEffect(() => {
    if (!sessionId) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') minimize()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sessionId, minimize])

  if (!sessionId) return null

  const workbook = loaded ? workbookById(loaded.session.workbookId) : undefined

  return (
    <div className="wb-sheet" role="dialog" aria-label={workbook?.name ?? 'Exercise'}>
      <div className="wb-head">
        <span className="wb-name">{workbook?.name ?? 'Exercise'}</span>
        <span className="wb-label">{label}</span>
        <button
          className="btn btn-icon wb-icon"
          title="Minimize"
          aria-label="Minimize"
          onClick={minimize}
        >
          <Minus size={17} />
        </button>
        <button
          className="btn btn-icon wb-icon"
          title="Close this exercise"
          aria-label="Close this exercise"
          onClick={() => void close()}
        >
          <X size={17} />
        </button>
      </div>

      <div className="wb-body">
        {error ? (
          <p className="st-error">{error}</p>
        ) : loaded && workbook && journal ? (
          <workbook.Component
            bundle={loaded.bundle}
            state={loaded.initialState as never}
            setState={setState as (next: never) => void}
            setLabel={setLabel}
            ai={ai}
            journal={journal}
            minimize={minimize}
            close={() => void close()}
          />
        ) : (
          <p className="rf-waiting">Getting it ready…</p>
        )}
      </div>
    </div>
  )
}
