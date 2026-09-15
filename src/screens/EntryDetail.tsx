import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, ChevronDown, ChevronUp, Pencil } from 'lucide-react'
import { db } from '../db/db'
import { entryOrdinal, neighbourEntries } from '../journal/writes'
import { RailButton, RailLink, SectionLabel, Shell } from '../ui/Shell'
import { Plate } from '../ui/Plate'
import { Capturable } from '../ui/Capturable'
import { Speak } from '../ui/Speak'
import { Extract } from './Extract'
import { useMedia, useNotebook } from '../ui/hooks'
import { longDate, shortDate } from '../ui/format'
import type { Id } from '../db/types'

/**
 * Reading one day back. UI guide §3.
 *
 * Source kicker over a short gold rule, the title, and the entry's own number set large in the margin.
 * Below the body, the words and sentences this moment produced.
 *
 * The body and any pasted text sit inside `<Capturable>`, so selecting a phrase floats a chip that
 * captures it as a word or a sentence against this entry. Technical plan §11.
 *
 * The rail's own icons are prev / next / edit, which are all moves within the entry, so the notebook's
 * icon sits over a hairline at the head, one step back out. Without it this screen is a dead end and
 * the browser's back button is the only exit.
 */
export const EntryDetail = () => {
  const { nb, id } = useParams<{ nb: Id; id: Id }>()
  const notebook = useNotebook(nb)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  // Extract is a modal over the entry, so it lives in a search param rather than a route. That gives
  // it browser back for free, which is the right way out of a dialog. Technical plan §6.
  const extracting = params.get('extract') === '1'

  const data = useLiveQuery(async () => {
    if (!id) return null
    const entry = await db.entries.get(id)
    if (!entry) return null

    const encounters = await db.encounters.where('entryId').equals(entry.id).toArray()
    const wordIds = encounters.filter((e) => e.targetType === 'word').map((e) => e.targetId)
    const sentenceIds = encounters.filter((e) => e.targetType === 'sentence').map((e) => e.targetId)

    return {
      entry,
      ordinal: await entryOrdinal(entry),
      neighbours: await neighbourEntries(entry),
      attachments: await db.attachments.where('entryId').equals(entry.id).toArray(),
      words: (await db.words.bulkGet(wordIds)).flatMap((w) => (w ? [w] : [])),
      sentences: (await db.sentences.bulkGet(sentenceIds)).flatMap((s) => (s ? [s] : [])),
    }
  }, [id])

  const media = useMedia(
    (data?.attachments ?? []).flatMap((a) => (a.mediaId ? [a.mediaId] : [])),
  )

  // The head of the rail is one step back out, on every screen inside the notebook.
  const back = (
    <RailLink to={`/n/${nb}`} label="Back to the journal">
      <BookOpen size={17} />
    </RailLink>
  )

  if (!nb || !id) return null
  if (data === undefined) return null
  if (data === null) {
    return (
      <Shell context={notebook?.title ?? ''} contextTo={`/n/${nb}`} detail="journal" back={back}>
        <p className="empty">That entry is gone.</p>
      </Shell>
    )
  }

  const { entry, ordinal, neighbours, attachments, words, sentences } = data
  const textAttachments = attachments.filter((a) => a.kind === 'text' && a.text)

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo={`/n/${nb}`}
      detail={shortDate(entry.date)}
      actions={
        <>
          <Link to={`/n/${nb}/e/${id}/reflect`} className="btn btn-ghost">
            Reflect
          </Link>
          <button className="btn btn-ghost" onClick={() => setParams({ extract: '1' })}>
            Extract
          </button>
          <Link to={`/n/${nb}/e/${id}/edit`} className="btn btn-secondary">
            Edit
          </Link>
        </>
      }
      back={back}
      rail={
        <>
          <RailButton
            label="Newer entry"
            disabled={!neighbours.newer}
            onClick={() => neighbours.newer && navigate(`/n/${nb}/e/${neighbours.newer.id}`)}
          >
            <ChevronUp size={17} />
          </RailButton>
          <RailButton
            label="Older entry"
            disabled={!neighbours.older}
            onClick={() => neighbours.older && navigate(`/n/${nb}/e/${neighbours.older.id}`)}
          >
            <ChevronDown size={17} />
          </RailButton>
          <RailLink to={`/n/${nb}/e/${id}/edit`} label="Edit">
            <Pencil size={17} />
          </RailLink>
        </>
      }
    >
      <div className="ed-head">
        <div className="ed-head-text">
          {entry.source ? <div className="ed-source">{entry.source}</div> : null}
          <div className="ed-rule" />
          <h3 className="ed-title">{entry.title ?? longDate(entry.date)}</h3>
        </div>
        <div className="ed-number">
          <div className="ed-numeral">{ordinal}</div>
          <div className="ed-numeral-label">entry</div>
        </div>
      </div>

      {entry.body ? (
        <Capturable notebookId={nb} entryId={id} className="ruled measure">
          {entry.body}
        </Capturable>
      ) : null}

      {textAttachments.map((a) => (
        <Capturable key={a.id} notebookId={nb} entryId={id} className="ruled measure ed-pasted">
          {a.text}
        </Capturable>
      ))}

      {attachments.filter((a) => a.kind !== 'text').length > 0 ? (
        <div className="ed-plates">
          {attachments
            .filter((a) => a.kind !== 'text')
            .map((a) => (
              <Plate
                key={a.id}
                attachment={a}
                media={a.mediaId ? media.get(a.mediaId) : undefined}
                width={112}
                height={80}
              />
            ))}
        </div>
      ) : null}

      {words.length > 0 || sentences.length > 0 ? (
        <>
          <hr className="hr" />
          <div className="ed-footer">
            <div>
              <SectionLabel>Words from this entry</SectionLabel>
              <div className="ed-words">
                {words.map((w) => (
                  <Link key={w.id} to={`/n/${nb}/words/${w.id}`} className="ed-word">
                    <span>{w.term}</span>
                    <span className="text-muted ed-word-meaning">{w.meaning ?? ''}</span>
                  </Link>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel>Sentences</SectionLabel>
              <div className="ed-sentences">
                {sentences.map((s) => (
                  <div key={s.id} className="wd-sentence-row">
                    <div
                      className={s.origin === 'encountered' ? 'sentence' : 'sentence sentence-mine'}
                    >
                      {s.text}
                      {s.translation ? (
                        <div className="sentence-translation">{s.translation}</div>
                      ) : null}
                    </div>
                    <Speak
                      text={s.text}
                      language={notebook?.language ?? ''}
                      size={28}
                      title="Speak this sentence"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}

      {extracting && notebook ? (
        <Extract
          notebook={notebook}
          entry={entry}
          // Clearing the param rather than navigating, so back out of the dialog lands on the entry
          // instead of wherever the entry was opened from.
          onClose={() => setParams({}, { replace: true })}
        />
      ) : null}
    </Shell>
  )
}
