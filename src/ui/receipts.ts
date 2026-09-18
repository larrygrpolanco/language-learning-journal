import { useEffect, useState } from 'react'

/**
 * The receipt channel. One line, published from a write path, rendered by `Receipt.tsx`.
 *
 * A module-level publisher rather than a context provider, in the style of the clip cache in
 * `ai/speech.ts`. Nothing here says a receipt needs a provider around it: the thing that publishes is a
 * capture chip floating over a selection, and the thing that renders sits outside the routes. A provider
 * between them would have to wrap the whole app to reach both, which is a lot of ceremony for one
 * string.
 *
 * Why it exists at all: the capture chip used to say `word added` in place of its own buttons, and it
 * destroyed itself doing so. Clearing the selection fires `selectionchange`, which hid the chip and the
 * line with it about 180ms later. Moving the line off the chip means nothing that happens to the
 * selection can take it away.
 */

export interface Receipt {
  /** Serial, so the same line twice in a row still restarts the timer. */
  seq: number
  text: string
}

type Listener = (r: Receipt) => void

const listeners = new Set<Listener>()

let current: Receipt | undefined
let seq = 0

/**
 * Publishes a line. Called from the write path, after the write has landed.
 *
 * No link target and no action. The receipt says what happened and nothing else, so it never becomes
 * a thing to deal with.
 */
export const say = (text: string): void => {
  seq += 1
  current = { seq, text }
  for (const l of listeners) l(current)
}

/** Subscribes to the line. Undefined until something is said. */
export const useReceipt = (): Receipt | undefined => {
  const [receipt, setReceipt] = useState<Receipt | undefined>(current)

  useEffect(() => {
    listeners.add(setReceipt)
    return () => {
      listeners.delete(setReceipt)
    }
  }, [])

  return receipt
}
