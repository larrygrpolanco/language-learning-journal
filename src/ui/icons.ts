import { createLucideIcon } from 'lucide-react'

/**
 * Icons this app draws itself. There is one.
 *
 * `NotebookTabs` without its binding rings. His call: the coil down the left made it the rail's busiest
 * glyph, and at 17px those four short strokes read as noise rather than as a notebook.
 *
 * Built with Lucide's own factory rather than hand-rolled SVG, so it is a real `LucideIcon` — the same
 * `size` / `color` / `strokeWidth` defaults, the same `lucide` class, and assignable anywhere a
 * manifest icon goes. The node is Lucide 0.469's `notebook-tabs` with the four `M2 …h4` binding paths
 * dropped and nothing else touched, keys included, since the renderer maps the node straight into an
 * array of elements.
 *
 * Dropping the coil leaves the rect centred on its own: x 4→20 in a 24 viewBox.
 */
export const NotebookTabsPlain = createLucideIcon('NotebookTabsPlain', [
  ['rect', { width: '16', height: '20', x: '4', y: '2', rx: '2', key: '1nb95v' }],
  ['path', { d: 'M15 2v20', key: 'dcj49h' }],
  ['path', { d: 'M15 7h5', key: '1xj5lc' }],
  ['path', { d: 'M15 12h5', key: 'w5shd9' }],
  ['path', { d: 'M15 17h5', key: '1qaofu' }],
])
