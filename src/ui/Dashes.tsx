import type { Familiarity } from '../db/types'
import { familiarityDashes } from '../journal/derive'

/**
 * Familiarity as three 14×2px dashes. UI guide §7.
 *
 * An estimated value renders identically to one the learner set, which is deliberate. Nothing in the
 * app branches on the estimate, so drawing attention to which is which would be noise.
 */
export const Dashes = ({ familiarity }: { familiarity: Familiarity }) => {
  const filled = familiarityDashes(familiarity)
  return (
    <span className="dashes" title={familiarity} aria-label={familiarity}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= filled ? 'dash dash-on' : 'dash'} />
      ))}
    </span>
  )
}
