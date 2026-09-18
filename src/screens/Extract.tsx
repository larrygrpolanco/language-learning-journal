import { useEffect, useState } from 'react'
import { db } from '../db/db'
import { extractFromEntry, type ExtractMode } from '../ai/extract'
import { failureLine } from '../ai/client'
import {
  mergeDrafts,
  rowsWorthShowing,
  splitProposals,
  type SentenceRow,
  type Split,
  type WordRow,
} from '../journal/proposals'
import { acceptProposal, discardProposal, draftProposal, saveProposal } from '../journal/writes'
import { SectionLabel } from '../ui/Shell'
import { Tick } from '../ui/Tick'
import { Dashes } from '../ui/Dashes'
import { ordinalWord, plural } from '../ui/format'
import type { Entry, Familiarity, Id, Notebook, ProposalDraft } from '../db/types'

/**
 * Extract. UI guide §5, technical plan §10.
 *
 * A dialog over the entry, which stays visible behind it. Everything arrives pre-ticked so accepting
 * is one press, and `Edit each` opens the per-item panel for the cases worth a second of attention.
 *
 * A note on the design reference. The mock draws this as a 302px panel pinned to the top right with
 * the proposed terms underlined and numbered inside the entry body. The guide's prose describes a
 * 600px dialog over a dimmed entry, and the guide separately calls that in-body underlining
 * "decoration in the mock, not a feature". The prose wins on the frame; the mock wins on the row
 * anatomy and the per-item panel, which it specifies concretely and the prose only summarises.
 *
 * Nothing here writes until Add. Not now leaves the draft on the entry, where it can sit forever
 * with no badge and no inbox.
 */
export const Extract = ({
  notebook,
  entry,
  onClose,
}: {
  notebook: Notebook
  entry: Entry
  onClose: () => void
}) => {
  const [split, setSplit] = useState<Split>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(true)

  // Governs both words and sentences alike. Changing it takes effect on the next `Look again`,
  // same as any other setting here: nothing is re-sent until the learner asks for it.
  const [mode, setMode] = useState<ExtractMode>('focused')

  // Ticked by term and by sentence text, both pre-filled. A Set of keys rather than a flag per row,
  // so the per-item panel and the list cannot disagree about what is on.
  const [tickedWords, setTickedWords] = useState<Set<string>>(new Set())
  const [tickedSentences, setTickedSentences] = useState<Set<string>>(new Set())

  // Edits from the per-item panel, keyed by the term as first proposed.
  const [edits, setEdits] = useState<Map<string, WordEdit>>(new Map())
  const [editingAt, setEditingAt] = useState<number>()
  const [done, setDone] = useState<string>()

  useEffect(() => {
    let live = true

    const run = async () => {
      setBusy(true)
      setError(undefined)
      try {
        const held = await draftProposal(entry.id)
        const previous: ProposalDraft | undefined = held
          ? { entryId: held.entryId, words: held.words, sentences: held.sentences }
          : undefined

        // A draft already on the entry is shown as it stands rather than spending a call to
        // regenerate it. Re-extracting is a separate press, and the mode picker only appears once
        // there is something on screen, so the first pass always runs `focused`.
        const draft = previous ?? (await extract(notebook, entry, 'focused'))
        if (!live) return

        if (!previous) await saveProposal(notebook.id, draft)

        const words = await db.words.where('notebookId').equals(notebook.id).toArray()
        const encounters = await db.encounters.where('entryId').equals(entry.id).toArray()
        const resolved = rowsWorthShowing(
          splitProposals(draft, words),
          new Set(encounters.map((e) => e.targetId)),
        )
        if (!live) return

        setSplit(resolved)
        setTickedWords(new Set(resolved.words.map((r) => r.proposed.term)))
        setTickedSentences(new Set(resolved.sentences.map((r) => r.proposed.text)))
      } catch (e) {
        if (live) setError(failureLine(e))
      } finally {
        if (live) setBusy(false)
      }
    }

    void run()
    return () => {
      live = false
    }
  }, [notebook, entry])

  /** Re-extract. Merges into the held draft, so an edited field is never rewritten. */
  const again = async () => {
    setBusy(true)
    setError(undefined)
    try {
      const held = await draftProposal(entry.id)
      const previous: ProposalDraft | undefined = held
        ? { entryId: held.entryId, words: held.words, sentences: held.sentences }
        : undefined

      const merged = mergeDrafts(previous, await extract(notebook, entry, mode))
      await saveProposal(notebook.id, merged)

      const words = await db.words.where('notebookId').equals(notebook.id).toArray()
      const encounters = await db.encounters.where('entryId').equals(entry.id).toArray()
      const resolved = rowsWorthShowing(
        splitProposals(merged, words),
        new Set(encounters.map((e) => e.targetId)),
      )

      setSplit(resolved)
      setTickedWords(new Set(resolved.words.map((r) => r.proposed.term)))
      setTickedSentences(new Set(resolved.sentences.map((r) => r.proposed.text)))
    } catch (e) {
      setError(failureLine(e))
    } finally {
      setBusy(false)
    }
  }

  const chosenWords = (split?.words ?? []).filter((r) => tickedWords.has(r.proposed.term))
  const chosenSentences = (split?.sentences ?? []).filter((r) => tickedSentences.has(r.proposed.text))
  const total = chosenWords.length + chosenSentences.length

  const add = async () => {
    if (!split || total === 0) return
    setBusy(true)
    try {
      // Built in one pass so the familiarity map is keyed by exactly the term that gets written.
      // Keyed off anything else and a hand-set familiarity silently lands on nothing.
      const words: { term: string; meaning?: string; note?: string }[] = []
      const familiarity = new Map<string, Familiarity>()

      for (const row of chosenWords) {
        const edit = edits.get(row.proposed.term)
        const word = applyEdit(row, edit)
        words.push(word)
        if (edit?.familiarity) familiarity.set(word.term, edit.familiarity)
      }

      const result = await acceptProposal({
        notebookId: notebook.id,
        entryId: entry.id,
        words,
        sentences: chosenSentences.map((r) => r.proposed),
        familiarity,
      })

      setDone(summarise(result.wordsAdded, result.wordsNoticedAgain, result.sentencesAdded))
    } catch (e) {
      setError(failureLine(e))
      setBusy(false)
    }
  }

  const notNow = () => onClose()

  const discard = async () => {
    await discardProposal(entry.id)
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div
        className="dialog ex-dialog"
        role="dialog"
        aria-label="Extract from this entry"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="dialog-title">Extract from this entry</h2>
          <p className="ex-count">{countLine(busy, split, total, done)}</p>
        </div>

        {error ? <p className="st-error">{error}</p> : null}

        {done ? (
          <div className="dialog-actions">
            <button className="btn btn-primary" onClick={onClose}>
              Done
            </button>
          </div>
        ) : busy && !split ? null : split ? (
          <>
            <div className="pick-lists">
              {split.words.length > 0 ? (
                <div>
                  <SectionLabel>Words</SectionLabel>
                  <div className="pick-rows">
                    {split.words.map((row, i) => (
                      <WordRowView
                        key={row.proposed.term}
                        row={row}
                        index={i + 1}
                        edit={edits.get(row.proposed.term)}
                        on={tickedWords.has(row.proposed.term)}
                        onToggle={() => setTickedWords(toggled(tickedWords, row.proposed.term))}
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {split.sentences.length > 0 ? (
                <div>
                  <SectionLabel>Sentences</SectionLabel>
                  <div className="pick-rows">
                    {split.sentences.map((row, i) => (
                      <SentenceRowView
                        key={row.proposed.text}
                        row={row}
                        index={split.words.length + i + 1}
                        on={tickedSentences.has(row.proposed.text)}
                        onToggle={() =>
                          setTickedSentences(toggled(tickedSentences, row.proposed.text))
                        }
                      />
                    ))}
                  </div>
                </div>
              ) : null}

              {split.words.length === 0 && split.sentences.length === 0 ? (
                <p className="text-muted pick-empty">
                  Nothing new in this one. Everything it holds is already in the notebook.
                </p>
              ) : null}
            </div>

            <div className="pick-actions">
              <button className="btn btn-ghost" onClick={notNow} disabled={busy}>
                Not now
              </button>
              <span className="pick-spacer" />
              <div className="seg ex-mode" title="How much Look again should pull">
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="ex-mode"
                    checked={mode === 'focused'}
                    onChange={() => setMode('focused')}
                    disabled={busy}
                  />
                  Handful
                </label>
                <label className="seg-opt">
                  <input
                    type="radio"
                    name="ex-mode"
                    checked={mode === 'exhaustive'}
                    onChange={() => setMode('exhaustive')}
                    disabled={busy}
                  />
                  Exhaustive
                </label>
              </div>
              <button className="btn btn-ghost pick-quiet" onClick={() => void again()} disabled={busy}>
                Look again
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy || chosenWords.length === 0}
                onClick={() => setEditingAt(0)}
              >
                Edit each
              </button>
              <button className="btn btn-primary" disabled={busy || total === 0} onClick={() => void add()}>
                {total === 0 ? 'Add' : `Add ${total}`}
              </button>
            </div>

            {split.words.length > 0 || split.sentences.length > 0 ? (
              <button className="btn btn-ghost ex-discard" onClick={() => void discard()}>
                Throw this suggestion away
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      {editingAt !== undefined && split ? (
        <EditPanel
          rows={chosenWords}
          at={editingAt}
          edits={edits}
          onSet={(term, edit) => setEdits(new Map(edits).set(term, edit))}
          onMove={(next) => setEditingAt(next < chosenWords.length ? next : undefined)}
          onClose={() => setEditingAt(undefined)}
        />
      ) : null}
    </div>
  )
}

/* ── the call ─────────────────────────────────────────────────────────────── */

/** Gathers the entry's material and asks. Kept out of the component so the effect reads plainly. */
const extract = async (
  notebook: Notebook,
  entry: Entry,
  mode: ExtractMode,
): Promise<ProposalDraft> => {
  const attachments = await db.attachments.where('entryId').equals(entry.id).toArray()

  const files: { kind: 'image' | 'pdf' | 'audio' | 'text'; blob: Blob; filename?: string }[] = []
  for (const a of attachments) {
    if (a.kind === 'text' || !a.mediaId) continue
    const media = await db.media.get(a.mediaId)
    if (!media) continue
    files.push({ kind: a.kind, blob: media.bytes, ...(a.filename ? { filename: a.filename } : {}) })
  }

  return extractFromEntry({
    entryId: entry.id,
    language: notebook.language,
    meaningLanguage: notebook.meaningLanguage ?? 'English',
    focus: notebook.focus,
    title: entry.title,
    source: entry.source,
    body: entry.body,
    pasted: attachments.flatMap((a) => (a.kind === 'text' && a.text ? [a.text] : [])),
    files,
    mode,
  })
}

/* ── rows ─────────────────────────────────────────────────────────────────── */

const WordRowView = ({
  row,
  index,
  edit,
  on,
  onToggle,
}: {
  row: WordRow
  index: number
  edit: WordEdit | undefined
  on: boolean
  onToggle: () => void
}) => (
  <label className="pick-row">
    <Tick on={on} onToggle={onToggle} />
    <span className="ex-index">{index}</span>
    <span className="ex-term">{edit?.term ?? row.proposed.term}</span>
    <span className="ex-note">
      {row.existing ? (
        // The "11th time" line. Accepting this writes an encounter and nothing else.
        <em className="ex-known">
          already in this notebook · <Times wordId={row.existing.id} />
        </em>
      ) : (
        (edit?.meaning ?? row.proposed.meaning ?? '')
      )}
    </span>
  </label>
)

/**
 * How many entries this word has come up in, counted live.
 *
 * Its own query rather than a count threaded down from the parent, because the number has to be right
 * and it is the only thing on this row that reads the database.
 */
const Times = ({ wordId }: { wordId: Id }) => {
  const [n, setN] = useState<number>()
  useEffect(() => {
    void db.encounters
      .where('targetId')
      .equals(wordId)
      .count()
      .then((c) => setN(c + 1))
  }, [wordId])
  return <>{n === undefined ? '…' : `${ordinalWord(n)} time`}</>
}

const SentenceRowView = ({
  row,
  index,
  on,
  onToggle,
}: {
  row: SentenceRow
  index: number
  on: boolean
  onToggle: () => void
}) => (
  <label className="pick-row">
    <Tick on={on} onToggle={onToggle} />
    <span className="ex-index">{index}</span>
    <span className="ex-term">{row.proposed.text}</span>
    <span className="ex-note">{row.proposed.translation ?? ''}</span>
  </label>
)

/* ── the per-item panel ───────────────────────────────────────────────────── */

interface WordEdit {
  term: string
  meaning?: string
  note?: string
  familiarity?: Familiarity
}

const applyEdit = (row: WordRow, edit: WordEdit | undefined) => {
  if (!edit) return row.proposed
  const out: { term: string; meaning?: string; note?: string } = { term: edit.term.trim() || row.proposed.term }
  const meaning = (edit.meaning ?? row.proposed.meaning ?? '').trim()
  const note = (edit.note ?? row.proposed.note ?? '').trim()
  if (meaning !== '') out.meaning = meaning
  if (note !== '') out.note = note
  return out
}

const FAMILIARITIES: readonly Familiarity[] = ['new', 'getting it', 'got it']

/**
 * One word at a time, per the mock: "Editing 1 of 5", the three fields, and familiarity.
 *
 * Sentences are not editable here. The mock's panel has Term / Meaning / Note, which are a word's
 * fields, and a sentence has nothing worth a form at this moment beyond the tick it already carries.
 */
const EditPanel = ({
  rows,
  at,
  edits,
  onSet,
  onMove,
  onClose,
}: {
  rows: readonly WordRow[]
  at: number
  edits: ReadonlyMap<string, WordEdit>
  onSet: (term: string, edit: WordEdit) => void
  onMove: (next: number) => void
  onClose: () => void
}) => {
  const row = rows[at]
  if (!row) return null

  const key = row.proposed.term
  const held = edits.get(key)
  const value: WordEdit = held ?? {
    term: row.proposed.term,
    ...(row.proposed.meaning !== undefined ? { meaning: row.proposed.meaning } : {}),
    ...(row.proposed.note !== undefined ? { note: row.proposed.note } : {}),
  }

  const set = (patch: Partial<WordEdit>) => onSet(key, { ...value, ...patch })

  return (
    <div className="ex-panel" onClick={(e) => e.stopPropagation()}>
      <div className="ex-panel-head">
        <span className="ex-panel-of">
          Editing {at + 1} of {rows.length}
        </span>
        <span className="ex-progress">
          {rows.map((r, i) => (
            <span key={r.proposed.term} className={i === at ? 'ex-pip ex-pip-on' : 'ex-pip'} />
          ))}
        </span>
      </div>

      <div className="field">
        <label htmlFor="ex-term">Term</label>
        <input
          id="ex-term"
          className="input"
          value={value.term}
          onChange={(e) => set({ term: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="ex-meaning">Meaning</label>
        <input
          id="ex-meaning"
          className="input"
          value={value.meaning ?? ''}
          onChange={(e) => set({ meaning: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="ex-note">Note</label>
        <textarea
          id="ex-note"
          className="input ex-note-field"
          value={value.note ?? ''}
          onChange={(e) => set({ note: e.target.value })}
        />
      </div>

      <SectionLabel>Familiarity</SectionLabel>
      <div className="seg ex-fam">
        {FAMILIARITIES.map((f) => (
          <label key={f} className="seg-opt">
            <input
              type="radio"
              name="ex-fam"
              checked={value.familiarity === f}
              onChange={() => set({ familiarity: f })}
            />
            {f}
          </label>
        ))}
      </div>
      {value.familiarity ? (
        <p className="wd-estimate">
          <Dashes familiarity={value.familiarity} /> set by hand.
        </p>
      ) : (
        <p className="wd-estimate">Left alone, this gets estimated from encounters.</p>
      )}

      <div className="ex-panel-actions">
        <button className="btn btn-ghost" onClick={() => (at + 1 < rows.length ? onMove(at + 1) : onClose())}>
          Skip
        </button>
        <button className="btn btn-primary" onClick={() => onMove(at + 1)}>
          {at + 1 < rows.length ? 'Next' : 'Done'}
        </button>
      </div>
    </div>
  )
}

/* ── lines ────────────────────────────────────────────────────────────────── */

const toggled = (set: ReadonlySet<string>, key: string): Set<string> => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

const countLine = (
  busy: boolean,
  split: Split | undefined,
  ticked: number,
  done: string | undefined,
): string => {
  if (done) return done
  if (!split) return busy ? 'Reading it…' : ''
  const found = split.words.length + split.sentences.length
  if (found === 0) return 'Nothing to add.'
  return `${plural(found, 'thing')} found · ${ticked} ticked`
}

const summarise = (added: number, again: number, sentences: number): string => {
  const parts: string[] = []
  if (added > 0) parts.push(plural(added, 'word'))
  if (again > 0) parts.push(`${again} noticed again`)
  if (sentences > 0) parts.push(plural(sentences, 'sentence'))
  return parts.length === 0 ? 'Nothing added.' : `Added ${parts.join(' · ')}.`
}
