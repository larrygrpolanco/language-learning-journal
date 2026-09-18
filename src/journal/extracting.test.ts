import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb, newId, nowIso } from '../db/db'
import { runningExtraction, runExtraction } from './extracting'
import { draftProposal } from './writes'
import type { Entry, Notebook, ProposalDraft } from '../db/types'

/**
 * The promise that outlives the dialog.
 *
 * Worth a test because the failure it guards against is invisible: before this, closing Extract
 * mid-call let the request finish and threw the answer away, which looks exactly like a slow model
 * from the outside. Nothing on screen would ever show the difference.
 */

let db: JournalDb
let nb: Notebook
let entry: Entry

/** Resolves when told to, so a call can be held open across an assertion. */
const deferred = <T>() => {
  let settle!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

/**
 * Waits for the module to finish its own work, without the test holding its promise.
 *
 * The slot is cleared after the save, so `runningExtraction` going empty is the signal that the
 * write landed. Holding the promise instead would defeat the point of the first test.
 */
const idle = async (entryId: string) => {
  for (let i = 0; i < 100 && runningExtraction(entryId); i += 1) {
    await new Promise((r) => setTimeout(r, 0))
  }
}

const draft = (over: Partial<ProposalDraft> = {}): ProposalDraft => ({
  entryId: entry.id,
  words: [],
  sentences: [],
  ...over,
})

beforeEach(async () => {
  db = new JournalDb(`test-${newId()}`)
  await db.open()

  nb = {
    id: newId(),
    title: 't',
    language: 'Spanish',
    createdAt: nowIso(),
    lastOpenedAt: nowIso(),
  }
  await db.notebooks.add(nb)

  entry = {
    id: newId(),
    notebookId: nb.id,
    date: nowIso(),
    origin: 'learner',
    body: 'b',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  await db.entries.add(entry)
})

describe('runExtraction', () => {
  it('saves the draft even when nobody is awaiting it', async () => {
    const held = deferred<ProposalDraft>()

    // Started and then dropped on the floor, which is what closing the dialog does.
    void runExtraction(nb.id, entry.id, () => held.promise, db)

    held.settle(draft({ words: [{ term: 'janguear' }] }))
    await idle(entry.id)

    const saved = await draftProposal(entry.id, db)
    expect(saved?.words.map((w) => w.term)).toEqual(['janguear'])
  })

  it('attaches a second caller to the call already running rather than asking twice', async () => {
    const held = deferred<ProposalDraft>()
    let asked = 0
    const ask = () => {
      asked += 1
      return held.promise
    }

    const first = runExtraction(nb.id, entry.id, ask, db)
    expect(runningExtraction(entry.id)).toBeDefined()

    const second = runExtraction(nb.id, entry.id, ask, db)
    held.settle(draft({ words: [{ term: 'chévere' }] }))

    expect(await first).toEqual(await second)
    expect(asked).toBe(1)
  })

  it('merges into the held draft instead of replacing it', async () => {
    await runExtraction(nb.id, entry.id, async () => draft({ words: [{ term: 'mofongo' }] }), db)
    await runExtraction(nb.id, entry.id, async () => draft({ words: [{ term: 'bachata' }] }), db)

    const saved = await draftProposal(entry.id, db)
    expect(saved?.words.map((w) => w.term)).toEqual(['mofongo', 'bachata'])
  })

  it('clears the slot after a failure so the next press can retry', async () => {
    await expect(
      runExtraction(nb.id, entry.id, () => Promise.reject(new Error('offline')), db),
    ).rejects.toThrow('offline')

    expect(runningExtraction(entry.id)).toBeUndefined()

    await runExtraction(nb.id, entry.id, async () => draft({ words: [{ term: 'brutal' }] }), db)
    const saved = await draftProposal(entry.id, db)
    expect(saved?.words.map((w) => w.term)).toEqual(['brutal'])
  })
})
