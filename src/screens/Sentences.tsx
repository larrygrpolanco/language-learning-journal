import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { deleteSentence, updateSentence } from '../journal/writes'
import { LibraryBack, SectionLabel, SectionRail, Shell } from '../ui/Shell'
import { QuickAdd } from '../ui/QuickAdd'
import { Speak } from '../ui/Speak'
import { Regenerate } from '../ui/Regenerate'
import { useNotebook } from '../ui/hooks'
import { shortDate } from '../ui/format'
import type { Entry, Id, Sentence, SentenceOrigin, Word } from '../db/types'

/**
 * Index left, detail right, the same frame as the words screen.
 *
 * Sentences were reachable three ways before this screen existed: the footer of the entry they came
 * from, the "in sentences" block on a word that appears in one, and a count on the timeline that was
 * not a link. None of those lets you see the notebook's sentences or find one when you have forgotten
 * which day it was.
 *
 * Newest first, not alphabetical. A sentence has no useful alphabetical order, and concepts §8 makes
 * them evidence rather than a deduplicated set, so the useful axis is when it was said.
 *
 * `?entry=` narrows the list to one entry's sentences, which is what the timeline's count links to.
 * Same search-param-as-filter reasoning as the timeline's `?q=`, so back clears it.
 */
export const Sentences = () => {
  const { nb, id } = useParams<{ nb: Id; id?: Id }>()
  const notebook = useNotebook(nb)
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)

  const scopeEntryId = params.get('entry') ?? undefined

  const rows = useLiveQuery(async () => {
    if (!nb) return []
    const all = await db.sentences.where('notebookId').equals(nb).toArray()
    return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }, [nb])

  // Only fetched when the list is scoped, so the common case is one query rather than two.
  const scope = useLiveQuery(async () => {
    if (!scopeEntryId) return undefined
    const encounters = await db.encounters.where('entryId').equals(scopeEntryId).toArray()
    return {
      entry: await db.entries.get(scopeEntryId),
      ids: new Set(encounters.filter((e) => e.targetType === 'sentence').map((e) => e.targetId)),
    }
  }, [scopeEntryId])

  const needle = filter.normalize('NFC').trim().toLocaleLowerCase()
  const hits = (rows ?? []).filter(
    (s) =>
      needle === '' ||
      s.text.normalize('NFC').toLocaleLowerCase().includes(needle) ||
      (s.translation ?? '').toLocaleLowerCase().includes(needle),
  )
  const visible = scope ? hits.filter((s) => scope.ids.has(s.id)) : hits

  if (!nb) return null

  const label = scope
    ? `${visible.length} from ${scope.entry ? shortDate(scope.entry.date) : 'that entry'}`
    : needle === ''
      ? 'All sentences'
      : `${visible.length} matching`

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo={`/n/${nb}`}
      detail={`sentences${rows ? ` · ${rows.length}` : ''}`}
      actions={
        <>
          <input
            className="input filter"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter sentences"
          />
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Add sentence
          </button>
        </>
      }
      back={<LibraryBack />}
      rail={<SectionRail nb={nb} />}
    >
      {rows === undefined ? null : rows.length === 0 ? (
        <p className="empty">
          No sentences yet. They come from what you hear and what you try to say.
        </p>
      ) : (
        <div className="ix-split">
          <div className="ix-list">
            <div className="section-label sn-scope">
              <span>{label}</span>
              {scope ? (
                <button
                  className="btn btn-ghost sn-scope-clear"
                  onClick={() => setParams({}, { replace: true })}
                >
                  show all
                </button>
              ) : null}
            </div>
            {visible.map((s) => (
              <Link
                key={s.id}
                to={`/n/${nb}/sentences/${s.id}${scopeEntryId ? `?entry=${scopeEntryId}` : ''}`}
                className={s.id === id ? 'ix-row sn-row ix-row-on' : 'ix-row sn-row'}
              >
                <span className="ix-row-text">
                  <span className="sn-text">{s.text}</span>
                  {s.translation ? <span className="ix-row-sub">{s.translation}</span> : null}
                </span>
                <span className={originClass(s.origin)}>{originLabel(s.origin)}</span>
              </Link>
            ))}
          </div>
          <div className="ix-rule" />
          <div className="ix-detail">
            {id ? (
              <SentenceDetail nb={nb} sentenceId={id} language={notebook?.language ?? ''} />
            ) : (
              <p className="text-muted">Pick a sentence.</p>
            )}
          </div>
        </div>
      )}

      {adding ? (
        <QuickAdd notebookId={nb} kind="sentence" onClose={() => setAdding(false)} />
      ) : null}
    </Shell>
  )
}

const ORIGINS: readonly SentenceOrigin[] = ['encountered', 'mine', 'corrected']

/** `encountered` reads as "heard", the same word quick add uses. The other two say themselves. */
const originLabel = (o: SentenceOrigin): string => (o === 'encountered' ? 'heard' : o)

const originClass = (o: SentenceOrigin): string =>
  o === 'corrected' ? 'sn-origin sn-origin-corrected' : 'sn-origin'

const SentenceDetail = ({
  nb,
  sentenceId,
  language,
}: {
  nb: Id
  sentenceId: Id
  language: string
}) => {
  const [editing, setEditing] = useState(false)

  const data = useLiveQuery(async () => {
    const sentence = await db.sentences.get(sentenceId)
    if (!sentence) return null

    const encounters = await db.encounters.where('targetId').equals(sentenceId).toArray()
    const entries = (await db.entries.bulkGet(encounters.map((e) => e.entryId)))
      .flatMap((e) => (e ? [e] : []))
      .sort((a, b) => (a.date < b.date ? 1 : -1))

    const links = await db.wordInSentences.where('sentenceId').equals(sentenceId).toArray()
    const words = (await db.words.bulkGet(links.map((l) => l.wordId))).flatMap((w) => (w ? [w] : []))

    return {
      sentence,
      entries,
      words,
      // Shown because the origin control below can drop this link. A sentence that quietly stopped
      // correcting something would be worse than the line of text it takes to say so.
      corrects: sentence.correctsId ? await db.sentences.get(sentence.correctsId) : undefined,
    }
  }, [sentenceId])

  if (data === undefined) return null
  if (data === null) return <p className="text-muted">That sentence is gone.</p>

  const { sentence, entries, words, corrects } = data

  if (editing) {
    return <SentenceEdit sentence={sentence} language={language} onClose={() => setEditing(false)} />
  }

  return (
    <>
      <div className="sentence-row sn-detail-text">
        <div className={sentence.origin === 'encountered' ? 'sentence' : 'sentence sentence-mine'}>
          {sentence.text}
          {sentence.translation ? (
            <div className="sentence-translation">{sentence.translation}</div>
          ) : null}
        </div>
        <Speak
          text={sentence.text}
          language={language}
          title="Speak this sentence"
          owner={{ type: 'sentence', id: sentence.id }}
        />
      </div>

      {sentence.note ? <p className="sn-note">{sentence.note}</p> : null}

      <SectionLabel>Where it came from</SectionLabel>
      <div className="seg ix-seg">
        {ORIGINS.map((o) => (
          <label key={o} className="seg-opt">
            <input
              type="radio"
              name={`origin-${sentence.id}`}
              checked={sentence.origin === o}
              onChange={() => void updateSentence(sentence.id, { origin: o })}
            />
            {originLabel(o)}
          </label>
        ))}
      </div>

      {corrects ? (
        <>
          <SectionLabel>Corrects</SectionLabel>
          <div className="sentence-list">
            <div className="sentence sentence-mine">{corrects.text}</div>
          </div>
        </>
      ) : null}

      <SectionLabel>Met in</SectionLabel>
      <div className="ix-met">
        {entries.map((e: Entry) => (
          <Link key={e.id} to={`/n/${nb}/e/${e.id}`} className="ix-met-row">
            {shortDate(e.date)} · {e.title ?? 'Untitled'}
          </Link>
        ))}
      </div>

      {words.length > 0 ? (
        <>
          <SectionLabel>Words in it</SectionLabel>
          <div className="sn-words">
            {words.map((w: Word) => (
              <Link key={w.id} to={`/n/${nb}/words/${w.id}`} className="tag tag-outline">
                {w.term}
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <button className="btn btn-secondary btn-block" onClick={() => setEditing(true)}>
        Edit sentence
      </button>
    </>
  )
}

const SentenceEdit = ({
  sentence,
  language,
  onClose,
}: {
  sentence: Sentence
  language: string
  onClose: () => void
}) => {
  const [text, setText] = useState(sentence.text)
  const [translation, setTranslation] = useState(sentence.translation ?? '')
  const [note, setNote] = useState(sentence.note ?? '')
  const navigate = useNavigate()

  const save = async () => {
    await updateSentence(sentence.id, { text, translation, note })
    onClose()
  }

  const remove = async () => {
    await deleteSentence(sentence.id)
    navigate(`/n/${sentence.notebookId}/sentences`)
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
        <label htmlFor="se-text">Sentence</label>
        <textarea
          id="se-text"
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
        />
      </div>
      <div className="field">
        <label htmlFor="se-translation">Translation</label>
        <input
          id="se-translation"
          className="input"
          value={translation}
          onChange={(e) => setTranslation(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="se-note">Note</label>
        <textarea
          id="se-note"
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
        />
      </div>
      <div className="ix-edit-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={text.trim() === ''}>
          Save
        </button>
      </div>
      <Regenerate
        target={{ type: 'sentence', id: sentence.id }}
        text={sentence.text}
        language={language}
        has={sentence.audioMediaId !== undefined}
      />
      <button type="button" className="btn btn-ghost ix-delete" onClick={() => void remove()}>
        Delete this sentence
      </button>
    </form>
  )
}
