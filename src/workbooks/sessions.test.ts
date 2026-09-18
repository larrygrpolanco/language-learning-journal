import { beforeEach, describe, expect, it } from 'vitest'
import { JournalDb } from '../db/db'
import {
  closeSession,
  dockSession,
  dockedSessions,
  expandSession,
  getSession,
  openSession,
  saveSessionState,
  setSessionLabel,
} from './sessions'
import type { OpenSessionInput } from './sessions'
import type { WorkbookScope } from '../db/types'

/**
 * The session round trip. The plan names this as owed, and it is the one thing in the dock worth
 * testing: everything else about the mechanic is layout, but if state does not survive the trip
 * through IndexedDB then minimizing loses the exercise, which is the whole feature.
 */

let d: JournalDb
let counter = 0

beforeEach(async () => {
  counter += 1
  d = new JournalDb(`sessions-test-${counter}`)
  await d.open()
})

/** One notebook and one workbook is the usual case, so only the label is worth writing out. */
const start = (label: string, over: Partial<OpenSessionInput> = {}, into: JournalDb = d) =>
  openSession({ notebookId: 'nb', workbookId: 'word-drill', label, ...over }, into)

interface DrillState {
  at: number
  asked: string[]
  right: Record<string, boolean>
}

describe('a session state round trip', () => {
  it('hands back exactly what the workbook handed over', async () => {
    const id = await start('starting')

    const state: DrillState = {
      at: 2,
      // Hangul included on purpose: this goes through structured clone, not JSON.stringify, and a
      // silent encoding problem here would only ever show up on the target language.
      asked: ['치우다', '얼른', '수고하셨습니다'],
      right: { 치우다: true, 얼른: false },
    }
    await dockSession(id, state, d)

    const back = await getSession(id, d)
    expect(back?.status).toBe('docked')
    expect(back?.state).toEqual(state)
    // Structurally equal but not the same object, so the workbook cannot be handed a live reference.
    expect(back?.state).not.toBe(state)
  })

  it('keeps state written by setState without changing status', async () => {
    const id = await start('starting')
    await saveSessionState(id, { at: 1 }, d)

    const back = await getSession(id, d)
    expect(back?.state).toEqual({ at: 1 })
    expect(back?.status).toBe('open')
  })

  it('leaves state alone when docking without one', async () => {
    const id = await start('starting')
    await saveSessionState(id, { at: 3 }, d)
    await dockSession(id, undefined, d)

    const back = await getSession(id, d)
    expect(back?.state).toEqual({ at: 3 })
    expect(back?.status).toBe('docked')
  })

  it('survives the database being reopened, which is what a reload is', async () => {
    const name = `sessions-reload-${counter}`
    const first = new JournalDb(name)
    await first.open()
    const id = await start('2 of 8', {}, first)
    await dockSession(id, { at: 2 }, first)
    first.close()

    const second = new JournalDb(name)
    await second.open()
    const back = await getSession(id, second)
    expect(back?.state).toEqual({ at: 2 })
    expect(back?.label).toBe('2 of 8')
    second.close()
  })
})

/**
 * The focus scope, which is stored once at open and never revised.
 *
 * Worth its own tests for the same reason state is: a scope lost on the way to the dock means a
 * restored exercise quietly rebuilds itself around the whole notebook instead of the two entries the
 * learner picked, and nothing on screen says so.
 */
describe('the focus scope', () => {
  const scope: WorkbookScope = { entryIds: ['e1', 'e2'], wordIds: ['w1'], sentenceIds: ['s1'] }

  it('is absent when nothing was focused, rather than an empty scope', async () => {
    const back = await getSession(await start('starting'), d)
    expect(back?.scope).toBeUndefined()
    expect('scope' in back!).toBe(false)
  })

  it('is stored on open and survives being docked', async () => {
    const id = await start('starting', { scope })
    expect((await getSession(id, d))?.scope).toEqual(scope)

    await dockSession(id, { at: 1 }, d)
    const back = await getSession(id, d)
    expect(back?.scope).toEqual(scope)
    expect(back?.state).toEqual({ at: 1 })
  })

  it('survives being restored from the dock', async () => {
    const id = await start('starting', { scope })
    await dockSession(id, { at: 1 }, d)
    await expandSession(id, d)
    expect((await getSession(id, d))?.scope).toEqual(scope)
  })
})

describe('at most one expanded', () => {
  it('docks the open session when a second is started', async () => {
    const first = await start('first')
    const second = await start('second')

    expect((await getSession(first, d))?.status).toBe('docked')
    expect((await getSession(second, d))?.status).toBe('open')
  })

  it('docks the open session when a docked one is restored', async () => {
    const first = await start('first')
    await dockSession(first, { at: 1 }, d)
    const second = await start('second')

    await expandSession(first, d)

    expect((await getSession(first, d))?.status).toBe('open')
    expect((await getSession(second, d))?.status).toBe('docked')
    // Restoring must not disturb the state it is restoring.
    expect((await getSession(first, d))?.state).toEqual({ at: 1 })
  })

  it('does not touch a session in another notebook', async () => {
    const mine = await start('mine', { notebookId: 'nb-a' })
    await start('theirs', { notebookId: 'nb-b' })

    // The notebook is the boundary, so opening one elsewhere leaves this one expanded.
    expect((await getSession(mine, d))?.status).toBe('open')
  })
})

describe('the dock', () => {
  it('lists only docked sessions for this notebook, oldest first', async () => {
    const a = await start('a')
    await dockSession(a, undefined, d)
    const b = await start('b')
    await dockSession(b, undefined, d)
    const stillOpen = await start('still open')
    await start('elsewhere', { notebookId: 'other' })

    const chips = await dockedSessions('nb', d)
    expect(chips.map((s) => s.label)).toEqual(['a', 'b'])
    expect(chips.some((s) => s.id === stillOpen)).toBe(false)
  })

  it('reads the label the workbook set', async () => {
    const id = await start('starting')
    await setSessionLabel(id, '3 of 8', d)
    await dockSession(id, undefined, d)

    expect((await dockedSessions('nb', d))[0]?.label).toBe('3 of 8')
  })

  it('drops a closed session entirely, since closing saves nothing', async () => {
    const id = await start('a')
    await dockSession(id, { at: 1 }, d)
    await closeSession(id, d)

    expect(await getSession(id, d)).toBeUndefined()
    expect(await dockedSessions('nb', d)).toEqual([])
  })
})
