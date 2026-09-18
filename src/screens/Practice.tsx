import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { WORKBOOKS, workbookById } from '../workbooks'
import { buildContext } from '../workbooks/context'
import { closeSession, notebookSession, openSession } from '../workbooks/sessions'
import { FocusPicker } from '../ui/FocusPicker'
import { LibraryBack, SectionRail, Shell } from '../ui/Shell'
import { useNotebook } from '../ui/hooks'
import { plural, relativeDay } from '../ui/format'
import type { ContextBundle } from '../workbooks/sdk'
import type { Id, WorkbookScope, WorkbookSession } from '../db/types'

/**
 * The practice page. UI guide §8.
 *
 * A contents page, not a dashboard. One row per workbook: its own glyph, its name, a line stating what
 * it actually draws from this notebook, and a Start button. Nothing here counts streaks, nothing
 * suggests what to do next, and there is no progress anywhere on the screen — except on the one row
 * that has an exercise going, which is the one place a count is a fact rather than a nag.
 *
 * The glyph is the workbook's, from its manifest, not the section's. Each exercise is a separate
 * workbook and the shelf should look like one.
 *
 * The lines are real. Each row builds that workbook's own bundle and asks the manifest to describe it,
 * so "Draws on 14 words" is fourteen words that exist rather than a number from the request. Focus a
 * row and its line retells the focus with no extra markup, because the line already reports the bundle
 * and the bundle is now built with the scope.
 *
 * A notebook holds one session (§7, enforced in `sessions.ts`). This page is where that costs something
 * and so it is where it is said out loud: the owning row reads its label and offers Resume and discard,
 * every other row drops to a secondary button, and starting a different one asks first.
 */
export const Practice = () => {
  const { nb } = useParams<{ nb: Id }>()
  const notebook = useNotebook(nb)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const lastPracticed = useLiveQuery(async () => {
    if (!nb) return undefined
    const rows = await db.practiceEvents.where('notebookId').equals(nb).toArray()
    if (rows.length === 0) return undefined
    return rows.reduce((a, b) => (a.at > b.at ? a : b)).at
  }, [nb])

  // One query for the page rather than one per row. Every row reads the same record, and they all have
  // to agree about which of them owns it.
  const session = useLiveQuery(async () => (nb ? notebookSession(nb) : undefined), [nb])

  /** A Start press waiting on the switch dialog, holding the session it would end. */
  const [pending, setPending] = useState<{
    workbookId: string
    scope?: WorkbookScope
    held: WorkbookSession
  }>()
  const [discarding, setDiscarding] = useState(false)

  const open = async (workbookId: string, scope: WorkbookScope | undefined) => {
    if (!nb) return
    // 'starting' rather than a count, because every workbook sets its own label on mount and only one
    // of them measures progress in words.
    const id = await openSession({ notebookId: nb, workbookId, label: 'starting', scope })
    // A search param rather than a route, so the practice page stays mounted underneath and
    // minimizing puts the learner back here without a reload.
    navigate(`/n/${nb}/practice?workbook=${id}`)
  }

  /**
   * Three paths, and which one runs is decided here.
   *
   * The session is read again rather than taken from the live query, which reads `undefined` while it is
   * still loading as well as when there is genuinely nothing going. Trusting it would mean a press in
   * that window took the first path and deleted a docked exercise without asking, which is the one
   * thing this dialog exists to prevent.
   *
   * Resuming must not go through `openSession`: that clears the notebook first, so it would delete the
   * very row it is meant to return to and throw the state away.
   */
  const start = async (workbookId: string, scope: WorkbookScope | undefined) => {
    if (!nb) return
    const held = await notebookSession(nb)
    if (!held) {
      await open(workbookId, scope)
      return
    }
    if (held.workbookId === workbookId) {
      navigate(`/n/${nb}/practice?workbook=${held.id}`)
      return
    }
    setPending({ workbookId, held, ...(scope !== undefined ? { scope } : {}) })
  }

  const discard = async () => {
    setDiscarding(false)
    if (!session) return
    await closeSession(session.id)
    // Its sheet may be on screen over this page, in which case it is now showing a row that no longer
    // exists. Dropping the param takes it down.
    if (params.get('workbook') === session.id) setParams({}, { replace: true })
  }

  if (!nb) return null

  const nameOf = (workbookId: string, fallback: string) =>
    workbookById(workbookId)?.name ?? fallback

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
            session={session}
            first={i === 0}
            onStart={(scope) => void start(w.id, scope)}
            onDiscard={() => setDiscarding(true)}
          />
        ))}
      </div>

      {pending ? (
        <Confirm
          title="One exercise at a time"
          body={`${nameOf(pending.held.workbookId, 'That exercise')} is on hold at ${pending.held.label}. Starting ${nameOf(pending.workbookId, 'this one')} closes it, and nothing from it is saved.`}
          confirm="Close it and start"
          onConfirm={() => {
            const next = pending
            setPending(undefined)
            void open(next.workbookId, next.scope)
          }}
          onCancel={() => setPending(undefined)}
        />
      ) : null}

      {discarding && session ? (
        <Confirm
          title={`Discard ${nameOf(session.workbookId, 'this exercise').toLowerCase()}?`}
          body={`It is on hold at ${session.label}. Nothing from it is saved, and there is no way back to it.`}
          confirm="Discard it"
          onConfirm={() => void discard()}
          onCancel={() => setDiscarding(false)}
        />
      ) : null}
    </Shell>
  )
}

/**
 * One row. Builds its own bundle so its line is true.
 *
 * Not a shared query: each workbook asks for something different, and a row claiming to draw on words
 * a different workbook requested would be worse than no line at all.
 *
 * The scope is the row's, not the page's. Two rows can be aimed at different entries and neither is
 * remembered, because focus belongs to the exercise you are about to start rather than to the notebook.
 *
 * The row that owns the session is a different row. Its line is the session's label rather than what it
 * draws, because the scope was frozen at open and the draws line could now be describing material the
 * exercise is not using. For the same reason focus becomes discard: a scope written now is a scope
 * `openSession` would ignore, and discard is the affordance that exists nowhere else.
 */
const Row = ({
  notebookId,
  workbook,
  session,
  first,
  onStart,
  onDiscard,
}: {
  notebookId: Id
  workbook: (typeof WORKBOOKS)[number]
  /** The notebook's session, whichever row owns it. */
  session: WorkbookSession | undefined
  first: boolean
  onStart: (scope: WorkbookScope | undefined) => void
  onDiscard: () => void
}) => {
  const [bundle, setBundle] = useState<ContextBundle>()
  const [scope, setScope] = useState<WorkbookScope>()
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let live = true
    setBundle(undefined)
    void buildContext(notebookId, workbook.request, scope).then((b) => {
      if (live) setBundle(b)
    })
    return () => {
      live = false
    }
  }, [notebookId, workbook, scope])

  // Ready when the notebook holds any of what this workbook asked for. Word drill requests only words,
  // so this is still "are there words" for it, while a listening exercise that asks for sentences is
  // not held back by a notebook that has none of one kind.
  const ready =
    bundle !== undefined &&
    (bundle.words.length > 0 || bundle.sentences.length > 0 || bundle.entries.length > 0)
  const Icon = workbook.icon

  const owns = session?.workbookId === workbook.id
  // The one live thing on the page gets the one emphasis. With nothing going, the first row keeps it.
  const primary = session ? owns : first

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
            {owns && session
              ? `in progress · ${session.label}`
              : bundle
                ? workbook.describes(bundle)
                : '\u00a0'}
          </div>
        </div>
      </div>

      {/* A text button rather than a third one with a border, so Start stays the row's only real
          affordance and focusing reads as an adjustment to it. Discard sits in the same place because
          it is the same kind of thing: a press on the row that is not the row's main move. */}
      {owns ? (
        <button className="btn btn-ghost pr-focus" onClick={onDiscard}>
          discard
        </button>
      ) : (
        <button className="btn btn-ghost pr-focus" onClick={() => setPicking(true)}>
          {scope ? focusLine(scope) : 'focus'}
        </button>
      )}
      <button
        className={primary ? 'btn btn-primary' : 'btn btn-secondary'}
        disabled={!owns && !ready}
        onClick={() => onStart(scope)}
      >
        {owns ? 'Resume' : 'Start'}
      </button>

      {picking ? (
        <FocusPicker
          notebookId={notebookId}
          scope={scope}
          onDone={(next) => {
            setScope(next)
            setPicking(false)
          }}
          onCancel={() => setPicking(false)}
        />
      ) : null}
    </div>
  )
}

/**
 * A press that costs something, naming what it costs before it happens.
 *
 * Local to this file because both uses are: one when starting an exercise would end another, one when
 * discarding ends it outright. Built from the dialog classes the notebooks and extract dialogs already
 * use, so it is the same object on screen rather than a new kind of thing.
 */
const Confirm = ({
  title,
  body,
  confirm,
  onConfirm,
  onCancel,
}: {
  title: string
  body: string
  confirm: string
  onConfirm: () => void
  onCancel: () => void
}) => (
  <div className="dialog-backdrop" onClick={onCancel}>
    <div
      className="dialog"
      style={{ width: 'min(420px, 100%)' }}
      role="dialog"
      aria-label={title}
      onClick={(e) => e.stopPropagation()}
    >
      <h2 className="dialog-title">{title}</h2>
      <p className="text-muted">{body}</p>
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Not now
        </button>
        <button type="button" className="btn btn-primary" onClick={onConfirm}>
          {confirm}
        </button>
      </div>
    </div>
  </div>
)

/** What the button reads once a scope is set. Says the entries, since those are what was picked. */
const focusLine = (scope: WorkbookScope): string => plural(scope.entryIds.length, 'entry', 'entries')
