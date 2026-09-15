import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Link, NavLink } from 'react-router-dom'
import { Dock } from './Dock'

/**
 * The persistent chrome. Technical plan §6, UI guide "Shell".
 *
 * Kicker strip across the top, 64px gutter rail down the left with the dock at its foot, content
 * between. On mobile the rail becomes a bottom bar, handled entirely in CSS.
 *
 * The kicker reads `context · detail`, split because every screen wants a different second segment:
 * "· journal", "· Fri 12 Sep", "· new entry", "· words · 312".
 *
 * `contextTo` makes the first segment a link to the thing it names, with a chevron in front of it so
 * it reads as one. The rail carries the same move as a plain icon: `back` is the head of the rail, one
 * step up, marked off from the screen's own tools by a hairline. Nothing labelled, nothing louder than
 * the icons under it.
 *
 * Up a level means the library from any of the notebook's three sections, and the thing that contains
 * it from an entry, an edit or a reflection.
 */
export interface ShellProps {
  context: string
  /** Where the context label goes when pressed. The notebook, usually. */
  contextTo?: string
  detail?: string
  /** Right of the kicker. */
  actions?: ReactNode
  /** Head of the rail, over a hairline. One icon, the way back up a level. */
  back?: ReactNode
  /** The gutter rail's icon buttons. Contents vary by screen. */
  rail?: ReactNode
  children: ReactNode
}

export const Shell = ({
  context,
  contextTo,
  detail,
  actions,
  back,
  rail,
  children,
}: ShellProps) => (
  <div className="shell">
    <header className="kicker">
      <span className="kicker-context">
        {contextTo ? (
          <Link to={contextTo} className="kicker-link">
            <ChevronLeft size={12} aria-hidden="true" />
            {context}
          </Link>
        ) : (
          context
        )}
        {detail ? ` · ${detail}` : null}
      </span>
      {actions ? <span className="kicker-actions">{actions}</span> : null}
    </header>
    <nav className="rail">
      {back}
      {back && rail ? <div className="rail-sep" /> : null}
      {rail}
      {/* The dock decides for itself whether it has anything to show, and renders nothing when it
          does not. Every screen carries it, so a docked exercise is reachable from anywhere in the
          notebook rather than only from the practice page. */}
      <Dock />
    </nav>
    <main className="content">{children}</main>
  </div>
)

/** A 36×36 ghost icon button in the rail. 44px on mobile, via CSS. */
export const RailLink = ({
  to,
  label,
  children,
  end = true,
}: {
  to: string
  label: string
  children: ReactNode
  end?: boolean
}) => (
  <NavLink to={to} className="btn btn-icon" title={label} aria-label={label} end={end}>
    {children}
  </NavLink>
)

/** Same look, but an action rather than a destination. Disabled when there is nowhere to go. */
export const RailButton = ({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) => (
  <button
    type="button"
    className="btn btn-icon"
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
  >
    {children}
  </button>
)

/** An 11.5px uppercase section label. Used above every block on the detail screens. */
export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="section-label">{children}</div>
)
