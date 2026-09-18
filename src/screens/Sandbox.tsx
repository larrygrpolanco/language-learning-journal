import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { JournalDb, newId, nowIso } from '../db/db'
import { WORKBOOKS } from '../workbooks'
import { buildContext } from '../workbooks/context'
import { aiFor, journalWriterFor } from '../workbooks/writer'
import { Shell } from '../ui/Shell'
import { failureLine } from '../ai/client'
import type { AnyWorkbook, ContextBundle } from '../workbooks/sdk'

/**
 * `/sandbox`. Technical plan §8. Dev build only.
 *
 * Mounts any registered workbook against a fixture notebook so a new exercise can be built and thrown
 * away without needing a real journal in a real state.
 *
 * The important part is the database name. This runs against `llj-sandbox`, a different IndexedDB
 * database entirely, so nothing here can reach a real notebook. `JournalDb` already took a name
 * parameter, which is what made that a one-line guarantee rather than a careful convention.
 *
 * In a production build this is a redirect. The route stays registered because removing it
 * conditionally would mean the router differs between builds, and a route that redirects is easier to
 * reason about than a route that sometimes exists.
 */
const SANDBOX_DB = 'llj-sandbox'
const FIXTURE_NOTEBOOK = 'sandbox-notebook'

export const Sandbox = () => {
  if (!import.meta.env.DEV) return <Navigate to="/" replace />
  return <SandboxInner />
}

const SandboxInner = () => {
  const [db, setDb] = useState<JournalDb>()
  const [picked, setPicked] = useState<AnyWorkbook>()
  const [bundle, setBundle] = useState<ContextBundle>()
  const [state, setState] = useState<unknown>()
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    const open = async () => {
      try {
        const d = new JournalDb(SANDBOX_DB)
        await d.open()
        await seed(d)
        if (live) setDb(d)
      } catch (e) {
        if (live) setError(failureLine(e))
      }
    }
    void open()
    return () => {
      live = false
    }
  }, [])

  const mount = async (workbook: AnyWorkbook) => {
    if (!db) return
    setError(undefined)
    try {
      setBundle(await buildContext(FIXTURE_NOTEBOOK, workbook.request, undefined, { d: db }))
      setState(undefined)
      setLabel('')
      setPicked(workbook)
    } catch (e) {
      setError(failureLine(e))
    }
  }

  const wipe = async () => {
    if (!db) return
    // Deletes the sandbox database only. The real one is a different name and is not opened here.
    db.close()
    await JournalDb.delete(SANDBOX_DB)
    window.location.reload()
  }

  /**
   * Stable across renders, which matters more here than it looks.
   *
   * A workbook's "fetch this once on mount" effects list `ai` among their dependencies. Built inline in
   * the JSX below, it was a new object on every render, so those effects re-ran on every render and a
   * workbook could pay for its setup twice. The workbooks now carry their own ref guards, but handing
   * them an unstable surface would still make the sandbox behave unlike `WorkbookLayer`, which memoizes
   * it — and a test bed that differs from the real thing is worth less than no test bed.
   */
  const language = bundle?.profile?.language ?? 'Korean'
  const ai = useMemo(() => aiFor(language), [language])
  const journal = useMemo(
    () => (db && picked ? journalWriterFor(FIXTURE_NOTEBOOK, picked.id, db) : undefined),
    [db, picked],
  )
  // Stable for the same reason `ai` is: it is handed to the workbook as a prop.
  const setWorkbookState = useCallback((next: unknown) => setState(next), [])

  return (
    <Shell context="Sandbox" detail={picked ? picked.name : 'pick a workbook'}>
      <p className="st-prose">
        Fixture notebook in a separate database, <code>{SANDBOX_DB}</code>. Nothing here can touch a
        real notebook. AI calls are real and use the key from Settings.
      </p>

      <div className="st-actions">
        {WORKBOOKS.map((w) => (
          <button key={w.id} className="btn btn-secondary" onClick={() => void mount(w)}>
            {w.name}
          </button>
        ))}
        <button className="btn btn-ghost" onClick={() => void wipe()}>
          Reset the fixture
        </button>
      </div>

      {error ? <p className="st-error">{error}</p> : null}
      {label ? <p className="st-line">chip would read: {label}</p> : null}

      <hr className="hr" />

      {picked && bundle && journal ? (
        <picked.Component
          bundle={bundle}
          state={state as never}
          setState={setWorkbookState as (next: never) => void}
          setLabel={setLabel}
          ai={ai}
          journal={journal}
          minimize={() => setPicked(undefined)}
          close={() => setPicked(undefined)}
        />
      ) : (
        <p className="text-muted">Pick one above.</p>
      )}
    </Shell>
  )
}

/**
 * The fixture. Written once and left alone on later visits, so an exercise can be reloaded against the
 * same data twice and behave the same both times.
 */
const seed = async (d: JournalDb): Promise<void> => {
  if (await d.notebooks.get(FIXTURE_NOTEBOOK)) return

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

  await d.notebooks.add({
    id: FIXTURE_NOTEBOOK,
    title: '시댁 한국어',
    language: 'Korean',
    focus: 'Talking with my mother-in-law. Polite forms, kitchen and family talk.',
    meaningLanguage: 'English',
    createdAt: daysAgo(120),
    lastOpenedAt: nowIso(),
  })

  const terms: [string, string, number][] = [
    ['치우다', 'to tidy up, to clear away', 3],
    ['얼른', 'quickly, right away', 5],
    ['수고하셨습니다', 'thanks for your effort', 8],
    ['반찬', 'side dishes', 11],
    ['어머님', 'mother-in-law, respectful', 2],
    ['챙기다', 'to look after, to gather up', 14],
    ['맡기다', 'to entrust, to leave to someone', 20],
    ['그릇', 'a bowl, a dish', 30],
  ]

  for (const [term, meaning, days] of terms) {
    const wordId = newId()
    const entryId = newId()
    await d.entries.add({
      id: entryId,
      notebookId: FIXTURE_NOTEBOOK,
      date: daysAgo(days),
      body: `Fixture entry for ${term}. 어머님 was in the kitchen again.`,
      origin: 'learner',
      createdAt: daysAgo(days),
      updatedAt: daysAgo(days),
    })
    await d.words.add({
      id: wordId,
      notebookId: FIXTURE_NOTEBOOK,
      term,
      termKey: term,
      meaning,
      createdAt: daysAgo(days),
      updatedAt: daysAgo(days),
    })
    await d.encounters.add({
      id: newId(),
      notebookId: FIXTURE_NOTEBOOK,
      entryId,
      targetType: 'word',
      targetId: wordId,
      createdAt: daysAgo(days),
    })
  }

  // Enough sentences for a sentence-led request to have something to work from. One sentence was
  // fine while word drill was the only workbook; a listening dialog built from one line is not a
  // dialog, and a fixture that cannot exercise a workbook is not a fixture for it.
  const lines: [string, string, number][] = [
    ['제가 치울게요', 'let me clear these away', 3],
    ['얼른 오세요', 'come quickly', 5],
    ['반찬 좀 더 드릴까요?', 'shall I give you some more side dishes?', 11],
    ['제가 챙길게요', "I'll see to it", 14],
    ['그릇은 어디에 둘까요?', 'where should I put the bowls?', 30],
    ['수고하셨습니다', 'thank you for your trouble', 8],
  ]

  const [firstEntry] = await d.entries.where('notebookId').equals(FIXTURE_NOTEBOOK).toArray()

  for (const [text, translation, days] of lines) {
    const sentenceId = newId()
    await d.sentences.add({
      id: sentenceId,
      notebookId: FIXTURE_NOTEBOOK,
      text,
      translation,
      createdAt: daysAgo(days),
    })
    // Hung off an entry, so the focus picker has something to offer for this fixture too.
    if (firstEntry) {
      await d.encounters.add({
        id: newId(),
        notebookId: FIXTURE_NOTEBOOK,
        entryId: firstEntry.id,
        targetType: 'sentence',
        targetId: sentenceId,
        createdAt: daysAgo(days),
      })
    }
  }
}
