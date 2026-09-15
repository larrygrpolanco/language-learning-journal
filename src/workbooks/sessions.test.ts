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

interface DrillState {
  at: number
  asked: string[]
  right: Record<string, boolean>
}

describe('a session state round trip', () => {
  it('hands back exactly what the workbook handed over', async () => {
    const id = await openSession('nb', 'word-drill', 'starting', d)

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
    const id = await openSession('nb', 'word-drill', 'starting', d)
    await saveSessionState(id, { at: 1 }, d)

    const back = await getSession(id, d)
    expect(back?.state).toEqual({ at: 1 })
    expect(back?.status).toBe('open')
  })

  it('leaves state alone when docking without one', async () => {
    const id = await openSession('nb', 'word-drill', 'starting', d)
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
    const id = await openSession('nb', 'word-drill', '2 of 8', first)
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

describe('at most one expanded', () => {
  it('docks the open session when a second is started', async () => {
    const first = await openSession('nb', 'word-drill', 'first', d)
    const second = await openSession('nb', 'word-drill', 'second', d)

    expect((await getSession(first, d))?.status).toBe('docked')
    expect((await getSession(second, d))?.status).toBe('open')
  })

  it('docks the open session when a docked one is restored', async () => {
    const first = await openSession('nb', 'word-drill', 'first', d)
    await dockSession(first, { at: 1 }, d)
    const second = await openSession('nb', 'word-drill', 'second', d)

    await expandSession(first, d)

    expect((await getSession(first, d))?.status).toBe('open')
    expect((await getSession(second, d))?.status).toBe('docked')
    // Restoring must not disturb the state it is restoring.
    expect((await getSession(first, d))?.state).toEqual({ at: 1 })
  })

  it('does not touch a session in another notebook', async () => {
    const mine = await openSession('nb-a', 'word-drill', 'mine', d)
    await openSession('nb-b', 'word-drill', 'theirs', d)

    // The notebook is the boundary, so opening one elsewhere leaves this one expanded.
    expect((await getSession(mine, d))?.status).toBe('open')
  })
})

describe('the dock', () => {
  it('lists only docked sessions for this notebook, oldest first', async () => {
    const a = await openSession('nb', 'word-drill', 'a', d)
    await dockSession(a, undefined, d)
    const b = await openSession('nb', 'word-drill', 'b', d)
    await dockSession(b, undefined, d)
    const open = await openSession('nb', 'word-drill', 'still open', d)
    await openSession('other', 'word-drill', 'elsewhere', d)

    const chips = await dockedSessions('nb', d)
    expect(chips.map((s) => s.label)).toEqual(['a', 'b'])
    expect(chips.some((s) => s.id === open)).toBe(false)
  })

  it('reads the label the workbook set', async () => {
    const id = await openSession('nb', 'word-drill', 'starting', d)
    await setSessionLabel(id, '3 of 8', d)
    await dockSession(id, undefined, d)

    expect((await dockedSessions('nb', d))[0]?.label).toBe('3 of 8')
  })

  it('drops a closed session entirely, since closing saves nothing', async () => {
    const id = await openSession('nb', 'word-drill', 'a', d)
    await dockSession(id, { at: 1 }, d)
    await closeSession(id, d)

    expect(await getSession(id, d)).toBeUndefined()
    expect(await dockedSessions('nb', d)).toEqual([])
  })
})
