import { useState } from 'react'
import { addSentence, addWord } from '../journal/writes'
import { ordinalWord } from './format'
import { say } from './receipts'
import type { Id } from '../db/types'

/**
 * Quick add of one word or one sentence. Concepts §11.
 *
 * The only required field is the text itself. Everything else can be filled in later or never, which
 * is what keeps capture cheap enough to actually happen. Given an `entryId` it links there, otherwise
 * it links to today's entry, creating it if needed.
 *
 * The receipt speaks when the surface goes away. A new word closes the dialog and publishes a line,
 * which is the only thing that then says it worked. A re-encounter keeps the dialog open and its own
 * `qa-note`, and publishes nothing, because a receipt behind a live dialog is worse than none.
 */
export const QuickAdd = ({
  notebookId,
  entryId,
  kind,
  onClose,
}: {
  notebookId: Id
  entryId?: Id
  kind: 'word' | 'sentence'
  onClose: () => void
}) => {
  const [text, setText] = useState('')
  const [meaning, setMeaning] = useState('')
  const [note, setNote] = useState<string>()

  const ready = text.trim() !== ''

  const submit = async () => {
    if (!ready) return
    if (kind === 'word') {
      const r = await addWord({ notebookId, term: text, meaning: meaning || undefined, entryId })
      if (!r.created) {
        // Already known, so this was a re-encounter rather than a new word. Say so and stay open.
        setNote(`Already in this notebook · ${ordinalWord(r.timesEncountered)} time`)
        setText('')
        setMeaning('')
        return
      }
      say('word added')
    } else {
      await addSentence({
        notebookId,
        text,
        translation: meaning || undefined,
        entryId,
      })
      say('sentence added')
    }
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form
        className="dialog"
        style={{ width: 'min(460px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 className="dialog-title">{kind === 'word' ? 'Add a word' : 'Add a sentence'}</h2>
        {note ? <p className="qa-note">{note}</p> : null}

        <div className="field">
          <label htmlFor="qa-text">{kind === 'word' ? 'Term' : 'Sentence'}</label>
          {kind === 'word' ? (
            <input
              id="qa-text"
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
          ) : (
            <textarea
              id="qa-text"
              className="input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              autoFocus
            />
          )}
        </div>

        <div className="field">
          <label htmlFor="qa-meaning">{kind === 'word' ? 'Meaning' : 'Translation'}</label>
          <input
            id="qa-meaning"
            className="input"
            value={meaning}
            onChange={(e) => setMeaning(e.target.value)}
          />
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Not now
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
