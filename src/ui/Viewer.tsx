import { useEffect } from 'react'
import { FileText } from 'lucide-react'
import type { Attachment, Media } from '../db/types'
import { useBlobUrl } from './hooks'

/**
 * One attachment, large enough to actually read.
 *
 * The plates on an entry are 112x80, which is enough to recognise a photographed page and not enough
 * to read it. This is the other half: press a plate and see the thing itself.
 *
 * Deliberately one component for all three kinds rather than three affordances. An entry can hold a
 * photo, a PDF and a recording at once, and "press the plate" reading the same way for each is worth
 * more than a bespoke control per kind.
 */
export const Viewer = ({
  attachment,
  media,
  onClose,
}: {
  attachment: Attachment
  media: Media | undefined
  onClose: () => void
}) => {
  const url = useBlobUrl(media?.bytes)

  // Escape closes, because the backdrop is the only other way out and a full-bleed image covers it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const name = attachment.filename ?? ''

  return (
    <div className="dialog-backdrop vw-backdrop" onClick={onClose}>
      <div className="vw" onClick={(e) => e.stopPropagation()}>
        {url === undefined ? (
          <p className="text-muted">Those bytes are missing.</p>
        ) : attachment.kind === 'image' ? (
          <img src={url} alt={name} className="vw-img" />
        ) : attachment.kind === 'pdf' ? (
          <object data={url} type="application/pdf" className="vw-pdf" aria-label={name || 'PDF'}>
            {/* Reached when the browser has no inline PDF viewer. A download beats a blank frame. */}
            <a href={url} download={name || 'attachment.pdf'} className="vw-fallback">
              <FileText size={16} />
              Open {name || 'this PDF'}
            </a>
          </object>
        ) : attachment.kind === 'audio' ? (
          <audio src={url} controls className="vw-audio" />
        ) : (
          <p className="text-muted">Nothing to show for that.</p>
        )}
        {name ? <p className="vw-name">{name}</p> : null}
      </div>
    </div>
  )
}
