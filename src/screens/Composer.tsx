import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { BookOpen, FileText, Paperclip, Quote, Type } from 'lucide-react'
import { db } from '../db/db'
import {
  addAttachment,
  deleteAttachment,
  pruneEntryIfEmpty,
  saveEntry,
} from '../journal/writes'
import { RailButton, Shell } from '../ui/Shell'
import { Plate } from '../ui/Plate'
import { Viewer } from '../ui/Viewer'
import { QuickAdd } from '../ui/QuickAdd'
import { imageSize, kindOf, useMedia, useNotebook } from '../ui/hooks'
import type { Attachment, Id } from '../db/types'

const AUTOSAVE_MS = 400

/**
 * Capture. UI guide §4.
 *
 * The whole sheet is for writing. There is no save button anywhere and no dirty state to track: a
 * 400ms debounce writes the entry record, and the action bar says so. Technical plan §5.
 *
 * Every way out of here runs `leave`, including the one in the rail, because closing the composer is
 * not a plain navigation: it flushes whatever the debounce is still holding and deletes an entry that
 * never became a record. A rail link straight to the journal would skip both.
 */
export const Composer = () => {
  const { nb, id } = useParams<{ nb: Id; id: Id }>()
  const notebook = useNotebook(nb)
  const navigate = useNavigate()

  const entry = useLiveQuery(() => (id ? db.entries.get(id) : undefined), [id])
  const attachments = useLiveQuery(
    () => (id ? db.attachments.where('entryId').equals(id).toArray() : []),
    [id],
  )
  const media = useMedia((attachments ?? []).flatMap((a) => (a.mediaId ? [a.mediaId] : [])))

  // Only for naming the way back. `pruneEntryIfEmpty` counts an encounter as content, so a word
  // quick-added into a still-empty entry keeps it alive, and without this the button would read
  // "Journal" and then land on the entry.
  const encounters = useLiveQuery(
    () => (id ? db.encounters.where('entryId').equals(id).count() : 0),
    [id],
  )

  // Local copies, so typing is never gated on a round trip to IndexedDB.
  const [title, setTitle] = useState<string>()
  const [source, setSource] = useState<string>()
  const [body, setBody] = useState<string>()
  const [saved, setSaved] = useState(false)
  const [adding, setAdding] = useState<'word' | 'sentence'>()
  const [viewing, setViewing] = useState<Attachment>()

  const fileInput = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // Seed the fields once, the first time the record arrives. Re-seeding on every live update would
  // fight the cursor, because our own debounced write comes back through this same query.
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !entry) return
    seeded.current = true
    setTitle(entry.title ?? '')
    setSource(entry.source ?? '')
    setBody(entry.body)
  }, [entry])

  // The autosave. One timer, reset on every change, cleared on unmount so a pending write cannot
  // land after the learner has navigated away.
  //
  // The equality guard is what stops a write firing on mount. Seeding the fields from the record makes
  // them transition from undefined to values, which looks exactly like a change, so without this the
  // composer saved the entry unchanged the moment it opened and the indicator read "saved" before a
  // single key had been pressed.
  useEffect(() => {
    if (!id || !entry || title === undefined || source === undefined || body === undefined) return
    if (title === (entry.title ?? '') && source === (entry.source ?? '') && body === entry.body) {
      return
    }

    setSaved(false)
    const t = setTimeout(() => {
      void saveEntry(id, { title, source, body }).then(() => setSaved(true))
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [id, entry, title, source, body])

  // Grow the sheet with the text rather than scrolling it. The ruled background is drawn per line, so
  // an inner scroll would slide the text off its own rules.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 230)}px`
  }, [body])

  const attach = async (files: FileList | null) => {
    if (!files || !nb || !id) return
    for (const file of Array.from(files)) {
      const kind = kindOf(file.type)
      const size = kind === 'image' ? await imageSize(file) : undefined
      await addAttachment({
        notebookId: nb,
        entryId: id,
        kind,
        bytes: file,
        filename: file.name,
        width: size?.width,
        height: size?.height,
      })
    }
  }

  /**
   * Leaving means closing, not saving. Everything is already written.
   *
   * An entry that never got a body, an attachment or an encounter was not a record, so it goes rather
   * than sitting blank on the timeline forever, and the destination is the journal instead of a page
   * for something that no longer exists.
   */
  const leave = async () => {
    if (!id || !nb) return
    if (title !== undefined && source !== undefined && body !== undefined) {
      await saveEntry(id, { title, source, body })
    }
    const pruned = await pruneEntryIfEmpty(id)
    navigate(pruned ? `/n/${nb}` : `/n/${nb}/e/${id}`)
  }

  if (!nb || !id) return null
  if (entry === undefined || body === undefined) return null
  if (entry === null) {
    return (
      <Shell
        context={notebook?.title ?? ''}
        contextTo={`/n/${nb}`}
        detail="journal"
        back={
          <RailButton label="Back to the journal" onClick={() => navigate(`/n/${nb}`)}>
            <BookOpen size={17} />
          </RailButton>
        }
      >
        <p className="empty">That entry is gone.</p>
      </Shell>
    )
  }

  // Where leaving actually lands, so the icon and its tooltip are true.
  const survives = body.trim() !== '' || (attachments ?? []).length > 0 || (encounters ?? 0) > 0

  return (
    <Shell
      context={notebook?.title ?? ''}
      contextTo={`/n/${nb}`}
      detail={entry.body === '' ? 'new entry' : 'editing'}
      actions={<span className="text-muted cp-saved">{saved ? 'saved' : ''}</span>}
      back={
        <RailButton
          label={survives ? 'Back to the entry' : 'Back to the journal'}
          onClick={() => void leave()}
        >
          {survives ? <FileText size={17} /> : <BookOpen size={17} />}
        </RailButton>
      }
      rail={
        <>
          <RailButton label="Attach" onClick={() => fileInput.current?.click()}>
            <Paperclip size={17} />
          </RailButton>
          <RailButton label="Add word" onClick={() => setAdding('word')}>
            <Type size={17} />
          </RailButton>
          <RailButton label="Add sentence" onClick={() => setAdding('sentence')}>
            <Quote size={17} />
          </RailButton>
        </>
      }
    >
      <div className="cp-head">
        <input
          className="input-bare cp-title"
          value={title ?? ''}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          aria-label="Title"
        />
        <input
          className="input-bare cp-source"
          value={source ?? ''}
          onChange={(e) => setSource(e.target.value)}
          placeholder="source"
          aria-label="Source"
        />
      </div>

      <textarea
        ref={bodyRef}
        className="ruled cp-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did you learn?"
        aria-label="Entry"
      />

      <div className="cp-attachments">
        {(attachments ?? []).map((a) => (
          <span key={a.id} className="cp-attachment">
            <Plate
              attachment={a}
              media={a.mediaId ? media.get(a.mediaId) : undefined}
              width={76}
              height={54}
              onClick={() => setViewing(a)}
            />
            <button
              type="button"
              className="cp-remove"
              title="Remove"
              aria-label="Remove attachment"
              onClick={() => void deleteAttachment(a.id)}
            >
              ×
            </button>
          </span>
        ))}
        <button
          type="button"
          className="btn btn-secondary cp-attach"
          onClick={() => fileInput.current?.click()}
        >
          + attach
        </button>
        <button
          type="button"
          className="btn btn-secondary cp-attach"
          onClick={() => setAdding('word')}
        >
          + word
        </button>
        <button
          type="button"
          className="btn btn-secondary cp-attach"
          onClick={() => setAdding('sentence')}
        >
          + sentence
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept="image/*,application/pdf,audio/*"
          hidden
          onChange={(e) => {
            void attach(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      <div className="action-bar">
        <span className="action-note">Entry saves as you write.</span>
        <div className="rf-actions">
          {/* Both leave the composer, and everything is already written, so neither needs a save
              first. They are hidden on an entry with nothing in it yet, because there would be
              nothing to reflect on or extract from. */}
          {entry.body.trim() !== '' ? (
            <>
              <Link to={`/n/${nb}/e/${id}/reflect`} className="btn btn-ghost">
                Reflect
              </Link>
              <Link to={`/n/${nb}/e/${id}?extract=1`} className="btn btn-ghost">
                Extract
              </Link>
            </>
          ) : null}
          <button className="btn btn-primary" onClick={() => void leave()}>
            Done
          </button>
        </div>
      </div>

      {adding ? (
        <QuickAdd
          notebookId={nb}
          entryId={id}
          kind={adding}
          onClose={() => setAdding(undefined)}
        />
      ) : null}

      {viewing ? (
        <Viewer
          attachment={viewing}
          media={viewing.mediaId ? media.get(viewing.mediaId) : undefined}
          onClose={() => setViewing(undefined)}
        />
      ) : null}
    </Shell>
  )
}
