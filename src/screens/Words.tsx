import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { normalizeTerm } from '../db/normalize'
import { signalsFor, type WordSignals } from '../journal/derive'
import { deleteWord, setFamiliarity, updateWord } from '../journal/writes'
import { LibraryBack, SectionLabel, SectionRail, Shell } from '../ui/Shell'
import { Dashes } from '../ui/Dashes'
import { QuickAdd } from '../ui/QuickAdd'
import { Speak } from '../ui/Speak'
import { Regenerate } from '../ui/Regenerate'
import { useNotebook } from '../ui/hooks'
import { plural, shortDate } from '../ui/format'
import type { Entry, Familiarity, Id, Sentence, Word } from '../db/types'

interface Row {
  word: Word
  signals: WordSignals
}

/**
 * Index left, detail right. UI guide §7.
 *
 * Familiarity reads as three dashes whether the learner set it or it was estimated, and the estimate
 * is computed here on read rather than stored, so it is never stale and there is nothing to migrate.
 */
export const Words = () => {
  const { nb, id } = useParams<{ nb: Id; id?: Id }>()
  const notebook = useNotebook(nb)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)

  const rows = useLiveQuery(async () => {
    if (!nb) return []
    const words = await db.words.where('notebookId').equals(nb).sortBy('term')
    return Promise.all(
      words.map(async (word): Promise<Row> => {
        const encounters = await db.encounters.where('targetId').equals(word.id).toArray()
        const dated = await Promise.all(
          encounters.map(async (e) => ({
            entryDate: (await db.entries.get(e.entryId))?.date ?? e.createdAt,
          })),
        )
        const practice = await db.practiceEvents.where('targetId').equals(word.id).toArray()
        return { word, signals: signalsFor(word, dated, practice) }
      }),
    )
  }, [nb])

  const needle = normalizeTerm(filter)
  const visible = (rows ?? []).filter(
    (r) =>
      needle === '' ||
      r.word.termKey.includes(needle) ||
      (r.word.meaning ?? '').toLocaleLowerCase().includes(needle),
  )

  if (!nb) return null

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo={`/n/${nb}`}
      detail={`words${rows ? ` · ${rows.length}` : ''}`}
      actions={
        <>
          <input
            className="input filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter words"
          />
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add word
          </button>
        </>
      }
      back={<LibraryBack />}
      rail={<SectionRail nb={nb} />}
    >
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="empty">No words yet. They build up on their own as you write.</p>
      ) : (
        <div className="ix-split">
          <div className="ix-list">
            <SectionLabel>{needle === '' ? 'All words' : `${visible.length} matching`}</SectionLabel>
            {visible.map(({ word, signals }) => (
              <Link
                key={word.id}
                to={`/n/${nb}/words/${word.id}`}
                className={word.id === id ? 'ix-row ix-row-on' : 'ix-row'}
              >
                <span className="ix-row-text">
                  <span className="wd-term">{word.term}</span>
                  {word.meaning ? <span className="ix-row-sub">{word.meaning}</span> : null}
                </span>
                <span className="ix-row-meta">
                  <Dashes familiarity={signals.familiarity} />
                  <span className="ix-count">{signals.timesEncountered}×</span>
                </span>
              </Link>
            ))}
          </div>
          <div className="ix-rule" />
          <div className="ix-detail">
            {id ? (
              <WordDetail nb={nb} wordId={id} language={notebook?.language ?? ''} />
            ) : (
              <p className="text-muted">Pick a word.</p>
            )}
          </div>
        </div>
      )}

      {adding ? <QuickAdd notebookId={nb} kind="word" onClose={() => setAdding(false)} /> : null}
    </Shell>
  )
}

const FAMILIARITIES: readonly Familiarity[] = ['new', 'getting it', 'got it']

const WordDetail = ({ nb, wordId, language }: { nb: Id; wordId: Id; language: string }) => {
  const [editing, setEditing] = useState(false)

  const data = useLiveQuery(async () => {
    const word = await db.words.get(wordId)
    if (!word) return null

    const encounters = await db.encounters.where('targetId').equals(wordId).toArray()
    const entries = (await db.entries.bulkGet(encounters.map((e) => e.entryId)))
      .flatMap((e) => (e ? [e] : []))
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    const links = await db.wordInSentences.where('wordId').equals(wordId).toArray()
    const sentences = (await db.sentences.bulkGet(links.map((l) => l.sentenceId))).flatMap((s) =>
      s ? [s] : [],
    )

    const practice = await db.practiceEvents.where('targetId').equals(wordId).toArray()
    const signals = signalsFor(
      word,
      entries.map((e) => ({ entryDate: e.date })),
      practice,
    )

    return { word, entries, sentences, signals }
  }, [wordId])

  if (data === undefined) return null
  if (data === null) return <p className="text-muted">That word is gone.</p>

  const { word, entries, sentences, signals } = data

  if (editing) {
    return <WordEdit word={word} language={language} onClose={() => setEditing(false)} />
  }

  return (
    <>
      <div className="ix-detail-head">
        <div className="ix-detail-term">{word.term}</div>
        <Speak
          text={word.term}
          language={language}
          title={`Speak ${word.term}`}
          owner={{ type: 'word', id: word.id }}
        />
      </div>
      {word.meaning || word.note ? (
        <div className="text-muted ix-detail-sub">
          {[word.meaning, word.note].filter(Boolean).join(' · ')}
        </div>
      ) : null}

      <SectionLabel>Familiarity</SectionLabel>
      <div className="seg ix-seg">
        {FAMILIARITIES.map((f) => (
          <label key={f} className="seg-opt">
            <input
              type="radio"
              name={`fam-${word.id}`}
              checked={signals.familiarity === f}
              onChange={() => void setFamiliarity(word.id, f)}
            />
            {f}
          </label>
        ))}
      </div>
      {signals.familiarityIsEstimate ? (
        <p className="wd-estimate">
          Estimated from {plural(signals.timesEncountered, 'encounter')}.
        </p>
      ) : (
        <button className="btn btn-ghost wd-unset" onClick={() => void setFamiliarity(word.id, undefined)}>
          Let it be estimated again
        </button>
      )}

      <SectionLabel>Met in</SectionLabel>
      <div className="ix-met">
        {entries.map((e: Entry) => (
          <Link key={e.id} to={`/n/${nb}/e/${e.id}`} className="ix-met-row">
            {shortDate(e.date)} · {e.title ?? 'Untitled'}
          </Link>
        ))}
      </div>

      {sentences.length > 0 ? (
        <>
          <SectionLabel>In sentences</SectionLabel>
          <div className="sentence-list">
            {sentences.map((s: Sentence) => (
              <div key={s.id} className="sentence-row">
                <Link to={`/n/${nb}/sentences/${s.id}`} className="sentence">
                  {s.text}
                  {s.translation ? <div className="sentence-translation">{s.translation}</div> : null}
                </Link>
                <Speak
                  text={s.text}
                  language={language}
                  size={28}
                  title="Speak this sentence"
                  owner={{ type: 'sentence', id: s.id }}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      <button className="btn btn-secondary btn-block" onClick={() => setEditing(true)}>
        Edit word
      </button>
    </>
  )
}

const WordEdit = ({
  word,
  language,
  onClose,
}: {
  word: Word
  language: string
  onClose: () => void
}) => {
  const [term, setTerm] = useState(word.term)
  const [meaning, setMeaning] = useState(word.meaning ?? '')
  const [note, setNote] = useState(word.note ?? '')
  const navigate = useNavigate()

  const save = async () => {
    await updateWord(word.id, { term, meaning, note })
    onClose()
  }

  const remove = async () => {
    await deleteWord(word.id)
    navigate(`/n/${word.notebookId}/words`)
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <SectionLabel>Editing</SectionLabel>
      <div className="field">
        <label htmlFor="we-term">Term</label>
        <input id="we-term" className="input" value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="we-meaning">Meaning</label>
        <input
          id="we-meaning"
          className="input"
          value={meaning}
          onChange={(e) => setMeaning(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="we-note">Note</label>
        <textarea
          id="we-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      </div>
      <div className="ix-edit-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={term.trim() === ''}>
          Save
        </button>
      </div>
      <Regenerate
        target={{ type: 'word', id: word.id }}
        text={word.term}
        language={language}
        has={word.audioMediaId !== undefined}
      />
      <button type="button" className="btn btn-ghost ix-delete" onClick={() => void remove()}>
        Delete this word
      </button>
    </form>
  )
}
