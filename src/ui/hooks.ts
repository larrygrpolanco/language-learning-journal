import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/db'
import { touchNotebook } from '../journal/writes'
import type { Id, Media } from '../db/types'

/**
 * The notebook for the current route, and a note that it was opened.
 *
 * `touchNotebook` runs once per mount, which is what moves the gold spine on the notebooks screen. It
 * writes `lastOpenedAt`, so it must not run on every render or the timeline would rewrite the record
 * continuously.
 */
export const useNotebook = (notebookId: Id | undefined) => {
  const notebook = useLiveQuery(
    () => (notebookId ? db.notebooks.get(notebookId) : undefined),
    [notebookId],
  )

  useEffect(() => {
    if (notebookId) void touchNotebook(notebookId)
  }, [notebookId])

  return notebook
}

/**
 * An object URL for a Blob, revoked when it changes or the component unmounts.
 *
 * Without the revoke, every thumbnail render leaks its blob for the life of the document, which on a
 * timeline of photographed textbook pages adds up fast.
 */
export const useBlobUrl = (blob: Blob | undefined): string | undefined => {
  const [url, setUrl] = useState<string>()

  useEffect(() => {
    if (!blob) {
      setUrl(undefined)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  return url
}

/** Media rows for a set of ids, in the order asked for. */
export const useMedia = (ids: readonly Id[]): Map<Id, Media> => {
  const key = ids.join(',')
  const rows = useLiveQuery(async () => {
    if (ids.length === 0) return []
    return (await db.media.bulkGet([...ids])).flatMap((m) => (m ? [m] : []))
    // key stands in for ids, which is a new array on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return new Map((rows ?? []).map((m) => [m.id, m]))
}

/** Reads an image's intrinsic size, so the plate can be laid out without a reflow later. */
export const imageSize = (file: Blob): Promise<{ width: number; height: number } | undefined> =>
  new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
      URL.revokeObjectURL(url)
    }
    img.onerror = () => {
      resolve(undefined)
      URL.revokeObjectURL(url)
    }
    img.src = url
  })

/** Which `Attachment.kind` a picked file is. Anything unrecognised is kept as bytes, not guessed at. */
export const kindOf = (mime: string): 'image' | 'pdf' | 'audio' | 'text' => {
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('audio/')) return 'audio'
  return 'text'
}
