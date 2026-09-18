import { useEffect, useState } from 'react'
import { useReceipt } from './receipts'

/**
 * Renders the receipt. Mounted beside the workbook layer, outside the routes.
 *
 * Fixed at the top right, clear of the kicker's 44px strip and on the same margin `kicker-actions`
 * keeps. Above the workbook sheet, because captures happen inside workbook output and a receipt
 * hidden under the surface that caused it is worse than none.
 *
 * The live region is the outer element and it is always mounted, empty most of the time. A `role`
 * `status` that appears and disappears with its own text is announced unreliably, and this is now the
 * app's only confirmation that a capture landed. Polite rather than assertive: the write already
 * happened, so there is nothing worth interrupting anyone for.
 */

/** Long enough to read a three-word line and look away. */
const RECEIPT_MS = 3000

export const Receipt = () => {
  const receipt = useReceipt()
  const seq = receipt?.seq
  const text = receipt?.text
  const [shown, setShown] = useState<string>()

  // The serial is the dependency that matters. Keyed on the text alone, capturing the same word twice
  // would leave the first press's expiry running and take the second line down early.
  useEffect(() => {
    if (text === undefined) return
    setShown(text)
    const t = window.setTimeout(() => setShown(undefined), RECEIPT_MS)
    return () => window.clearTimeout(t)
  }, [seq, text])

  return (
    <div className="receipt-live" role="status" aria-live="polite">
      {shown ? <span className="receipt">{shown}</span> : null}
    </div>
  )
}
