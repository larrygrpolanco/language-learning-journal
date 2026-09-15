import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Library, Settings as SettingsIcon } from 'lucide-react'
import { db } from '../db/db'
import { SETTINGS_ID, type Id, type Notebook } from '../db/types'
import { RailLink, SectionLabel, Shell } from '../ui/Shell'
import { plural, relativeDay, shortDate } from '../ui/format'
import { openBundle } from '../storage/files'
import { isInstalled, onInstallAvailable, promptInstall } from '../storage/install'
import { BundleError } from '../storage/bundle'
import { applyImport, exportBundle, planImport, type ImportPlan, type Resolution } from '../storage/transfer'

/** The plan's threshold for the export line changing its tone. Technical plan §4. */
const STALE_DAYS = 14

/**
 * Settings. Not covered by the UI guide, so built plainly from the token set.
 *
 * Three things live here: the file the learner owns, the API key, and the meaning-language default.
 * No section does anything until pressed.
 */
export const Settings = () => {
  const settings = useLiveQuery(() => db.settings.get(SETTINGS_ID), [])
  const notebooks = useLiveQuery(() => db.notebooks.orderBy('lastOpenedAt').reverse().toArray(), [])

  return (
    <Shell
      context="Settings"
      detail={shortDate(new Date().toISOString())}
      back={
        <RailLink to="/" label="Back to the library">
          <Library size={17} />
        </RailLink>
      }
      rail={
        <RailLink to="/settings" label="Settings">
          <SettingsIcon size={17} />
        </RailLink>
      }
    >
      <div className="st-page">
        <ExportSection notebooks={notebooks ?? []} lastExportedAt={settings?.lastExportedAt} />
        <hr className="hr" />
        <ImportSection />
        <hr className="hr" />
        <KeySection current={settings?.xaiKey} />
        <hr className="hr" />
        <MeaningLanguageSection current={settings?.meaningLanguage} />
        <hr className="hr" />
        <InstallSection />
      </div>
    </Shell>
  )
}

/* ── export ───────────────────────────────────────────────────────────────── */

const ExportSection = ({
  notebooks,
  lastExportedAt,
}: {
  notebooks: readonly Notebook[]
  lastExportedAt: string | undefined
}) => {
  const [busy, setBusy] = useState(false)
  const [wrote, setWrote] = useState<string>()

  const run = async (notebookId?: Id) => {
    setBusy(true)
    setWrote(undefined)
    try {
      setWrote(await exportBundle(notebookId))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <h4 className="st-heading">The file you own</h4>
      <p className="st-prose">
        A <code>.lljournal</code> file is a zip of plain JSON, one folder per notebook, with the media
        alongside it. It also carries a <code>readable/</code> folder holding each notebook as plain
        Markdown, so the journal stays readable in any text editor with no app and no import step.
      </p>

      <p className="st-line">{exportLine(lastExportedAt)}</p>

      <div className="st-actions">
        <button
          className="btn btn-primary"
          disabled={busy || notebooks.length === 0}
          onClick={() => void run()}
        >
          {notebooks.length > 1 ? `Export all ${notebooks.length} notebooks` : 'Export'}
        </button>
        {notebooks.length > 1
          ? notebooks.map((n) => (
              <button
                key={n.id}
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void run(n.id)}
              >
                {n.title}
              </button>
            ))
          : null}
      </div>

      {wrote ? <p className="st-ok">Wrote {wrote}.</p> : null}
    </section>
  )
}

/**
 * One plain line of text. No badge, no modal, no red dot.
 *
 * IndexedDB is evictable, and this line plus `storage.persist()` is the whole mitigation. It says more
 * after a fortnight because that is when it starts to matter, not to nag.
 */
const exportLine = (lastExportedAt: string | undefined): string => {
  if (!lastExportedAt) return 'You have never exported. Everything so far lives only in this browser.'

  const days = Math.floor((Date.now() - Date.parse(lastExportedAt)) / 86_400_000)
  const when = relativeDay(lastExportedAt)
  if (days >= STALE_DAYS) {
    return `Last exported ${when}. That has been a while, and a browser can clear its own storage.`
  }
  return `Last exported ${when}.`
}

/* ── import ───────────────────────────────────────────────────────────────── */

const ImportSection = () => {
  const [plan, setPlan] = useState<ImportPlan>()
  const [choices, setChoices] = useState<Map<Id, Resolution>>(new Map())
  const [error, setError] = useState<string>()
  const [done, setDone] = useState<number>()

  const pick = async () => {
    setError(undefined)
    setDone(undefined)
    const bytes = await openBundle()
    if (!bytes) return

    try {
      const next = await planImport(bytes)
      setPlan(next)
      // New copy is the default, so a mistaken import never overwrites anything.
      setChoices(new Map(next.notebooks.map((n) => [n.id, n.existing ? 'new copy' : 'replace'])))
    } catch (e) {
      setError(e instanceof BundleError ? e.message : 'Could not read that file.')
    }
  }

  const apply = async () => {
    if (!plan) return
    const applied = await applyImport(plan, choices)
    setPlan(undefined)
    setDone(applied.length)
  }

  return (
    <section>
      <h4 className="st-heading">Bring a journal in</h4>
      <p className="st-prose">
        Import reads a <code>.lljournal</code> file. Where a notebook is already here, you choose
        whether it arrives as a copy or replaces what you have. Replace is a whole-notebook overwrite,
        not a merge.
      </p>

      {!plan ? (
        <div className="st-actions">
          <button className="btn btn-secondary" onClick={() => void pick()}>
            Choose a file…
          </button>
        </div>
      ) : null}

      {error ? <p className="st-error">{error}</p> : null}
      {done !== undefined ? (
        <p className="st-ok">
          {done === 0 ? 'Nothing imported.' : `Imported ${plural(done, 'notebook')}.`}
        </p>
      ) : null}

      {plan ? (
        <>
          <SectionLabel>In that file</SectionLabel>
          <div className="st-plan">
            {plan.notebooks.map((n) => (
              <div key={n.id} className="st-plan-row">
                <div className="st-plan-text">
                  <span className="st-plan-title">{n.title}</span>
                  <span className="st-plan-meta">
                    {plural(n.entries, 'entry', 'entries')} · {plural(n.words, 'word')}
                    {n.existing ? ' · already here' : ' · new to this device'}
                  </span>
                </div>
                {n.existing ? (
                  <div className="seg">
                    {(['new copy', 'replace', 'skip'] as const).map((r) => (
                      <label key={r} className="seg-opt">
                        <input
                          type="radio"
                          name={`res-${n.id}`}
                          checked={choices.get(n.id) === r}
                          onChange={() => setChoices(new Map(choices).set(n.id, r))}
                        />
                        {r}
                      </label>
                    ))}
                  </div>
                ) : (
                  <span className="st-plan-meta">will be added</span>
                )}
              </div>
            ))}
          </div>

          {[...choices.values()].includes('replace') &&
          plan.notebooks.some((n) => n.existing && choices.get(n.id) === 'replace') ? (
            <p className="st-warn">
              Replace deletes the local notebook and everything in it first. Anything written since the
              file was exported is lost.
            </p>
          ) : null}

          <div className="st-actions">
            <button className="btn btn-ghost" onClick={() => setPlan(undefined)}>
              Not now
            </button>
            <button className="btn btn-primary" onClick={() => void apply()}>
              Import
            </button>
          </div>
        </>
      ) : null}
    </section>
  )
}

/* ── the key ──────────────────────────────────────────────────────────────── */

const KeySection = ({ current }: { current: string | undefined }) => {
  const [value, setValue] = useState<string>()
  const [shown, setShown] = useState(false)
  const [saved, setSaved] = useState(false)

  const editing = value ?? current ?? ''

  const save = async () => {
    const settings = await db.settings.get(SETTINGS_ID)
    const next = { ...settings, id: SETTINGS_ID } as { id: typeof SETTINGS_ID; xaiKey?: string }
    if (editing.trim() === '') delete next.xaiKey
    else next.xaiKey = editing.trim()
    await db.settings.put(next)
    setSaved(true)
  }

  return (
    <section>
      <h4 className="st-heading">Key</h4>
      <p className="st-prose">
        Reflect, Extract and the exercises call xAI directly with your own key. Nothing is proxied and
        there is no account. Being honest about what this is: the key is stored in this browser, and
        anyone who can open this browser can read it. That is fine for one person on their own machine,
        which is what this is.
      </p>

      <div className="st-key">
        <input
          className="input"
          type={shown ? 'text' : 'password'}
          value={editing}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          placeholder="xai-…"
          aria-label="xAI API key"
          autoComplete="off"
          spellCheck={false}
        />
        <button className="btn btn-secondary" onClick={() => setShown(!shown)}>
          {shown ? 'Hide' : 'Show'}
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Save
        </button>
      </div>
      {saved ? <p className="st-ok">Saved.</p> : null}
    </section>
  )
}

/* ── installing ───────────────────────────────────────────────────────────── */

/**
 * Install the app. Technical plan M5.
 *
 * The button appears only when the browser says it can install, so there is nothing here to press that
 * would do nothing. Once installed, this says so and stops offering.
 *
 * Worth being plain about what installing does and does not do. It gives the journal its own window
 * and its own icon, and it means the shell opens without a network. It does not make the data safer:
 * an installed PWA is the same evictable IndexedDB, and the export above is still the backstop.
 */
const InstallSection = () => {
  const [available, setAvailable] = useState(false)
  const [installed, setInstalled] = useState(isInstalled())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => onInstallAvailable(setAvailable), [])

  const install = async () => {
    const outcome = await promptInstall()
    if (outcome === 'accepted') setInstalled(true)
    if (outcome === 'dismissed') setDismissed(true)
  }

  return (
    <section>
      <h4 className="st-heading">Install it</h4>
      <p className="st-prose">
        Installing gives the journal its own window and its own icon, and the app opens without a
        network. It does not make the data any safer: it is the same browser storage either way, so the
        file above is still the backstop.
      </p>

      {installed ? (
        <p className="st-ok">Installed. You are running it now.</p>
      ) : available ? (
        <div className="st-actions">
          <button className="btn btn-primary" onClick={() => void install()}>
            Install
          </button>
        </div>
      ) : (
        <p className="st-line">
          This browser is not offering to install it. Chrome and Edge put an install button in the
          address bar; on iOS it is Share, then Add to Home Screen.
        </p>
      )}

      {dismissed ? <p className="st-line">Not installed. The address bar still offers it.</p> : null}
    </section>
  )
}

/* ── meaning language ─────────────────────────────────────────────────────── */

const MeaningLanguageSection = ({ current }: { current: string | undefined }) => {
  const [value, setValue] = useState<string>()
  const [saved, setSaved] = useState(false)
  const editing = value ?? current ?? ''

  const save = async () => {
    const settings = await db.settings.get(SETTINGS_ID)
    const next = { ...settings, id: SETTINGS_ID } as {
      id: typeof SETTINGS_ID
      meaningLanguage?: string
    }
    if (editing.trim() === '') delete next.meaningLanguage
    else next.meaningLanguage = editing.trim()
    await db.settings.put(next)
    setSaved(true)
  }

  return (
    <section>
      <h4 className="st-heading">Meaning language</h4>
      <p className="st-prose">
        The language new notebooks use for meanings and translations, unless the notebook sets its own.
        A heritage learner might want Spanish here; a beginner, English.
      </p>
      <div className="st-key">
        <input
          className="input"
          value={editing}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          placeholder="English"
          aria-label="Meaning language"
        />
        <button className="btn btn-primary" onClick={() => void save()}>
          Save
        </button>
      </div>
      {saved ? <p className="st-ok">Saved.</p> : null}
    </section>
  )
}
