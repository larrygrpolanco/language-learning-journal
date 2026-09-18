import { FileText, Music } from 'lucide-react'
import type { Attachment, Media } from '../db/types'
import { useBlobUrl } from './hooks'

/**
 * A matted attachment. Every image in this design sits inside a plate: a 6px mat, a hairline outline,
 * and a warm archival filter.
 *
 * A pdf or audio attachment has no thumbnail, so it gets the same mat around an icon and its filename
 * rather than a broken image.
 */
export const Plate = ({
  attachment,
  media,
  width,
  height,
  onClick,
}: {
  attachment: Attachment
  media: Media | undefined
  width: number
  height: number
  onClick?: () => void
}) => {
  const url = useBlobUrl(attachment.kind === 'image' ? media?.bytes : undefined)
  const style = { width, height } as const

  const inner =
    attachment.kind === 'image' && url ? (
      <img src={url} alt={attachment.filename ?? ''} className="plate-img" />
    ) : (
      <span className="plate-icon">
        {attachment.kind === 'audio' ? <Music size={16} /> : <FileText size={16} />}
        {attachment.filename ? <span className="plate-name">{attachment.filename}</span> : null}
      </span>
    )

  if (onClick) {
    return (
      <button type="button" className="plate plate-btn" style={style} onClick={onClick}>
        {inner}
      </button>
    )
  }
  return (
    <span className="plate" style={style}>
      {inner}
    </span>
  )
}

/** The striped stand-in the mocks use, for an image whose bytes have not loaded yet. */
export const PlateEmpty = ({ width, height }: { width: number; height: number }) => (
  <span className="plate plate-empty" style={{ width, height }} />
)

/**
 * A matted image that is only bytes.
 *
 * `Plate` needs an `Attachment` and a `Media`, and a workbook holds neither: generated images live in
 * React state and die with the sheet (§7), so there is nothing in the database to point at until the
 * learner presses Keep. This gets them the same mat, hairline and archival filter without inventing
 * records for pictures that may never become any.
 */
export const BlobPlate = ({
  blob,
  width,
  height,
  alt = '',
}: {
  blob: Blob
  width: number
  height: number
  alt?: string
}) => {
  const url = useBlobUrl(blob)
  if (!url) return <PlateEmpty width={width} height={height} />
  return (
    <span className="plate" style={{ width, height }}>
      <img src={url} alt={alt} className="plate-img" />
    </span>
  )
}
