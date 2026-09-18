import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { focusCandidates, type FocusCandidates } from '../workbooks/context'
import { SectionLabel } from './Shell'
import { Tick } from './Tick'
import { shortDate } from './format'
import type { Id, WorkbookScope } from '../db/types'

/**
 * What an exercise should be built around. UI guide §8.
 *
 * Focus is a marking rather than a filter, and the copy says so, because the obvious reading of a
 * dialog full of ticks is that unticking bans something. It does not: the notebook still comes in
 * behind whatever is chosen. That is what makes this worth opening for one entry rather than a
 * commitment to a whole revision plan.
 *
 * Entries lead because they are what the learner remembers. Their words and sentences appear
 * underneath as they tick, already on, so the common case is two taps and Use these — and the
 * individual ticks are there for the one word in the entry that is not the point.
 */
export const FocusPicker = ({
  notebookId,
  scope,
  onDone,
  onCancel,
}: {
  notebookId: Id
  /** What the row is already holding, so reopening adjusts rather than restarts. */
  scope: WorkbookScope | undefined
  /** `undefined` means the whole notebook. */
  onDone: (next: WorkbookScope | undefined) => void
  onCancel: () => void
}) => {
  const entries = useLiveQuery(
    async () => (await db.entries.where('notebookId').equals(notebookId).sortBy('date')).reverse(),
    [notebookId],
  )

  const [entryIds, setEntryIds] = useState<ReadonlySet<Id>>(() => new Set(scope?.entryIds ?? []))
  const [candidates, setCandidates] = useState<FocusCandidates>({ words: [], sentences: [] })
  const [picked, setPicked] = useState<ReadonlySet<Id>>(
    () => new Set([...(scope?.wordIds ?? []), ...(scope?.sentenceIds ?? [])]),
  )

  // Ids the learner has already had the chance to untick. A candidate that is not in here is new on
  // screen, so it arrives ticked; one that is stays however they left it. Held in a ref because it
  // decides what the next load does rather than what this render shows.
  const seen = useRef<Set<Id>>(new Set())
  // Reopening starts from a scope that already reflects earlier unticks, so the first load counts as
  // seen wholesale. Without this, a word unticked last time would come back with its entry.
  const primed = useRef(scope === undefined)

  useEffect(() => {
    let live = true
    void focusCandidates(notebookId, [...entryIds]).then((next) => {
      if (!live) return
      setCandidates(next)

      const ids = [...next.words.map((w) => w.id), ...next.sentences.map((s) => s.id)]
      if (!primed.current) {
        for (const id of ids) seen.current.add(id)
        primed.current = true
        return
      }

      const fresh = ids.filter((id) => !seen.current.has(id))
      if (fresh.length === 0) return
      for (const id of fresh) seen.current.add(id)
      setPicked((prev) => new Set([...prev, ...fresh]))
    })
    return () => {
      live = false
    }
  }, [notebookId, entryIds])

  // Escape backs out without changing what the row holds. The two footer buttons both commit
  // something, and "Whole notebook" throwing away a scope by accident is the one expensive misclick
  // here. The composition guard is the same one every key handler in this app carries (§5).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const toggleEntry = (id: Id) => setEntryIds(toggled(entryIds, id))
  const toggleItem = (id: Id) => setPicked(toggled(picked, id))

  /**
   * Resolved ids, not entry ids alone.
   *
   * The session stores what this returns and never revises it, so editing one of these entries later
   * cannot quietly change what a docked exercise is working from.
   */
  const use = () =>
    onDone({
      entryIds: [...entryIds],
      wordIds: candidates.words.filter((w) => picked.has(w.id)).map((w) => w.id),
      sentenceIds: candidates.sentences.filter((s) => picked.has(s.id)).map((s) => s.id),
    })

  const chosen = useMemo(
    () =>
      candidates.words.filter((w) => picked.has(w.id)).length +
      candidates.sentences.filter((s) => picked.has(s.id)).length,
    [candidates, picked],
  )

  return (
    <div className="dialog-backdrop">
      <div className="dialog fp-dialog" role="dialog" aria-label="Choose what to focus on">
        <h2 className="dialog-title">Focus on</h2>
        <p className="text-muted fp-hint">
          Pick what this should build around. The rest of the notebook still comes in behind it.
        </p>

        <div className="pick-lists">
          <div className="fp-group">
            <SectionLabel>Entries</SectionLabel>
            {entries === undefined ? null : entries.length === 0 ? (
              <p className="text-muted pick-empty">Nothing written in this notebook yet.</p>
            ) : (
              <div className="pick-rows">
                {entries.map((e) => (
                  <label key={e.id} className="pick-row">
                    <Tick on={entryIds.has(e.id)} onToggle={() => toggleEntry(e.id)} />
                    <span className="fp-date">{shortDate(e.date)}</span>
                    <span className="fp-line">{entryLine(e.title, e.body)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {candidates.words.length > 0 ? (
            <div className="fp-group">
              <SectionLabel>Words in them</SectionLabel>
              <div className="pick-rows">
                {candidates.words.map((w) => (
                  <label key={w.id} className="pick-row">
                    <Tick on={picked.has(w.id)} onToggle={() => toggleItem(w.id)} />
                    <span className="fp-term">{w.term}</span>
                    <span className="fp-meaning">{w.meaning ?? ''}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {candidates.sentences.length > 0 ? (
            <div className="fp-group">
              <SectionLabel>Sentences in them</SectionLabel>
              <div className="pick-rows">
                {candidates.sentences.map((s) => (
                  <label key={s.id} className="pick-row">
                    <Tick on={picked.has(s.id)} onToggle={() => toggleItem(s.id)} />
                    <span className="fp-term">{s.text}</span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="pick-actions">
          <span className="pick-spacer" />
          <button className="btn btn-ghost pick-quiet" onClick={() => onDone(undefined)}>
            Whole notebook
          </button>
          <button className="btn btn-primary" disabled={entryIds.size === 0} onClick={use}>
            {chosen === 0 ? 'Use these' : `Use these ${chosen}`}
          </button>
        </div>
      </div>
    </div>
  )
}

/** The entry's title, or its opening line if it has none. Enough to recognise it by. */
const entryLine = (title: string | undefined, body: string): string => {
  if (title !== undefined && title.trim() !== '') return title
  const first = body.split('\n').find((l) => l.trim() !== '')
  return first?.trim() ?? 'Untitled'
}

const toggled = <T,>(set: ReadonlySet<T>, value: T): Set<T> => {
  const next = new Set(set)
  if (!next.delete(value)) next.add(value)
  return next
}
