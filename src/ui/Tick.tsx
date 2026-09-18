/**
 * The 14px tick. One glyph, two dialogs.
 *
 * The visible square is a `<span>`, because a native checkbox cannot be styled to the design's
 * hairline-and-fill without fighting the browser. The real control is still a real checkbox, kept
 * off screen but focusable, so a row announces itself as a checkbox and works from the keyboard.
 *
 * Both are rendered here rather than by the caller because the focus ring is
 * `.pick-box:focus-visible + .pick-tick`, which only works while they are siblings.
 */
export const Tick = ({ on, onToggle }: { on: boolean; onToggle: () => void }) => (
  <>
    <input type="checkbox" className="pick-box" checked={on} onChange={onToggle} />
    <span className={on ? 'pick-tick pick-tick-on' : 'pick-tick'} />
  </>
)
