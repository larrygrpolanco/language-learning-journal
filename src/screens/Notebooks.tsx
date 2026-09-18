import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { Library, Settings as SettingsIcon } from 'lucide-react'
import { db } from '../db/db'
import { createNotebook } from '../journal/writes'
import { Shell, RailLink } from '../ui/Shell'
import { plural, relativeDay, shortDate } from '../ui/format'

/**
 * The landing screen. UI guide §1.
 *
 * A grid of notebook cards with the most recently used one carrying a gold spine, and a dashed cell
 * that starts a new one. Counts come off the tables live, so they are never stale and never cached.
 */
export const Notebooks = () => {
  const [creating, setCreating] = useState(false)

  const rows = useLiveQuery(async () => {
    const notebooks = await db.notebooks.orderBy('lastOpenedAt').reverse().toArray()
    return Promise.all(
      notebooks.map(async (n) => ({
        notebook: n,
        entries: await db.entries.where('notebookId').equals(n.id).count(),
        words: await db.words.where('notebookId').equals(n.id).count(),
      })),
    )
  }, [])

  return (
    <Shell
      context="Library"
      detail={shortDate(new Date().toISOString())}
      actions={
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          New notebook
        </button>
      }
      rail={
        <>
          <RailLink to="/" label="Library">
            <Library size={17} />
          </RailLink>
          <RailLink to="/settings" label="Settings">
            <SettingsIcon size={17} />
          </RailLink>
        </>
      }
    >
      {rows === undefined ? null : (
        <>
          {rows.length === 0 ? (
            <p className="empty">Nothing here yet. A notebook is one language and one purpose.</p>
          ) : null}
          <div className="nb-grid">
            {rows.map(({ notebook, entries, words }, i) => (
              <Link
                key={notebook.id}
                to={`/n/${notebook.id}`}
                className={`nb-card${i === 0 ? ' nb-card-active' : ''}`}
              >
                <span className="nb-lang">{notebook.language}</span>
                <span className="nb-title">{notebook.title}</span>
                <span className="nb-focus">{notebook.focus ?? ''}</span>
                <span className="nb-meta">
                  {plural(entries, 'entry', 'entries')} · {plural(words, 'word')} ·{' '}
                  {relativeDay(notebook.lastOpenedAt)}
                </span>
              </Link>
            ))}
            <button className="nb-new" onClick={() => setCreating(true)}>
              Start a notebook
            </button>
          </div>
        </>
      )}

      {creating ? <NewNotebook onClose={() => setCreating(false)} /> : null}
    </Shell>
  )
}

/** Fields per concepts §4. Title and language are required; the rest can be filled later or never. */
const NewNotebook = ({ onClose }: { onClose: () => void }) => {
  const [title, setTitle] = useState('')
  const [language, setLanguage] = useState('')
  const [focus, setFocus] = useState('')
  const [meaningLanguage, setMeaningLanguage] = useState('')

  const ready = title.trim() !== '' && language.trim() !== ''

  const submit = async () => {
    if (!ready) return
    await createNotebook({ title, language, focus, meaningLanguage })
    onClose()
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <form
        className="dialog"
        style={{ width: 'min(480px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <h2 className="dialog-title">Start a notebook</h2>

        <div className="field">
          <label htmlFor="nb-title">Title</label>
          <input
            id="nb-title"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What to call it"
            autoFocus
          />
        </div>

        <div className="field">
          <label htmlFor="nb-language">Language</label>
          <input
            id="nb-language"
            className="input"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            placeholder="The one you are learning"
          />
        </div>

        <div className="field">
          <label htmlFor="nb-focus">Focus, and what to tell an exercise about this notebook</label>
          <textarea
            id="nb-focus"
            className="input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="What it is for"
          />
        </div>

        <div className="field">
          <label htmlFor="nb-meaning">Meaning language</label>
          <input
            id="nb-meaning"
            className="input"
            value={meaningLanguage}
            onChange={(e) => setMeaningLanguage(e.target.value)}
            placeholder="Defaults to English"
          />
        </div>

        <div className="dialog-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Not now
          </button>
          <button type="submit" className="btn btn-primary" disabled={!ready}>
            Start
          </button>
        </div>
      </form>
    </div>
  )
}
